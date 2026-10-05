#pragma once

#include "account_service.hpp"
#include "backend_task_service.hpp"

#include <QObject>
#include <QString>
#include <QStringList>

class UiShell final : public QObject {
  Q_OBJECT
  Q_PROPERTY(QString appTitle READ appTitle CONSTANT)
  Q_PROPERTY(QString currentPage READ currentPage NOTIFY currentPageChanged)
  Q_PROPERTY(QStringList publishedTitles READ publishedTitles NOTIFY publishedTitlesChanged)
  Q_PROPERTY(QString selectedContentBody READ selectedContentBody NOTIFY selectedContentBodyChanged)
  Q_PROPERTY(QString starterLanguage READ starterLanguage NOTIFY starterCodeChanged)
  Q_PROPERTY(QString starterCode READ starterCode NOTIFY starterCodeChanged)
  Q_PROPERTY(QString executionPolicy READ executionPolicy NOTIFY starterCodeChanged)
  Q_PROPERTY(QString draftCode READ draftCode NOTIFY draftChanged)
  Q_PROPERTY(bool draftDirty READ draftDirty NOTIFY draftDirtyChanged)
  Q_PROPERTY(qulonglong accountGeneration READ accountGeneration NOTIFY accountChanged)
  Q_PROPERTY(qulonglong draftRevision READ draftRevision NOTIFY draftChanged)
  Q_PROPERTY(qulonglong savedRevision READ savedRevision NOTIFY draftDirtyChanged)
  Q_PROPERTY(QString documentId READ documentId NOTIFY selectedContentChanged)
  Q_PROPERTY(bool hasActiveAccount READ hasActiveAccount NOTIFY accountChanged)
  Q_PROPERTY(QString activeAccountId READ activeAccountId NOTIFY accountChanged)
  Q_PROPERTY(bool draftSaving READ draftSaving NOTIFY draftSavingChanged)
  Q_PROPERTY(bool draftPersistenceBlocked READ draftPersistenceBlocked NOTIFY draftPersistenceBlockedChanged)
  Q_PROPERTY(bool hasSelectedContent READ hasSelectedContent NOTIFY selectedContentChanged)
  Q_PROPERTY(QString contentStatus READ contentStatus NOTIFY contentStatusChanged)
  Q_PROPERTY(bool contentBusy READ contentBusy NOTIFY contentBusyChanged)

 public:
  explicit UiShell(QObject* parent = nullptr);
  ~UiShell() override;

  [[nodiscard]] QString appTitle() const;
  [[nodiscard]] QString currentPage() const;
  [[nodiscard]] QStringList publishedTitles() const;
  [[nodiscard]] QString selectedContentBody() const;
  [[nodiscard]] QString starterLanguage() const;
  [[nodiscard]] QString starterCode() const;
  [[nodiscard]] QString executionPolicy() const;
  [[nodiscard]] bool hasSelectedContent() const;
  [[nodiscard]] QString draftCode() const;
  [[nodiscard]] bool draftDirty() const;
  [[nodiscard]] qulonglong accountGeneration() const { return account_generation_; }
  [[nodiscard]] qulonglong draftRevision() const { return draft_revision_; }
  [[nodiscard]] qulonglong savedRevision() const { return saved_revision_; }
  [[nodiscard]] QString documentId() const { return selected_content_id_; }
  [[nodiscard]] bool hasActiveAccount() const;
  [[nodiscard]] QString activeAccountId() const;
  [[nodiscard]] bool draftSaving() const;
  [[nodiscard]] bool draftPersistenceBlocked() const;
  [[nodiscard]] QString contentStatus() const;
  [[nodiscard]] bool contentBusy() const;

  Q_INVOKABLE void reloadPublishedContent();
  Q_INVOKABLE void openPublishedContent(int index);
  Q_INVOKABLE void loadStarterCode();
  Q_INVOKABLE void updateDraftCode(const QString& code);
  Q_INVOKABLE void resetDraftCode();
  Q_INVOKABLE void saveDraft();
  void loadPublishedContent(const QString& root);
  // Trusted C++ session boundary; never invokable from QML.
  bool setAccountContext(const codeweave::account::AccountService& session,
      const std::filesystem::path& workspace, const std::filesystem::path& nativeDataRoot);
  bool clearAccountContext();
  Q_INVOKABLE void discardDraftChanges();
  Q_INVOKABLE bool requestClose();

  Q_INVOKABLE void selectPage(const QString& page);

 signals:
  void currentPageChanged();
  void publishedTitlesChanged();
  void selectedContentBodyChanged();
  void selectedContentChanged();
  void starterCodeChanged();
  void draftChanged();
  void draftDirtyChanged();
  void accountChanged();
  void draftSavingChanged();
  void draftPersistenceBlockedChanged();
  void contentStatusChanged();
  void contentBusyChanged();

 private:
  void clearDraft();
  void loadAccountDraft();
  bool allowDocumentChange();
  void setStatus(const QString& status);
  QString current_page_;
  QStringList published_titles_;
  QStringList published_ids_;
  QString selected_content_body_;
  QString starter_language_;
  QString starter_code_;
  QString execution_policy_;
  QString draft_code_;
  QString draft_baseline_;
  QString draft_saved_code_;
  QString selected_content_id_;
  QString active_account_id_;
  std::filesystem::path workspace_root_;
  std::filesystem::path data_root_;
  std::shared_ptr<codeweave::app::ApplicationCore> personal_core_;
  std::uint64_t account_generation_{};
  std::uint64_t draft_revision_{};
  std::uint64_t saved_revision_{};
  bool draft_saving_{};
  bool draft_persistence_blocked_{};
  int selected_content_index_{-1};
  QString content_status_;
  QString content_root_;
  bool content_busy_{};
  std::uint64_t next_task_id_{1};
  codeweave::backend::BackendTaskService backend_tasks_;
};
