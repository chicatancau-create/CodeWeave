#pragma once

#include "mastery_contract.hpp"

#include <filesystem>
#include <mutex>
#include <vector>

namespace codeweave::learning {

class MasteryStore final {
 public:
  explicit MasteryStore(std::filesystem::path data_root);
  app::Result append_idempotent(const MasteryEvidence& evidence, bool& duplicate);
  app::Result read_all(std::vector<MasteryEvidence>& evidence) const;

 private:
  std::filesystem::path path() const;
  std::filesystem::path data_root_;
  mutable std::mutex mutex_;
};

}  // namespace codeweave::learning
