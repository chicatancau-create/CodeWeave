#include "ui_shell.hpp"

#include "content_repository.hpp"
#include "challenge_runtime.hpp"
#include "output_comparison.hpp"

#include <QEventLoop>
#include <QDir>
#include <QFile>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QMetaObject>
#include <QSettings>
#include <QTimer>

#include <algorithm>
#include <filesystem>
#include <memory>
#include <vector>

UiShell::UiShell(QObject* parent)
    : QObject(parent), current_page_(QStringLiteral("学习")),
      content_status_(QStringLiteral("尚未加载课程内容")), backend_tasks_(4) {
  connect(this, &UiShell::selectedContentChanged, this, &UiShell::lessonAssessmentChanged);
  connect(this, &UiShell::starterCodeChanged, this, &UiShell::lessonAssessmentChanged);
  connect(this, &UiShell::contentBusyChanged, this, &UiShell::lessonAssessmentChanged);
  connect(this, &UiShell::draftChanged, this, &UiShell::lessonAssessmentChanged);
  connect(this, &UiShell::draftSavingChanged, this, &UiShell::lessonAssessmentChanged);
  connect(this, &UiShell::executionBusyChanged, this, &UiShell::lessonAssessmentChanged);
  connect(this, &UiShell::executionOutputChanged, this, &UiShell::lessonAssessmentChanged);
  connect(this, &UiShell::reviewSummaryChanged, this, &UiShell::lessonAssessmentChanged);
  connect(this, &UiShell::operationBusyChanged, this, &UiShell::lessonAssessmentChanged);
  connect(this, &UiShell::accountChanged, this, &UiShell::lessonAssessmentChanged);
  connect(this, &UiShell::accountBusyChanged, this, &UiShell::lessonAssessmentChanged);
  connect(this, &UiShell::challengeRunBusyChanged, this, &UiShell::lessonAssessmentChanged);
  connect(this, &UiShell::challengeHistoryChanged, this, &UiShell::lessonAssessmentChanged);
  connect(this, &UiShell::draftPersistenceBlockedChanged, this, &UiShell::lessonAssessmentChanged);
}

// §14.5 要求：关闭时进入 Closing、对在飞任务发取消、**同时保持事件泵**，
// 只有 worker 真停了才回收线程与服务。
// 改之前是析构里 close() + wait_closed()：close() 不取消在飞任务，wait_closed()
// 又在 UI 线程直接 join，于是冻结时长等于任务完整时长（备份/派生都是几百毫秒起）。
bool UiShell::drain_backend_tasks(int budget_ms) {
  closing_ = true;
  execution_cancelled_.store(true, std::memory_order_release);
  challenge_cancelled_.store(true, std::memory_order_release);
  backend_tasks_.close();
  if (!backend_tasks_.stopped()) {
    QEventLoop pump;
    QTimer tick;
    QObject::connect(&tick, &QTimer::timeout, &pump, [this, &pump] {
      if (backend_tasks_.stopped()) pump.quit();
    });
    tick.start(15);
    QTimer::singleShot(budget_ms, &pump, &QEventLoop::quit);
    pump.exec();
  }
  if (!backend_tasks_.stopped()) return false;
  backend_tasks_.wait_closed();
  return true;
}

UiShell::~UiShell() {
  // 析构阶段没有可泵的事件循环宿主了，给足预算；超时也要走 wait_closed()，
  // 因为 backend_tasks_ 作为成员随后会自己等 stopped 并 join —— 提前收干净是唯一选择。
  if (!drain_backend_tasks(5000)) backend_tasks_.wait_closed();
}

QString UiShell::appTitle() const { return QStringLiteral("CodeWeave"); }

