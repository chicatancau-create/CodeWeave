#pragma once

#include "evidence_store.hpp"

namespace codeweave::learning {

struct ExternalEvidenceFields {
  std::string environment;
  std::string command;
  std::string result_summary;
  std::string artifact_ref;
  std::string reproduced_on;
};

inline constexpr std::string_view kExternalEvidenceExerciseId = "external-evidence";

app::Result prepare_external_evidence(std::string_view content_id,
    const ExternalEvidenceFields& fields, std::string_view operation_id,
    std::string_view evidence_id, EvidenceRecord& evidence);

// Validates submitted material, not the truth of an external execution.
// This API never writes ProgressStore or marks evidence independently passed.
app::Result save_external_evidence(EvidenceStore& store, std::string_view content_id,
    const ExternalEvidenceFields& fields, std::string_view operation_id,
    std::string_view evidence_id);

}  // namespace codeweave::learning
