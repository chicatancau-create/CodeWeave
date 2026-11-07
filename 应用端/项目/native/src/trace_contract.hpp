#pragma once

#include "execution_contract.hpp"

#include <cstdint>
#include <string>
#include <string_view>
#include <vector>

namespace codeweave::execution {

enum class EventKind { Started, SourceStep, Output, Paused, Resumed, Completed, Failed, Cancelled };

struct TraceEvent {
  std::uint64_t sequence{};
  EventKind kind{EventKind::Started};
  std::string session_id;
  std::string payload;
};

class Trace final {
 public:
  explicit Trace(std::string session_id);

  app::Result append(EventKind kind, std::string_view payload = {});
  app::Result append_source_step(std::string_view payload);
  [[nodiscard]] const std::vector<TraceEvent>& events() const noexcept { return events_; }
  [[nodiscard]] std::uint64_t next_sequence() const noexcept { return next_sequence_; }

 private:
  std::string session_id_;
  std::uint64_t next_sequence_{1};
  std::vector<TraceEvent> events_;
};

}  // namespace codeweave::execution
