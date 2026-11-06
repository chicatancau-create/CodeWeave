#pragma once

#include "app_core.hpp"
#include "trace_contract.hpp"

#include <filesystem>
#include <mutex>
#include <string>
#include <vector>

namespace codeweave::execution {

struct TracePage {
  std::vector<TraceEvent> events;
  std::size_t next_offset{};
  bool end{};
};

class TraceStore final {
 public:
  explicit TraceStore(std::filesystem::path data_root);
  app::Result append(const Trace& trace);
  app::Result read_page(std::string_view session_id, std::size_t offset,
      std::size_t limit, TracePage& page) const;

 private:
  std::filesystem::path path() const;
  std::filesystem::path data_root_;
  mutable std::mutex mutex_;
};

struct TraceSummary {
  std::string session_id;
  std::size_t event_count{};
  std::size_t output_bytes{};
  bool completed{};
  bool failed{};
  bool cancelled{};
  bool paused{};
};

TraceSummary summarize_trace(const std::vector<TraceEvent>& events);

}  // namespace codeweave::execution
