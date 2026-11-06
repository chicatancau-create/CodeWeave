#pragma once

#include "execution_plan.hpp"

#include <string>
#include <atomic>
#include <functional>
#include <mutex>
#include <vector>

namespace codeweave::execution {

enum class ControlCommand { Pause, Resume, Step };

class ExecutionControl final {
 public:
  using Handler = std::function<app::Result(ControlCommand)>;

  app::Result request(ControlCommand command);
  void attach(Handler handler);
  void detach();
  [[nodiscard]] bool is_paused() const noexcept { return paused_.load(); }

 private:
  friend class ProcessRunner;
  void set_paused(bool value) noexcept { paused_.store(value); }
  mutable std::mutex mutex_;
  Handler handler_;
  std::atomic<bool> paused_{false};
};

struct ControlEvent {
  ControlCommand command{};
};

struct ProcessResult {
  bool started{};
  bool timed_out{};
  bool cancelled{};
  bool output_truncated{};
  unsigned long exit_code{};
  std::string output;
  std::string error_code;
  // False when output came from a compilation step that never produced a
  // runnable program. Such output must not be submitted as learner output.
  bool execution_output_valid{true};
  std::vector<ControlEvent> control_events;
};

class ProcessRunner final {
 public:
  ProcessResult run(const ProcessPlan& plan, const std::atomic_bool* cancellation = nullptr,
      ExecutionControl* control = nullptr) const;
};

}  // namespace codeweave::execution
