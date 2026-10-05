#pragma once

#include "account.hpp"
#include "app_core.hpp"
#include "learning_contract.hpp"
#include "progress_store.hpp"

#include <string>
#include <vector>

namespace codeweave::migration {

// This is an in-memory contract for an explicitly exported, user-approved
// snapshot. It deliberately does not parse or discover files on its own.
struct LegacyDraft {
  std::string draft_id;
  std::string contents;
};

struct Snapshot {
  int schema_version{};
  std::string source_app_version;
  std::vector<account::Record> accounts;
  std::vector<LegacyDraft> drafts;
  std::vector<learning::ProgressFact> progress;
};

enum class Status { Ready, Blocked };

struct Issue {
  std::string code;
  std::string subject;
  std::string detail;
};

struct Plan {
  Status status{Status::Blocked};
  std::size_t account_count{};
  std::size_t draft_count{};
  std::size_t progress_count{};
  std::vector<Issue> issues;
  bool source_read{};
  bool writes_performed{};
  bool committed{};
};

Plan inspect_snapshot(const Snapshot& snapshot);

}  // namespace codeweave::migration