bool UiShell::configurePreferenceStorage(const std::filesystem::path& root) {
  const auto root_path = QString::fromStdWString(root.wstring());
  if (root_path.isEmpty() || !QDir().mkpath(root_path)) return false;

  const auto settings_path = QDir(root_path).filePath(QStringLiteral("preferences.ini"));
  QSettings settings(settings_path, QSettings::IniFormat);
  settings.setFallbacksEnabled(false);
  const bool reduced_motion = settings.value(QStringLiteral("preferences/reducedMotion"), false).toBool();
  bool font_size_valid = false;
  const int stored_font_size = settings.value(QStringLiteral("preferences/editorFontSize"), 13)
      .toInt(&font_size_valid);
  const bool font_size_supported = font_size_valid &&
      (stored_font_size == 12 || stored_font_size == 13 || stored_font_size == 14 ||
       stored_font_size == 15 || stored_font_size == 16 || stored_font_size == 18);
  const int editor_font_size = font_size_supported ? stored_font_size : 13;
  const bool editor_line_numbers = settings.value(QStringLiteral("preferences/editorLineNumbers"), true).toBool();
  if (settings.status() != QSettings::NoError) return false;

  const bool was_ready = preferenceStorageReady();
  preference_settings_path_ = settings_path;
  if (!was_ready) emit preferenceStorageReadyChanged();
  if (reduced_motion_ != reduced_motion) {
    reduced_motion_ = reduced_motion;
    emit reducedMotionChanged();
  }
  if (editor_font_size_ != editor_font_size) {
    editor_font_size_ = editor_font_size;
    emit editorFontSizeChanged();
  }
  if (editor_line_numbers_ != editor_line_numbers) {
    editor_line_numbers_ = editor_line_numbers;
    emit editorLineNumbersChanged();
  }
  return true;
}

bool UiShell::persistPreference(const QString& key, const QVariant& value) {
  if (preference_settings_path_.isEmpty()) return false;

  QSettings settings(preference_settings_path_, QSettings::IniFormat);
  settings.setFallbacksEnabled(false);
  const bool had_value = settings.contains(key);
  const auto previous_value = settings.value(key);
  settings.setValue(key, value);
  settings.sync();
  if (settings.status() == QSettings::NoError) return true;

  if (had_value) settings.setValue(key, previous_value);
  else settings.remove(key);
  settings.sync();
  return false;
}

bool UiShell::setReducedMotion(bool value) {
  if (preference_settings_path_.isEmpty()) return false;
  if (reduced_motion_ == value) return true;
  if (!persistPreference(QStringLiteral("preferences/reducedMotion"), value)) return false;
  reduced_motion_ = value;
  emit reducedMotionChanged();
  return true;
}

bool UiShell::setEditorFontSize(int value) {
  if (value != 12 && value != 13 && value != 14 && value != 15 && value != 16 && value != 18) {
    return false;
  }
  if (preference_settings_path_.isEmpty()) return false;
  if (editor_font_size_ == value) return true;
  if (!persistPreference(QStringLiteral("preferences/editorFontSize"), value)) return false;
  editor_font_size_ = value;
  emit editorFontSizeChanged();
  return true;
}

bool UiShell::setEditorLineNumbers(bool value) {
  if (preference_settings_path_.isEmpty()) return false;
  if (editor_line_numbers_ == value) return true;
  if (!persistPreference(QStringLiteral("preferences/editorLineNumbers"), value)) return false;
  editor_line_numbers_ = value;
  emit editorLineNumbersChanged();
  return true;
}

bool UiShell::restoreDefaultPreferences() {
  if (preference_settings_path_.isEmpty()) return false;

  QSettings settings(preference_settings_path_, QSettings::IniFormat);
  settings.setFallbacksEnabled(false);
  const QStringList keys = {
      QStringLiteral("preferences/reducedMotion"),
      QStringLiteral("preferences/editorFontSize"),
      QStringLiteral("preferences/editorLineNumbers"),
  };
  QVariantMap previous_values;
  for (const auto& key : keys) {
    if (settings.contains(key)) previous_values.insert(key, settings.value(key));
    settings.remove(key);
  }
  settings.sync();
  if (settings.status() != QSettings::NoError) {
    for (auto it = previous_values.cbegin(); it != previous_values.cend(); ++it) {
      settings.setValue(it.key(), it.value());
    }
    settings.sync();
    return false;
  }

  if (reduced_motion_) {
    reduced_motion_ = false;
    emit reducedMotionChanged();
  }
  if (editor_font_size_ != 13) {
    editor_font_size_ = 13;
    emit editorFontSizeChanged();
  }
  if (!editor_line_numbers_) {
    editor_line_numbers_ = true;
    emit editorLineNumbersChanged();
  }
  return true;
}

QString UiShell::currentPage() const { return current_page_; }

