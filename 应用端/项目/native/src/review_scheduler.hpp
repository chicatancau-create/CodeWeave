#pragma once

#include "mastery_contract.hpp"

#include <optional>
#include <string>
#include <vector>

namespace codeweave::learning {

enum class ReviewPlanSource { Unit, Published, Fallback };

struct ReviewPlan {
  std::vector<int> offsets;
  ReviewPlanSource source{ReviewPlanSource::Fallback};
};

struct ReviewGroups {
  std::vector<MasteryRecord> overdue;
  std::vector<MasteryRecord> today;
  std::vector<MasteryRecord> upcoming;
  std::optional<MasteryRecord> next;
  std::string next_date_key;
};

std::vector<int> usable_review_offsets(const std::optional<std::vector<int>>& values);
ReviewPlan effective_review_plan(const std::optional<std::vector<int>>& unit_offsets,
    const std::optional<std::vector<int>>& published_offsets);
std::string add_days_key(std::string_view date_key, int days);
MasteryRecord schedule_first_review(const MasteryRecord& record,
    std::string_view today_key, const ReviewPlan& plan);
MasteryRecord schedule_next_review(const MasteryRecord& record,
    std::string_view today_key, const ReviewPlan& plan);
MasteryRecord reschedule_review(const MasteryRecord& record,
    std::string_view today_key, const ReviewPlan& plan);
MasteryRecord snooze_review(const MasteryRecord& record, std::string_view today_key);
ReviewGroups group_reviews(const std::vector<MasteryRecord>& records, std::string_view today_key);

}  // namespace codeweave::learning
