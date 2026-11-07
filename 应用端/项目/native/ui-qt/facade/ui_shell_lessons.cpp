#include "ui_shell.hpp"
#include "external_evidence_service.hpp"
#include "output_comparison.hpp"

#include <QDateTime>
#include <QMetaObject>
#include <QUuid>

QVariantMap UiShell::lessonAssessment() const {
  const auto states = lesson_evidence_states_.value(selected_content_id_).toMap();
  const bool completed = states.value("autoVerifiedPassed").toBool() ||
      states.value("selfDeclaredPassed").toBool() || states.value("reviewMastered").toBool();
  const bool ready = hasSelectedContent() && !selected_content_id_.startsWith("free-") &&
      lesson_contract_ready_ && !content_busy_;
  const bool external = ready && execution_policy_ == "external";
  const bool local = ready && execution_policy_ == "native" && !starter_code_.trimmed().isEmpty();
  const bool ran = local && lesson_run_succeeded_ && lesson_run_revision_ == draft_revision_;
  const bool contract = local && !lesson_expected_output_.isEmpty();
  QVariantList cases, extras;
  bool verified = false;
  int matched = 0;
  if (contract) {
    std::vector<std::string> expected;
    for (const auto& line : lesson_expected_output_) expected.push_back(line.toUtf8().toStdString());
    const auto judgement = codeweave::learning::judge_output(expected,
        ran ? execution_output_.toUtf8().toStdString() : std::string{});
    verified = ran && judgement.passed;
    for (const auto& item : judgement.cases) {
      if (item.matched) ++matched;
      cases.append(QVariantMap{{"expected", QString::fromUtf8(item.expected)},
          {"matched", item.matched}, {"reason", QString::fromUtf8(item.reason)}});
    }
    for (const auto& line : judgement.extra_lines) extras.append(QString::fromUtf8(line));
  }
  const bool available = ready && lesson_evidence_ready_ && hasActiveAccount() && !closing_ && !account_busy_ &&
      !operation_busy_ && !execution_busy_ && !draft_saving_ && !draft_persistence_blocked_ &&
      !challenge_run_busy_ && !challenge_history_busy_;
  QString label = QStringLiteral("标记完成（自行声明）");
  if (!hasActiveAccount()) label = QStringLiteral("登录后可记录学习证据");
  else if (!ready) label = QStringLiteral("课程契约未就绪");
  else if (!lesson_evidence_ready_) label = QStringLiteral("学习证据尚未读取");
  else if (completed) label = QStringLiteral("本单元已完成");
  else if (local && !ran) label = QStringLiteral("运行成功后可标记完成");
  else if (contract && !verified) label = QStringLiteral("验收点 %1/%2 未全中").arg(matched).arg(cases.size());
  else if (verified) label = QStringLiteral("标记完成（自动验证）");
  QString source;
  if (states.value("autoVerifiedPassed").toBool()) source = QStringLiteral("该题验收点自动比对通过");
  else if (states.value("selfDeclaredPassed").toBool()) source = QStringLiteral("学习者自行声明，系统未比对输出");
  else if (states.value("reviewMastered").toBool()) source = QStringLiteral("到期复测判为掌握，本课没有逐题验收记录");
  return {{"ready", ready}, {"external", external}, {"local", local}, {"ran", ran},
      {"completed", completed}, {"completionSource", source}, {"buttonLabel", label},
      {"canComplete", available && !completed && (!local || ran) && (!contract || verified)},
      {"canMarkRead", available && !selected_content_body_.isEmpty() && !states.value("read").toBool()},
      {"autoVerified", verified}, {"cases", cases}, {"extraLines", extras}};
}

codeweave::app::Result UiShell::recordLessonFact(const std::filesystem::path& root,
    const QString& document, const QString& signal, const QString& note,
    bool verified, bool independent, bool hintsViewed) {
  using namespace codeweave::learning;
  MasteryStore store(root);
  std::vector<MasteryEvidence> previous;
  const auto read = store.read_all(previous);
  if (!read.ok) return read;
  const bool completion = signal == "completion";
  const auto prefix = signal == "read" ? QStringLiteral("学习信号：已阅读 · ")
      : QStringLiteral("学习信号：已练习 · ");
  for (const auto& item : previous) {
    if (item.ref_id != document.toStdString()) continue;
    if ((completion && item.passed && (item.kind == MasteryEvidenceKind::Lesson || item.kind == MasteryEvidenceKind::Review)) ||
        (!completion && item.kind == MasteryEvidenceKind::Lesson && QString::fromUtf8(item.note).startsWith(prefix)))
      return codeweave::app::Result::success("该学习事实已记录，未重复写入");
  }
  const auto unique = QUuid::createUuid().toString(QUuid::Id128).toStdString();
  const MasteryEvidence evidence{"lesson-" + unique, MasteryEvidenceKind::Lesson,
      document.toStdString(), note.toUtf8().toStdString(),
      QDateTime::currentDateTimeUtc().toString(Qt::ISODateWithMs).toStdString(), completion,
      verified ? CompletionVerification::AutoVerified : CompletionVerification::SelfDeclared,
      RanBy::Learner, completion && independent, hintsViewed ? "L3" : "L1",
      "op-" + unique.substr(0, 20) + "-" + unique.substr(26)};
  bool duplicate = false;
  // Completion is a fact even without independent mastery eligibility. Replay
  // retains the existing eligibility gate for level and review-plan changes.
  const auto saved = store.append_idempotent(evidence, duplicate);
  if (!saved.ok) return saved;
  return codeweave::app::Result::success(completion ? "课程完成证据已保存" : "学习痕迹已保存，不计为完成");
}

