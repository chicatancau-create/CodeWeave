#pragma once

#include "account_service.hpp"
#include "backend_task_service.hpp"
#include "execution_service.hpp"
#include "progress_projection.hpp"
#include "review_service.hpp"

#include <QObject>
#include <QDate>
#include <QHash>
#include <QString>
#include <QStringList>
#include <QVariantList>
#include <QVariantMap>
#include <atomic>
#include <unordered_map>
#include <functional>

class ChallengeSubmissionStore;
class VaultWritebackStore;

class UiShell final : public QObject {
  Q_OBJECT
  Q_PROPERTY(QString appTitle READ appTitle CONSTANT)
  Q_PROPERTY(QString currentPage READ currentPage NOTIFY currentPageChanged)
  Q_PROPERTY(QStringList publishedTitles READ publishedTitles NOTIFY publishedTitlesChanged)
  Q_PROPERTY(QStringList publishedIds READ publishedIds NOTIFY publishedIdsChanged)
  Q_PROPERTY(QVariantList lessonMeta READ lessonMeta NOTIFY publishedTitlesChanged)
  Q_PROPERTY(QVariantList challengeMeta READ challengeMeta NOTIFY publishedTitlesChanged)
  Q_PROPERTY(QVariantMap selectedChallenge READ selectedChallenge NOTIFY challengeSelectionChanged)
  Q_PROPERTY(bool challengeDetailOpen READ challengeDetailOpen NOTIFY challengeSelectionChanged)
  Q_PROPERTY(QString challengeCode READ challengeCode NOTIFY challengeCodeChanged)
  Q_PROPERTY(QVariantMap challengeRunResult READ challengeRunResult NOTIFY challengeRunResultChanged)
  Q_PROPERTY(bool challengeRunBusy READ challengeRunBusy NOTIFY challengeRunBusyChanged)
  Q_PROPERTY(QVariantList challengeHistory READ challengeHistory NOTIFY challengeHistoryChanged)
  Q_PROPERTY(QVariantMap challengeProgress READ challengeProgress NOTIFY challengeHistoryChanged)
  Q_PROPERTY(bool challengeHistoryBusy READ challengeHistoryBusy NOTIFY challengeHistoryChanged)
  Q_PROPERTY(QString challengeHistoryStatus READ challengeHistoryStatus NOTIFY challengeHistoryChanged)
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
  Q_PROPERTY(bool accountBusy READ accountBusy NOTIFY accountBusyChanged)
  Q_PROPERTY(QString accountStatus READ accountStatus NOTIFY accountStatusChanged)
  Q_PROPERTY(QString accountName READ accountName NOTIFY accountChanged)
  Q_PROPERTY(QString hints READ hints NOTIFY hintsChanged)
  Q_PROPERTY(QString operationStatus READ operationStatus NOTIFY operationStatusChanged)
  Q_PROPERTY(bool operationBusy READ operationBusy NOTIFY operationBusyChanged)
  Q_PROPERTY(bool executionBusy READ executionBusy NOTIFY executionBusyChanged)
  Q_PROPERTY(bool executionPaused READ executionPaused NOTIFY executionStateChanged)
  Q_PROPERTY(QString executionOutput READ executionOutput NOTIFY executionOutputChanged)
  Q_PROPERTY(bool executionOutputError READ executionOutputError NOTIFY executionOutputChanged)
  Q_PROPERTY(QVariantMap executionTrace READ executionTrace NOTIFY executionTraceChanged)
  Q_PROPERTY(QString progressSummary READ progressSummary NOTIFY reviewSummaryChanged)
  Q_PROPERTY(QString reviewSummary READ reviewSummary NOTIFY reviewSummaryChanged)
  Q_PROPERTY(QVariantList reviewItems READ reviewItems NOTIFY reviewItemsChanged)
  Q_PROPERTY(QVariantMap analysisSnapshot READ analysisSnapshot NOTIFY reviewSummaryChanged)
  Q_PROPERTY(QVariantMap checkinSummary READ checkinSummary NOTIFY checkinChanged)
  Q_PROPERTY(QVariantMap vaultWriteback READ vaultWriteback NOTIFY vaultWritebackChanged)
  Q_PROPERTY(QVariantMap lessonEvidenceStates READ lessonEvidenceStates NOTIFY reviewSummaryChanged)
  Q_PROPERTY(bool lessonEvidenceReady READ lessonEvidenceReady NOTIFY reviewSummaryChanged)
  Q_PROPERTY(QVariantMap lessonAssessment READ lessonAssessment NOTIFY lessonAssessmentChanged)
  Q_PROPERTY(int executionTimeout READ executionTimeout WRITE setExecutionTimeout NOTIFY executionOptionsChanged)
  Q_PROPERTY(bool independentAttempt READ independentAttempt WRITE setIndependentAttempt NOTIFY independentAttemptChanged)

