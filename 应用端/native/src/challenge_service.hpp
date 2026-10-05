#pragma once

#include "evidence_store.hpp"
#include "execution_service.hpp"
#include "progress_store.hpp"

#include <string>

namespace codeweave::learning {

struct ChallengeRequest {
  std::string evidence_id;
  std::string content_id;
  std::string exercise_id;
  std::string at;
  std::string expected_output;
  std::string operation_id;
  bool independent{};
  std::string hint_level;
};

struct ChallengeResult {
  app::Result validation;
  bool passed{};
  bool evidence_duplicate{};
  bool progress_duplicate{};
};

class ChallengeService final {
 public:
  ChallengeService(EvidenceStore& evidence_store, ProgressStore& progress_store);

  ChallengeResult record_execution(const ChallengeRequest& request,
      const execution::ProcessResult& process_result);

 private:
  EvidenceStore& evidence_store_;
  ProgressStore& progress_store_;
};

}  // namespace codeweave::learning
