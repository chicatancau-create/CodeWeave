#include "ui_shell.hpp"

#include "content_repository.hpp"

#include <QEventLoop>
#include <QDir>
#include <QFile>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QMetaObject>
#include <QTimer>

#include <filesystem>
#include <memory>
#include <vector>

UiShell::UiShell(QObject* parent)
    : QObject(parent), current_page_(QStringLiteral("学习")),
      content_status_(QStringLiteral("尚未加载课程内容")), backend_tasks_(4) {}

// §14.5 要求：关闭时进入 Closing、对在飞任务发取消、**同时保持事件泵**，
// 只有 worker 真停了才回收线程与服务。
// 改之前是析构里 close() + wait_closed()：close() 不取消在飞任务，wait_closed()
// 又在 UI 线程直接 join，于是冻结时长等于任务完整时长（备份/派生都是几百毫秒起）。
bool UiShell::drain_backend_tasks(int budget_ms) {
  closing_ = true;
  execution_cancelled_.store(true, std::memory_order_release);
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
      challenge_meta.append(c);
    }
    challenge_meta_ = challenge_meta;
  }
  reloadPublishedContent();
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
  content_status_ = QStringLiteral("正在读取起始代码…");
  emit contentBusyChanged();
  emit contentStatusChanged();
  const auto root = std::filesystem::path(content_root_.toStdWString());
  const auto selected_id = published_ids_.at(selected_content_index_);
  const auto content_id = selected_id.toStdString();
  const auto language = std::make_shared<QString>();
  const auto code = std::make_shared<QString>();
  const auto policy = std::make_shared<QString>();
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
  request.work = [root, content_id, language, code, policy](const codeweave::backend::CancellationToken& token) {
    if (token.cancelled()) return codeweave::app::Result::failure("读取任务已取消");
    std::string native_language;
    std::string native_code;
    std::string native_policy;
    const auto result = codeweave::content::ContentRepository(root).read_starter(
        content_id, native_language, native_code, native_policy);
    if (result.ok) {
      *language = QString::fromUtf8(native_language);
      *code = QString::fromUtf8(native_code);
      *policy = QString::fromUtf8(native_policy);
    }
    return result;
  };
  const auto submitted = backend_tasks_.submit(std::move(request),
      [this, language, code, policy, account, generation, expected_id, task_name](codeweave::backend::TaskResult result) mutable {
        QMetaObject::invokeMethod(this, [this, language, code, policy, account, generation,
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