 public:
  explicit UiShell(QObject* parent = nullptr);
  ~UiShell() override;

  [[nodiscard]] QString appTitle() const;
  [[nodiscard]] QString currentPage() const;
  [[nodiscard]] QStringList publishedTitles() const;
  [[nodiscard]] QStringList publishedIds() const { return published_ids_; }
  [[nodiscard]] QVariantList lessonMeta() const { return lesson_meta_; }
  [[nodiscard]] QVariantList challengeMeta() const { return challenge_meta_; }
  [[nodiscard]] QVariantMap selectedChallenge() const { return selected_challenge_; }
  [[nodiscard]] bool challengeDetailOpen() const { return !selected_challenge_.isEmpty(); }
  [[nodiscard]] QString challengeCode() const;
  [[nodiscard]] QVariantMap challengeRunResult() const { return challenge_run_result_; }
  [[nodiscard]] bool challengeRunBusy() const { return challenge_run_busy_; }
  [[nodiscard]] QVariantList challengeHistory() const;
  [[nodiscard]] QVariantMap challengeProgress() const;
  [[nodiscard]] bool challengeHistoryBusy() const { return challenge_history_busy_; }
  [[nodiscard]] QString challengeHistoryStatus() const { return challenge_history_status_; }
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
  [[nodiscard]] bool accountBusy() const;
  [[nodiscard]] QString accountStatus() const;
  [[nodiscard]] QString accountName() const;
  [[nodiscard]] QString hints() const { return hints_; }
  [[nodiscard]] QString operationStatus() const { return operation_status_; }
  [[nodiscard]] bool operationBusy() const { return operation_busy_; }
  [[nodiscard]] bool executionBusy() const { return execution_busy_; }
  [[nodiscard]] bool executionPaused() const { return execution_control_.is_paused(); }
  [[nodiscard]] QString executionOutput() const { return execution_output_; }
  [[nodiscard]] bool executionOutputError() const { return execution_output_error_; }
  [[nodiscard]] QString progressSummary() const { return progress_summary_; }
  [[nodiscard]] QString reviewSummary() const { return review_summary_; }
  [[nodiscard]] QVariantList reviewItems() const { return review_items_; }
  [[nodiscard]] QVariantMap analysisSnapshot() const;
  [[nodiscard]] QVariantMap checkinSummary() const;
  [[nodiscard]] QVariantMap vaultWriteback() const;
  Q_INVOKABLE void requestVaultSelection();
  void configureVaultRoot(const std::filesystem::path& root);
  Q_INVOKABLE void refreshVaultWriteback();
  Q_INVOKABLE void bindVaultOwner();
  Q_INVOKABLE void previewVaultWriteback(const QStringList& evidenceIds);
  Q_INVOKABLE void commitVaultWriteback(const QString& operationId, const QVariantMap& expectedHashes);
  Q_INVOKABLE void rollbackVaultWriteback(const QString& operationId);
  Q_INVOKABLE void refreshCheckin();
  Q_INVOKABLE void checkIn();
  Q_INVOKABLE void refreshLocalDay();
  [[nodiscard]] QVariantMap lessonEvidenceStates() const { return lesson_evidence_states_; }
  [[nodiscard]] bool lessonEvidenceReady() const { return lesson_evidence_ready_; }
  [[nodiscard]] QVariantMap lessonAssessment() const;
  Q_INVOKABLE void markLessonRead();
  Q_INVOKABLE void completeLesson(const QVariantMap& externalEvidence);
  [[nodiscard]] int executionTimeout() const { return execution_timeout_; }
  void setExecutionTimeout(int milliseconds);
  [[nodiscard]] bool independentAttempt() const { return independent_attempt_; }
  void setIndependentAttempt(bool value);

