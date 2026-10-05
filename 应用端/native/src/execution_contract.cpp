#include "execution_contract.hpp"

#include <algorithm>
#include <cctype>

namespace codeweave::execution {
namespace {

bool safe_session_id(std::string_view value) {
  if (value.empty() || value.size() > 96) return false;
  const auto ascii_identifier = [](unsigned char character) {
    return (character >= 'a' && character <= 'z') ||
        (character >= 'A' && character <= 'Z') ||
        (character >= '0' && character <= '9') || character == '-' || character == '_';
  };
  const auto first = static_cast<unsigned char>(value.front());
  const bool valid_first = (first >= 'a' && first <= 'z') ||
      (first >= 'A' && first <= 'Z') || (first >= '0' && first <= '9');
  return valid_first && std::all_of(value.begin(), value.end(), ascii_identifier);
}

bool supported_language(std::string_view value) {
  return value == "cpp" || value == "javascript" || value == "python" || value == "java";
}

}  // namespace

app::Result validate_request(const Request& request) {
  if (!safe_session_id(request.session_id)) return app::Result::failure("执行会话 ID 格式无效");
  if (!supported_language(request.language)) return app::Result::failure("执行语言未纳入支持清单");
  if (request.source.empty() || request.source.size() > Limits::kMaxSourceBytes) {
    return app::Result::failure("执行源码为空或超过大小上限");
  }
  if (request.timeout_ms < Limits::kMinTimeoutMs || request.timeout_ms > Limits::kMaxTimeoutMs) {
    return app::Result::failure("执行超时不在允许范围");
  }
  if (request.output_limit < Limits::kMinOutputBytes || request.output_limit > Limits::kMaxOutputBytes) {
    return app::Result::failure("执行输出上限不在允许范围");
  }
  return app::Result::success("执行请求有效");
}

bool is_valid_transition(State from, State to) {
  if (from == State::Created) return to == State::Running || to == State::Cancelled;
  if (from == State::Running) return to == State::Paused || to == State::Completed ||
      to == State::Failed || to == State::Cancelled;
  if (from == State::Paused) return to == State::Running || to == State::Cancelled || to == State::Failed;
  return false;
}

Session::Session(Request request) : request_(std::move(request)) {}

app::Result Session::transition(State next, std::string_view error_code) {
  if (!is_valid_transition(result_.state, next)) return app::Result::failure("执行状态转换不允许");
  result_.state = next;
  if (!error_code.empty()) result_.error_code = std::string(error_code);
  return app::Result::success("执行状态已更新");
}

app::Result Session::start() {
  if (const auto valid = validate_request(request_); !valid.ok) return valid;
  return transition(State::Running);
}

app::Result Session::pause() { return transition(State::Paused); }
app::Result Session::resume() { return transition(State::Running); }
app::Result Session::complete() { return transition(State::Completed); }
app::Result Session::fail(std::string_view error_code) {
  if (error_code.empty() || error_code.size() > 64) return app::Result::failure("执行错误码无效");
  return transition(State::Failed, error_code);
}
app::Result Session::cancel() { return transition(State::Cancelled, "cancelled"); }

app::Result Session::append_output(std::string_view output) {
  if (result_.state != State::Running && result_.state != State::Paused) {
    return app::Result::failure("当前执行状态不接受输出");
  }
  const auto remaining = request_.output_limit > result_.output_bytes
      ? request_.output_limit - result_.output_bytes : 0;
  const auto accepted = std::min(remaining, output.size());
  result_.output_bytes += accepted;
  if (accepted < output.size()) {
    result_.output_truncated = true;
    return app::Result::failure("执行输出超过上限");
  }
  return app::Result::success("执行输出已接收");
}

}  // namespace codeweave::execution
