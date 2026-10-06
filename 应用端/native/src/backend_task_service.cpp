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
    cancel_all_pending();
    {
      std::unique_lock lock(mutex);
      condition.wait(lock, [this] { return stopped; });
    }
    if (worker.joinable()) worker.join();
  }

  // 关闭时进入 Closing 并**对在飞的读任务发取消** —— 只遍历 queue 是不够的：
  // 在飞任务已在 run() 里弹出，queue 里没有它，于是关闭要等它自己跑完，
  // 而调用方正阻塞等回收，这就是「关闭冻结界面」的成因。
  // cancellation 表在任务完成前一直持有令牌，查这张表可同时覆盖队列与在飞两类。
  //
  // 只取消 Read：写类任务（草稿/账户/备份/导入）是用户已经下达的持久化意图，
  // 关闭时把它丢掉等于静默丢数据。§14.5 要求的是「保持事件泵等它到安全边界」，
  // 不是「取消它」—— 等待由调用方的事件泵承担（见 UiShell::drain_backend_tasks）。
  void cancel_all_pending() {
    std::lock_guard lock(mutex);
    closing = true;
    for (auto& item : queue) {
      if (item.request.kind == TaskKind::Read || item.request.kind == TaskKind::Execute ||
          item.request.kind == TaskKind::Backup || item.request.kind == TaskKind::Import) {
        item.cancelled->store(true, std::memory_order_release);
      }
    }
    // 在飞任务已被 run() 从 queue 弹出，只能靠这份登记才拿得到它的令牌。
    if ((active_kind == TaskKind::Read || active_kind == TaskKind::Execute ||
         active_kind == TaskKind::Backup || active_kind == TaskKind::Import) && active_cancel) {
      active_cancel->store(true, std::memory_order_release);
    }
    condition.notify_all();
  }

  void run() {
    for (;;) {
      Item item;
      {
        std::unique_lock lock(mutex);
        condition.wait(lock, [this] { return closing || !queue.empty(); });
        if (queue.empty() && closing) {
          stopped = true;
          condition.notify_all();
          return;
        }
        item = std::move(queue.front());
        queue.pop_front();
        active = true;
        active_kind = item.request.kind;
        active_cancel = item.cancelled;
      }
      TaskResult result{item.request.task_id, item.request.account_id,
          item.request.account_generation, item.request.kind, false,
          app::Result::failure("任务未执行")};
      if (item.cancelled->load(std::memory_order_acquire)) {
        result.cancelled = true;
        result.result = app::Result::failure("任务已取消");
      } else {
        // work 抛出不得带走整个进程：active 不复位会让 close() 永远等不到 stopped。
        try {
          result.result = item.request.work(CancellationToken(item.cancelled.get()));
        } catch (const std::exception& error) {
          result.result = app::Result::failure(std::string("任务抛出异常：") + error.what());
        } catch (...) {
          result.result = app::Result::failure("任务抛出未知异常");
        }
        // §14.5「成功写入后不得假报已取消」：work 返回 ok 表示副作用已经发生，
        // 结论必须原样上报。取消只作为 cancelled 观察位交给调用方自行呈现，
        // 绝不在这里把 ok 改写成 failure —— 那会让磁盘已写入而 UI 仍显示未保存。
        result.cancelled = item.cancelled->load(std::memory_order_acquire);
      }
      if (item.completion) {
        try {
          item.completion(std::move(result));
        } catch (...) {
          // 完成回调不得把 worker 线程带走；队列与关闭信号比一次回调重要。
        }
      }
      {
        std::lock_guard lock(mutex);
        active = false;
        active_cancel.reset();
        active_kind = TaskKind::Read;
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
  // 在飞任务的取消登记：queue 里已经没有它，close() 只能靠这两个成员拿到令牌。
  std::shared_ptr<std::atomic_bool> active_cancel;
  TaskKind active_kind{TaskKind::Read};
  bool closing{};
  bool stopped{};
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
  state->cancel_all_pending();
  return app::Result::success("后台任务服务已进入关闭");
}

app::Result BackendTaskService::wait_closed() {
  const auto state = state_;
  std::unique_lock lock(state->mutex);
  if (!state->closing) return app::Result::failure("后台任务服务尚未关闭");
  state->condition.wait(lock, [&] { return state->stopped; });
  lock.unlock();
  // 从 worker 线程自己回收会死锁或留下 joinable 的 std::thread（析构时直接 terminate）。
  // 这里明确失败交回调用方处理，而不是静默跳过 join 假装成功。
  if (state->worker.get_id() == std::this_thread::get_id()) {
    return app::Result::failure("不能在 worker 线程内回收后台任务服务");
  }
  if (state->worker.joinable()) state->worker.join();
  return app::Result::success("后台任务服务已停止");
}

bool BackendTaskService::stopped() const {
  const auto state = state_;
  std::lock_guard lock(state->mutex);
  return state->stopped;
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
