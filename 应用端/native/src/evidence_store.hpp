#pragma once

#include "app_core.hpp"
#include "learning_contract.hpp"

#include <filesystem>
#include <mutex>
#include <vector>

namespace codeweave::learning {

class EvidenceStore final {
 public:
  explicit EvidenceStore(std::filesystem::path data_root);
  app::Result append_idempotent(const EvidenceRecord& record, bool& already_present);
  app::Result read_all(std::vector<EvidenceRecord>& records) const;

 private:
  std::filesystem::path path() const;
  std::filesystem::path data_root_;
  mutable std::mutex mutex_;
};

}  // namespace codeweave::learning
