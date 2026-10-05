#pragma once

#include "app_core.hpp"

#include <string>
#include <string_view>
#include <vector>

namespace codeweave::learning {

enum class MasteryKind { Numeric, Range, Uncertain };

struct MasteryLevel {
  MasteryKind kind{MasteryKind::Uncertain};
  int value{};
  int low{};
  int high{};
  std::string label;
};

MasteryLevel parse_mastery_level(std::string_view raw);

enum class EvidenceState { Pending, Synced, Partial };
enum class RanBy { Learner, Assistant, Unknown };

struct EvidenceRecord {
  std::string evidence_id;
  std::string content_id;
  std::string exercise_id;
  std::string at;
  std::string expected_result;
  std::string actual_result;
  RanBy ran_by{RanBy::Unknown};
  bool independent{};
  std::string hint_level;
  std::vector<std::string> artifact_refs;
  std::vector<std::string> unfinished_items;
  EvidenceState state{EvidenceState::Pending};
  std::string operation_id;
};

app::Result validate_evidence(const EvidenceRecord& record);
bool is_operation_id(std::string_view value);

}  // namespace codeweave::learning
