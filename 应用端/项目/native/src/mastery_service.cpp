#include "mastery_service.hpp"

namespace codeweave::learning {

namespace {

std::string date_key_from_timestamp(std::string_view timestamp) {
  return timestamp.size() >= 10 ? std::string(timestamp.substr(0, 10)) : std::string{};
}

}  // namespace

app::Result MasteryService::replay(std::size_t plan_length, MasterySnapshot& snapshot) const {
  std::vector<MasteryEvidence> events;
  const auto loaded = store_.read_all(events);
  if (!loaded.ok) return loaded;
  snapshot = {};
  for (const auto& event : events) {
    auto found = snapshot.records.find(event.ref_id);
    MasteryRecord next;
    const auto applied = apply_mastery_evidence(
        found == snapshot.records.end() ? nullptr : &found->second,
        event, plan_length, next);
    if (!applied.ok) return applied;
    snapshot.records[event.ref_id] = std::move(next);
  }
  return app::Result::success("掌握度已从事实重放");
}

app::Result MasteryService::replay(const ReviewPlan& plan, MasterySnapshot& snapshot) const {
  std::vector<MasteryEvidence> events;
  const auto loaded = store_.read_all(events);
  if (!loaded.ok) return loaded;
  snapshot = {};
  for (const auto& event : events) {
    auto found = snapshot.records.find(event.ref_id);
    MasteryRecord next;
    const auto applied = apply_mastery_evidence(
        found == snapshot.records.end() ? nullptr : &found->second,
        event, plan.offsets.size(), next);
    if (!applied.ok) return applied;
    const auto date_key = date_key_from_timestamp(event.at);
    if (!date_key.empty() && event.kind == MasteryEvidenceKind::Snooze) {
      next = snooze_review(next, date_key);
    } else if (!date_key.empty() && mastery_eligible(event)) {
      if (event.kind == MasteryEvidenceKind::Review) {
        next = schedule_next_review(next, date_key, plan);
      } else {
        next = schedule_first_review(next, date_key, plan);
      }
    } else if (!date_key.empty() && event.kind == MasteryEvidenceKind::Review &&
        !event.passed && event.ran_by == RanBy::Learner &&
        (event.hint_level == "L1" || event.hint_level == "L2")) {
      next = reschedule_review(next, date_key, plan);
    }
    snapshot.records[event.ref_id] = std::move(next);
  }
  return app::Result::success("掌握度与复习计划已从事实重放");
}

app::Result MasteryService::record_evidence(const MasteryEvidence& evidence,
    std::size_t plan_length, bool& duplicate, MasterySnapshot& snapshot) {
  const auto valid = validate_mastery_evidence(evidence);
  if (!valid.ok) return valid;
  if (evidence.passed && !mastery_eligible(evidence)) {
    return app::Result::failure("不符合正式掌握度门槛的通过证据不能推进掌握度");
  }
  if (!evidence.passed && evidence.kind == MasteryEvidenceKind::Review &&
      (evidence.ran_by != RanBy::Learner ||
       (evidence.hint_level != "L1" && evidence.hint_level != "L2"))) {
    return app::Result::failure("不符合正式复测门槛的失败证据不能改变掌握度");
  }
  const auto appended = store_.append_idempotent(evidence, duplicate);
  if (!appended.ok) return appended;
  return replay(plan_length, snapshot);
}

app::Result MasteryService::record_evidence(const MasteryEvidence& evidence,
    const ReviewPlan& plan, bool& duplicate, MasterySnapshot& snapshot) {
  const auto valid = validate_mastery_evidence(evidence);
  if (!valid.ok) return valid;
  if (evidence.passed && !mastery_eligible(evidence)) {
    return app::Result::failure("不符合正式掌握度门槛的通过证据不能推进掌握度");
  }
  if (!evidence.passed && evidence.kind == MasteryEvidenceKind::Review &&
      (evidence.ran_by != RanBy::Learner ||
       (evidence.hint_level != "L1" && evidence.hint_level != "L2"))) {
    return app::Result::failure("不符合正式复测门槛的失败证据不能改变掌握度");
  }
  const auto appended = store_.append_idempotent(evidence, duplicate);
  if (!appended.ok) return appended;
  return replay(plan, snapshot);
}

}  // namespace codeweave::learning
