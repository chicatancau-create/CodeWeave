#pragma once

#include "app_core.hpp"

#include <atomic>
#include <cstdint>
#include <functional>
#include <memory>
#include <string>
#include <string_view>

namespace codeweave::backend {

enum class TaskKind { Read, Account, Backup, Import, Draft, Evidence, Execute };

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
  // 进入 Closing：拒绝新任务，并对**队列中与正在执行**的任务同时发取消。非阻塞。
  app::Result close();
  // 阻塞回收 worker。UI 线程不得直接调它等一个未取消的任务（§14.5），
  // 必须先 close() 再用 idle_stopped() 轮询并保持事件泵。
  app::Result wait_closed();
  [[nodiscard]] bool busy() const;
  // worker 是否已彻底停止。供 UI 线程「泵事件直到可安全回收」使用。
  [[nodiscard]] bool stopped() const;
  [[nodiscard]] std::size_t pending() const;

 private:
  struct State;
  std::shared_ptr<State> state_;
};

}  // namespace codeweave::backend