QStringList UiShell::publishedTitles() const { return published_titles_; }

QString UiShell::selectedContentBody() const { return selected_content_body_; }

QString UiShell::starterLanguage() const { return starter_language_; }

QString UiShell::starterCode() const { return starter_code_; }

QString UiShell::executionPolicy() const { return execution_policy_; }

bool UiShell::hasSelectedContent() const { return selected_content_index_ >= 0; }

QString UiShell::draftCode() const { return draft_code_; }

bool UiShell::draftDirty() const { return draft_code_ != draft_saved_code_; }

bool UiShell::hasActiveAccount() const { return !active_account_id_.isEmpty(); }

QString UiShell::activeAccountId() const { return active_account_id_; }

bool UiShell::draftSaving() const { return draft_saving_; }

bool UiShell::draftPersistenceBlocked() const { return draft_persistence_blocked_; }

QString UiShell::contentStatus() const { return content_status_; }

bool UiShell::contentBusy() const { return content_busy_; }

void UiShell::loadPublishedContent(const QString& root) {
  content_root_ = root;
  closeChallenge();
  challenge_meta_.clear();
  // Load lesson metadata from curriculum.v1.json adjacent to the content dir.
  // This is the full curriculum object including description, level, languageLabel,
  // and flow nodes — needed for the rich homepage cards and the execution canvas.
  // The catalog.v1.tsv only has id/title/status/language, so we read the JSON.
  QFile curriculum_file(QDir(root).filePath(QStringLiteral("curriculum.v1.json")));
  if (curriculum_file.open(QIODevice::ReadOnly)) {
    const auto doc = QJsonDocument::fromJson(curriculum_file.readAll());
    const auto lessons = doc.object().value(QStringLiteral("lessons")).toArray();
    QVariantList meta;
    for (const auto& entry : lessons) {
      const auto obj = entry.toObject();
      QVariantMap m;
      m[QStringLiteral("id")] = obj.value(QStringLiteral("id")).toString();
      m[QStringLiteral("label")] = obj.value(QStringLiteral("label")).toString();
      m[QStringLiteral("title")] = obj.value(QStringLiteral("title")).toString();
      m[QStringLiteral("description")] = obj.value(QStringLiteral("description")).toString();
      m[QStringLiteral("language")] = obj.value(QStringLiteral("language")).toString();
      m[QStringLiteral("languageLabel")] = obj.value(QStringLiteral("languageLabel")).toString();
      m[QStringLiteral("level")] = obj.value(QStringLiteral("level")).toString();
      m[QStringLiteral("duration")] = obj.value(QStringLiteral("duration")).toString();
      m[QStringLiteral("content")] = obj.value(QStringLiteral("content")).toObject().toVariantMap();
      for (const auto* field : {"stageId", "reading", "code", "fileName", "legacy", "contentId",
                               "source", "exercise", "executable"}) {
        const auto key = QString::fromLatin1(field);
        if (obj.contains(key)) m[key] = obj.value(key).toVariant();
      }
      m[QStringLiteral("prerequisites")] = obj.value(QStringLiteral("content")).toObject()
          .value(QStringLiteral("prerequisites")).toVariant();
      auto acceptance = obj.value(QStringLiteral("content")).toObject().value(QStringLiteral("evidenceChecklist")).toArray();
      const auto completion = obj.value(QStringLiteral("content")).toObject().value(QStringLiteral("completion")).toString();
      if (!completion.isEmpty()) acceptance.append(completion);
      m[QStringLiteral("evidenceChecklist")] = acceptance.toVariantList();
      // Flatten flow nodes to a QVariantList so QML can render the canvas skeleton.
      const auto flow_arr = obj.value(QStringLiteral("flow")).toArray();
      QVariantList flow;
      for (const auto& fn : flow_arr) {
        const auto fn_obj = fn.toObject();
        QVariantMap node;
        node[QStringLiteral("id")] = fn_obj.value(QStringLiteral("id")).toString();
        node[QStringLiteral("label")] = fn_obj.value(QStringLiteral("label")).toString();
        node[QStringLiteral("kind")] = fn_obj.value(QStringLiteral("kind")).toString();
        node[QStringLiteral("tone")] = fn_obj.value(QStringLiteral("tone")).toString();
        node[QStringLiteral("line")] = fn_obj.value(QStringLiteral("line")).toInt();
        flow.append(node);
      }
      m[QStringLiteral("flow")] = flow;
      meta.append(m);
    }
    lesson_meta_ = meta;

    // Challenges drive the 实战挑战 page. Same one-time read as the lessons.
    const auto challenges = doc.object().value(QStringLiteral("challenges")).toArray();
    QVariantList challenge_meta;
    for (const auto& entry : challenges) {
      const auto obj = entry.toObject();
      QVariantMap c;
      c[QStringLiteral("id")] = obj.value(QStringLiteral("id")).toString();
      c[QStringLiteral("stageId")] = obj.value(QStringLiteral("stageId")).toString();
      c[QStringLiteral("track")] = obj.value(QStringLiteral("track")).toString();
      c[QStringLiteral("title")] = obj.value(QStringLiteral("title")).toString();
      c[QStringLiteral("description")] = obj.value(QStringLiteral("description")).toString();
      c[QStringLiteral("language")] = obj.value(QStringLiteral("language")).toString();
      c[QStringLiteral("difficulty")] = obj.value(QStringLiteral("difficulty")).toString();
      c[QStringLiteral("runner")] = obj.value(QStringLiteral("runner")).toString();
      QStringList stack;
      for (const auto& s : obj.value(QStringLiteral("stack")).toArray())
        stack.append(s.toString());
      c[QStringLiteral("stack")] = stack;
      c[QStringLiteral("prerequisites")] = obj.value(QStringLiteral("prerequisites")).toArray().toVariantList();
      c[QStringLiteral("starterCode")] = obj.value(QStringLiteral("starterCode")).toString();
      c[QStringLiteral("targetOutput")] = obj.value(QStringLiteral("targetOutput")).toArray().toVariantList();
      c[QStringLiteral("evidence")] = obj.value(QStringLiteral("evidence")).toArray().toVariantList();
      c[QStringLiteral("hint")] = obj.value(QStringLiteral("hint")).toString();
      c[QStringLiteral("explanation")] = obj.value(QStringLiteral("explanation")).toString();
      challenge_meta.append(c);
    }
    challenge_meta_ = challenge_meta;
  }
  reloadPublishedContent();
}

