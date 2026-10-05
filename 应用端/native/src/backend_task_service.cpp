#include "backend_task_service.hpp"

#include <condition_variable>
#include <cstddef>
#include <deque>
#include <mutex>
#include <thread>
#include <unordered_map>
#include <utility>

namespace codeweave::backend {

struct BackendTaskService::State {
  struct Item {
    TaskRequest request;
    Completion completion;
    std::shared_ptr<std::atomic_bool> cancelled;
  };

  explicit State(std::size_t limit) : queue_limit(limit), worker([this] { run(); }) {}
  ~State() {
    {
      std::lock_guard lock(mutex);
      closing = true;
      for (auto& item : queue) item.cancelled->store(true, std::memory_order_release);
    }
    condition.notify_all();
    if (worker.joinable()) worker.join();
  }

  void run() {
    for (;;) {
      Item item;
      {
        std::unique_lock lock(mutex);
        condition.wait(lock, [this] { return closing || !queue.empty(); });
        if (queue.empty() && closing) return;
        item = std::move(queue.front());
        queue.pop_front();
        active = true;
      }
      TaskResult result{item.request.task_id, item.request.account_id,
          item.request.account_generation, item.request.kind, false,
          app::Result::failure("任务未执行")};
      if (item.cancelled->load(std::memory_order_acquire)) {
        result.cancelled = true;
        result.result = app::Result::failure("任务已取消");
      } else {
        result.result = item.request.work(CancellationToken(item.cancelled.get()));
        result.cancelled = item.cancelled->load(std::memory_order_acquire);
        if (result.cancelled && result.result.ok) result.result = app::Result::failure("任务已取消");
      }
      if (item.completion) item.completion(std::move(result));
      {
        std::lock_guard lock(mutex);
        active = false;
        cancellation.erase(item.request.task_id);
      }
      condition.notify_all();
    }
  }

  const std::size_t queue_limit;
  mutable std::mutex mutex;
  std::condition_variable condition;
  std::deque<Item> queue;
  std::unordered_map<std::string, std::shared_ptr<std::atomic_bool>> cancellation;
  bool active{};
  bool closing{};
  std::thread worker;
};

bool CancellationToken::cancelled() const noexcept {
  return cancelled_ != nullptr && cancelled_->load(std::memory_order_acquire);
}

BackendTaskService::BackendTaskService(std::size_t queue_limit)
    : state_(std::make_shared<State>(queue_limit)) {}

BackendTaskService::~BackendTaskService() { close(); }

app::Result BackendTaskService::submit(TaskRequest request, Completion completion) {
  if (request.task_id.empty() || !request.work) return app::Result::failure("任务请求不完整");
  const auto state = state_;
  std::lock_guard lock(state->mutex);
  if (state->closing) return app::Result::failure("后台任务服务正在关闭");
  if (state->cancellation.contains(request.task_id)) return app::Result::failure("任务 ID 已存在");
  if (state->queue.size() >= state->queue_limit) return app::Result::failure("后台任务队列已满");
  auto cancelled = std::make_shared<std::atomic_bool>(false);
  state->cancellation.emplace(request.task_id, cancelled);
  state->queue.push_back({std::move(request), std::move(completion), std::move(cancelled)});
  state->condition.notify_one();
  return app::Result::success("任务已排队");
}

app::Result BackendTaskService::cancel(std::string_view task_id) {
  const auto state = state_;
  std::lock_guard lock(state->mutex);
  const auto found = state->cancellation.find(std::string(task_id));
  if (found == state->cancellation.end()) return app::Result::failure("任务不存在");
  found->second->store(true, std::memory_order_release);
  return app::Result::success("已请求取消任务");
}

app::Result BackendTaskService::close() {
  const auto state = state_;
  {
    std::lock_guard lock(state->mutex);
    state->closing = true;
    for (auto& item : state->queue) item.cancelled->store(true, std::memory_order_release);
  }
  state->condition.notify_all();
  return app::Result::success("后台任务服务已进入关闭");
}

bool BackendTaskService::busy() const {
  const auto state = state_;
  std::lock_guard lock(state->mutex);
  return state->active || !state->queue.empty();
}

std::size_t BackendTaskService::pending() const {
  const auto state = state_;
  std::lock_guard lock(state->mutex);
  return state->queue.size();
}

}  // namespace codeweave::backend
