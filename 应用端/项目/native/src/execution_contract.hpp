#pragma once

#include "app_core.hpp"

#include <cstddef>
#include <cstdint>
#include <string>
#include <string_view>

namespace codeweave::execution {

enum class State { Created, Running, Paused, Completed, Failed, Cancelled };

struct Request {
  std::string session_id;
  std::string language;
  std::string source;
  std::uint32_t timeout_ms{};
  std::size_t output_limit{};
};

struct Limits {
  static constexpr std::uint32_t kMinTimeoutMs = 100;
  static constexpr std::uint32_t kMaxTimeoutMs = 120'000;
  static constexpr std::size_t kMinOutputBytes = 256;
  static constexpr std::size_t kMaxOutputBytes = 1'048'576;
  static constexpr std::size_t kMaxSourceBytes = 1'048'576;
};

struct Result {
  State state{State::Created};
  std::size_t output_bytes{};
  bool output_truncated{};
  std::string error_code;
};

app::Result validate_request(const Request& request);
bool is_valid_transition(State from, State to);

class Session final {
 public:
  explicit Session(Request request);

  [[nodiscard]] const Request& request() const noexcept { return request_; }
  [[nodiscard]] const Result& result() const noexcept { return result_; }

  app::Result start();
  app::Result pause();
  app::Result resume();
  app::Result complete();
  app::Result fail(std::string_view error_code);
  app::Result cancel();
  app::Result append_output(std::string_view output);

 private:
  app::Result transition(State next, std::string_view error_code = {});
  Request request_;
  Result result_;
};

}  // namespace codeweave::execution
