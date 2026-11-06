#include "review_scheduler.hpp"

#include <algorithm>
#include <charconv>
#include <chrono>
#include <cstdio>

namespace codeweave::learning {
namespace {

const std::vector<int> kFallbackOffsets{1, 3, 7, 14, 30};

std::optional<std::chrono::year_month_day> parse_date(std::string_view value) {
  if (value.size() != 10 || value[4] != '-' || value[7] != '-') return std::nullopt;
  int year_value = 0, month_value = 0, day_value = 0;
  const auto parse = [](std::string_view part, int& output) {
    const auto result = std::from_chars(part.data(), part.data() + part.size(), output);
    return result.ec == std::errc{} && result.ptr == part.data() + part.size();
  };
  if (!parse(value.substr(0, 4), year_value) || !parse(value.substr(5, 2), month_value) ||
      !parse(value.substr(8, 2), day_value)) return std::nullopt;
  const std::chrono::year_month_day date{
      std::chrono::year{year_value}, std::chrono::month{static_cast<unsigned>(month_value)},
      std::chrono::day{static_cast<unsigned>(day_value)}};
  return date.ok() ? std::optional{date} : std::nullopt;
}

std::string format_date(std::chrono::year_month_day date) {
  const auto year_value = static_cast<int>(date.year());
  const auto month_value = static_cast<unsigned>(date.month());
  const auto day_value = static_cast<unsigned>(date.day());
  char buffer[11]{};
  std::snprintf(buffer, sizeof(buffer), "%04d-%02u-%02u", year_value, month_value, day_value);
  return buffer;
}

int offset_for(const ReviewPlan& plan, std::size_t step) {
  if (plan.offsets.empty()) return 0;
  return step < plan.offsets.size() ? plan.offsets[step] : plan.offsets.back();
}

bool due(const MasteryRecord& record) { return !record.review_due_key.empty(); }

}  // namespace

std::vector<int> usable_review_offsets(const std::optional<std::vector<int>>& values) {
  if (!values) return {};
  std::vector<int> clean;
  for (const int value : *values) if (value >= 0) clean.push_back(value);
  std::sort(clean.begin(), clean.end());
  clean.erase(std::unique(clean.begin(), clean.end()), clean.end());
  return clean;
}

ReviewPlan effective_review_plan(const std::optional<std::vector<int>>& unit_offsets,
    const std::optional<std::vector<int>>& published_offsets) {
  const auto unit = usable_review_offsets(unit_offsets);
  if (!unit.empty()) return {unit, ReviewPlanSource::Unit};
  const auto published = usable_review_offsets(published_offsets);
  if (!published.empty()) return {published, ReviewPlanSource::Published};
  return {kFallbackOffsets, ReviewPlanSource::Fallback};
}

std::string add_days_key(std::string_view date_key, int days) {
  const auto parsed = parse_date(date_key);
  if (!parsed) return {};
  const auto base = std::chrono::sys_days{*parsed};
  const auto shifted = base + std::chrono::days{days};
  const auto minimum = std::chrono::sys_days{
      std::chrono::year_month_day{std::chrono::year{0}, std::chrono::January, std::chrono::day{1}}};
  const auto maximum = std::chrono::sys_days{
      std::chrono::year_month_day{std::chrono::year{9999}, std::chrono::December, std::chrono::day{31}}};
  if (shifted < minimum || shifted > maximum) return {};
  return format_date(std::chrono::year_month_day{shifted});
}

MasteryRecord schedule_first_review(const MasteryRecord& record,
    std::string_view today_key, const ReviewPlan& plan) {
  auto output = record;
  output.review_step = 0;
  output.review_due_key = add_days_key(today_key, offset_for(plan, 0));
  return output;
}

MasteryRecord schedule_next_review(const MasteryRecord& record,
    std::string_view today_key, const ReviewPlan& plan) {
  auto output = record;
  if (output.review_step >= plan.offsets.size()) {
    output.review_due_key.clear();
    return output;
  }
  output.review_due_key = add_days_key(today_key, offset_for(plan, output.review_step));
  return output;
}

MasteryRecord reschedule_review(const MasteryRecord& record,
    std::string_view today_key, const ReviewPlan& plan) {
  auto output = record;
  const auto step = output.review_step > 0 ? output.review_step - 1 : 0;
  output.review_step = step;
  output.review_due_key = add_days_key(today_key, offset_for(plan, step));
  return output;
}

MasteryRecord snooze_review(const MasteryRecord& record, std::string_view today_key) {
  auto output = record;
  const auto base = !record.review_due_key.empty() && record.review_due_key > today_key
      ? record.review_due_key : std::string(today_key);
  output.review_due_key = add_days_key(base, 1);
  return output;
}

ReviewGroups group_reviews(const std::vector<MasteryRecord>& records, std::string_view today_key) {
  if (!parse_date(today_key)) return {};
  std::vector<MasteryRecord> sorted;
  for (const auto& record : records) {
    if (due(record) && parse_date(record.review_due_key)) sorted.push_back(record);
  }
  std::stable_sort(sorted.begin(), sorted.end(), [](const auto& left, const auto& right) {
    return left.review_due_key < right.review_due_key;
  });
  ReviewGroups groups;
  const auto upcoming_end = add_days_key(today_key, 7);
  for (const auto& record : sorted) {
    if (record.review_due_key < today_key) groups.overdue.push_back(record);
    else if (record.review_due_key == today_key) groups.today.push_back(record);
    else if (!upcoming_end.empty() && record.review_due_key <= upcoming_end) groups.upcoming.push_back(record);
    if (!groups.next && record.review_due_key > today_key) {
      groups.next = record;
      groups.next_date_key = record.review_due_key;
    }
  }
  return groups;
}

}  // namespace codeweave::learning
