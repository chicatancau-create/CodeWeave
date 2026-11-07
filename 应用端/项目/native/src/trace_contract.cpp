#include "trace_contract.hpp"

namespace codeweave::execution {

Trace::Trace(std::string session_id) : session_id_(std::move(session_id)) {}

app::Result Trace::append(EventKind kind, std::string_view payload) {
  if (session_id_.empty()) return app::Result::failure("轨迹缺少会话 ID");
  if (payload.size() > Limits::kMaxOutputBytes) return app::Result::failure("轨迹事件过大");
  if ((kind == EventKind::Started || kind == EventKind::Paused || kind == EventKind::Resumed ||
          kind == EventKind::Completed || kind == EventKind::Cancelled) && !payload.empty()) {
    return app::Result::failure("控制事件不应携带输出正文");
  }
  if (kind == EventKind::SourceStep) return app::Result::failure("源码步骤必须通过受限快照接口追加");
  events_.push_back({next_sequence_++, kind, session_id_, std::string(payload)});
  return app::Result::success("轨迹事件已追加");
}

app::Result Trace::append_source_step(std::string_view payload) {
  constexpr std::size_t kMaxSourceStepBytes = 8192;
  constexpr std::size_t kMaxSourceSteps = 512;
  constexpr std::size_t kMaxSourceTraceBytes = 256 * 1024;
  if (session_id_.empty()) return app::Result::failure("轨迹缺少会话 ID");
  if (payload.empty() || payload.size() > kMaxSourceStepBytes) return app::Result::failure("源码快照超过单步大小上限");
  std::size_t step_count = 0;
  std::size_t step_bytes = 0;
  for (const auto& event : events_) {
    if (event.kind == EventKind::SourceStep) {
      ++step_count;
      step_bytes += event.payload.size();
    }
  }
  if (step_count >= kMaxSourceSteps || step_bytes + payload.size() > kMaxSourceTraceBytes) {
    return app::Result::failure("源码快照达到运行上限");
  }
  events_.push_back({next_sequence_++, EventKind::SourceStep, session_id_, std::string(payload)});
  return app::Result::success("源码快照已追加");
}

}  // namespace codeweave::execution
