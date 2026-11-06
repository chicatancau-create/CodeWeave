#pragma once

#include "app_core.hpp"
#include "evidence_store.hpp"
#include "mastery_service.hpp"
#include "progress_store.hpp"
#include "review_scheduler.hpp"

#include <filesystem>
#include <string>
#include <vector>

namespace codeweave::learning {

struct ReviewItem {
  std::string content_id;
  std::string exercise_id;
  std::string latest_at;
  std::string latest_result;
  bool passed{};
  bool independent{};
  std::string hint_level;
  std::size_t evidence_count{};
  std::string due_key;
  std::size_t next_node_index{};
  int mastery_level{};
  ReviewPlanSource plan_source{ReviewPlanSource::Fallback};
  std::string group;
  std::string forgetting_risk;
};

struct ReviewSummary {
  std::size_t evidence_count{};
  std::size_t progress_count{};
  std::size_t passed_count{};
  std::size_t independent_passed_count{};
  std::size_t overdue_count{};
  std::size_t today_count{};
  std::size_t upcoming_count{};
  std::string next_due_key;
  std::vector<ReviewItem> items;
};

struct AnalysisWindowSummary {
  std::size_t practice_count{};
  std::size_t completed_units{};
  std::size_t challenge_passes{};
  std::size_t review_passed{};
  std::size_t review_failed{};
};

AnalysisWindowSummary summarize_analysis_window(
    const std::vector<EvidenceRecord>& evidence,
    const std::vector<MasteryEvidence>& mastery_evidence,
    std::string_view first_day, std::string_view last_day);

class ReviewService final {
 public:
  ReviewService(const EvidenceStore& evidence, const ProgressStore& progress,
      MasteryStore* mastery = nullptr) : evidence_(evidence), progress_(progress), mastery_(mastery) {}

  // Backward-compatible read-only entry point used by the native CLI and older callers.
  // The richer overload remains the single implementation of review aggregation.
  app::Result summarize(ReviewSummary& summary) const;
  app::Result summarize(ReviewSummary& summary, std::string_view today_key,
      const ReviewPlan& plan) const;

 private:
  const EvidenceStore& evidence_;
  const ProgressStore& progress_;
  MasteryStore* mastery_{};
};

}  // namespace codeweave::learning