void UiShell::openChallenge(const QString& challengeId) {
  const auto match = std::find_if(challenge_meta_.cbegin(), challenge_meta_.cend(),
      [&challengeId](const QVariant& value) {
        return value.toMap().value(QStringLiteral("id")).toString() == challengeId;
      });
  if (match == challenge_meta_.cend()) return;
  const auto selected = match->toMap();
  selectPage(QStringLiteral("挑战"));
  if (selected_challenge_ == selected) return;
  if (challenge_run_busy_) cancelChallenge();
  ++challenge_revision_;
  selected_challenge_ = selected;
  if (!challenge_drafts_.contains(challengeId))
    challenge_drafts_.insert(challengeId, selected.value(QStringLiteral("starterCode")).toString());
  challenge_run_result_.clear();
  emit challengeSelectionChanged();
  emit challengeCodeChanged();
  emit challengeRunResultChanged();
  emit challengeHistoryChanged();
}

void UiShell::closeChallenge() {
  if (selected_challenge_.isEmpty()) return;
  if (challenge_run_busy_) cancelChallenge();
  ++challenge_revision_;
  selected_challenge_.clear();
  challenge_run_result_.clear();
  emit challengeSelectionChanged();
  emit challengeRunResultChanged();
  emit challengeHistoryChanged();
}

QString UiShell::challengeCode() const {
  return challenge_drafts_.value(selected_challenge_.value(QStringLiteral("id")).toString(),
      selected_challenge_.value(QStringLiteral("starterCode")).toString());
}

void UiShell::updateChallengeCode(const QString& code) {
  if (selected_challenge_.isEmpty() || code.toUtf8().size() > 65536) return;
  const auto id = selected_challenge_.value(QStringLiteral("id")).toString();
  if (challenge_drafts_.value(id) == code) return;
  challenge_drafts_.insert(id, code);
  ++challenge_revision_;
  if (challenge_run_busy_) cancelChallenge();
  challenge_run_result_.clear();
  emit challengeCodeChanged();
  emit challengeRunResultChanged();
}

