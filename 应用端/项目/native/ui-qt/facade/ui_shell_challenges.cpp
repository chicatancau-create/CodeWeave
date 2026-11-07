#include "ui_shell.hpp"
#include "challenge_submission_store.hpp"
#include "external_evidence_service.hpp"

#include <QDateTime>
#include <QJsonValue>
#include <QMetaObject>
#include <QRegularExpression>
#include <QSet>
#include <QUuid>
#include <algorithm>

bool UiShell::mentionsAcceptance(const QString& summary, const QVariantMap& challenge) {
  static const QRegularExpression separators(QStringLiteral(R"([\s，。、；：！？,.;:!?/|（）()【】\[\]“”"'`]+)"));
  static const QRegularExpression whitespace(QStringLiteral("\\s+"));
  static const QRegularExpression number(QStringLiteral("^[0-9.]+$"));
  const auto normalized = [](QString text) { return text.remove(whitespace).toLower(); };
  QStringList source;
  for (const auto* field : {"targetOutput", "evidence"})
    for (const auto& value : challenge.value(field).toList()) source.append(value.toString());
  const auto tokens = source.join(' ').split(separators, Qt::SkipEmptyParts);
  const auto actual = normalized(summary);
  bool has_keywords = false;
  for (const auto& token : tokens) {
    if (token.size() < 2 || number.match(token).hasMatch()) continue;
    has_keywords = true;
    const auto keyword = normalized(token);
    if (actual.contains(keyword)) return true;
    QSet<QChar> characters;
    for (const auto character : keyword) characters.insert(character);
    qsizetype hits = 0;
    for (const auto character : characters) if (actual.contains(character)) ++hits;
    // Match the web's loose 60% character coverage, never execution truth.
    if (characters.isEmpty() || hits * 5 >= characters.size() * 3) return true;
  }
  return !has_keywords;
}

QVariantList UiShell::challengeHistory() const {
  QVariantList history;
  const auto id = selected_challenge_.value("id").toString();
  for (auto it = challenge_submissions_.crbegin(); it != challenge_submissions_.crend(); ++it)
    if (it->toMap().value("challengeId").toString() == id) history.append(*it);
  return history;
}

QVariantMap UiShell::challengeProgress() const {
  QVariantMap progress;
  for (const auto& record : challenge_submissions_) {
    const auto item = record.toMap();
    const auto id = item.value("challengeId").toString();
    const auto previous = progress.value(id).toMap().value("status").toString();
    if ((previous == "verified" || previous == "passed") && item.value("status") == "submitted") continue;
    progress[id] = item;
  }
  return progress;
}

void UiShell::performChallengeHistoryTask(bool write,
    std::function<codeweave::app::Result(const ChallengeSubmissionStore&, QVariantList&)> work) {
  if (closing_ || challenge_history_busy_ || !hasActiveAccount()) return;
  const auto account = active_account_id_;
  const auto generation = account_generation_;
  const auto root = QString::fromStdWString(data_root_.wstring());
  const auto records = std::make_shared<QVariantList>();
  const auto task = QStringLiteral("qt-challenge-history-%1").arg(next_task_id_++);
  challenge_history_task_id_ = task;
  challenge_history_busy_ = true;
  challenge_history_write_ = write;
  challenge_history_status_ = write ? QStringLiteral("正在保存挑战记录…") : QStringLiteral("正在读取挑战记录…");
  emit challengeHistoryChanged();
  codeweave::backend::TaskRequest request;
  request.task_id = task.toStdString();
  request.account_id = account.toStdString();
  request.account_generation = generation;
  request.kind = write ? codeweave::backend::TaskKind::Evidence : codeweave::backend::TaskKind::Read;
  request.work = [root, records, work = std::move(work)](const auto& token) {
    if (token.cancelled()) return codeweave::app::Result::failure("挑战记录操作已取消");
    return work(ChallengeSubmissionStore(root), *records);
  };
  const auto submitted = backend_tasks_.submit(std::move(request),
      [this, task, account, generation, records](codeweave::backend::TaskResult result) mutable {
        QMetaObject::invokeMethod(this, [this, task, account, generation, records, result = std::move(result)] {
          if (task != challenge_history_task_id_) return;
          challenge_history_task_id_.clear();
          challenge_history_busy_ = false;
          if (closing_ || account != active_account_id_ || generation != account_generation_) return;
          if (result.result.ok && !result.cancelled) challenge_submissions_ = *records;
          challenge_history_status_ = result.cancelled ? QStringLiteral("挑战记录操作已取消")
              : QString::fromUtf8(result.result.message);
          emit challengeHistoryChanged();
        }, Qt::QueuedConnection);
      });
  if (!submitted.ok) {
    challenge_history_task_id_.clear();
    challenge_history_busy_ = false;
    challenge_history_status_ = QString::fromUtf8(submitted.message);
    emit challengeHistoryChanged();
  }
}

void UiShell::refreshChallengeHistory() {
  performChallengeHistoryTask(false, [](const ChallengeSubmissionStore& store, QVariantList& records) {
    return store.read(records);
  });
}

void UiShell::submitChallenge(const QString& evidence, const QVariantMap& externalEvidence) {
  const auto fail = [this](const QString& message) {
    challenge_history_status_ = message;
    emit challengeHistoryChanged();
  };
  if (closing_ || account_busy_ || challenge_run_busy_ || challenge_history_busy_ ||
      execution_busy_ || operation_busy_ || selected_challenge_.isEmpty()) return;
  if (!hasActiveAccount()) { fail(QStringLiteral("请先登录再提交挑战")); return; }
  const auto id = selected_challenge_.value("id").toString();
  const bool external = selected_challenge_.value("runner") == "external";
  QString summary = evidence.trimmed();
  if (external) {
    codeweave::learning::EvidenceRecord prepared;
    const codeweave::learning::ExternalEvidenceFields fields{
        externalEvidence.value("environment").toString().toUtf8().toStdString(),
        externalEvidence.value("command").toString().toUtf8().toStdString(),
        externalEvidence.value("resultSummary").toString().toUtf8().toStdString(),
        externalEvidence.value("artifactRef").toString().toUtf8().toStdString(),
        externalEvidence.value("reproducedOn").toString().toUtf8().toStdString()};
    const auto validation = codeweave::learning::prepare_external_evidence(
        id.toStdString(), fields, "op-challenges-0123ab", "challenge-validation", prepared);
    if (!validation.ok) { fail(QString::fromUtf8(validation.message)); return; }
    if (!mentionsAcceptance(externalEvidence.value("resultSummary").toString(), selected_challenge_)) {
      fail(QStringLiteral("结果摘要没有提到本关的任何验收点，请写明对应的实际结果")); return;
    }
    summary = QString::fromUtf8(prepared.actual_result);
    if (!prepared.artifact_refs.empty()) summary += QStringLiteral("\n日志 / 截图引用：") + QString::fromUtf8(prepared.artifact_refs.front());
  } else {
    if (summary.isEmpty() || summary.size() > 400 || summary.contains(QChar::Null)) {
      fail(QStringLiteral("请填写 1–400 字的完成证据说明")); return;
    }
    if (challenge_run_result_.contains("error") || !challenge_run_result_.value("passed").toBool() ||
        (challenge_run_result_.value("tier") != "teaching" && challenge_run_result_.value("tier") != "qt-js")) {
      fail(QStringLiteral("请先运行当前代码并命中全部验收点")); return;
    }
  }
  const QVariantMap record{
      {"id", "submission-" + QUuid::createUuid().toString(QUuid::Id128)}, {"challengeId", id},
      {"submittedAt", QDateTime::currentDateTimeUtc().toString(Qt::ISODateWithMs)},
      {"status", external ? "submitted" : "passed"},
      {"tier", external ? QVariant("external") : challenge_run_result_.value("tier")},
      {"judgeMode", external ? "" : "exact-lines"}, {"evidence", summary},
      {"code", external ? QString() : challengeCode()},
      {"expected", selected_challenge_.value("targetOutput")},
      {"output", external ? QVariant(QVariantList{}) : challenge_run_result_.value("output")},
      {"observation", ""}, {"reviewedAt", ""}};
  // Repeated clicks on an unchanged successful/pending snapshot are idempotent.
  // A rejected external attempt can be submitted again and keeps its old review.
  const auto history = challengeHistory();
  if (!history.isEmpty()) {
    const auto last = history.first().toMap();
    bool same = last.value("status") != "rejected";
    for (const auto* key : {"challengeId", "tier", "evidence", "code", "expected", "output"})
      same = same && QJsonValue::fromVariant(last.value(key)) == QJsonValue::fromVariant(record.value(key));
    if (same) { fail(QStringLiteral("该次挑战结果已提交")); return; }
  }
  performChallengeHistoryTask(true, [record](const ChallengeSubmissionStore& store, QVariantList& records) {
    return store.append(record, records);
  });
}

void UiShell::reviewChallengeSubmission(const QString& submissionId, bool passed, const QString& observation) {
  if (closing_ || account_busy_ || challenge_run_busy_ || execution_busy_ || operation_busy_ ||
      challenge_history_busy_ || !hasActiveAccount()) return;
  const auto history = challengeHistory();
  const auto found = std::find_if(history.cbegin(), history.cend(), [&](const auto& item) {
    return item.toMap().value("id").toString() == submissionId;
  });
  if (found == history.cend()) {
    challenge_history_status_ = QStringLiteral("找不到当前关卡的提交记录");
    emit challengeHistoryChanged();
    return;
  }
  performChallengeHistoryTask(true, [submissionId, passed, observation](const ChallengeSubmissionStore& store, QVariantList& records) {
    return store.review(submissionId, passed, observation, records);
  });
}