  Q_INVOKABLE void reloadPublishedContent();
  Q_INVOKABLE void openChallenge(const QString& challengeId);
  Q_INVOKABLE void closeChallenge();
  Q_INVOKABLE void updateChallengeCode(const QString& code);
  Q_INVOKABLE void runChallenge();
  Q_INVOKABLE void cancelChallenge();
  Q_INVOKABLE void refreshChallengeHistory();
  Q_INVOKABLE void submitChallenge(const QString& evidence, const QVariantMap& externalEvidence);
  Q_INVOKABLE void reviewChallengeSubmission(const QString& submissionId, bool passed,
      const QString& observation);
  Q_INVOKABLE void openPublishedContent(int index);
  Q_INVOKABLE void loadStarterCode();
  Q_INVOKABLE void updateDraftCode(const QString& code);
  Q_INVOKABLE void resetDraftCode();
  Q_INVOKABLE void saveDraft();
  Q_INVOKABLE void dismissContentStatus();
  void loadPublishedContent(const QString& root);
  void configureAccountStorage(const std::filesystem::path& workspace,
      const std::filesystem::path& nativeDataRoot);
  // Trusted C++ session boundary; never invokable from QML.
  bool setAccountContext(const codeweave::account::AccountService& session,
      const std::filesystem::path& workspace, const std::filesystem::path& nativeDataRoot);
  bool clearAccountContext();
  Q_INVOKABLE void discardDraftChanges();
  Q_INVOKABLE bool requestClose();
  Q_INVOKABLE void login(const QString& identifier, const QString& password);
  Q_INVOKABLE void registerAccount(const QString& name, const QString& identifier,
      const QString& password);
  Q_INVOKABLE void logout();
  Q_INVOKABLE void changePassword(const QString& currentPassword, const QString& newPassword);
  Q_INVOKABLE void openFreeProgram(const QString& language);
  Q_INVOKABLE void requestDataAction(const QString& action);
  Q_INVOKABLE void requestToolSelection();
  bool performDataAction(const QString& action, const std::filesystem::path& source,
      const std::filesystem::path& target);
  [[nodiscard]] std::filesystem::path nativeDataRoot() const { return native_data_root_; }
  Q_INVOKABLE void loadHints();
  Q_INVOKABLE void saveExternalEvidence(const QString& environment, const QString& command,
      const QString& summary, const QString& artifactRef, const QString& reproducedOn);
  Q_INVOKABLE void runCode();
  [[nodiscard]] QVariantMap executionTrace() const { return execution_trace_; }
  Q_INVOKABLE void cancelExecution();
  Q_INVOKABLE void pauseExecution();
  Q_INVOKABLE void resumeExecution();
  Q_INVOKABLE void stepExecution();
  Q_INVOKABLE void refreshReviewSummary();
  Q_INVOKABLE void reviewItem(const QString& itemId, bool passed, const QString& note);
  Q_INVOKABLE void snoozeReview(const QString& itemId);

  // Trusted host configuration; QML never supplies filesystem paths or tool paths.
  // The executable is selected by the native host for the current language.
  void configureExecutionTool(const QString& language, const std::filesystem::path& tool);
  bool createBackup(const std::filesystem::path& source, const std::filesystem::path& target);
  bool restoreBackup(const std::filesystem::path& backup, const std::filesystem::path& target);

  Q_INVOKABLE void selectPage(const QString& page);

 signals:
  void dataActionRequested(const QString& action);
  void toolSelectionRequested(const QString& language);
  void vaultSelectionRequested();
  void vaultWritebackChanged();
  void executionOptionsChanged();
  void currentPageChanged();
  void publishedTitlesChanged();
   void publishedIdsChanged();
  void challengeSelectionChanged();
  void challengeCodeChanged();
  void challengeRunResultChanged();
  void challengeRunBusyChanged();
  void challengeHistoryChanged();
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
  void accountBusyChanged();
  void accountStatusChanged();
  void hintsChanged();
  void operationStatusChanged();
  void operationBusyChanged();
  void executionBusyChanged();
  void executionStateChanged();
  void executionOutputChanged();
  void executionTraceChanged();
  void reviewSummaryChanged();
  void checkinChanged();
  void lessonAssessmentChanged();
  void reviewItemsChanged();
  void independentAttemptChanged();

