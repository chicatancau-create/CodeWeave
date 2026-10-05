#include "migration_contract.hpp"
#include "progress_store.hpp"

#include <algorithm>
#include <unordered_set>

namespace codeweave::migration {
namespace {

constexpr std::size_t kMaxSnapshotRecords = 100000;
constexpr std::size_t kMaxDraftBytes = 4 * 1024 * 1024;

void add_issue(Plan& plan, std::string code, std::string subject, std::string detail) {
  plan.issues.push_back({std::move(code), std::move(subject), std::move(detail)});
}

template <typename T, typename Key>
void check_unique(const std::vector<T>& records, Key key, Plan& plan,
    std::string_view code, std::string_view label) {
  std::unordered_set<std::string> seen;
  for (const auto& record : records) {
    const auto value = key(record);
    if (!seen.insert(value).second) {
      add_issue(plan, std::string(code), value,
          std::string(label) + "重复，不能自动择一");
    }
  }
}

}  // namespace

Plan inspect_snapshot(const Snapshot& snapshot) {
  Plan plan;
  plan.account_count = snapshot.accounts.size();
  plan.draft_count = snapshot.drafts.size();
  plan.progress_count = snapshot.progress.size();

  if (snapshot.schema_version != 1) {
    add_issue(plan, "invalid_schema", "snapshot", "schemaVersion 必须为 1");
  }
  if (snapshot.source_app_version.empty() || snapshot.source_app_version.size() > 64) {
    add_issue(plan, "invalid_source_version", "snapshot", "sourceAppVersion 不能为空且长度有限");
  }
  if (snapshot.accounts.size() + snapshot.drafts.size() + snapshot.progress.size() >
      kMaxSnapshotRecords) {
    add_issue(plan, "snapshot_too_large", "snapshot", "记录数量超过迁移上限");
  }

  check_unique(snapshot.accounts, [](const account::Record& record) { return record.id; },
      plan, "duplicate_account_id", "账户 ID");
  check_unique(snapshot.drafts, [](const LegacyDraft& draft) { return draft.draft_id; },
      plan, "duplicate_draft_id", "草稿 ID");
  check_unique(snapshot.progress, [](const learning::ProgressFact& fact) { return fact.operation_id; },
      plan, "duplicate_progress_operation", "进度 operationId");

  for (const auto& record : snapshot.accounts) {
    const auto validation = account::validate(record);
    if (!validation.ok) add_issue(plan, "invalid_account", record.id, validation.message);
  }
  for (const auto& draft : snapshot.drafts) {
    if (draft.draft_id.empty() || draft.draft_id.size() > 96) {
      add_issue(plan, "invalid_draft_id", draft.draft_id, "草稿 ID 长度无效");
    } else {
      for (const char character : draft.draft_id) {
        const bool valid = (character >= 'a' && character <= 'z') ||
            (character >= 'A' && character <= 'Z') ||
            (character >= '0' && character <= '9') || character == '-' || character == '_';
        if (!valid) {
          add_issue(plan, "invalid_draft_id", draft.draft_id, "草稿 ID 含有非法字符");
          break;
        }
      }
    }
    if (draft.contents.size() > kMaxDraftBytes) {
      add_issue(plan, "draft_too_large", draft.draft_id, "草稿超过大小上限");
    }
    if (draft.contents.find('\0') != std::string::npos) {
      add_issue(plan, "draft_contains_nul", draft.draft_id, "草稿包含 NUL 字节");
    }
  }
  for (const auto& fact : snapshot.progress) {
    const auto validation = learning::validate_progress_fact(fact);
    if (!validation.ok) add_issue(plan, "invalid_progress", fact.fact_id, validation.message);
  }

  plan.status = plan.issues.empty() ? Status::Ready : Status::Blocked;
  plan.source_read = true;
  plan.writes_performed = false;
  plan.committed = false;
  return plan;
}

}  // namespace codeweave::migration
