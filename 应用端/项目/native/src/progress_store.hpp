#pragma once

#include "learning_contract.hpp"
#include "operation_index.hpp"

#include <filesystem>
#include <mutex>
#include <string>
#include <vector>

namespace codeweave::learning {

struct ProgressFact {
  std::string fact_id;
  std::string content_id;
  std::string exercise_id;
  std::string at;
  std::string status;
  std::string operation_id;
};

app::Result validate_progress_fact(const ProgressFact& fact);

class ProgressStore final {
 public:
  explicit ProgressStore(std::filesystem::path data_root);
  app::Result append_idempotent(const ProgressFact& fact, bool& duplicate);
  app::Result remove_operation(std::string_view operation_id);
  app::Result read_all(std::vector<ProgressFact>& facts) const;

 private:
  std::filesystem::path path() const;
  std::filesystem::path index_path() const;
  std::filesystem::path data_root_;
  mutable std::mutex mutex_;
  mutable operation_index::Snapshot index_snapshot_;
  mutable bool index_ready_{};
};

}  // namespace codeweave::learning