 private:
  friend struct UiShellTestAccess;
  void clearVaultWriteback();
  void performVaultTask(const QString& action,
      std::function<codeweave::app::Result(VaultWritebackStore&, QVariantMap&)> operation);
  void performCheckinTask(bool write);
  void clearCheckin();
  void clearDraft(bool accountChange = false);
  void clearChallengeDrafts();
  void performChallengeHistoryTask(bool write,
      std::function<codeweave::app::Result(const ChallengeSubmissionStore&, QVariantList&)> work);
  void loadAccountDraft();
  void saveLessonFact(const QString& signal, const QString& note, bool verified);
  static codeweave::app::Result recordLessonFact(const std::filesystem::path& root,
      const QString& document, const QString& signal, const QString& note,
      bool verified, bool independent, bool hintsViewed);
  static bool mentionsAcceptance(const QString& summary, const QVariantMap& acceptance);
  bool allowDocumentChange();
  void setStatus(const QString& status);
  // 进入 Closing、对在飞任务发取消、泵事件直到 worker 停止，然后才回收。
  // 返回 false 表示预算内没停干净。
  bool drain_backend_tasks(int budget_ms = 5000);
  void setAccountStatus(const QString& status);
  void authenticate(const QString& name, const QString& identifier,
      const QString& password, bool registration);
  void setOperationStatus(const QString& status);
  QString current_page_;
  QStringList published_titles_;
  QStringList published_ids_;
  QVariantList lesson_meta_;
  QVariantList challenge_meta_;
  QVariantMap selected_challenge_;
  QHash<QString, QString> challenge_drafts_;
  QVariantMap challenge_run_result_;
  bool challenge_run_busy_{};
  std::atomic_bool challenge_cancelled_{false};
  QString challenge_task_id_;
  std::uint64_t challenge_revision_{};
  QVariantList challenge_submissions_;
  bool challenge_history_busy_{};
  bool challenge_history_write_{};
  QString challenge_history_status_;
  QString challenge_history_task_id_;
  QString selected_content_body_;
  QString starter_language_;
  QString starter_code_;
  QString execution_policy_;
  QString draft_code_;
  QString draft_baseline_;
  QString draft_saved_code_;
  QString selected_content_id_;
  QString active_account_id_;
  QString account_status_;
  QString hints_;
  QString operation_status_;
  QString execution_output_;
  QVariantMap execution_trace_;
  bool execution_output_error_{};
  QString progress_summary_;
  QString review_summary_;
  QVariantList review_items_;
  QVariantMap analysis_snapshot_;
  std::filesystem::path vault_root_;
  QVariantMap vault_writeback_;
  QString vault_status_;
  QString vault_task_id_;
  bool vault_busy_{};
  bool vault_write_{};
  QStringList checkin_dates_;
  QString checkin_status_;
  QString checkin_task_id_;
  bool checkin_busy_{};
  bool checkin_write_{};
  bool checkin_ready_{};
  QDate checkin_day_;
  std::function<QDate()> local_date_{[] { return QDate::currentDate(); }};
  bool independent_attempt_{};
  bool hints_viewed_{};
  std::unordered_map<std::string, std::filesystem::path> execution_tools_;
  std::atomic_bool execution_cancelled_{false};
  codeweave::execution::ExecutionControl execution_control_;
  bool execution_busy_{};
  int execution_timeout_{30000};
  bool operation_busy_{};
  bool closing_{};
  std::filesystem::path workspace_root_;
  std::filesystem::path native_data_root_;
  std::filesystem::path data_root_;
  std::shared_ptr<codeweave::app::ApplicationCore> personal_core_;
  std::shared_ptr<codeweave::account::AccountStore> account_store_;
  std::unique_ptr<codeweave::account::AccountService> account_service_;
  std::uint64_t account_generation_{};
  std::uint64_t draft_revision_{};
  std::uint64_t saved_revision_{};
  bool draft_saving_{};
  bool draft_persistence_blocked_{};
  bool account_busy_{};
  QVariantMap lesson_evidence_states_;
  bool lesson_evidence_ready_{};
  QStringList lesson_expected_output_;
  bool lesson_contract_ready_{};
  bool lesson_run_succeeded_{};
  std::uint64_t lesson_run_revision_{};
  int selected_content_index_{-1};
  QString content_status_;
  QString content_root_;
  bool content_busy_{};
   QString content_task_id_;
   QString draft_task_id_;
   QString account_task_id_;
   QString operation_task_id_;
   QString execution_task_id_;
  std::uint64_t next_task_id_{1};
  codeweave::backend::BackendTaskService backend_tasks_;
};
