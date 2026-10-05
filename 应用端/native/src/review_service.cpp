#include "review_service.hpp"
#include "output_comparison.hpp"
#include "external_evidence_service.hpp"

#include <algorithm>

namespace codeweave::learning {

app::Result ReviewService::summarize(ReviewSummary& summary) const {
  summary = {};
  std::vector<EvidenceRecord> evidence;
  const auto evidence_result = evidence_.read_all(evidence);
  if (!evidence_result.ok) return evidence_result;
  std::vector<ProgressFact> progress;
  const auto progress_result = progress_.read_all(progress);
  if (!progress_result.ok) return progress_result;
  summary.evidence_count = evidence.size();
  summary.progress_count = progress.size();
  for (const auto& record : evidence) {
    const bool pending_external = record.exercise_id == kExternalEvidenceExerciseId &&
        record.state == EvidenceState::Pending;
    const bool passed = !pending_external && record.unfinished_items.empty() &&
        output_matches(record.actual_result, record.expected_result);
    const bool independent = record.independent && record.ran_by == RanBy::Learner &&
        (record.hint_level == "L1" || record.hint_level == "L2");
    if (passed) ++summary.passed_count;
    if (passed && independent) ++summary.independent_passed_count;
    const auto found = std::find_if(summary.items.begin(), summary.items.end(),
        [&record](const auto& item) {
          return item.content_id == record.content_id &&
              item.exercise_id == record.exercise_id;
        });
    if (found == summary.items.end()) {
      summary.items.push_back({record.content_id, record.exercise_id, record.at,
          record.actual_result, passed, independent, record.hint_level, 1});
    } else {
      ++found->evidence_count;
      if (record.at >= found->latest_at) {
        found->latest_at = record.at;
        found->latest_result = record.actual_result;
        found->passed = passed;
        found->independent = independent;
        found->hint_level = record.hint_level;
      }
    }
  }
  std::sort(summary.items.begin(), summary.items.end(),
      [](const auto& left, const auto& right) {
        if (left.latest_at != right.latest_at) return left.latest_at > right.latest_at;
        if (left.content_id != right.content_id) return left.content_id < right.content_id;
        return left.exercise_id < right.exercise_id;
      });
  return app::Result::success("复习汇总已生成（只读）");
}

}  // namespace codeweave::learning
