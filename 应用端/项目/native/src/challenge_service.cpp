#include "challenge_service.hpp"
#include "output_comparison.hpp"

#include <algorithm>
#include <string_view>
#include <utility>
#include <vector>

namespace codeweave::learning {

ChallengeService::ChallengeService(EvidenceStore& evidence_store, ProgressStore& progress_store)
    : evidence_store_(evidence_store), progress_store_(progress_store) {}

ChallengeResult ChallengeService::record_with_judgement(const ChallengeRequest& request,
    const execution::ProcessResult& process_result, OutputJudgement judgement) {
  if (request.expected_output.size() > 4000)
    return {app::Result::failure("挑战预期输出过长"), false, false, false, {}};
  if (process_result.output.size() > 4000)
    return {app::Result::failure("挑战实际输出过长"), false, false, false, {}};
  const bool passed = process_result.started && process_result.exit_code == 0 && process_result.error_code.empty() &&
      process_result.execution_output_valid &&
      judgement.passed;
  EvidenceRecord evidence{request.evidence_id, request.content_id, request.exercise_id, request.at,
      request.expected_output, process_result.output, RanBy::Learner, request.independent,
      request.hint_level, {}, passed ? std::vector<std::string>{} : std::vector<std::string>{"输出未通过挑战判定"},
      EvidenceState::Pending, request.operation_id};
  const auto evidence_valid = validate_evidence(evidence);
  if (!evidence_valid.ok) return {evidence_valid, passed, false, false, judgement};
  bool evidence_duplicate = false;
  const auto evidence_saved = evidence_store_.append_idempotent(evidence, evidence_duplicate);
  if (!evidence_saved.ok) return {evidence_saved, passed, evidence_duplicate, false, judgement};
  if (!passed) return {app::Result::success("挑战未通过，已记录证据"), false, evidence_duplicate, false, judgement};
  if (!request.independent || request.hint_level == "L3" || request.hint_level == "L4") {
    return {app::Result::success("挑战通过，已记录证据；未声明独立完成，正式进度未提升"),
        true, evidence_duplicate, false, judgement};
  }
  ProgressFact fact{request.evidence_id, request.content_id, request.exercise_id, request.at, "completed", request.operation_id};
  bool progress_duplicate = false;
  const auto progress_saved = progress_store_.append_idempotent(fact, progress_duplicate);
  if (!progress_saved.ok) {
    const auto compensated = evidence_duplicate
        ? app::Result::success("已有证据不需要补偿")
        : evidence_store_.remove_operation(request.operation_id);
    if (!compensated.ok) {
      return {app::Result::failure("正式进度保存失败，且证据补偿失败；请保留当前数据并执行恢复"),
          true, evidence_duplicate, progress_duplicate, judgement};
    }
    return {app::Result::failure("正式进度保存失败，已撤销本次证据提交"),
        true, evidence_duplicate, progress_duplicate, judgement};
  }
  return {app::Result::success("挑战通过，证据与正式进度已保存"), true, evidence_duplicate, progress_duplicate, judgement};
}

ChallengeResult ChallengeService::record_execution(const ChallengeRequest& request,
    const execution::ProcessResult& process_result) {
  if (request.expected_output.size() > 4000 || process_result.output.size() > 4000)
    return {app::Result::failure("挑战输出过长"), false, false, false, {}};
  std::vector<std::string> expected_lines;
  std::size_t start = 0;
  while (start < request.expected_output.size()) {
    const auto end = request.expected_output.find('\n', start);
    auto line = std::string_view(request.expected_output).substr(start,
        end == std::string::npos ? request.expected_output.size() - start : end - start);
    if (!line.empty() && line.back() == '\r') line.remove_suffix(1);
    expected_lines.emplace_back(line);
    if (end == std::string::npos) break;
    start = end + 1;
  }
  auto judgement = judge_output(expected_lines, process_result.output);
  return record_with_judgement(request, process_result, std::move(judgement));
}

ChallengeResult ChallengeService::record_course_execution(const ChallengeRequest& request,
    const execution::ProcessResult& process_result) {
  OutputJudgement judgement;
  judgement.passed = output_matches(process_result.output, request.expected_output);
  return record_with_judgement(request, process_result, std::move(judgement));
}

}  // namespace codeweave::learning
