#pragma once

#include "app_core.hpp"
#include "learning_contract.hpp"
#include "operation_index.hpp"

#include <filesystem>
#include <mutex>
#include <vector>

namespace codeweave::learning {

class EvidenceStore final {
 public:
  explicit EvidenceStore(std::filesystem::path data_root);
  app::Result append_idempotent(const EvidenceRecord& record, bool& already_present);
  // Compensates a same-operation evidence append when a paired ledger write fails.
  app::Result remove_operation(std::string_view operation_id);
  app::Result read_all(std::vector<EvidenceRecord>& records) const;

 private:
  std::filesystem::path path() const;
  std::filesystem::path index_path() const;
  std::filesystem::path data_root_;
  mutable std::mutex mutex_;
  mutable operation_index::Snapshot index_snapshot_;
  mutable bool index_ready_{};
};

}  // namespace codeweave::learning