void UiShell::saveLessonFact(const QString& signal, const QString& note, bool verified) {
  const auto root = data_root_;
  const auto account = active_account_id_;
  const auto generation = account_generation_;
  const auto document = selected_content_id_;
  const bool independent = independent_attempt_ && !hints_viewed_;
  const bool hintsViewed = hints_viewed_;
  const auto task = QStringLiteral("qt-lesson-%1").arg(next_task_id_++);
  operation_busy_ = true;
  emit operationBusyChanged();
  codeweave::backend::TaskRequest request;
  request.task_id = task.toStdString();
  request.account_id = account.toStdString();
  request.account_generation = generation;
  request.kind = codeweave::backend::TaskKind::Evidence;
  request.work = [root, document, signal, note, verified, independent, hintsViewed](const auto& token) {
    if (token.cancelled()) return codeweave::app::Result::failure("课程证据保存已取消");
    return recordLessonFact(root, document, signal, note, verified, independent, hintsViewed);
  };
  operation_task_id_ = task;
  const auto submitted = backend_tasks_.submit(std::move(request),
      [this, account, generation, task](codeweave::backend::TaskResult result) {
        QMetaObject::invokeMethod(this, [this, account, generation, task, result = std::move(result)] {
          if (task != operation_task_id_) return;
          operation_task_id_.clear();
          operation_busy_ = false;
          emit operationBusyChanged();
          if (closing_ || account != active_account_id_ || generation != account_generation_) return;
          setOperationStatus(result.cancelled ? QStringLiteral("课程证据保存已取消") : QString::fromUtf8(result.result.message));
          if (result.result.ok && !result.cancelled) refreshReviewSummary();
        }, Qt::QueuedConnection);
      });
  if (!submitted.ok) {
    operation_task_id_.clear();
    operation_busy_ = false;
    emit operationBusyChanged();
    setOperationStatus(QString::fromUtf8(submitted.message));
  }
}

void UiShell::markLessonRead() {
  if (!lessonAssessment().value("canMarkRead").toBool()) return;
  saveLessonFact("read", QStringLiteral("学习信号：已阅读 · 课程「%1」：学习者标记读过正文，不构成完成证明，不推进掌握等级")
      .arg(selected_content_id_), false);
}

void UiShell::completeLesson(const QVariantMap& externalEvidence) {
  const auto assessment = lessonAssessment();
  if (!assessment.value("canComplete").toBool()) {
    setOperationStatus(assessment.value("buttonLabel").toString());
    return;
  }
  const bool verified = assessment.value("autoVerified").toBool();
  QString note = verified ? QStringLiteral("本课验收点逐行命中（exact-lines），学习者标记完成")
      : QStringLiteral("学习者自行声明完成，系统未比对输出");
  if (assessment.value("external").toBool()) {
    codeweave::learning::EvidenceRecord prepared;
    const codeweave::learning::ExternalEvidenceFields fields{
        externalEvidence.value("environment").toString().toUtf8().toStdString(),
        externalEvidence.value("command").toString().toUtf8().toStdString(),
        externalEvidence.value("resultSummary").toString().toUtf8().toStdString(),
        externalEvidence.value("artifactRef").toString().toUtf8().toStdString(),
        externalEvidence.value("reproducedOn").toString().toUtf8().toStdString()};
    const auto checked = codeweave::learning::prepare_external_evidence(
        selected_content_id_.toStdString(), fields, "op-lesson-0123ab", "lesson-validation", prepared);
    if (!checked.ok) { setOperationStatus(QString::fromUtf8(checked.message)); return; }
    QVariantMap acceptance{{"targetOutput", lesson_expected_output_}};
    for (const auto& value : lesson_meta_) {
      const auto lesson = value.toMap();
      if (lesson.value("id") == selected_content_id_) acceptance["evidence"] = lesson.value("evidenceChecklist");
    }
    if (!mentionsAcceptance(externalEvidence.value("resultSummary").toString(), acceptance)) {
      setOperationStatus(QStringLiteral("结果摘要没有提到本课的任何验收点，请补充实际结果"));
      return;
    }
    note += '\n' + QString::fromUtf8(prepared.actual_result);
    if (!prepared.artifact_refs.empty()) note += QStringLiteral("\n日志 / 截图引用：") + QString::fromUtf8(prepared.artifact_refs.front());
    if (note.toUtf8().size() > 4000) {
      setOperationStatus(QStringLiteral("课程完成证据超过账本上限，请缩短摘要"));
      return;
    }
  }
  saveLessonFact("completion", note, verified);
}
