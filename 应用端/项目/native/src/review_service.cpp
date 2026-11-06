#include "review_service.hpp"
#include "output_comparison.hpp"
#include "external_evidence_service.hpp"

#include <algorithm>
#include <set>

namespace codeweave::learning {

namespace {

std::string group_name(const MasteryRecord& record, std::string_view today_key) {
  if (record.review_due_key.empty()) return "none";
  if (record.review_due_key < today_key) return "overdue";
  if (record.review_due_key == today_key) return "today";
  const auto upcoming_end = add_days_key(today_key, 7);
  return !upcoming_end.empty() && record.review_due_key <= upcoming_end ? "upcoming" : "scheduled";
}

std::string risk_name(const MasteryRecord& record, std::string_view today_key) {
  if (record.review_due_key.empty()) return {};
  if (record.review_due_key < today_key) return "high";
  if (record.review_due_key == today_key) return "medium";
  return "low";
}

}  // namespace

AnalysisWindowSummary summarize_analysis_window(
    const std::vector<EvidenceRecord>& evidence,
    const std::vector<MasteryEvidence>& mastery_evidence,
    std::string_view first_day, std::string_view last_day) {
  AnalysisWindowSummary summary;
  if (first_day.size() < 10 || last_day.size() < 10 || first_day > last_day) return summary;
  std::set<std::string> completed;
  const auto in_window = [first_day, last_day](std::string_view timestamp) {
    if (timestamp.size() < 10) return false;
    const auto day = timestamp.substr(0, 10);
    return day >= first_day.substr(0, 10) && day <= last_day.substr(0, 10);
  };
  for (const auto& record : evidence) {
    if (!in_window(record.at) || record.exercise_id == kExternalEvidenceExerciseId) continue;
    ++summary.practice_count;
    if (record.unfinished_items.empty() &&
        output_matches(record.actual_result, record.expected_result)) {
      completed.insert(record.content_id);
    }
  }
  summary.completed_units = completed.size();
  for (const auto& evidence_item : mastery_evidence) {
    if (!in_window(evidence_item.at)) continue;
    if (evidence_item.kind == MasteryEvidenceKind::Challenge && evidence_item.passed)
      ++summary.challenge_passes;
    if (evidence_item.kind == MasteryEvidenceKind::Review) {
      if (evidence_item.passed) ++summary.review_passed;
      else ++summary.review_failed;
    }
  }
  return summary;
}

app::Result ReviewService::summarize(ReviewSummary& summary) const {
  return summarize(summary, {}, ReviewPlan{});
}

app::Result ReviewService::summarize(ReviewSummary& summary, std::string_view today_key,
    const ReviewPlan& plan) const {
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
      ReviewItem item;
      item.content_id = record.content_id;
      item.exercise_id = record.exercise_id;
      item.latest_at = record.at;
      item.latest_result = record.actual_result;
      item.passed = passed;
      item.independent = independent;
      item.hint_level = record.hint_level;
      item.evidence_count = 1;
      summary.items.push_back(std::move(item));
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
  if (mastery_ && !today_key.empty()) {
    const auto effective_plan = plan.offsets.empty()
        ? effective_review_plan(std::nullopt, std::nullopt) : plan;
    MasterySnapshot snapshot;
    const auto replayed = MasteryService(*mastery_).replay(effective_plan, snapshot);
    if (!replayed.ok) return replayed;
    const auto groups = group_reviews([&] {
      std::vector<MasteryRecord> records;
      records.reserve(snapshot.records.size());
      for (const auto& [ref_id, record] : snapshot.records) records.push_back(record);
      return records;
    }(), today_key);
    summary.overdue_count = groups.overdue.size();
    summary.today_count = groups.today.size();
    summary.upcoming_count = groups.upcoming.size();
    summary.next_due_key = groups.next_date_key;
    for (const auto& [ref_id, record] : snapshot.records) {
      auto found = std::find_if(summary.items.begin(), summary.items.end(),
          [&ref_id](const auto& item) {
            return item.content_id == ref_id && item.exercise_id.empty();
          });
      if (found == summary.items.end()) {
        ReviewItem item;
        item.content_id = ref_id;
        item.latest_at = record.updated_at;
        item.evidence_count = record.evidence.size();
        summary.items.push_back(std::move(item));
        found = std::prev(summary.items.end());
      }
      found->due_key = record.review_due_key;
      found->next_node_index = record.review_step;
      found->mastery_level = record.level;
      found->plan_source = effective_plan.source;
      found->group = group_name(record, today_key);
      found->forgetting_risk = risk_name(record, today_key);
      if (!record.evidence.empty()) {
        const auto& latest = record.evidence.back();
        found->latest_at = latest.at;
        found->latest_result = latest.note;
        found->passed = latest.passed;
        found->independent = mastery_eligible(latest);
        found->hint_level = latest.hint_level;
      }
    }
  }
  return app::Result::success("复习汇总已生成（只读）");
}

}  // namespace codeweave::learning
