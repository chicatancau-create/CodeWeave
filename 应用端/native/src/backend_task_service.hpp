#pragma once

#include "app_core.hpp"

#include <atomic>
#include <cstdint>
#include <functional>
#include <memory>
#include <string>
#include <string_view>

namespace codeweave::backend {

enum class TaskKind { Read, Account, Backup, Import, Draft };

class CancellationToken final {
 public:
  [[nodiscard]] bool cancelled() const noexcept;

 private:
  friend class BackendTaskService;
  explicit CancellationToken(const std::atomic_bool* cancelled) : cancelled_(cancelled) {}
  const std::atomic_bool* cancelled_{};
};

struct TaskRequest {
  std::string task_id;
  std::string account_id;
  std::uint64_t account_generation{};
  TaskKind kind{TaskKind::Read};
  std::function<app::Result(const CancellationToken&)> work;
};

struct TaskResult {
  std::string task_id;
  std::string account_id;
  std::uint64_t account_generation{};
  TaskKind kind{TaskKind::Read};
  bool cancelled{};
  app::Result result{app::Result::failure("任务未执行")};
};

class BackendTaskService final {
 public:
  using Completion = std::function<void(TaskResult)>;

  explicit BackendTaskService(std::size_t queue_limit = 8);
  ~BackendTaskService();

  BackendTaskService(const BackendTaskService&) = delete;
  BackendTaskService& operator=(const BackendTaskService&) = delete;

  app::Result submit(TaskRequest request, Completion completion);
  app::Result cancel(std::string_view task_id);
  app::Result close();
  app::Result wait_closed();
  [[nodiscard]] bool busy() const;
  [[nodiscard]] std::size_t pending() const;

 private:
  struct State;
  std::shared_ptr<State> state_;
};

}  // namespace codeweave::backend