void UiShell::runChallenge() {
  if (closing_ || account_busy_ || selected_challenge_.isEmpty() || challenge_run_busy_ ||
      execution_busy_ || operation_busy_) return;
  const auto runner = selected_challenge_.value(QStringLiteral("runner")).toString();
  if (runner != QStringLiteral("teaching") && runner != QStringLiteral("javascript-sandbox")) {
    challenge_run_result_ = {{QStringLiteral("error"), QStringLiteral("本关需要在外部环境完成")}};
    emit challengeRunResultChanged();
    return;
  }
  const auto source = challengeCode();
  if (source.trimmed().isEmpty() || source.toUtf8().size() > 65536) {
    challenge_run_result_ = {{QStringLiteral("error"), QStringLiteral("代码为空或超过 64 KiB 上限")}};
    emit challengeRunResultChanged();
    return;
  }
  challenge_cancelled_.store(false, std::memory_order_release);
  challenge_run_result_.clear();
  emit challengeRunResultChanged();
  challenge_run_busy_ = true;
  emit challengeRunBusyChanged();
  const auto selected = selected_challenge_;
  const auto generation = account_generation_;
  const auto revision = challenge_revision_;
  const auto request_name = QStringLiteral("qt-challenge-%1").arg(next_task_id_++);
  challenge_task_id_ = request_name;
  codeweave::backend::TaskRequest request;
  request.task_id = request_name.toStdString();
  request.account_id = active_account_id_.toStdString();
  request.account_generation = account_generation_;
  request.kind = codeweave::backend::TaskKind::Execute;
  request.work = [selected, source, this](const auto& token) {
    if (token.cancelled()) return codeweave::app::Result::failure("执行已取消");
    QVariantMap run_request{
        {QStringLiteral("runner"), selected.value(QStringLiteral("runner"))},
        {QStringLiteral("language"), selected.value(QStringLiteral("language"))},
        {QStringLiteral("code"), source}};
    const auto raw = run_challenge_process(run_request,
        [&] { return token.cancelled() || challenge_cancelled_.load(std::memory_order_acquire); });
    if (raw.contains(QStringLiteral("error")))
      return codeweave::app::Result::failure(raw.value(QStringLiteral("error")).toString().toStdString());
    return codeweave::app::Result::success(QJsonDocument::fromVariant(raw).toJson(QJsonDocument::Compact).toStdString());
  };
  const auto submitted = backend_tasks_.submit(std::move(request),
      [this, request_name, selected, source, generation, revision](codeweave::backend::TaskResult task_result) mutable {
        QMetaObject::invokeMethod(this, [this, request_name, selected, source, generation, revision,
            task_result = std::move(task_result)]() mutable {
          if (request_name != challenge_task_id_) return;
          challenge_task_id_.clear();
          challenge_run_busy_ = false;
          emit challengeRunBusyChanged();
          if (revision != challenge_revision_ || generation != account_generation_ || source != challengeCode() ||
              selected.value(QStringLiteral("id")) !=
              selected_challenge_.value(QStringLiteral("id"))) return;
          QVariantMap result;
          if (task_result.cancelled) {
            result.insert(QStringLiteral("error"), QStringLiteral("执行已取消"));
          } else if (!task_result.result.ok) {
            result.insert(QStringLiteral("error"), QString::fromUtf8(task_result.result.message));
          } else {
            const auto raw = QJsonDocument::fromJson(QByteArray::fromStdString(task_result.result.message)).object();
            const auto output = raw.value(QStringLiteral("output")).toArray();
            std::vector<std::string> lines;
            for (const auto& value : output) lines.push_back(value.toString().toUtf8().toStdString());
            QStringList expected;
            for (const auto& value : selected.value(QStringLiteral("targetOutput")).toList())
              expected.append(value.toString());
            std::vector<std::string> expected_utf8;
            for (const auto& line : expected) expected_utf8.push_back(line.toUtf8().toStdString());
            const auto judgement = codeweave::learning::judge_output(expected_utf8, lines);
            QVariantList cases;
            for (const auto& item : judgement.cases) {
              cases.append(QVariantMap{
                  {QStringLiteral("expected"), QString::fromUtf8(item.expected)},
                  {QStringLiteral("matched"), item.matched},
                  {QStringLiteral("actual"), QString::fromUtf8(item.actual)},
                  {QStringLiteral("reason"), QString::fromUtf8(item.reason)}});
            }
            QVariantList extras;
            for (const auto& line : judgement.extra_lines) extras.append(QString::fromUtf8(line));
            result.insert(QStringLiteral("passed"), judgement.passed);
            result.insert(QStringLiteral("output"), output.toVariantList());
            result.insert(QStringLiteral("cases"), cases);
            result.insert(QStringLiteral("extraLines"), extras);
            result.insert(QStringLiteral("tier"), raw.value(QStringLiteral("tier")).toString());
          }
          challenge_run_result_ = result;
          emit challengeRunResultChanged();
        }, Qt::QueuedConnection);
      });
  if (!submitted.ok) {
    challenge_task_id_.clear();
    challenge_run_busy_ = false;
    emit challengeRunBusyChanged();
    challenge_run_result_ = {{QStringLiteral("error"), QString::fromUtf8(submitted.message)}};
    emit challengeRunResultChanged();
  }
}

