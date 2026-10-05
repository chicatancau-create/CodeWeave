#pragma once

#include "learning_contract.hpp"

#include <string>
#include <string_view>
#include <vector>

namespace codeweave::learning {

enum class ProgressStatus { Ok, Partial, StructureUnsupported };

struct ProjectionIssue {
  std::string key;
  std::string scope;
  std::string reason;
};

struct MasteryRow {
  std::string skill;
  MasteryLevel level;
  std::string status;
  std::string evidence;
};

struct StageRow {
  std::string id;
  std::string name;
  std::string status;
  std::string note;
};

struct ProgressProjection {
  int schema_version{1};
  ProgressStatus status{ProgressStatus::StructureUnsupported};
  std::string latest_evidence_on;
  std::vector<MasteryRow> mastery;
  std::vector<StageRow> stages;
  std::vector<ProjectionIssue> unparsed;
  std::string read_only_notice;
};

ProgressProjection parse_progress(std::string_view markdown);

}  // namespace codeweave::learning
