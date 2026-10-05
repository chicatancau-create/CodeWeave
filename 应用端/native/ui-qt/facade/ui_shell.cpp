#include "ui_shell.hpp"

#include "content_repository.hpp"

#include <QMetaObject>

#include <filesystem>
#include <memory>
#include <vector>

UiShell::UiShell(QObject* parent)
    : QObject(parent), current_page_(QStringLiteral("学习")),
      content_status_(QStringLiteral("尚未加载课程内容")), backend_tasks_(4) {}

UiShell::~UiShell() {
  backend_tasks_.close();
  backend_tasks_.wait_closed();
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
  const auto task_id = QStringLiteral("qt-content-%1").arg(next_task_id_++).toStdString();
  codeweave::backend::TaskRequest request;
  request.task_id = task_id;
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
      [this, listed](codeweave::backend::TaskResult result) mutable {
        QMetaObject::invokeMethod(this,
            [this, listed, result = std::move(result)]() mutable {
              content_busy_ = false;
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
                published_ids_ = next_ids;
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
              emit contentBusyChanged();
              emit contentStatusChanged();
            }, Qt::QueuedConnection);
      });
  if (!submitted.ok) {
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
  codeweave::backend::TaskRequest request;
  request.task_id = QStringLiteral("qt-body-%1").arg(next_task_id_++).toStdString();
  request.kind = codeweave::backend::TaskKind::Read;
  request.work = [root, content_id, body](const codeweave::backend::CancellationToken& token) {
    if (token.cancelled()) return codeweave::app::Result::failure("读取任务已取消");
    codeweave::content::LoadedUnit unit;
    const auto result = codeweave::content::ContentRepository(root).read_published(content_id, unit);
    if (result.ok) *body = QString::fromUtf8(unit.body);
    return result;
  };
  const auto submitted = backend_tasks_.submit(std::move(request),
      [this, body](codeweave::backend::TaskResult result) mutable {
        QMetaObject::invokeMethod(this, [this, body, result = std::move(result)]() mutable {
          content_busy_ = false;
          if (result.result.ok) {
            selected_content_body_ = *body;
            emit selectedContentBodyChanged();
            content_status_ = QStringLiteral("课程正文已读取");
          } else {
            content_status_ = QString::fromUtf8(result.result.message);
          }
          emit contentBusyChanged();
          emit contentStatusChanged();
        }, Qt::QueuedConnection);
      });
  if (!submitted.ok) {
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
  codeweave::backend::TaskRequest request;
  request.task_id = QStringLiteral("qt-starter-%1").arg(next_task_id_++).toStdString();
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
      [this, language, code, policy](codeweave::backend::TaskResult result) mutable {
        QMetaObject::invokeMethod(this, [this, language, code, policy,
            result = std::move(result)]() mutable {
          content_busy_ = false;
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
          emit contentBusyChanged();
          emit contentStatusChanged();
        }, Qt::QueuedConnection);
      });
  if (!submitted.ok) {
    content_busy_ = false;
    content_status_ = QString::fromUtf8(submitted.message);
    emit contentBusyChanged();
    emit contentStatusChanged();
  }
}

void UiShell::updateDraftCode(const QString& code) {
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