void UiShell::cancelChallenge() {
  if (!challenge_run_busy_) return;
  challenge_cancelled_.store(true, std::memory_order_release);
}

void UiShell::reloadPublishedContent() {
  if (content_busy_ || draft_saving_ || content_root_.isEmpty() || !allowDocumentChange()) return;
  content_busy_ = true;
  content_status_ = QStringLiteral("正在读取课程内容…");
  emit contentBusyChanged();
  emit contentStatusChanged();

  const auto root = std::filesystem::path(content_root_.toStdWString());
  struct ListedContent { QString id; QString title; };
  const auto listed = std::make_shared<std::vector<ListedContent>>();
  const auto task_name = QStringLiteral("qt-content-%1").arg(next_task_id_++);
  const auto task_id = task_name.toStdString();
  content_task_id_ = task_name;
  // 内容链此前不带代次：账户切换后，上一个账户排队的回调仍会无条件覆盖课程清单。
  // 草稿链已有同款守卫（见 ui_shell_draft.cpp），这里补齐以统一口径。
  const auto account = active_account_id_;
  const auto generation = account_generation_;
  codeweave::backend::TaskRequest request;
  request.task_id = task_id;
  request.account_id = account.toStdString();
  request.account_generation = generation;
  request.kind = codeweave::backend::TaskKind::Read;
  request.work = [root, listed](const codeweave::backend::CancellationToken& token) {
    if (token.cancelled()) return codeweave::app::Result::failure("读取任务已取消");
    std::vector<codeweave::content::Unit> units;
    codeweave::content::ContentRepository repository(root);
    const auto result = repository.list_published(units);
    if (!result.ok) return result;
    listed->reserve(units.size());
    for (const auto& unit : units) {
      if (token.cancelled()) return codeweave::app::Result::failure("读取任务已取消");
      listed->push_back({QString::fromUtf8(unit.content_id), QString::fromUtf8(unit.title)});
    }
    return result;
  };
  const auto submitted = backend_tasks_.submit(std::move(request),
      [this, listed, account, generation, task_name](codeweave::backend::TaskResult result) mutable {
        QMetaObject::invokeMethod(this,
            [this, listed, account, generation, task_name, result = std::move(result)]() mutable {
              if (task_name != content_task_id_) return;
              content_task_id_.clear();
              content_busy_ = false;
              emit contentBusyChanged();
              if (account != active_account_id_ || generation != account_generation_) {
                return;
              }
              if (result.cancelled) {
                content_status_ = QStringLiteral("课程读取已取消");
                emit contentStatusChanged();
                return;
              }
              if (result.result.ok) {
                QStringList next_titles;
                QStringList next_ids;
                for (const auto& item : *listed) {
                  next_ids.push_back(item.id);
                  next_titles.push_back(item.title);
                }
                if (published_titles_ != next_titles) {
                  published_titles_ = next_titles;
                  emit publishedTitlesChanged();
                }
                if (published_ids_ != next_ids) {
                  published_ids_ = next_ids;
                  emit publishedIdsChanged();
                }
                selected_content_index_ = -1;
                selected_content_id_.clear();
                selected_content_body_.clear();
                closeChallenge();
                clearDraft();
                emit selectedContentChanged();
                emit selectedContentBodyChanged();
                content_status_ = QStringLiteral("已读取 %1 门已发布课程")
                    .arg(published_titles_.size());
              } else {
                content_status_ = QString::fromUtf8(result.result.message);
              }
              emit contentStatusChanged();
            }, Qt::QueuedConnection);
      });
  if (!submitted.ok) {
    content_task_id_.clear();
    content_busy_ = false;
    content_status_ = QString::fromUtf8(submitted.message);
    emit contentBusyChanged();
    emit contentStatusChanged();
  }
}

