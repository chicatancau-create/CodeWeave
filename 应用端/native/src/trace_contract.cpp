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
  events_.push_back({next_sequence_++, kind, session_id_, std::string(payload)});
  return app::Result::success("轨迹事件已追加");
}

}  // namespace codeweave::execution
