#pragma once

#include "app_core.hpp"
#include "learning_contract.hpp"

#include <cstddef>
#include <string>
#include <vector>

namespace codeweave::learning {

enum class MasteryEvidenceKind { Lesson, Challenge, Review, Bugfix, Snooze };
enum class CompletionVerification { AutoVerified, SelfDeclared };

struct MasteryEvidence {
  std::string id;
  MasteryEvidenceKind kind{MasteryEvidenceKind::Challenge};
  std::string ref_id;
  std::string note;
  std::string at;
  bool passed{};
  CompletionVerification verification{CompletionVerification::SelfDeclared};
  RanBy ran_by{RanBy::Unknown};
  bool independent{};
  std::string hint_level;
  std::string operation_id;
};

struct MasteryRecord {
  std::string ref_id;
  MasteryEvidenceKind kind{MasteryEvidenceKind::Challenge};
  int level{};
  std::vector<MasteryEvidence> evidence;
  std::string updated_at;
  std::string review_due_key;
  std::size_t review_step{};
  std::string last_fail_reason;
};

app::Result validate_mastery_evidence(const MasteryEvidence& evidence);
app::Result apply_mastery_evidence(const MasteryRecord* record,
    const MasteryEvidence& evidence, std::size_t plan_length, MasteryRecord& output);
bool mastery_eligible(const MasteryEvidence& evidence);

}  // namespace codeweave::learning