void UiShell::openPublishedContent(int index) {
  if (content_busy_ || draft_saving_ || index < 0 || index >= published_ids_.size() || !allowDocumentChange()) return;
  content_busy_ = true;
  content_status_ = QStringLiteral("正在读取课程正文…");
  emit contentBusyChanged();
  emit contentStatusChanged();
  const auto root = std::filesystem::path(content_root_.toStdWString());
  const auto content_id = published_ids_.at(index).toStdString();
  selected_content_id_ = published_ids_.at(index);
  const auto selection_changed = selected_content_index_ != index;
  selected_content_index_ = index;
  selected_content_body_.clear();
  emit selectedContentBodyChanged();
  closeChallenge();
  clearDraft();
  if (selection_changed) emit selectedContentChanged();
  const auto body = std::make_shared<QString>();
  const auto account = active_account_id_;
  const auto generation = account_generation_;
  const auto expected_id = selected_content_id_;
  codeweave::backend::TaskRequest request;
  request.account_id = account.toStdString();
  request.account_generation = generation;
  request.kind = codeweave::backend::TaskKind::Read;
  request.work = [root, content_id, body](const codeweave::backend::CancellationToken& token) {
    if (token.cancelled()) return codeweave::app::Result::failure("读取任务已取消");
    codeweave::content::LoadedUnit unit;
    const auto result = codeweave::content::ContentRepository(root).read_published(content_id, unit);
    if (result.ok) *body = QString::fromUtf8(unit.body);
    return result;
  };
  const auto task_name = QStringLiteral("qt-body-%1").arg(next_task_id_++);
  request.task_id = task_name.toStdString();
  content_task_id_ = task_name;
  const auto submitted = backend_tasks_.submit(std::move(request),
      [this, body, account, generation, expected_id, task_name](codeweave::backend::TaskResult result) mutable {
        QMetaObject::invokeMethod(this, [this, body, account, generation, expected_id, task_name,
            result = std::move(result)]() mutable {
          if (task_name != content_task_id_) return;
          content_task_id_.clear();
          content_busy_ = false;
          emit contentBusyChanged();
          if (account != active_account_id_ || generation != account_generation_ ||
              expected_id != selected_content_id_) {
            return;
          }
          if (result.cancelled) {
            content_status_ = QStringLiteral("课程正文读取已取消");
            emit contentStatusChanged();
            return;
          }
          if (result.result.ok) {
            selected_content_body_ = *body;
            emit selectedContentBodyChanged();
            content_status_ = QStringLiteral("课程正文已读取");
            emit contentStatusChanged();
            loadStarterCode();
          } else {
            content_status_ = QString::fromUtf8(result.result.message);
            emit contentStatusChanged();
          }
        }, Qt::QueuedConnection);
      });
  if (!submitted.ok) {
    content_task_id_.clear();
    content_busy_ = false;
    content_status_ = QString::fromUtf8(submitted.message);
    emit contentBusyChanged();
    emit contentStatusChanged();
  }
}

void UiShell::loadStarterCode() {
  if (content_busy_ || draft_saving_ || !allowDocumentChange() || selected_content_index_ < 0 ||
      selected_content_index_ >= published_ids_.size()) return;
  content_busy_ = true;
  lesson_contract_ready_ = false;
  lesson_run_succeeded_ = false;
  content_status_ = QStringLiteral("正在读取起始代码…");
  emit contentBusyChanged();
  emit contentStatusChanged();
  const auto root = std::filesystem::path(content_root_.toStdWString());
  const auto selected_id = published_ids_.at(selected_content_index_);
  const auto content_id = selected_id.toStdString();
  const auto language = std::make_shared<QString>();
  const auto code = std::make_shared<QString>();
  const auto policy = std::make_shared<QString>();
  const auto expected = std::make_shared<QStringList>();
  const auto account = active_account_id_;
  const auto generation = account_generation_;
  const auto expected_id = selected_id;
  codeweave::backend::TaskRequest request;
  const auto task_name = QStringLiteral("qt-starter-%1").arg(next_task_id_++);
  request.task_id = task_name.toStdString();
  content_task_id_ = task_name;
  request.account_id = account.toStdString();
  request.account_generation = generation;
  request.kind = codeweave::backend::TaskKind::Read;
  request.work = [root, content_id, language, code, policy, expected](const codeweave::backend::CancellationToken& token) {
    if (token.cancelled()) return codeweave::app::Result::failure("读取任务已取消");
    std::string native_language;
    std::string native_code;
    std::string native_policy;
    const auto result = codeweave::content::ContentRepository(root).read_starter(
        content_id, native_language, native_code, native_policy);
    if (result.ok) {
      std::vector<codeweave::content::Exercise> exercises;
      const auto loaded = codeweave::content::ContentRepository(root).list_exercises(content_id, exercises);
      if (!loaded.ok) return loaded;
      if (!exercises.empty())
        for (const auto& line : codeweave::learning::output_lines(exercises.front().expected_output))
          expected->append(QString::fromUtf8(line));
      *language = QString::fromUtf8(native_language);
      *code = QString::fromUtf8(native_code);
      *policy = QString::fromUtf8(native_policy);
    }
    return result;
  };
  const auto submitted = backend_tasks_.submit(std::move(request),
      [this, language, code, policy, expected, account, generation, expected_id, task_name](codeweave::backend::TaskResult result) mutable {
        QMetaObject::invokeMethod(this, [this, language, code, policy, expected, account, generation,
            expected_id, task_name, result = std::move(result)]() mutable {
          if (task_name != content_task_id_) return;
          content_task_id_.clear();
          content_busy_ = false;
          emit contentBusyChanged();
          // 这条回调会覆写 starter/baseline/draft 三组状态并触发 loadAccountDraft()，
          // 旧账户或旧课程的迟到结果一旦落地就是「A 账户的草稿写进 B 账户视图」。
          if (account != active_account_id_ || generation != account_generation_ ||
              expected_id != selected_content_id_) {
            return;
          }
          if (result.cancelled) {
            content_status_ = QStringLiteral("起始代码读取已取消");
            emit contentStatusChanged();
            return;
          }
          if (result.result.ok) {
            starter_language_ = *language;
            starter_code_ = *code;
            execution_policy_ = *policy;
            lesson_expected_output_ = *expected;
            lesson_contract_ready_ = true;
            draft_baseline_ = *code;
            draft_code_ = *code;
            draft_saved_code_ = *code;
            draft_revision_++;
            saved_revision_ = draft_revision_;
            draft_persistence_blocked_ = false;
            emit draftPersistenceBlockedChanged();
            emit starterCodeChanged();
            emit draftChanged();
            emit draftDirtyChanged();
            content_status_ = QStringLiteral("起始代码已读取");
            loadAccountDraft();
          } else {
            content_status_ = QString::fromUtf8(result.result.message);
          }
          emit contentStatusChanged();
        }, Qt::QueuedConnection);
      });
  if (!submitted.ok) {
    content_task_id_.clear();
    content_busy_ = false;
    content_status_ = QString::fromUtf8(submitted.message);
    emit contentBusyChanged();
    emit contentStatusChanged();
  }
}

void UiShell::updateDraftCode(const QString& code) {
  if (closing_ || account_busy_) return;
  if (content_busy_ || draft_persistence_blocked_ || starter_language_.isEmpty() || draft_code_ == code) return;
  const auto was_dirty = draftDirty();
  draft_code_ = code;
  draft_revision_++;
  emit draftChanged();
  if (was_dirty != draftDirty()) emit draftDirtyChanged();
}

void UiShell::resetDraftCode() {
  updateDraftCode(draft_baseline_);
}

void UiShell::selectPage(const QString& page) {
  if (page.isEmpty() || page == current_page_) return;
  current_page_ = page;
  emit currentPageChanged();
}
