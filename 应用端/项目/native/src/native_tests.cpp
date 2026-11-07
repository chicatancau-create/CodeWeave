#include "app_core.hpp"
#include "backend_task_service.hpp"
#include "account_store.hpp"
#include "password_crypto.hpp"
#include "account_service.hpp"
#include "progress_store.hpp"
#include "operation_index.hpp"
#include "challenge_service.hpp"
#include "external_evidence_service.hpp"
#include "migration_staging.hpp"
#include "migration_contract.hpp"
#include "legacy_import.hpp"
#include "backup_service.hpp"
#include "review_service.hpp"
#include "content_access.hpp"
#include "account.hpp"
#include "content_contract.hpp"
#include "content_repository.hpp"
#include "learning_contract.hpp"
#include "mastery_contract.hpp"
#include "mastery_service.hpp"
#include "review_scheduler.hpp"
#include "evidence_store.hpp"
#include "progress_projection.hpp"
#include "manifest_dry_run.hpp"
#include "migration_dry_run.hpp"
#include "execution_contract.hpp"
#include "process_contract.hpp"
#include "execution_plan.hpp"
#include "process_runner.hpp"
#include "execution_service.hpp"
#include "trace_contract.hpp"
#include "trace_store.hpp"

#include <cassert>
#include <array>
#include <atomic>
#include <chrono>
#include <cstdio>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <random>
#include <string>
#include <thread>
#include <vector>
#include <thread>
#ifdef _WIN32
#include <windows.h>
#endif

namespace {

struct Fixture {
  std::filesystem::path root = std::filesystem::temp_directory_path() /
      ("codeweave-native-core-fixture-" + std::to_string(std::random_device{}()));

  Fixture() {
    std::error_code error;
    std::filesystem::create_directories(root / "config", error);
    assert(!error);
    std::ofstream(root / "config" / "codeweave.config.example.json") << "{}\n";
  }

  ~Fixture() {
    std::error_code error;
    std::filesystem::remove_all(root, error);
  }
};

void test_workspace_and_draft_round_trip() {
  Fixture fixture;
  codeweave::app::ApplicationCore core;
  assert(!core.open_workspace(fixture.root / "missing").ok);
  const auto open_result = core.open_workspace(fixture.root);
  assert(open_result.ok);
  assert(core.is_open());

  const std::string source = "中文 draft\nreturn 42;\n";
  const auto save_result = core.save_draft("lesson-01", source);
  assert(save_result.ok);
  std::string restored;
  assert(core.load_draft("lesson-01", restored).ok);
  assert(restored == source);
  assert(std::filesystem::exists(fixture.root / "data/runtime/native/drafts/lesson-01.txt"));
  codeweave::app::ApplicationCore second;
  assert(!second.open_workspace(fixture.root).ok);
  assert(core.close_workspace().ok);
  assert(second.open_workspace(fixture.root).ok);
}

void test_backend_task_service_is_bounded_cancellable_and_generation_safe() {
  using codeweave::backend::BackendTaskService;
  using codeweave::backend::TaskKind;
  using codeweave::backend::TaskRequest;
  std::mutex mutex;
  std::condition_variable condition;
  std::vector<codeweave::backend::TaskResult> completed;
  BackendTaskService service(1);
  std::atomic_bool release{false};
  assert(service.submit({"task-1", "account-1", 7, TaskKind::Backup,
      [&](const auto& token) {
        while (!release.load(std::memory_order_acquire) && !token.cancelled()) {
          std::this_thread::yield();
        }
        return token.cancelled() ? codeweave::app::Result::failure("cancelled") : codeweave::app::Result::success("done");
      }}, [&](auto result) {
        std::lock_guard lock(mutex); completed.push_back(std::move(result)); condition.notify_all();
      }).ok);
  assert(!service.submit({"task-2", "account-1", 7, TaskKind::Read,
      [](const auto&) { return codeweave::app::Result::success(); }}, {}).ok);
  assert(service.cancel("task-1").ok);
  release.store(true, std::memory_order_release);
  {
    std::unique_lock lock(mutex);
    assert(condition.wait_for(lock, std::chrono::seconds(2), [&] { return completed.size() == 1; }));
  }
  assert(completed[0].task_id == "task-1" && completed[0].account_generation == 7);
  assert(completed[0].cancelled && !completed[0].result.ok);
  assert(service.close().ok);
  assert(service.wait_closed().ok);
  assert(!service.submit({"task-3", "account-1", 8, TaskKind::Read,
      [](const auto&) { return codeweave::app::Result::success(); }}, {}).ok);
}

// 缺陷 B 的回归：work 已经成功落盘、期间又被请求取消时，结论不得被改写成失败。
// 上面的既有用例让 work 自己在取消时返回 failure，所以恰好测不到这条路径。
void test_backend_task_service_keeps_successful_write_when_cancelled() {
  using codeweave::backend::BackendTaskService;
  using codeweave::backend::TaskKind;
  std::mutex mutex;
  std::condition_variable condition;
  std::vector<codeweave::backend::TaskResult> completed;
  BackendTaskService service(4);
  std::atomic_bool entered{false};
  assert(service.submit({"write-committed", "account-1", 3, TaskKind::Draft,
      [&](const auto& token) {
        entered.store(true, std::memory_order_release);
        condition.notify_all();
        // 模拟「已经写入之后才被请求取消」：取消发生在副作用完成之后。
        std::this_thread::sleep_for(std::chrono::milliseconds(30));
        (void)token;
        return codeweave::app::Result::success("已写入");
      }}, [&](auto result) {
        std::lock_guard lock(mutex);
        completed.push_back(std::move(result));
        condition.notify_all();
      }).ok);
  {
    std::unique_lock lock(mutex);
    assert(condition.wait_for(lock, std::chrono::seconds(2), [&] { return entered.load(); }));
  }
  assert(service.cancel("write-committed").ok);
  {
    std::unique_lock lock(mutex);
    assert(condition.wait_for(lock, std::chrono::seconds(3), [&] { return completed.size() == 1; }));
  }
  // 副作用已经发生：必须上报成功，同时把「曾被取消」作为观察位保留给调用方。
  assert(completed[0].result.ok);
  assert(completed[0].cancelled);
  assert(service.close().ok);
  assert(service.wait_closed().ok);
}

// 缺陷 A 的回归：close() 必须能取消**正在执行**的读任务。
// 改之前 close() 只遍历 queue，而在飞任务已被弹出，于是关闭要等它自己跑完。
void test_backend_task_service_close_cancels_inflight_read() {
  using codeweave::backend::BackendTaskService;
  using codeweave::backend::TaskKind;
  BackendTaskService service(4);
  std::atomic_bool entered{false};
  std::atomic_bool saw_cancel{false};
  std::mutex mutex;
  std::condition_variable condition;
  bool stopped_flag{};
  assert(service.submit({"slow-read", "account-1", 1, TaskKind::Read,
      [&](const auto& token) {
        entered.store(true, std::memory_order_release);
        condition.notify_all();
        const auto deadline = std::chrono::steady_clock::now() + std::chrono::seconds(8);
        while (!token.cancelled() && std::chrono::steady_clock::now() < deadline) {
          std::this_thread::yield();
        }
        saw_cancel.store(token.cancelled(), std::memory_order_release);
        return token.cancelled() ? codeweave::app::Result::failure("cancelled")
                                 : codeweave::app::Result::success("ran to completion");
      }}, [&](codeweave::backend::TaskResult) {
        std::lock_guard lock(mutex);
        stopped_flag = true;
        condition.notify_all();
      }).ok);
  {
    std::unique_lock lock(mutex);
    assert(condition.wait_for(lock, std::chrono::seconds(2), [&] { return entered.load(); }));
  }
  const auto began = std::chrono::steady_clock::now();
  assert(service.close().ok);
  assert(service.wait_closed().ok);
  const auto waited = std::chrono::duration_cast<std::chrono::milliseconds>(
      std::chrono::steady_clock::now() - began).count();
  assert(saw_cancel.load());   // 是 close() 把它停下来的，不是自己熬到超时
  assert(waited < 2000);       // 关闭等待有界
  assert(stopped_flag);
}

void test_worker_cannot_wait_for_itself() {
  codeweave::backend::BackendTaskService service;
  std::atomic_bool returned{false};
  assert(service.submit({"self-close", "", 0, codeweave::backend::TaskKind::Read,
      [](const auto&) { return codeweave::app::Result::success("done"); }},
      [&](auto) {
        assert(service.close().ok);
        assert(!service.wait_closed().ok);
        returned.store(true, std::memory_order_release);
      }).ok);
  const auto deadline = std::chrono::steady_clock::now() + std::chrono::seconds(2);
  while (!returned.load(std::memory_order_acquire) && std::chrono::steady_clock::now() < deadline) {
    std::this_thread::sleep_for(std::chrono::milliseconds(1));
  }
  assert(returned.load(std::memory_order_acquire));
  assert(service.wait_closed().ok);
}

void test_workspace_can_use_independent_application_data_root() {
  Fixture fixture;
  const auto profile = fixture.root.parent_path() / (fixture.root.filename().string() + "-profile");
  std::error_code cleanup_error;
  std::filesystem::remove_all(profile, cleanup_error);
  codeweave::app::ApplicationCore core;
  assert(core.open_workspace(fixture.root, profile).ok);
  assert(core.data_root() == std::filesystem::absolute(profile));
  assert(core.save_draft("isolated", "data").ok);
  assert(std::filesystem::exists(profile / "drafts" / "isolated.txt"));
  assert(!std::filesystem::exists(fixture.root / "data" / "runtime" / "native" / "drafts" / "isolated.txt"));
  assert(core.close_workspace().ok);
  std::filesystem::remove_all(profile, cleanup_error);
}

void test_workspace_rejects_symlink_data_root() {
  Fixture fixture;
  const auto outside = fixture.root.parent_path() /
      (fixture.root.filename().string() + "-outside-data");
  std::error_code error;
  std::filesystem::create_directories(outside);
  const auto alias = fixture.root.parent_path() /
      (fixture.root.filename().string() + "-data-alias");
  std::filesystem::create_directory_symlink(outside, alias, error);
  if (!error) {
    codeweave::app::ApplicationCore core;
    assert(!core.open_workspace(fixture.root, alias).ok);
    std::filesystem::remove(alias, error);
  }
  std::filesystem::remove_all(outside, error);
}

void test_invalid_ids_and_atomic_replace() {
  Fixture fixture;
  codeweave::app::ApplicationCore core;
  assert(core.open_workspace(fixture.root).ok);
  assert(!core.save_draft("../escape", "bad").ok);
  assert(!core.save_draft("lesson/01", "bad").ok);
  assert(!core.save_draft("lesson-nul", std::string("bad\0text", 8)).ok);
  assert(!core.save_draft("lesson-large", std::string(4 * 1024 * 1024 + 1, 'x')).ok);
  assert(core.save_draft("lesson-01", "first").ok);
  assert(core.save_draft("lesson-01", "second").ok);
  std::string restored;
  assert(core.load_draft("lesson-01", restored).ok);
  assert(restored == "second");
}

void test_oversized_existing_draft_is_rejected_before_reading() {
  Fixture fixture;
  codeweave::app::ApplicationCore core;
  assert(core.open_workspace(fixture.root).ok);
  const auto path = core.data_root() / "drafts" / "oversized.txt";
  std::ofstream output(path, std::ios::binary | std::ios::trunc);
  output << std::string(4 * 1024 * 1024 + 1, 'x');
  output.close();
  std::string restored;
  assert(!core.load_draft("oversized", restored).ok);
}

void test_draft_symlink_is_rejected_before_reading() {
  Fixture fixture;
  codeweave::app::ApplicationCore core;
  assert(core.open_workspace(fixture.root).ok);
  const auto target = fixture.root / "outside-draft.txt";
  std::ofstream(target) << "outside\n";
  const auto link = core.data_root() / "drafts" / "linked.txt";
  std::error_code error;
  std::filesystem::create_symlink(target, link, error);
  if (!error) {
    std::string restored;
    assert(!core.load_draft("linked", restored).ok);
    std::filesystem::remove(link, error);
  }
}

void test_write_before_open_is_rejected() {
  codeweave::app::ApplicationCore core;
  assert(!core.save_draft("lesson-01", "bad").ok);
  std::string restored;
  assert(!core.load_draft("lesson-01", restored).ok);
}

void test_open_workspace_is_idempotence_guarded() {
  Fixture fixture;
  codeweave::app::ApplicationCore core;
  assert(core.open_workspace(fixture.root).ok);
  assert(!core.open_workspace(fixture.root).ok);
  assert(core.close_workspace().ok);
  assert(core.close_workspace().ok);
}

void test_account_contract_uses_non_sensitive_vectors() {
  const codeweave::account::Record valid{
      "user-01", "demo@example.test", "", "Demo", 
      "scrypt$v1$0123456789abcdef0123456789abcdef:"
      "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
      "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"};
  assert(codeweave::account::validate(valid).ok);
  assert(codeweave::account::is_phone("138 0013 8000"));
  assert(codeweave::account::normalized_phone("138 0013 8000") == "13800138000");
  assert(!codeweave::account::validate({ "../escape", "", "", "Demo", valid.password_hash }).ok);
  assert(!codeweave::account::validate({ "user-02", "bad", "", "Demo", valid.password_hash }).ok);
  assert(!codeweave::account::validate({ "user-03", "", "", "Demo", valid.password_hash }).ok);
  assert(!codeweave::account::validate({ "user-04", "demo@example.test", "", "Demo", "plain-password" }).ok);
  assert(!codeweave::account::validate({ "user-05", "demo@example.test", "", std::string("bad\xC3\x28"), valid.password_hash }).ok);
}

void test_password_crypto_matches_legacy_scrypt_vector() {
#ifdef _WIN32
  std::string encoded;
  const auto hashed = codeweave::account::hash_password_with_salt(
      "password", "0123456789abcdef0123456789abcdef", encoded);
  assert(hashed.ok);
  assert(encoded == "scrypt$v1$0123456789abcdef0123456789abcdef:d17d0629e32ad3ac88ab78b388a13cb98d41fa6ed2e104e81b80e25bc66af3008a31dd0a0a9fa8bef5b167c25ca65cb0c9278b211bd5ab1270f7104cadd89486");
  bool matches = false;
  assert(codeweave::account::verify_password("password", encoded, matches).ok && matches);
  assert(codeweave::account::verify_password("wrong", encoded, matches).ok && !matches);
#endif
}

void test_account_store_is_native_only_and_idempotence_guarded() {
#ifdef _WIN32
  Fixture fixture;
  codeweave::account::AccountStore store(fixture.root / "data" / "runtime" / "native");
  codeweave::account::Record record;
  const auto register_result = store.register_with_password("native-user-01", "native@example.test", "", "Native User", "Password-123!", record);
  assert(register_result.ok);
  assert(!store.register_account(record).ok);
  std::vector<codeweave::account::Record> records;
  assert(store.list_accounts(records).ok && records.size() == 1);
  codeweave::account::Record authenticated;
  assert(store.authenticate_password("native@example.test", "Password-123!", authenticated).ok);
  assert(authenticated.id == record.id);
  assert(!store.authenticate_password("native@example.test", "wrong", authenticated).ok);
  assert(store.change_password("native@example.test", "Password-123!", "Password-456!").ok);
  assert(!store.authenticate_password("native@example.test", "Password-123!", authenticated).ok);
  assert(store.authenticate_password("native@example.test", "Password-456!", authenticated).ok);
  assert(!std::filesystem::exists(fixture.root / "data" / "runtime" / "desktop" / "users.json"));
#endif
}

void test_account_service_owns_in_memory_session_only() {
#ifdef _WIN32
  Fixture fixture;
  codeweave::account::AccountStore store(fixture.root / "data" / "runtime" / "native");
  codeweave::account::AccountService service(store);
  assert(service.register_account("Native", "service@example.test", "Password-123!").ok);
  assert(service.authenticated());
  assert(service.change_password("Password-123!", "Password-456!").ok);
  assert(service.logout().ok && !service.authenticated());
  assert(service.login("service@example.test", "Password-456!").ok);
  assert(service.logout().ok && !service.authenticated());
#endif
}

void test_account_learning_roots_are_session_scoped_and_fail_closed() {
#ifdef _WIN32
  Fixture fixture;
  const auto native_root = fixture.root / "data" / "runtime" / "native";
  codeweave::account::AccountStore store(native_root);
  codeweave::account::AccountService first(store);
  codeweave::account::AccountService second(store);
  std::filesystem::path root;
  assert(!first.learning_data_root(native_root, root).ok);
  assert(first.register_account("First", "first@example.test", "Password-123!").ok);
  const auto first_record = first.current();
  assert(first_record.has_value());
  assert(first.learning_data_root(native_root, root).ok);
  const auto first_root = root;
  assert(first_root == native_root / "accounts" / first_record->id);
  assert(!std::filesystem::exists(first_root));
  assert(second.register_account("Second", "second@example.test", "Password-123!").ok);
  assert(second.learning_data_root(native_root, root).ok);
  assert(root != first_root);
  assert(root == native_root / "accounts" / second.current()->id);
  codeweave::learning::ProgressStore first_progress(first_root);
  codeweave::learning::ProgressStore second_progress(root);
  bool duplicate = false;
  assert(first_progress.append_idempotent(
      {"fact-account-01", "lesson-01", "exercise-01", "2026-10-05", "completed",
       "op-account-0123ab"}, duplicate).ok);
  std::vector<codeweave::learning::ProgressFact> facts;
  assert(second_progress.read_all(facts).ok && facts.empty());
  assert(first_progress.read_all(facts).ok && facts.size() == 1);
  assert(!std::filesystem::exists(native_root / "learning"));
  assert(first.logout().ok);
  assert(!first.learning_data_root(native_root, root).ok);
  assert(root.empty());
  assert(first.login("first@example.test", "Password-123!").ok);
  assert(first.learning_data_root(native_root, root).ok && root == first_root);
  assert(!first.learning_data_root("relative", root).ok && root.empty());
#endif
}

void test_content_contract_requires_stable_published_units() {
  const codeweave::content::Unit valid{
      "java-01", "Java 的第一个循环", "published", "java",
      "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef", 1};
  assert(codeweave::content::validate(valid).ok);
  assert(codeweave::content::is_stable_id("java-01.lesson"));
  assert(!codeweave::content::is_stable_id("../lesson"));
  assert(!codeweave::content::is_content_hash("not-a-hash"));
  assert(!codeweave::content::validate({ "java/01", "Title", "published", "java", valid.content_hash, 1 }).ok);
  assert(!codeweave::content::validate({ "java-02", "Title", "removed", "java", valid.content_hash, 1 }).ok);
  assert(!codeweave::content::validate({ "java-03", "Title", "published", "java", "short", 1 }).ok);
  assert(!codeweave::content::validate({ "java-04", "Title", "published", "java", valid.content_hash, 2 }).ok);
  assert(!codeweave::content::validate({ "java-05", std::string("bad\xC3\x28"), "published", "java", valid.content_hash, 1 }).ok);
  assert(!codeweave::content::validate({ "java-06", "Title", "published", std::string("java\xC3\x28"), valid.content_hash, 1 }).ok);
}

void test_content_repository_reads_only_published_units() {
  Fixture fixture;
  const auto root = fixture.root / "content";
  std::filesystem::create_directories(root);
  // The fixture is written through the Windows text stream, so its bytes are
  // "native lesson\\r\\n". Keep the catalog hash aligned with those bytes.
  const std::string hash = "1e4e588064256e81ac0170f60d10b64daa6e9407bfc0dc7ade40341aa3afe7d0";
  const auto hex = [](std::string_view value) {
    constexpr char digits[] = "0123456789abcdef"; std::string result;
    for (const unsigned char c : value) { result.push_back(digits[c >> 4]); result.push_back(digits[c & 15]); }
    return result;
  };
  std::ofstream(root / "catalog.v1.tsv") << hex("lesson-01") << '\t' << hex("循环") << '\t' << hex("published") << '\t' << hex("cpp") << '\t' << hex(hash) << '\t' << hex("1") << '\n'
      << hex("draft-01") << '\t' << hex("草稿") << '\t' << hex("draft") << '\t' << hex("cpp") << '\t' << hex(hash) << '\t' << hex("1") << '\n';
  std::ofstream(root / "lesson-01.txt") << "native lesson\n";
  codeweave::content::ContentRepository repository(root);
  std::vector<codeweave::content::Unit> units;
  const auto listed = repository.list_published(units);
  assert(listed.ok && units.size() == 1 && units[0].content_id == "lesson-01");
  codeweave::content::LoadedUnit loaded;
  assert(!repository.read_published("../lesson-01", loaded).ok);
  assert(!repository.read_published("lesson/01", loaded).ok);
  const auto read = repository.read_published("lesson-01", loaded);
  assert(read.ok && (loaded.body == "native lesson\n" || loaded.body == "native lesson\r\n"));
  assert(!repository.read_published("draft-01", loaded).ok);
  std::ofstream(root / "lesson-01.txt", std::ios::binary | std::ios::trunc) << "\xC3\x28";
  assert(!repository.read_published("lesson-01", loaded).ok);
  std::ofstream(root / "lesson-01.txt", std::ios::binary | std::ios::trunc) << "native lesson\n";
  std::ofstream(root / "catalog.v1.tsv", std::ios::trunc) << hex("lesson-01") << '\t' << hex("循环") << '\t' << hex("published") << '\t' << hex("cpp") << '\t' << hex(hash + "0") << '\t' << hex("1") << '\n';
  assert(!repository.read_published("lesson-01", loaded).ok);
}

void test_content_repository_rejects_symlink_files() {
  Fixture fixture;
  const auto root = fixture.root / "content-symlink";
  const auto outside = fixture.root / "content-outside";
  std::filesystem::create_directories(root);
  std::filesystem::create_directories(outside);
  const auto hex = [](std::string_view value) {
    constexpr char digits[] = "0123456789abcdef";
    std::string result;
    for (const unsigned char character : value) {
      result.push_back(digits[character >> 4]);
      result.push_back(digits[character & 0x0f]);
    }
    return result;
  };
  const std::string body = "native lesson\n";
  const std::string hash = "1e4e588064256e81ac0170f60d10b64daa6e9407bfc0dc7ade40341aa3afe7d0";
  std::ofstream(outside / "catalog.v1.tsv") << hex("lesson-01") << '\t' << hex("标题") << '\t'
      << hex("published") << '\t' << hex("cpp") << '\t' << hex(hash) << '\t' << hex("1") << '\n';
  std::ofstream(outside / "lesson-01.txt") << body;
  std::error_code error;
  std::filesystem::create_symlink(outside / "catalog.v1.tsv", root / "catalog.v1.tsv", error);
  if (!error) {
    codeweave::content::ContentRepository repository(root);
    std::vector<codeweave::content::Unit> units;
    assert(!repository.list_published(units).ok);
    std::filesystem::remove(root / "catalog.v1.tsv", error);
  }
  error.clear();
  std::ofstream(root / "catalog.v1.tsv") << hex("lesson-01") << '\t' << hex("标题") << '\t'
      << hex("published") << '\t' << hex("cpp") << '\t' << hex(hash) << '\t' << hex("1") << '\n';
  std::filesystem::create_symlink(outside / "lesson-01.txt", root / "lesson-01.txt", error);
  if (!error) {
    codeweave::content::ContentRepository repository(root);
    codeweave::content::LoadedUnit loaded;
    assert(!repository.read_published("lesson-01", loaded).ok);
    std::filesystem::remove(root / "lesson-01.txt", error);
  }
}

void test_content_repository_reads_versioned_exercise_metadata() {
  Fixture fixture;
  const auto root = fixture.root / "content-exercises";
  std::filesystem::create_directories(root);
  const auto hex = [](std::string_view value) {
    constexpr char digits[] = "0123456789abcdef";
    std::string result;
    for (const unsigned char character : value) {
      result.push_back(digits[character >> 4]);
      result.push_back(digits[character & 0x0f]);
    }
    return result;
  };
  const std::string hash(64, 'a');
  std::ofstream(root / "catalog.v1.tsv") << hex("lesson-01") << '\t' << hex("循环") << '\t'
      << hex("published") << '\t' << hex("cpp") << '\t' << hex(hash) << '\t' << hex("1") << '\n';
  std::ofstream(root / "exercises.v1.tsv") << hex("lesson-01") << '\t' << hex("exercise-01")
      << '\t' << hex("42") << '\t' << hex("L1") << '\n'
      << hex("draft-01") << '\t' << hex("exercise-draft") << '\t' << hex("bad") << '\t'
      << hex("L1") << '\n';
  codeweave::content::ContentRepository repository(root);
  std::vector<codeweave::content::Exercise> exercises;
  const auto result = repository.list_exercises("lesson-01", exercises);
  assert(result.ok && exercises.size() == 1);
  assert(exercises.front().exercise_id == "exercise-01");
  assert(exercises.front().expected_output == "42");
  assert(!repository.list_exercises("draft-01", exercises).ok);
}

void test_content_contract_rejects_invalid_exercise_utf8() {
  const codeweave::content::Exercise invalid_output{
      "lesson-01", "exercise-01", std::string("bad\xC3\x28"), "L1"};
  assert(!codeweave::content::validate(invalid_output).ok);

  const codeweave::content::Exercise invalid_id{
      "lesson-01", "exercise\xC3\x28", "42", "L1"};
  assert(!codeweave::content::validate(invalid_id).ok);
}

void test_learning_contract_preserves_uncertainty_and_evidence_boundaries() {
  const auto numeric = codeweave::learning::parse_mastery_level("2 级");
  assert(numeric.kind == codeweave::learning::MasteryKind::Numeric);
  assert(numeric.value == 2);
  const auto range = codeweave::learning::parse_mastery_level("0—1 级");
  assert(range.kind == codeweave::learning::MasteryKind::Range);
  assert(range.low == 0 && range.high == 1);
  const auto uncertain = codeweave::learning::parse_mastery_level("无法确认");
  assert(uncertain.kind == codeweave::learning::MasteryKind::Uncertain);
  assert(codeweave::learning::parse_mastery_level("999999999999999999999 级").kind ==
      codeweave::learning::MasteryKind::Uncertain);

  codeweave::learning::EvidenceRecord valid{
      "evidence-01", "java-01", "exercise-01", "2026-10-04",
      "应输出 42", "输出 42", codeweave::learning::RanBy::Learner,
      true, "L2", {"run-log"}, {"无"}, codeweave::learning::EvidenceState::Pending};
  valid.operation_id = "op-abc123-0123ab";
  assert(codeweave::learning::validate_evidence(valid).ok);
  assert(codeweave::learning::is_operation_id("op-abc123-0123ab"));
  assert(!codeweave::learning::is_operation_id("op-invalid"));
  valid.ran_by = codeweave::learning::RanBy::Assistant;
  assert(!codeweave::learning::validate_evidence(valid).ok);
  valid.ran_by = codeweave::learning::RanBy::Learner;
  valid.actual_result = std::string("bad\xC3\x28");
  assert(!codeweave::learning::validate_evidence(valid).ok);
  valid.actual_result = "输出 42";
  valid.artifact_refs = {std::string("bad\xC3\x28")};
  assert(!codeweave::learning::validate_evidence(valid).ok);
  valid.artifact_refs = {"run-log"};
  valid.at = "2026/10/04";
  assert(!codeweave::learning::validate_evidence(valid).ok);
  valid.at = "2026-02-30";
  assert(!codeweave::learning::validate_evidence(valid).ok);
  valid.at = "2026-10-04";
  valid.hint_level = "L3";
  assert(!codeweave::learning::validate_evidence(valid).ok);
}

void test_mastery_contract_matches_web_semantics_and_eligibility_gate() {
  using namespace codeweave::learning;
  const MasteryEvidence passed{
      "mastery-evidence-01", MasteryEvidenceKind::Challenge, "lesson-01", "通过挑战",
      "2026-10-05T00:00:00.000Z", true, CompletionVerification::AutoVerified,
      RanBy::Learner, true, "L1", "op-mastery-0123ab"};
  assert(validate_mastery_evidence(passed).ok);
  assert(mastery_eligible(passed));
  MasteryRecord record;
  assert(apply_mastery_evidence(nullptr, passed, 6, record).ok);
  assert(record.level == 1 && record.evidence.size() == 1 && record.review_step == 0);

  auto guided = passed;
  guided.id = "mastery-evidence-02";
  guided.operation_id = "op-mastery-0123ac";
  guided.independent = false;
  assert(validate_mastery_evidence(guided).ok);
  assert(!mastery_eligible(guided));
  MasteryRecord guided_result;
  assert(apply_mastery_evidence(&record, guided, 6, guided_result).ok);
  assert(guided_result.level == 1 && guided_result.evidence.size() == 2);

  auto failed_review = passed;
  failed_review.id = "mastery-evidence-03";
  failed_review.operation_id = "op-mastery-0123ad";
  failed_review.kind = MasteryEvidenceKind::Review;
  failed_review.passed = false;
  failed_review.note = "忘记边界条件";
  MasteryRecord lowered;
  assert(apply_mastery_evidence(&guided_result, failed_review, 6, lowered).ok);
  assert(lowered.level == 0 && lowered.evidence.size() == 3);

  auto capped = guided_result;
  capped.level = 6;
  auto cap_evidence = passed;
  cap_evidence.id = "mastery-evidence-04";
  cap_evidence.operation_id = "op-mastery-0123ae";
  MasteryRecord capped_result;
  assert(apply_mastery_evidence(&capped, cap_evidence, 6, capped_result).ok);
  assert(capped_result.level == 6);

  auto malformed = passed;
  malformed.id = "bad/id";
  assert(!validate_mastery_evidence(malformed).ok);
  malformed = passed;
  malformed.id = "mastery-evidence-time";
  malformed.at = "2026-10-05T00:00:00.000Ztrailing";
  assert(!validate_mastery_evidence(malformed).ok);
  malformed.at = "1999-10-05T00:00:00.000Z";
  assert(!validate_mastery_evidence(malformed).ok);
}

void test_mastery_store_is_idempotent_fail_closed_and_replayable() {
  using namespace codeweave::learning;
  Fixture fixture;
  const auto root = fixture.root / "data" / "runtime" / "native";
  MasteryStore store(root);
  MasteryService service(store);
  MasterySnapshot snapshot;
  bool duplicate = false;
  MasteryEvidence first{
      "mastery-store-01", MasteryEvidenceKind::Lesson, "lesson-01", "课程自动验证完成",
      "2026-10-05T00:00:00.000Z", true, CompletionVerification::AutoVerified,
      RanBy::Learner, true, "L1", "op-masterystore-0123ab"};
  const auto first_result = service.record_evidence(first, 6, duplicate, snapshot);
  if (!first_result.ok) std::cerr << "mastery first: " << first_result.message << '\n';
  assert(first_result.ok && !duplicate);
  assert(snapshot.records.at("lesson-01").level == 1);
  assert(service.record_evidence(first, 6, duplicate, snapshot).ok && duplicate);
  assert(snapshot.records.at("lesson-01").evidence.size() == 1);

  auto conflict = first;
  conflict.note = "different payload";
  assert(!service.record_evidence(conflict, 6, duplicate, snapshot).ok);

  auto guided = first;
  guided.id = "mastery-store-02";
  guided.operation_id = "op-masterystore-0123ac";
  guided.independent = false;
  assert(!service.record_evidence(guided, 6, duplicate, snapshot).ok);
  std::vector<MasteryEvidence> events;
  assert(store.read_all(events).ok && events.size() == 1);

  auto review = first;
  review.id = "mastery-store-03";
  review.operation_id = "op-masterystore-0123ad";
  review.kind = MasteryEvidenceKind::Review;
  review.note = "复测通过";
  assert(service.record_evidence(review, 6, duplicate, snapshot).ok);
  assert(snapshot.records.at("lesson-01").level == 2);
  assert(snapshot.records.at("lesson-01").review_step == 1);

  MasterySnapshot replayed;
  assert(service.replay(6, replayed).ok);
  assert(replayed.records.at("lesson-01").level == snapshot.records.at("lesson-01").level);
  assert(replayed.records.at("lesson-01").review_step == snapshot.records.at("lesson-01").review_step);
  assert(replayed.records.at("lesson-01").evidence.size() == snapshot.records.at("lesson-01").evidence.size());

  auto legacy_guided = first;
  legacy_guided.id = "mastery-store-legacy-guided";
  legacy_guided.operation_id = "op-masterystore-0123ae";
  legacy_guided.independent = false;
  assert(store.append_idempotent(legacy_guided, duplicate).ok && !duplicate);
  assert(service.replay(6, replayed).ok);
  assert(replayed.records.at("lesson-01").level == snapshot.records.at("lesson-01").level);

  const auto ledger = root / "learning" / "mastery.v1.log";
  std::ofstream(ledger, std::ios::app | std::ios::binary) << "corrupt\n";
  events.clear();
  assert(!store.read_all(events).ok);
}

void test_review_scheduler_matches_web_vectors() {
  using namespace codeweave::learning;
  const auto fallback = effective_review_plan(std::nullopt, std::nullopt);
  assert(fallback.source == ReviewPlanSource::Fallback);
  assert(fallback.offsets == std::vector<int>({1, 3, 7, 14, 30}));
  const auto published = effective_review_plan(std::vector<int>{}, std::vector<int>{0, 1, 3, 7, 14, 30});
  assert(published.source == ReviewPlanSource::Published &&
      published.offsets == std::vector<int>({0, 1, 3, 7, 14, 30}));
  const auto unit = effective_review_plan(std::vector<int>{7, 1, 1, -3, 30}, published.offsets);
  assert(unit.source == ReviewPlanSource::Unit && unit.offsets == std::vector<int>({1, 7, 30}));
  assert(add_days_key("2026-09-30", 1) == "2026-10-01");
  assert(add_days_key("2026-12-31", 1) == "2027-01-01");
  assert(add_days_key("2026-03-01", -1) == "2026-02-28");
  assert(add_days_key("0000-01-01", -1).empty());

  MasteryRecord record{"lesson-01", MasteryEvidenceKind::Lesson, 1, {}, "2026-09-10T00:00:00.000Z", {}, 0, {}};
  const auto first = schedule_first_review(record, "2026-09-10", published);
  assert(first.review_due_key == "2026-09-10" && first.review_step == 0);
  auto advanced = first;
  advanced.review_step = 1;
  assert(schedule_next_review(advanced, "2026-09-10", published).review_due_key == "2026-09-11");
  advanced.review_step = 2;
  const auto failed = reschedule_review(advanced, "2026-09-13", published);
  assert(failed.review_step == 1 && failed.review_due_key == "2026-09-14");
  assert(snooze_review(failed, "2026-09-13").review_due_key == "2026-09-15");

  std::vector<MasteryRecord> records{
      {"a", MasteryEvidenceKind::Lesson, 1, {}, {}, "2026-09-10", 0, {}},
      {"b", MasteryEvidenceKind::Lesson, 1, {}, {}, "2026-09-13", 0, {}},
      {"c", MasteryEvidenceKind::Lesson, 1, {}, {}, "2026-09-18", 0, {}},
      {"d", MasteryEvidenceKind::Lesson, 1, {}, {}, "2026-09-25", 0, {}},
  };
  const auto groups = group_reviews(records, "2026-09-13");
  assert(groups.overdue.size() == 1 && groups.overdue[0].ref_id == "a");
  assert(groups.today.size() == 1 && groups.today[0].ref_id == "b");
  assert(groups.upcoming.size() == 1 && groups.upcoming[0].ref_id == "c");
  assert(groups.next && groups.next->ref_id == "c" && groups.next_date_key == "2026-09-18");
  assert(group_reviews(records, "not-a-date").overdue.empty());
  std::vector<MasteryRecord> tied{
      {"first", MasteryEvidenceKind::Lesson, 1, {}, {}, "2026-09-10", 0, {}},
      {"second", MasteryEvidenceKind::Lesson, 1, {}, {}, "2026-09-10", 0, {}}};
  const auto tied_groups = group_reviews(tied, "2026-09-09");
  assert(tied_groups.upcoming.size() == 2 && tied_groups.upcoming[0].ref_id == "first" &&
      tied_groups.upcoming[1].ref_id == "second");
}

void test_evidence_store_is_idempotent_and_atomic() {
  Fixture fixture;
  codeweave::learning::EvidenceStore store(fixture.root / "data" / "runtime" / "native");
  codeweave::learning::EvidenceRecord record{
      "evidence-store-01", "java-01", "exercise-01", "2026-10-05", "42", "42",
      codeweave::learning::RanBy::Learner, true, "L1", {"run-log"}, {},
      codeweave::learning::EvidenceState::Pending, "op-store1-0123ab"};
  bool duplicate = false;
  assert(store.append_idempotent(record, duplicate).ok && !duplicate);
  assert(store.append_idempotent(record, duplicate).ok && duplicate);
  auto conflict = record;
  conflict.evidence_id = "evidence-store-02";
  assert(!store.append_idempotent(conflict, duplicate).ok);
  auto same_id_different_body = record;
  same_id_different_body.actual_result = "different";
  assert(!store.append_idempotent(same_id_different_body, duplicate).ok);
  std::vector<codeweave::learning::EvidenceRecord> records;
  assert(store.read_all(records).ok && records.size() == 1 && records[0].actual_result == "42");
}

void test_learning_stores_serialize_concurrent_appends() {
  Fixture fixture;
  codeweave::learning::EvidenceStore evidence_store(
      fixture.root / "data" / "runtime" / "native");
  codeweave::learning::ProgressStore progress_store(
      fixture.root / "data" / "runtime" / "native");
  const auto evidence = codeweave::learning::EvidenceRecord{
      "evidence-concurrent", "java-01", "exercise-01", "2026-10-05",
      "42", "42", codeweave::learning::RanBy::Learner, true, "L1", {}, {},
      codeweave::learning::EvidenceState::Pending, "op-concurrent-0123ab"};
  const auto progress = codeweave::learning::ProgressFact{
      "fact-concurrent", "java-01", "exercise-01", "2026-10-05",
      "completed", "op-concurrent-0123ac"};
  std::thread evidence_first([&] { bool duplicate = false;
    assert(evidence_store.append_idempotent(evidence, duplicate).ok); });
  std::thread evidence_second([&] { bool duplicate = false;
    assert(evidence_store.append_idempotent(evidence, duplicate).ok); });
  std::thread progress_first([&] { bool duplicate = false;
    assert(progress_store.append_idempotent(progress, duplicate).ok); });
  std::thread progress_second([&] { bool duplicate = false;
    assert(progress_store.append_idempotent(progress, duplicate).ok); });
  evidence_first.join(); evidence_second.join();
  progress_first.join(); progress_second.join();
  std::vector<codeweave::learning::EvidenceRecord> evidence_records;
  std::vector<codeweave::learning::ProgressFact> progress_facts;
  assert(evidence_store.read_all(evidence_records).ok && evidence_records.size() == 1);
  assert(progress_store.read_all(progress_facts).ok && progress_facts.size() == 1);
}

void test_progress_store_is_idempotent_and_separate_from_projection() {
  Fixture fixture;
  codeweave::learning::ProgressStore store(fixture.root / "data" / "runtime" / "native");
  const codeweave::learning::ProgressFact fact{
      "fact-01", "lesson-01", "exercise-01", "2026-10-05", "completed", "op-progress-0123ab"};
  bool duplicate = false;
  assert(store.append_idempotent(fact, duplicate).ok && !duplicate);
  assert(store.append_idempotent(fact, duplicate).ok && duplicate);
  auto conflict = fact; conflict.status = "review";
  assert(!store.append_idempotent(conflict, duplicate).ok);
  std::vector<codeweave::learning::ProgressFact> facts;
  assert(store.read_all(facts).ok && facts.size() == 1 && facts[0].status == "completed");
  assert(!std::filesystem::exists(fixture.root / "data" / "runtime" / "desktop" / "progress.json"));
  const auto index_dir = fixture.root / "data" / "runtime" / "native" / "learning" / "progress-index.v1";
  assert(std::filesystem::exists(index_dir / "metadata.v1"));
  std::filesystem::remove(index_dir / "metadata.v1");
  duplicate = false;
  codeweave::learning::ProgressStore rebuilt_store(
      fixture.root / "data" / "runtime" / "native");
  assert(rebuilt_store.append_idempotent(fact, duplicate).ok && duplicate);
  std::ofstream(index_dir / "metadata.v1", std::ios::binary | std::ios::trunc)
      << "corrupt-index\n";
  duplicate = false;
  codeweave::learning::ProgressStore recovered_store(
      fixture.root / "data" / "runtime" / "native");
  assert(recovered_store.append_idempotent(fact, duplicate).ok && duplicate);
  std::filesystem::path shard_path;
  for (const auto& item : std::filesystem::directory_iterator(index_dir)) {
    if (item.path().filename().string().starts_with("shard-")) {
      shard_path = item.path();
      break;
    }
  }
  assert(!shard_path.empty());
  const auto shard_size = std::filesystem::file_size(shard_path);
  assert(shard_size > 0);
  std::filesystem::resize_file(shard_path, shard_size - 1);
  duplicate = false;
  codeweave::learning::ProgressStore shard_recovered_store(
      fixture.root / "data" / "runtime" / "native");
  assert(shard_recovered_store.append_idempotent(fact, duplicate).ok && duplicate);
}

void test_progress_index_refreshes_after_external_ledger_change() {
  Fixture fixture;
  const auto data_root = fixture.root / "data" / "runtime" / "native";
  codeweave::learning::ProgressStore store(data_root);
  const codeweave::learning::ProgressFact original{
      "fact-01", "lesson-01", "exercise-01", "2026-10-05", "completed",
      "op-progress-0123ab"};
  const codeweave::learning::ProgressFact replacement{
      "fact-02", "lesson-02", "exercise-01", "2026-10-05", "completed",
      "op-progress-0123ac"};
  const auto hex = [](std::string_view value) {
    constexpr char digits[] = "0123456789abcdef";
    std::string encoded;
    for (const unsigned char byte : value) {
      encoded.push_back(digits[byte >> 4]);
      encoded.push_back(digits[byte & 0x0f]);
    }
    return encoded;
  };
  bool duplicate = false;
  assert(store.append_idempotent(original, duplicate).ok && !duplicate);
  std::ofstream ledger(data_root / "learning" / "progress.v1.log",
      std::ios::binary | std::ios::trunc);
  ledger << hex(replacement.fact_id) << '\t' << hex(replacement.content_id) << '\t'
      << hex(replacement.exercise_id) << '\t' << hex(replacement.at) << '\t'
      << hex(replacement.status) << '\t' << hex(replacement.operation_id) << '\n';
  ledger.close();
  duplicate = false;
  assert(store.append_idempotent(original, duplicate).ok && !duplicate);
  std::vector<codeweave::learning::ProgressFact> facts;
  assert(store.read_all(facts).ok && facts.size() == 2);
}

void test_progress_append_transaction_recovers_or_fails_closed() {
  Fixture fixture;
  const auto learning_root = fixture.root / "data" / "runtime" / "native" / "learning";
  std::filesystem::create_directories(learning_root);
  const auto ledger = learning_root / "progress.v1.log";
  const auto pending = ledger.string() + ".append.txn";
  const auto hex = [](std::string_view value) {
    constexpr char digits[] = "0123456789abcdef";
    std::string result;
    for (const unsigned char byte : value) {
      result.push_back(digits[byte >> 4]);
      result.push_back(digits[byte & 0x0f]);
    }
    return result;
  };
  const auto line = hex("fact-txn") + '\t' + hex("lesson-01") + '\t' + hex("exercise-01") + '\t' +
      hex("2026-10-05") + '\t' + hex("completed") + '\t' + hex("op-txnabc-0123ab") + '\n';
  const auto transaction = [&] (std::uintmax_t base_size, std::string_view encoded_line) {
    std::ofstream output(pending, std::ios::binary | std::ios::trunc);
    output << base_size << '\n' << hex(encoded_line);
  };

  transaction(0, line);
  codeweave::learning::ProgressStore store(fixture.root / "data" / "runtime" / "native");
  std::vector<codeweave::learning::ProgressFact> facts;
  assert(store.read_all(facts).ok && facts.size() == 1 && facts[0].fact_id == "fact-txn");
  assert(!std::filesystem::exists(pending));
  const codeweave::learning::ProgressFact recovered_fact{
      "fact-txn", "lesson-01", "exercise-01", "2026-10-05", "completed", "op-txnabc-0123ab"};
  bool duplicate = false;
  assert(store.append_idempotent(recovered_fact, duplicate).ok && duplicate);

  std::ofstream(ledger, std::ios::binary | std::ios::trunc) << line;
  transaction(0, line);
  facts.clear();
  assert(store.read_all(facts).ok && facts.size() == 1 && !std::filesystem::exists(pending));

  const auto different_line = hex("fact-other") + '\t' + hex("lesson-01") + '\t' + hex("exercise-01") + '\t' +
      hex("2026-10-05") + '\t' + hex("completed") + '\t' + hex("op-other-0123ab") + '\n';
  std::ofstream(ledger, std::ios::binary | std::ios::trunc) << different_line;
  transaction(0, line);
  facts.clear();
  assert(!store.read_all(facts).ok && std::filesystem::exists(pending));

  std::ofstream(pending, std::ios::binary | std::ios::trunc) << "not-a-transaction";
  facts.clear();
  assert(!store.read_all(facts).ok && std::filesystem::exists(pending));
}

void test_operation_index_rejects_symlink_shard() {
  Fixture fixture;
  const auto data_root = fixture.root / "data" / "runtime" / "native";
  const auto index_dir = data_root / "learning" / "progress-index.v1";
  const auto ledger = data_root / "learning" / "progress.v1.log";
  const auto operation_id = std::string("op-index-0123ab");
  std::uint32_t hash = 2166136261u;
  for (const unsigned char byte : operation_id) {
    hash ^= byte;
    hash *= 16777619u;
  }
  char suffix[3]{};
  std::snprintf(suffix, sizeof(suffix), "%02x", static_cast<unsigned>(hash & 0xffu));
  std::filesystem::create_directories(index_dir);
  std::filesystem::create_directories(ledger.parent_path());
  std::ofstream(ledger, std::ios::binary) << "x";
  const auto outside = fixture.root / "outside-index-shard";
  std::ofstream(outside, std::ios::binary) << "unchanged\n";
  std::error_code error;
  std::filesystem::create_symlink(outside,
      index_dir / (std::string("shard-") + suffix + ".v1"), error);
  if (!error) {
    codeweave::learning::operation_index::Snapshot snapshot{1, 0};
    const auto result = codeweave::learning::operation_index::append(
        index_dir, ledger, data_root, {operation_id, 0, 1}, snapshot);
    assert(!result.ok);
    std::ifstream input(outside, std::ios::binary);
    const std::string contents((std::istreambuf_iterator<char>(input)),
        std::istreambuf_iterator<char>());
    assert(contents == "unchanged\n");
  }
}

void test_evidence_append_transaction_recovers_and_cleans_up() {
  Fixture fixture;
  const auto data_root = fixture.root / "data" / "runtime" / "native";
  const auto ledger = data_root / "learning" / "evidence.v1.log";
  const auto pending = ledger.string() + ".append.txn";
  codeweave::learning::EvidenceStore store(data_root);
  const codeweave::learning::EvidenceRecord record{
      "evidence-txn", "java-01", "exercise-01", "2026-10-05", "42", "42",
      codeweave::learning::RanBy::Learner, true, "L1", {"run-log"}, {},
      codeweave::learning::EvidenceState::Pending, "op-txnevidence-0123ab"};
  bool duplicate = false;
  assert(store.append_idempotent(record, duplicate).ok && !duplicate);
  std::ifstream input(ledger, std::ios::binary);
  const std::string line((std::istreambuf_iterator<char>(input)), std::istreambuf_iterator<char>());
  assert(!line.empty());
  input.close();
  std::filesystem::remove(ledger);
  const auto hex = [](std::string_view value) {
    constexpr char digits[] = "0123456789abcdef";
    std::string result;
    for (const unsigned char byte : value) {
      result.push_back(digits[byte >> 4]);
      result.push_back(digits[byte & 0x0f]);
    }
    return result;
  };
  std::ofstream(pending, std::ios::binary | std::ios::trunc) << "0\n" << hex(line);
  std::vector<codeweave::learning::EvidenceRecord> records;
  const auto recovered = store.read_all(records);
  if (!recovered.ok) std::cerr << "evidence recovery failed: " << recovered.message << '\n';
  assert(recovered.ok && records.size() == 1 && !std::filesystem::exists(pending));

  std::ofstream(ledger, std::ios::binary | std::ios::trunc) << line;
  std::ofstream(pending, std::ios::binary | std::ios::trunc) << "0\n" << hex(line);
  records.clear();
  assert(store.read_all(records).ok && records.size() == 1 && !std::filesystem::exists(pending));
}

void test_corrupt_learning_ledgers_fail_closed() {
  Fixture fixture;
  const auto learning_root = fixture.root / "data" / "runtime" / "native" / "learning";
  std::filesystem::create_directories(learning_root);
  std::ofstream(learning_root / "progress.v1.log") << "not-a-valid-progress-record\n";
  std::ofstream(learning_root / "evidence.v1.log") << "not-a-valid-evidence-record\n";
  codeweave::learning::ProgressStore progress(fixture.root / "data" / "runtime" / "native");
  codeweave::learning::EvidenceStore evidence(fixture.root / "data" / "runtime" / "native");
  std::vector<codeweave::learning::ProgressFact> facts;
  std::vector<codeweave::learning::EvidenceRecord> records;
  assert(!progress.read_all(facts).ok);
  assert(!evidence.read_all(records).ok);
  bool duplicate = false;
  const codeweave::learning::ProgressFact valid_progress{
      "fact-corrupt", "lesson-01", "exercise-01", "2026-10-05",
      "completed", "op-corrupt-0123ab"};
  assert(!progress.append_idempotent(valid_progress, duplicate).ok);
}

void test_learning_ledgers_reject_symlink_files() {
  Fixture fixture;
  const auto root = fixture.root / "outside";
  std::filesystem::create_directories(root);
  const auto source = root / "ledger.log";
  std::ofstream(source) << "outside\n";
  const auto learning = fixture.root / "data" / "runtime" / "native" / "learning";
  std::filesystem::create_directories(learning);
  std::error_code error;
  std::filesystem::create_symlink(source, learning / "progress.v1.log", error);
  if (!error) {
    codeweave::learning::ProgressStore progress(fixture.root / "data" / "runtime" / "native");
    std::vector<codeweave::learning::ProgressFact> facts;
    assert(!progress.read_all(facts).ok);
    std::filesystem::remove(learning / "progress.v1.log", error);
  }
  error.clear();
  std::filesystem::create_symlink(source, learning / "evidence.v1.log", error);
  if (!error) {
    codeweave::learning::EvidenceStore evidence(fixture.root / "data" / "runtime" / "native");
    std::vector<codeweave::learning::EvidenceRecord> records;
    assert(!evidence.read_all(records).ok);
    std::filesystem::remove(learning / "evidence.v1.log", error);
  }
}

void test_learning_and_trace_ledgers_reject_oversized_records() {
  Fixture fixture;
  const auto learning_root = fixture.root / "data" / "runtime" / "native" / "learning";
  std::filesystem::create_directories(learning_root);
  std::ofstream(learning_root / "progress.v1.log") << std::string(64 * 1024 + 1, 'x');
  std::ofstream(learning_root / "evidence.v1.log") << std::string(256 * 1024 + 1, 'x');
  codeweave::learning::ProgressStore progress(fixture.root / "data" / "runtime" / "native");
  codeweave::learning::EvidenceStore evidence(fixture.root / "data" / "runtime" / "native");
  std::vector<codeweave::learning::ProgressFact> facts;
  std::vector<codeweave::learning::EvidenceRecord> records;
  assert(!progress.read_all(facts).ok);
  assert(!evidence.read_all(records).ok);

  const auto trace_root = fixture.root / "trace-limit";
  std::filesystem::create_directories(trace_root / "execution");
  std::ofstream(trace_root / "execution" / "trace.v1.log")
      << "1\t1\t1\t" << std::string(2 * 1024 * 1024 + 1, 'x') << '\n';
  codeweave::execution::TraceStore trace(trace_root);
  codeweave::execution::TracePage page;
  assert(!trace.read_page("trace", 0, 1, page).ok);
}

void test_challenge_service_links_execution_evidence_and_progress() {
  Fixture fixture;
  codeweave::learning::EvidenceStore evidence_store(fixture.root / "data" / "runtime" / "native");
  codeweave::learning::ProgressStore progress_store(fixture.root / "data" / "runtime" / "native");
  codeweave::learning::ChallengeService service(evidence_store, progress_store);
  const codeweave::learning::ChallengeRequest request{
      "challenge-01", "lesson-01", "exercise-01", "2026-10-05", "42",
      "op-challenge-0123ab", true, "L1"};
  codeweave::execution::ProcessResult passed{true, false, false, false, 0, "42\r\n", ""};
  const auto first = service.record_execution(request, passed);
  assert(first.validation.ok && first.passed && !first.evidence_duplicate && !first.progress_duplicate);
  assert(first.judgement.passed && first.judgement.cases.size() == 1 &&
      first.judgement.cases.front().matched);
  const auto repeated = service.record_execution(request, passed);
  assert(repeated.validation.ok && repeated.passed && repeated.evidence_duplicate && repeated.progress_duplicate);
  auto failed_output = passed; failed_output.output = "41\r\n";
  auto failed_request = request; failed_request.evidence_id = "challenge-02"; failed_request.operation_id = "op-challenge-0223ab";
  const auto failed = service.record_execution(failed_request, failed_output);
  assert(failed.validation.ok && !failed.passed);
  auto compile_only = passed;
  compile_only.execution_output_valid = false;
  auto compile_request = request;
  compile_request.evidence_id = "challenge-compile-only";
  compile_request.operation_id = "op-compile-0123ab";
  const auto compile_result = service.record_execution(compile_request, compile_only);
  assert(compile_result.validation.ok && !compile_result.passed);
  assert(compile_result.judgement.passed);
  auto guided_request = request;
  guided_request.evidence_id = "challenge-guided";
  guided_request.operation_id = "op-guided-0123ab";
  guided_request.independent = false;
  const auto guided = service.record_execution(guided_request, passed);
  assert(guided.validation.ok && guided.passed && !guided.progress_duplicate);
  std::vector<codeweave::learning::ProgressFact> facts;
  assert(progress_store.read_all(facts).ok && facts.size() == 1);
}

void test_challenge_output_judgement_matches_exact_lines_contract() {
  using codeweave::learning::judge_output;
  const auto exact = judge_output({"1", "15"}, "15\r\n1\n");
  assert(exact.passed && exact.cases.size() == 2 && exact.extra_lines.empty());

  const auto partial = judge_output({"1", "15"}, "10\n15\n");
  assert(!partial.passed && partial.cases.size() == 2);
  assert(!partial.cases.front().matched &&
      partial.cases.front().reason == "只有包含验收点的输出行");
  assert(partial.cases.back().matched);

  const auto repeated = judge_output({"15", "15"}, "15\n");
  assert(!repeated.passed && repeated.cases[0].matched && !repeated.cases[1].matched);
  assert(repeated.cases[1].reason == "没有多余的输出行可以匹配（每行只能用一次）");

  const auto extra = judge_output({"15"}, "15\ntrace\n");
  assert(extra.passed && extra.extra_lines == std::vector<std::string>{"trace"});

  const auto empty_expected = judge_output({}, "15\n");
  assert(!empty_expected.passed && empty_expected.cases.empty());
  const auto empty_output = judge_output({"15"}, "");
  assert(!empty_output.passed && !empty_output.cases.front().matched);
}

void test_challenge_service_compensates_evidence_when_progress_commit_fails() {
  Fixture fixture;
  const auto learning = fixture.root / "data" / "runtime" / "native" / "learning";
  std::filesystem::create_directories(learning);
  std::filesystem::create_directory(learning / "progress.v1.log");
  codeweave::learning::EvidenceStore evidence(fixture.root / "data" / "runtime" / "native");
  codeweave::learning::ProgressStore progress(fixture.root / "data" / "runtime" / "native");
  codeweave::learning::ChallengeService service(evidence, progress);
  const codeweave::learning::ChallengeRequest request{
      "challenge-compensate", "lesson-01", "exercise-01", "2026-10-05", "42",
      "op-compensate-0123ab", true, "L1"};
  codeweave::execution::ProcessResult passed{true, false, false, false, 0, "42", ""};
  const auto result = service.record_execution(request, passed);
  assert(!result.validation.ok);
  std::vector<codeweave::learning::EvidenceRecord> records;
  assert(evidence.read_all(records).ok && records.empty());
  std::error_code error;
  std::filesystem::remove(learning / "progress.v1.log", error);
}

void test_external_evidence_stays_pending_and_rejects_sensitive_fields() {
  Fixture fixture;
  codeweave::learning::EvidenceStore evidence(fixture.root);
  codeweave::learning::ProgressStore progress(fixture.root);
  const codeweave::learning::ExternalEvidenceFields valid{
      "  Windows 11 + JDK 21  ", "java -version",
      "JDK 已安装，版本输出与所用工具链一致。", "logs/java-version.txt", "2026-01-01"};
  const auto save = [&](const auto& fields, std::string_view operation = "op-external-0123ab") {
    return codeweave::learning::save_external_evidence(evidence, "java-install", fields,
        operation, "external-record-01");
  };
  assert(save(valid).ok);
  assert(save(valid).ok);
  std::vector<codeweave::learning::EvidenceRecord> records;
  assert(evidence.read_all(records).ok && records.size() == 1);
  assert(records[0].state == codeweave::learning::EvidenceState::Pending);
  assert(!records[0].independent && !records[0].unfinished_items.empty());
  assert(records[0].expected_result != records[0].actual_result);
  assert(records[0].actual_result.starts_with("执行环境：Windows 11 + JDK 21\n"));
  std::vector<codeweave::learning::ProgressFact> facts;
  assert(progress.read_all(facts).ok && facts.empty());
  codeweave::learning::ReviewService review(evidence, progress);
  codeweave::learning::ReviewSummary summary;
  assert(review.summarize(summary).ok && summary.evidence_count == 1 &&
      summary.passed_count == 0 && summary.independent_passed_count == 0);
  for (const auto& secret : {"password=demo", "API_KEY: demo", "Authorization: Bearer demo",
      "Cookie: demo", "postgres://user:demo@localhost/db", "-----BEGIN PRIVATE KEY-----"}) {
    auto bad = valid; bad.command = secret;
    assert(!save(bad).ok);
  }
  auto bad = valid; bad.environment = " \t　 ";
  assert(!save(bad).ok);
  bad = valid; bad.result_summary = std::string(601, 'x');
  assert(!save(bad).ok);
  bad = valid; bad.artifact_ref = std::string(301, 'x');
  assert(!save(bad).ok);
  bad = valid; bad.reproduced_on = "2025-02-29";
  assert(!save(bad).ok);
  bad = valid; bad.reproduced_on = "9999-01-01";
  assert(!save(bad).ok);
  bad = valid; bad.environment = std::string("bad\xc3\x28");
  assert(!save(bad).ok);
  auto chinese = valid; chinese.result_summary.clear();
  for (int i = 0; i < 600; ++i) chinese.result_summary += "中";
  assert(save(chinese, "op-external-0123ac").ok);
  assert(evidence.read_all(records).ok && records.size() == 2);
  // Even an old/malformed external Pending record with equal output cannot
  // be promoted by review's output comparison.
  auto forged = records[0]; forged.operation_id = "op-external-0123ad";
  forged.evidence_id = "external-record-02"; forged.unfinished_items.clear();
  forged.expected_result = forged.actual_result;
  bool duplicate = false;
  assert(evidence.append_idempotent(forged, duplicate).ok);
  assert(review.summarize(summary).ok && summary.passed_count == 0);
}

void test_migration_staging_requires_fixture_and_rolls_back() {
  Fixture fixture;
  const auto source = fixture.root / "fixture-source";
  const auto target = fixture.root / "fixture-target";
  std::filesystem::create_directories(source / "nested");
  std::ofstream(source / "codeweave.migration-fixture") << "codeweave.migration-fixture\n";
  std::ofstream(source / "nested" / "sample.txt") << "non-sensitive fixture\n";
  codeweave::migration::StagingReport report;
  const auto staged = codeweave::migration::stage_fixture_copy(source, target, report);
  if (!staged.ok) std::cerr << "migration stage failed: " << staged.message << "\n";
  assert(staged.ok);
  assert(report.fixture_only && report.staged && report.verified && report.committed &&
      report.copied_files == 1 && report.receipts.size() == 1 && report.receipts[0].fingerprint != 0);
  assert(std::filesystem::exists(target / "nested" / "sample.txt"));
  assert(codeweave::migration::rollback_fixture_copy(target, report).ok && report.rolled_back);
  assert(!std::filesystem::exists(target));
  std::filesystem::create_directories(target);
  std::ofstream(target / "existing.txt") << "keep";
  codeweave::migration::StagingReport occupied;
  assert(!codeweave::migration::stage_fixture_copy(source, target, occupied).ok);
  assert(std::filesystem::exists(target / "existing.txt"));
  std::filesystem::remove_all(target);
  codeweave::migration::StagingReport blocked;
  assert(!codeweave::migration::stage_fixture_copy(fixture.root, fixture.root / "blocked", blocked).ok);
}

void test_fixture_staging_rejects_targets_inside_source_or_through_alias() {
  Fixture fixture;
  const auto source = fixture.root / "fixture-source-boundary";
  const auto nested_target = source / "nested-target";
  std::filesystem::create_directories(source);
  std::ofstream(source / "codeweave.migration-fixture") << "fixture" << '\n';
  std::ofstream(source / "payload.txt") << "non-sensitive fixture" << '\n';
  codeweave::migration::StagingReport nested_report;
  assert(!codeweave::migration::stage_fixture_copy(source, nested_target, nested_report).ok);
  assert(!std::filesystem::exists(nested_target));

  const auto alias = fixture.root / "fixture-alias";
  std::error_code error;
  std::filesystem::create_directory_symlink(source, alias, error);
  if (!error) {
    codeweave::migration::StagingReport alias_report;
    assert(!codeweave::migration::stage_fixture_copy(alias,
        fixture.root / "alias-target", alias_report).ok);
    std::filesystem::remove(alias, error);
  }
}

void test_fixture_backup_rejects_targets_inside_source() {
  Fixture fixture;
  const auto source = fixture.root / "backup-source-boundary";
  const auto nested_target = source / "nested-backup";
  std::filesystem::create_directories(source);
  std::ofstream(source / "codeweave.migration-fixture") << "fixture" << '\n';
  std::ofstream(source / "payload.txt") << "non-sensitive fixture" << '\n';
  codeweave::backup::Report report;
  assert(!codeweave::backup::create_fixture_backup(source, nested_target, report).ok);
  assert(!std::filesystem::exists(nested_target));
}

void test_fixture_backup_restore_round_trip() {
  Fixture fixture;
  const auto source = fixture.root / "backup-source";
  const auto backup = fixture.root / "backup-copy";
  const auto restored = fixture.root / "backup-restored";
  std::filesystem::create_directories(source / "nested");
  std::ofstream(source / "codeweave.migration-fixture") << "fixture\n";
  std::ofstream(source / "nested" / "draft.txt") << "中文 draft\n";
  codeweave::backup::Report created;
  assert(codeweave::backup::create_fixture_backup(source, backup, created).ok);
  assert(created.source_verified && created.target_verified &&
      created.committed && created.receipts.size() == 1);
  codeweave::backup::Report restored_report;
  assert(codeweave::backup::restore_fixture_backup(backup, restored,
      restored_report).ok);
  assert(restored_report.target_verified && restored_report.committed);
  std::ifstream restored_file(restored / "nested" / "draft.txt");
  std::string contents((std::istreambuf_iterator<char>(restored_file)), {});
  assert(contents == "中文 draft\n");
  restored_file.close();
  const auto restored_rollback = codeweave::backup::rollback_fixture_target(restored,
      restored_report);
  if (!restored_rollback.ok) std::cerr << restored_rollback.message << "\\n";
  assert(restored_rollback.ok);
  assert(!std::filesystem::exists(restored));
  assert(codeweave::backup::rollback_fixture_target(backup, created).ok);
  assert(!std::filesystem::exists(backup));
}

void test_native_backup_restores_only_to_new_directory() {
  Fixture fixture;
  const auto source = fixture.root / "native-source";
  const auto backup = fixture.root / "native-backup";
  const auto restored = fixture.root / "native-restored";
  std::filesystem::create_directories(source / "drafts");
  std::ofstream(source / "drafts" / "sample.txt") << "native draft\n";
  std::ofstream(source / ".native.lock") << "transient lock";
  std::filesystem::create_directories(source / "accounts" / "user-01");
  const auto child_lock = source / "accounts" / "user-01" / ".native.lock";
#ifdef _WIN32
  const auto held_lock = CreateFileW(child_lock.wstring().c_str(), GENERIC_READ,
      FILE_SHARE_READ, nullptr, CREATE_NEW, FILE_ATTRIBUTE_HIDDEN | FILE_FLAG_DELETE_ON_CLOSE, nullptr);
  assert(held_lock != INVALID_HANDLE_VALUE);
#else
  std::ofstream(child_lock) << "transient child lock";
#endif
  codeweave::backup::Report report;
  const auto backup_result = codeweave::backup::create_native_backup(source, backup, report);
  if (!backup_result.ok) std::cerr << "native backup failed: " << backup_result.message << "\n";
  assert(backup_result.ok);
  assert(report.committed && !report.fixture_only);
  assert(!std::filesystem::exists(backup / ".native.lock"));
  assert(!std::filesystem::exists(backup / "accounts" / "user-01" / ".native.lock"));
  assert(codeweave::backup::restore_native_backup(backup, restored, report).ok);
  std::ifstream input(restored / "drafts" / "sample.txt");
  std::string contents((std::istreambuf_iterator<char>(input)), {});
  assert(contents == "native draft\n");
  assert(!codeweave::backup::restore_native_backup(backup, source, report).ok);
  assert(std::filesystem::exists(source / ".native.lock"));
  std::ofstream(backup / "drafts" / "sample.txt", std::ios::trunc) << "changed";
  const auto damaged_target = fixture.root / "damaged-restored";
  assert(!codeweave::backup::restore_native_backup(backup, damaged_target, report).ok);
  assert(!std::filesystem::exists(damaged_target));
#ifdef _WIN32
  CloseHandle(held_lock);
#endif
}

void test_native_backup_supports_another_windows_volume() {
#ifdef _WIN32
  Fixture fixture;
  const auto source = fixture.root / "cross-volume-source";
  std::filesystem::create_directories(source / "drafts");
  std::ofstream(source / "drafts" / "sample.txt") << "cross-volume fixture\n";
  // The build runs in the project volume; the source uses the OS temp volume.
  // Create only a uniquely named test directory and remove exactly that path.
  const auto destination_parent = std::filesystem::current_path() /
      ("codeweave-cross-volume-fixture-" + std::to_string(std::random_device{}()));
  if (destination_parent.root_name() == source.root_name()) {
    std::cout << "cross-volume backup test unavailable on a single test volume\n";
    return;
  }
  assert(std::filesystem::create_directory(destination_parent));
  const auto target = destination_parent / "backup";
  codeweave::backup::Report report;
  const auto result = codeweave::backup::create_native_backup(source, target, report);
  const bool copied = std::filesystem::exists(target / "drafts" / "sample.txt");
  std::error_code cleanup_error;
  std::filesystem::remove_all(destination_parent, cleanup_error);
  assert(!cleanup_error);
  if (!result.ok) std::cerr << result.message << '\n';
  assert(result.ok && report.committed && copied);
#endif
}

void test_review_summary_is_read_only_and_latest_first() {
  Fixture fixture;
  const auto root = fixture.root / "data" / "runtime" / "native";
  codeweave::learning::EvidenceStore evidence(root);
  codeweave::learning::ProgressStore progress(root);
  codeweave::learning::EvidenceRecord first{
      "evidence-review-01", "lesson-01", "exercise-01", "2026-10-01",
      "42", "41", codeweave::learning::RanBy::Learner, false, "L2", {}, {},
      codeweave::learning::EvidenceState::Pending, "op-review01-abcdef"};
  codeweave::learning::EvidenceRecord second = first;
  second.evidence_id = "evidence-review-02";
  second.at = "2026-10-02";
  second.actual_result = "42\r\n";
  second.independent = true;
  second.operation_id = "op-review02-abcdef";
  bool duplicate = false;
  assert(evidence.append_idempotent(first, duplicate).ok);
  assert(evidence.append_idempotent(second, duplicate).ok);
  codeweave::learning::ReviewService service(evidence, progress);
  codeweave::learning::ReviewSummary summary;
  assert(service.summarize(summary).ok);
  assert(summary.evidence_count == 2 && summary.progress_count == 0);
  assert(summary.passed_count == 1 && summary.independent_passed_count == 1);
  assert(summary.items.size() == 1 && summary.items[0].latest_at == "2026-10-02" &&
      summary.items[0].passed && summary.items[0].independent);

  auto failed = second;
  failed.evidence_id = "evidence-review-03";
  failed.operation_id = "op-review03-abcdef";
  failed.unfinished_items = {"执行失败"};
  assert(evidence.append_idempotent(failed, duplicate).ok);
  assert(service.summarize(summary).ok);
  assert(summary.passed_count == 1 && summary.independent_passed_count == 1);
}

void test_analysis_window_filters_dates_and_evidence_types() {
  using namespace codeweave::learning;
  const std::vector<EvidenceRecord> evidence{
      {"window-1", "lesson-a", "exercise-a", "2026-10-02T12:00:00Z", "ok", "ok"},
      {"window-2", "lesson-a", "exercise-a", "2026-10-07T12:00:00Z", "ok", "ok"},
      {"window-3", "lesson-b", "exercise-b", "2026-10-08T00:00:00Z", "ok", "bad"},
      {"window-4", "lesson-c", "exercise-c", "2026-10-09T00:00:00Z", "ok", "ok"},
      {"window-external", "lesson-d", "external-evidence", "2026-10-08", "ok", "ok"}};
  const std::vector<MasteryEvidence> mastery{
      {"challenge-in", MasteryEvidenceKind::Challenge, "c1", "", "2026-10-08", true},
      {"challenge-fail", MasteryEvidenceKind::Challenge, "c2", "", "2026-10-08", false},
      {"review-pass", MasteryEvidenceKind::Review, "r1", "", "2026-10-08", true},
      {"review-fail", MasteryEvidenceKind::Review, "r2", "", "2026-10-08", false},
      {"challenge-old", MasteryEvidenceKind::Challenge, "c3", "", "2026-10-01", true}};
  const auto summary = summarize_analysis_window(evidence, mastery, "2026-10-02", "2026-10-08");
  assert(summary.practice_count == 3 && summary.completed_units == 1);
  assert(summary.challenge_passes == 1);
  assert(summary.review_passed == 1 && summary.review_failed == 1);
  const auto empty = summarize_analysis_window({}, {}, "2026-10-02", "2026-10-08");
  assert(empty.practice_count == 0 && empty.completed_units == 0 && empty.challenge_passes == 0);
}

void test_content_owner_and_attachment_boundary_is_read_only() {
  Fixture fixture;
  const auto root = fixture.root / "vault";
  std::filesystem::create_directories(root);
  std::filesystem::create_directories(root / "assets" / "images");
  std::ofstream(root / "assets" / "images" / "notes.md") << "fixture attachment";
  codeweave::content::VaultBinding binding{
      "vault-fixture-01", "owner-fixture-01", root,
      codeweave::content::Visibility::Private, true};
  codeweave::content::AccessReport report;
  assert(codeweave::content::inspect_attachment(binding,
      {"attachment-01", "assets/images/notes.md",
       "a3a1cdeb929c7e1d6e70aaaa4f5f96d985c7528c200c5a27ad96255182013260", 18}, report).ok);
  assert(report.owner_verified && report.read_only && report.path_safe &&
      report.attachments_verified);
  assert(!codeweave::content::inspect_attachment(binding,
      {"attachment-02", "../notes.md", std::string(64, 'a'), 18}, report).ok);
  assert(!codeweave::content::inspect_attachment(binding,
      {"attachment-03", "assets/images/notes.md", std::string(64, 'a'), 18}, report).ok);
  assert(!codeweave::content::validate_binding(
      {"vault-fixture-01", "owner-fixture-01", root, codeweave::content::Visibility::Private, false}).ok);
}

void test_progress_projection_is_read_only_and_conservative() {
  const std::string markdown =
      "结构维护：2026-10-04；最近学习证据：2026-10-03\n"
      "## 1. 当前状态\n\n| 项目 | 当前值 | 证据 |\n| --- | --- | --- |\n| 当前阶段 | A2 | fixture |\n"
      "## 3. 掌握程度\n\n| 技能 | 等级 | 状态 | 最新证据 |\n| --- | --- | --- | --- |\n"
      "| C++ | 0—1 级 | 进行中 | test |\n| Rust | 无法确认 | 待确认 | none |\n"
      "## 7. 阶段状态\n\n| 阶段 | 名称 | 状态 | 说明 |\n| --- | --- | --- | --- |\n| S2 | 原生重构 | 进行中 | contract |\n";
  const auto projection = codeweave::learning::parse_progress(markdown);
  assert(projection.status == codeweave::learning::ProgressStatus::Ok);
  assert(projection.latest_evidence_on == "2026-10-03");
  assert(projection.mastery.size() == 2);
  assert(projection.mastery[0].level.kind == codeweave::learning::MasteryKind::Range);
  assert(projection.mastery[1].level.kind == codeweave::learning::MasteryKind::Uncertain);
  assert(projection.stages.size() == 1 && projection.stages[0].id == "S2");

  const auto unsupported = codeweave::learning::parse_progress("## 3. 掌握程度\n\n| 技能 | 状态 |\n| --- | --- |\n| C++ | 待确认 |\n");
  assert(unsupported.status == codeweave::learning::ProgressStatus::StructureUnsupported);

  const auto partial = codeweave::learning::parse_progress(
      std::string(markdown).replace(markdown.find("0—1 级"), std::string("0—1 级").size(), "未来级别"));
  assert(partial.unparsed.size() == 1);
  assert(partial.status == codeweave::learning::ProgressStatus::Partial);
}

void test_manifest_dry_run_is_non_mutating_and_blocks_conflicts() {
  const codeweave::content::ManifestInput valid{
      1,
      "vault-demo",
      {{"topic-0001", "课程/循环.md", "循环", "active", {"source-book"}}},
      {"lesson-01"},
      {{"source-book", "已核验"}},
      {}};
  const auto ready = codeweave::content::inspect_manifest(valid);
  assert(ready.status == codeweave::content::DryRunStatus::Ready);
  assert(ready.topic_count == 1 && ready.source_count == 1);
  assert(ready.migratable_topic_count == 1);
  assert(!ready.content_read && !ready.writes_performed && !ready.migration_committed);

  auto conflict = valid;
  conflict.topics.push_back({"topic-0001", "课程/另一个.md", "重复", "active", {"missing-source"}});
  conflict.unknown_fields.push_back("privatePath");
  const auto blocked = codeweave::content::inspect_manifest(conflict);
  assert(blocked.status == codeweave::content::DryRunStatus::Blocked);
  assert(blocked.conflict_count == 1);
  assert(blocked.migratable_topic_count == 1);

  auto unsupported = valid;
  unsupported.schema_version = 2;
  const auto invalid = codeweave::content::inspect_manifest(unsupported);
  assert(invalid.status == codeweave::content::DryRunStatus::Blocked);

  auto unsafe = valid;
  unsafe.vault_id = "";
  unsafe.topics[0].path = "C:/private/course.md";
  unsafe.published_content_ids.push_back("lesson-01");
  const auto unsafe_result = codeweave::content::inspect_manifest(unsafe);
  assert(unsafe_result.status == codeweave::content::DryRunStatus::Blocked);
  assert(unsafe_result.conflict_count == 1);

  unsafe.topics[0].path = "/private/course.md";
  const auto unix_absolute = codeweave::content::inspect_manifest(unsafe);
  assert(unix_absolute.status == codeweave::content::DryRunStatus::Blocked);
}

void test_migration_preflight_rejects_symlink_root() {
  const auto parent = std::filesystem::temp_directory_path() /
      ("codeweave-native-preflight-link-" + std::to_string(std::random_device{}()));
  std::error_code error;
  std::filesystem::create_directories(parent / "real", error);
  assert(!error);
  std::ofstream(parent / "real" / "fixture.txt") << "fixture\n";
  const auto alias = parent / "alias";
  std::filesystem::create_directory_symlink(parent / "real", alias, error);
  if (!error) {
    codeweave::migration::Report report;
    assert(!codeweave::migration::inspect_read_only(alias, report).ok);
    std::filesystem::remove(alias, error);
  }
  std::filesystem::remove_all(parent, error);
}
void test_migration_preflight_is_metadata_only() {
  Fixture fixture;
  std::ofstream(fixture.root / "profile.json") << "sensitive fixture body\n";
  std::filesystem::create_directories(fixture.root / "nested");
  std::ofstream(fixture.root / "nested" / "progress.md") << "progress fixture\n";
  codeweave::migration::Report report;
  assert(codeweave::migration::inspect_read_only(fixture.root, report).ok);
  assert(!report.content_read && !report.writes_performed && !report.migration_committed);
  assert(report.file_count >= 3);
  assert(std::any_of(report.entries.begin(), report.entries.end(), [](const auto& entry) {
    return entry.relative_path == "profile.json" && entry.regular;
  }));
  assert(!codeweave::migration::inspect_read_only(std::filesystem::path("relative"), report).ok);
}

void test_migration_and_backup_reject_incomplete_symlink_sources() {
  Fixture fixture;
  const auto source = fixture.root / "incomplete-source";
  const auto target = fixture.root / "incomplete-target";
  const auto backup = fixture.root / "incomplete-backup";
  std::filesystem::create_directories(source);
  std::ofstream(source / "codeweave.migration-fixture") << "fixture\n";
  std::ofstream(fixture.root / "outside.txt") << "non-sensitive outside fixture\n";
  std::error_code error;
  std::filesystem::create_symlink(fixture.root / "outside.txt", source / "alias.txt", error);
  if (error) {
    std::cout << "symlink-source test unavailable: " << error.message() << '\n';
    return;
  }
  codeweave::migration::Report scan;
  assert(!codeweave::migration::inspect_read_only(source, scan).ok);
  assert(!scan.issues.empty());
  codeweave::migration::StagingReport staged;
  assert(!codeweave::migration::stage_fixture_copy(source, target, staged).ok);
  assert(!staged.committed && !std::filesystem::exists(target));
  codeweave::backup::Report saved;
  assert(!codeweave::backup::create_fixture_backup(source, backup, saved).ok);
  assert(!saved.committed && !std::filesystem::exists(backup));
}

void test_migration_contract_is_field_level_and_fail_closed() {
  codeweave::migration::Snapshot snapshot;
  snapshot.schema_version = 1;
  snapshot.source_app_version = "legacy-fixture-1";
  snapshot.accounts.push_back({"account-01", "fixture@example.test", "", "Fixture",
      "scrypt$v1$0123456789abcdef0123456789abcdef:d17d0629e32ad3ac88ab78b388a13cb98d41fa6ed2e104e81b80e25bc66af3008a31dd0a0a9fa8bef5b167c25ca65cb0c9278b211bd5ab1270f7104cadd89486"});
  snapshot.drafts.push_back({"draft-01", "中文草稿"});
  snapshot.progress.push_back({"fact-01", "lesson-01", "exercise-01", "2026-10-05", "completed", "op-migrate-0123ab"});
  const auto ready = codeweave::migration::inspect_snapshot(snapshot);
  assert(ready.status == codeweave::migration::Status::Ready);
  assert(ready.source_read && !ready.writes_performed && !ready.committed);

  auto invalid = snapshot;
  invalid.drafts.push_back({"draft-01", "duplicate"});
  invalid.progress[0].operation_id = "bad";
  const auto blocked = codeweave::migration::inspect_snapshot(invalid);
  assert(blocked.status == codeweave::migration::Status::Blocked);
  assert(!blocked.issues.empty());
  assert(!blocked.writes_performed && !blocked.committed);
}

void test_legacy_account_import_preserves_identity_and_rejects_bad_input() {
  Fixture fixture;
  const auto source = fixture.root / "users.json";
  const auto target = fixture.root / "imported-native";
  const std::string hash = "0123456789abcdef0123456789abcdef:d17d0629e32ad3ac88ab78b388a13cb98d41fa6ed2e104e81b80e25bc66af3008a31dd0a0a9fa8bef5b167c25ca65cb0c9278b211bd5ab1270f7104cadd89486";
  const std::string valid = "[{\"id\":\"user-legacy\",\"name\":\"中文\",\"email\":\"legacy@example.test\","
      "\"passwordHash\":\"" + hash + "\"}]";
  std::ofstream(source, std::ios::binary) << valid;
  codeweave::migration::LegacyImportReport report;
  assert(codeweave::migration::import_legacy_users(source, target, report).ok);
  assert(report.committed && report.accounts == 1);
  codeweave::account::AccountStore accounts(target);
  std::vector<codeweave::account::Record> records;
  assert(accounts.list_accounts(records).ok && records.size() == 1);
  assert(records[0].id == "user-legacy" && records[0].password_hash == hash);
  assert(records[0].name == "中文");
  codeweave::account::Record authenticated;
  assert(accounts.authenticate_password("legacy@example.test", "password", authenticated).ok);
  assert(authenticated.id == "user-legacy");
  assert(std::filesystem::exists(target / "profile" / "legacy-users.json"));
  std::ifstream input(source, std::ios::binary);
  const std::string retained((std::istreambuf_iterator<char>(input)), {});
  assert(retained == valid);
  assert(!codeweave::migration::import_legacy_users(source, target, report).ok);
  const auto invalid_target = fixture.root / "invalid-import";
  for (const auto& bad : {
      std::string("[{\"id\":\"first\",\"id\":\"second\"}]"),
      std::string("[{\"unknown\":true}]"),
      std::string("[{\"id\":\"user-legacy\",\"name\":\"x\",\"email\":\"legacy@example.test\",\"passwordHash\":\"") + hash + "\",\"bio\":1}]",
      std::string("[{\"id\":\"user-legacy\",\"name\":\"\\uD800\"}]"),
      valid + " trailing"}) {
    std::ofstream(source, std::ios::binary | std::ios::trunc) << bad;
    assert(!codeweave::migration::import_legacy_users(source, invalid_target, report).ok);
    assert(!std::filesystem::exists(invalid_target));
  }
}

void test_legacy_learning_import_keeps_history_out_of_formal_progress() {
  Fixture fixture;
  const auto source = fixture.root / "learning-export.json";
  const auto target = fixture.root / "learning-history";
  const std::string exported =
      "{\"schema\":\"codeweave.learning-data\",\"version\":1,\"exportedAt\":\"2026-10-05\","
      "\"scope\":\"user-legacy\",\"categories\":[],\"data\":{"
      "\"code-canvas.challenge-progress.v2:user-legacy\":{\"data\":{\"sample\":{\"status\":\"passed\"}}}}}";
  std::ofstream(source, std::ios::binary) << exported;
  codeweave::migration::LegacyImportReport report;
  assert(!codeweave::migration::import_legacy_learning(source, "other-user", target, report).ok);
  assert(!std::filesystem::exists(target));
  assert(codeweave::migration::import_legacy_learning(source, "user-legacy", target, report).ok);
  assert(report.committed && report.history_categories == 1);
  assert(std::filesystem::exists(target / "legacy-learning.json"));
  assert(!std::filesystem::exists(target / "learning" / "progress.v1.log"));
  assert(!codeweave::migration::import_legacy_learning(source, "user-legacy", target, report).ok);
}

void test_execution_contract_controls_state_and_output_budget() {
  codeweave::execution::Request request{
      "session-01", "cpp", "int main() { return 0; }", 1000, 256};
  assert(codeweave::execution::validate_request(request).ok);
  codeweave::execution::Session session(request);
  assert(session.result().state == codeweave::execution::State::Created);
  assert(!session.pause().ok);
  assert(session.start().ok);
  assert(session.append_output("hello").ok);
  assert(session.pause().ok);
  assert(session.resume().ok);
  assert(session.cancel().ok);
  assert(!session.complete().ok);
  assert(session.result().error_code == "cancelled");

  codeweave::execution::Session limited({"session-02", "python", "print(1)", 1000, 256});
  assert(limited.start().ok);
  const std::string too_large(257, 'x');
  assert(!limited.append_output(too_large).ok);
  assert(limited.result().output_truncated);
  assert(limited.result().output_bytes == 256);
  assert(!codeweave::execution::validate_request({"../escape", "cpp", "x", 1000, 256}).ok);
  assert(!codeweave::execution::validate_request({"会话-01", "cpp", "x", 1000, 256}).ok);
  assert(!codeweave::execution::validate_request({"session-03", "shell", "x", 1000, 256}).ok);
  assert(!codeweave::execution::validate_request({"session-04", "cpp", "x", 10, 256}).ok);
}

void test_process_contract_requires_whitelisted_absolute_tools() {
  const auto valid = codeweave::execution::ProcessRequest{
      std::filesystem::path("C:/CodeWeave/tools/node.exe"), {L"--version"},
      std::filesystem::path("C:/CodeWeave/runtime"), "javascript"};
  assert(codeweave::execution::validate_process_request(valid).ok);
  assert(codeweave::execution::validate_process_request({
      std::filesystem::path("C:/CodeWeave/tools/g++.exe"), {},
      valid.working_directory, "cpp"}).ok);
  assert(!codeweave::execution::validate_process_request({
      std::filesystem::path("node.exe"), {}, valid.working_directory, "javascript"}).ok);
  assert(!codeweave::execution::validate_process_request({
      std::filesystem::path("C:/CodeWeave/tools/powershell.exe"), {}, valid.working_directory, "javascript"}).ok);
  assert(!codeweave::execution::validate_process_request({
      valid.executable, {}, std::filesystem::path("runtime"), "javascript"}).ok);
}

void test_test_runner_is_not_a_production_tool() {
  const auto test_tool = std::filesystem::path("C:/CodeWeave/tools/codeweave-cpp-runner.exe");
  const auto working_directory = std::filesystem::path("C:/CodeWeave/runtime");
  const auto request = codeweave::execution::ProcessRequest{
      test_tool, {}, working_directory, "cpp"};
  assert(codeweave::execution::validate_process_request(request).ok);
  assert(request.executable.filename() == L"codeweave-cpp-runner.exe");
  assert(codeweave::execution::validate_process_request({
      std::filesystem::path("C:/CodeWeave/runtime/codeweave-program-session-01.exe"),
      {}, working_directory, "cpp-runtime"}).ok);
  assert(!codeweave::execution::validate_process_request({
      std::filesystem::path("C:/CodeWeave/runtime/other.exe"),
      {}, working_directory, "cpp-runtime"}).ok);
}

void test_execution_plan_reuses_both_request_and_process_guards() {
  codeweave::execution::ProcessPlan plan{};
  const auto result = codeweave::execution::build_process_plan(
      {"session-01", "javascript", "console.log(1)", 1000, 4096},
      std::filesystem::path("C:/CodeWeave/tools/node.exe"),
      std::filesystem::path("C:/CodeWeave/runtime"), plan);
  assert(result.ok);
  assert(plan.timeout_ms == 1000 && plan.output_limit == 4096);
  assert(plan.process.language == "javascript");
  assert(plan.process.arguments.size() == 1 && plan.process.arguments[0] == L"-");
  assert(codeweave::execution::build_process_plan(
      {"session-01", "cpp", "int main() { return 0; }", 1000, 4096},
      std::filesystem::path("C:/CodeWeave/tools/g++.exe"),
      std::filesystem::path("C:/CodeWeave/runtime"), plan).ok);
  assert(plan.process.arguments.size() == 8 &&
      plan.process.arguments[0] == L"-std=c++23" &&
      plan.process.arguments[7] == L"-");
  const std::string long_session(96, 'a');
  assert(codeweave::execution::build_process_plan(
      {long_session, "cpp", "int main() { return 0; }", 1000, 4096},
      std::filesystem::path("C:/CodeWeave/tools/cl.exe"),
      std::filesystem::path("C:/CodeWeave/runtime"), plan).ok);
  assert(plan.process.arguments.size() == 5);
  for (const auto& argument : plan.process.arguments) assert(argument.size() <= 4096);
  assert(!codeweave::execution::build_process_plan(
      {"session-02", "shell", "x", 1000, 4096},
      std::filesystem::path("C:/CodeWeave/tools/node.exe"),
      std::filesystem::path("C:/CodeWeave/runtime"), plan).ok);
  assert(!codeweave::execution::build_process_plan(
      {"会话-01", "cpp", "int main() { return 0; }", 1000, 4096},
      std::filesystem::path("C:/CodeWeave/tools/g++.exe"),
      std::filesystem::path("C:/CodeWeave/runtime"), plan).ok);
}

void test_process_runner_rejects_unvalidated_plan_without_starting() {
  codeweave::execution::ProcessRunner runner;
  const auto result = runner.run({
      {{}, {}, {}, "javascript"}, "source", 1000, 4096});
  assert(!result.started);
  assert(result.error_code == "invalid_process_plan" || result.error_code == "windows_only_runner");
}

void test_execution_service_keeps_validation_before_process_start() {
  codeweave::execution::ExecutionService service;
  const auto invalid = service.run(
      {"session-01", "shell", "echo unsafe", 1000, 4096},
      std::filesystem::path("C:/Windows/System32/cmd.exe"),
      std::filesystem::path("C:/CodeWeave/runtime"));
  assert(!invalid.validation.ok);
  assert(!invalid.process.has_value());
  assert(!invalid.trace.has_value());

  const auto checked = service.validate(
      {"session-02", "javascript", "console.log(1)", 1000, 4096},
      std::filesystem::path("C:/CodeWeave/tools/node.exe"),
      std::filesystem::path("C:/CodeWeave/runtime"));
  assert(checked.validation.ok);
  assert(!checked.process.has_value());
  assert(!checked.trace.has_value());
}

void test_process_runner_executes_and_enforces_limits(const std::filesystem::path& tool) {
#ifdef _WIN32
  if (tool.empty()) return;
  codeweave::execution::ProcessRunner runner;
  const auto working_directory = tool.parent_path();
  codeweave::execution::ProcessPlan output_plan{
      {tool, {L"--text", L"runner-ok\n"}, working_directory, "cpp"}, "source", 1000, 4096};
  const auto output = runner.run(output_plan);
  if (!output.started) {
    std::cerr << "process output test failed: " << output.error_code << "\n";
  }
  assert(output.started);
  assert(output.exit_code == 0);
  assert(output.output == "runner-ok\r\n");
  assert(output.error_code.empty());

  codeweave::execution::ProcessPlan limited_plan{
      {tool, {L"--emit-bytes", L"65536"}, working_directory, "cpp"}, "source", 3000, 256};
  const auto limited = runner.run(limited_plan);
  assert(limited.started);
  assert(limited.output_truncated);
  assert(limited.output.size() == 256);
  assert(limited.error_code == "output_limit_exceeded");

  codeweave::execution::ProcessPlan timeout_plan{
      {tool, {L"--sleep-ms", L"1000"}, working_directory, "cpp"}, "source", 100, 4096};
  const auto timeout = runner.run(timeout_plan);
  assert(timeout.started);
  assert(timeout.timed_out);
  assert(timeout.error_code == "execution_timeout");

  std::atomic_bool cancellation{false};
  codeweave::execution::ProcessPlan cancel_plan{
      {tool, {L"--sleep-ms", L"1000"}, working_directory, "cpp"}, "source", 3000, 4096};
  std::thread cancel_thread([&cancellation] { std::this_thread::sleep_for(std::chrono::milliseconds(120)); cancellation.store(true); });
  const auto cancelled = runner.run(cancel_plan, &cancellation);
  cancel_thread.join();
  assert(cancelled.started && cancelled.cancelled && cancelled.error_code == "execution_cancelled");
#else
  (void)tool;
#endif
}

void test_process_runner_control_contract(const std::filesystem::path& tool) {
#ifdef _WIN32
  if (tool.empty()) return;
  codeweave::execution::ProcessRunner runner;
  codeweave::execution::ExecutionControl control;
  assert(!control.request(codeweave::execution::ControlCommand::Pause).ok);
  std::atomic_bool cancellation{false};
  codeweave::execution::ProcessResult result;
  const auto working_directory = tool.parent_path();
  std::thread worker([&] {
    result = runner.run({
        {tool, {L"--sleep-ms", L"1200"}, working_directory, "cpp"},
        "source", 3000, 4096}, &cancellation, &control);
  });
  std::this_thread::sleep_for(std::chrono::milliseconds(120));
  assert(control.request(codeweave::execution::ControlCommand::Pause).ok);
  assert(control.is_paused());
  assert(control.request(codeweave::execution::ControlCommand::Step).ok);
  assert(control.is_paused());
  assert(control.request(codeweave::execution::ControlCommand::Resume).ok);
  assert(!control.is_paused());
  cancellation.store(true);
  worker.join();
  assert(result.started && result.cancelled);
  assert(result.control_events.size() == 3);
#else
  (void)tool;
#endif
}

void test_execution_service_compiles_and_runs_cpp(const std::filesystem::path& compiler) {
#ifdef _WIN32
  if (compiler.empty()) return;
  const auto root = std::filesystem::temp_directory_path() /
      ("codeweave-native-cpp-execution-" + std::to_string(std::random_device{}()));
  std::error_code error;
  std::filesystem::create_directories(root, error);
  assert(!error);
  codeweave::execution::ExecutionService service;
  const auto result = service.run(
      {"cpp-e2e-01", "cpp",
       "#include <iostream>\nint main() { std::cout << 42 << '\\n'; }\n",
       10'000, 4096}, compiler, root);
  if (!result.validation.ok || !result.process.has_value()) {
    std::cerr << "cpp compiler execution failed: "
              << (result.validation.message.empty()
                  ? (result.process ? result.process->error_code : "no_process")
                  : result.validation.message)
              << "\n";
  }
  assert(result.validation.ok);
  assert(result.process.has_value());
  assert(result.process->started);
  assert(result.process->exit_code == 0);
  assert(result.process->error_code.empty());
  assert(result.process->output == "42\r\n");
  assert(std::filesystem::is_empty(root, error));
  assert(!error);
  std::filesystem::remove_all(root, error);
#else
  (void)compiler;
#endif
}

void test_execution_service_rejects_failed_cpp_compilation(const std::filesystem::path& compiler) {
#ifdef _WIN32
  if (compiler.empty()) return;
  const auto root = std::filesystem::temp_directory_path() /
      ("codeweave-native-cpp-failure-" + std::to_string(std::random_device{}()));
  std::error_code error;
  std::filesystem::create_directories(root, error);
  assert(!error);
  codeweave::execution::ExecutionService service;
  const auto result = service.run(
      {"cpp-failure-01", "cpp", "int main( {", 10'000, 4096}, compiler, root);
  assert(result.validation.ok);
  assert(result.process.has_value());
  assert(result.process->started);
  assert(result.process->exit_code != 0 || !result.process->error_code.empty());
  assert(!result.process->execution_output_valid);
  assert(std::filesystem::is_empty(root, error));
  assert(!error);
  std::filesystem::remove_all(root, error);
#else
  (void)compiler;
#endif
}

void test_execution_service_compiles_and_runs_java(const std::filesystem::path& runtime) {
#ifdef _WIN32
  if (runtime.empty()) return;
  const auto root = std::filesystem::temp_directory_path() /
      ("codeweave-native-java-execution-" + std::to_string(std::random_device{}()));
  std::error_code error;
  std::filesystem::create_directories(root, error);
  assert(!error);
  codeweave::execution::ExecutionService service;
  const auto result = service.run(
      {"java-e2e-01", "java",
       "public class Main { public static void main(String[] args) { System.out.println(42); } }",
       10'000, 4096}, runtime, root);
  if (!result.validation.ok || !result.process.has_value()) {
    std::cerr << "java runtime execution failed: "
              << (result.validation.message.empty()
                  ? (result.process ? result.process->error_code : "no_process")
                  : result.validation.message)
              << "\n";
  }
  assert(result.validation.ok);
  assert(result.process.has_value());
  assert(result.process->started);
  assert(result.process->exit_code == 0);
  assert(result.process->error_code.empty());
  assert(result.process->output == "42\r\n");
  assert(std::filesystem::is_empty(root, error));
  assert(!error);
  std::filesystem::remove_all(root, error);
#else
  (void)runtime;
#endif
}

void test_execution_service_runs_external_language(const std::string& language,
    const std::filesystem::path& runtime, std::string source, std::string expected_output) {
#ifdef _WIN32
  if (runtime.empty()) return;
  const auto root = std::filesystem::temp_directory_path() /
      ("codeweave-native-" + language + "-execution-" + std::to_string(std::random_device{}()));
  std::error_code error;
  std::filesystem::create_directories(root, error);
  assert(!error);
  codeweave::execution::ExecutionService service;
  const auto result = service.run(
      {"external-" + language + "-01", language, std::move(source), 10'000, 4096},
      runtime, root);
  assert(result.validation.ok);
  assert(result.process.has_value() && result.process->started);
  assert(result.process->exit_code == 0 && result.process->error_code.empty());
  if (result.process->output != expected_output) {
    std::cerr << language << " output mismatch: expected bytes="
              << expected_output.size() << " actual bytes="
              << result.process->output.size() << " actual="
              << result.process->output << "\n";
  }
  assert(result.process->output == expected_output);
  assert(std::filesystem::is_empty(root, error) && !error);
  std::filesystem::remove_all(root, error);
#else
  (void)language; (void)runtime; (void)source; (void)expected_output;
#endif
}

void test_trace_contract_is_ordered_and_bounded() {
  codeweave::execution::Trace trace("session-trace-01");
  assert(trace.append(codeweave::execution::EventKind::Started).ok);
  assert(trace.append(codeweave::execution::EventKind::Output, "line 1").ok);
  assert(!trace.append(codeweave::execution::EventKind::Completed, "unexpected").ok);
  assert(trace.append(codeweave::execution::EventKind::Completed).ok);
  assert(trace.events().size() == 3);
  assert(trace.events()[0].sequence == 1 && trace.events()[1].sequence == 2 && trace.events()[2].sequence == 3);
  assert(trace.events()[1].payload == "line 1");
  assert(!trace.append(codeweave::execution::EventKind::Output,
      std::string(codeweave::execution::Limits::kMaxOutputBytes + 1, 'x')).ok);
}

void test_trace_store_paginates_and_summarizes() {
  Fixture fixture;
  codeweave::execution::Trace trace("trace-store-01");
  assert(trace.append(codeweave::execution::EventKind::Started).ok);
  assert(trace.append(codeweave::execution::EventKind::Paused).ok);
  assert(trace.append(codeweave::execution::EventKind::Resumed).ok);
  assert(trace.append(codeweave::execution::EventKind::Output, "abcdef").ok);
  assert(trace.append(codeweave::execution::EventKind::Completed).ok);
  codeweave::execution::TraceStore store(fixture.root);
  const auto first_save = store.append(trace);
  if (!first_save.ok) std::cerr << first_save.message << "\n";
  assert(first_save.ok);
  const auto second_save = store.append(trace);
  if (!second_save.ok) std::cerr << second_save.message << "\n";
  assert(second_save.ok);
  codeweave::execution::TracePage page;
  assert(store.read_page("trace-store-01", 0, 2, page).ok);
  assert(page.events.size() == 2 && !page.end && page.next_offset == 2);
  std::vector<codeweave::execution::TraceEvent> all = page.events;
  assert(store.read_page("trace-store-01", page.next_offset, 8, page).ok);
  assert(page.events.size() == 3 && page.end);
  all.insert(all.end(), page.events.begin(), page.events.end());
  const auto summary = codeweave::execution::summarize_trace(all);
  assert(summary.event_count == 5);
  assert(summary.output_bytes == 6 && summary.completed && summary.paused);
  assert(!store.read_page("trace-store-01", 0, 0, page).ok);
  assert(store.read_page("trace-store-01", 1000000, 2, page).ok);
  assert(page.events.empty() && page.end && page.next_offset == 5);
  std::ofstream(fixture.root / "execution" / "trace.v1.log", std::ios::app) << "broken\n";
  assert(!store.read_page("trace-store-01", 0, 1, page).ok);
  assert(page.events.empty());
}

std::filesystem::path sibling_process_tool() {
#ifdef _WIN32
  std::wstring buffer(32768, L'\0');
  const auto length = GetModuleFileNameW(nullptr, buffer.data(), static_cast<DWORD>(buffer.size()));
  if (length == 0 || length >= buffer.size()) return {};
  buffer.resize(length);
  return std::filesystem::path(buffer).parent_path() / L"codeweave-cpp-runner.exe";
#else
  return {};
#endif
}

}  // namespace

int main(int argc, char** argv) {
  test_backend_task_service_is_bounded_cancellable_and_generation_safe();
  test_backend_task_service_keeps_successful_write_when_cancelled();
  test_backend_task_service_close_cancels_inflight_read();
  test_worker_cannot_wait_for_itself();
  test_workspace_and_draft_round_trip();
  test_workspace_can_use_independent_application_data_root();
  test_workspace_rejects_symlink_data_root();
  test_invalid_ids_and_atomic_replace();
  test_oversized_existing_draft_is_rejected_before_reading();
  test_draft_symlink_is_rejected_before_reading();
  test_write_before_open_is_rejected();
  test_open_workspace_is_idempotence_guarded();
  test_account_contract_uses_non_sensitive_vectors();
  test_password_crypto_matches_legacy_scrypt_vector();
  test_account_store_is_native_only_and_idempotence_guarded();
  test_account_service_owns_in_memory_session_only();
  test_account_learning_roots_are_session_scoped_and_fail_closed();
  test_content_contract_requires_stable_published_units();
  test_content_repository_reads_only_published_units();
  test_content_repository_rejects_symlink_files();
  test_content_repository_reads_versioned_exercise_metadata();
  test_content_contract_rejects_invalid_exercise_utf8();
  test_learning_contract_preserves_uncertainty_and_evidence_boundaries();
  test_mastery_contract_matches_web_semantics_and_eligibility_gate();
  test_mastery_store_is_idempotent_fail_closed_and_replayable();
  test_review_scheduler_matches_web_vectors();
  test_evidence_store_is_idempotent_and_atomic();
  test_learning_stores_serialize_concurrent_appends();
  test_progress_store_is_idempotent_and_separate_from_projection();
  test_progress_index_refreshes_after_external_ledger_change();
  test_progress_append_transaction_recovers_or_fails_closed();
  test_operation_index_rejects_symlink_shard();
  test_evidence_append_transaction_recovers_and_cleans_up();
  test_corrupt_learning_ledgers_fail_closed();
  test_learning_ledgers_reject_symlink_files();
  test_learning_and_trace_ledgers_reject_oversized_records();
  test_challenge_service_links_execution_evidence_and_progress();
  test_challenge_output_judgement_matches_exact_lines_contract();
  test_challenge_service_compensates_evidence_when_progress_commit_fails();
  test_external_evidence_stays_pending_and_rejects_sensitive_fields();
  test_migration_staging_requires_fixture_and_rolls_back();
  test_fixture_staging_rejects_targets_inside_source_or_through_alias();
  test_fixture_backup_rejects_targets_inside_source();
  test_fixture_backup_restore_round_trip();
  test_native_backup_restores_only_to_new_directory();
  test_native_backup_supports_another_windows_volume();
  test_review_summary_is_read_only_and_latest_first();
  test_analysis_window_filters_dates_and_evidence_types();
  test_content_owner_and_attachment_boundary_is_read_only();
  test_progress_projection_is_read_only_and_conservative();
  test_manifest_dry_run_is_non_mutating_and_blocks_conflicts();
  test_migration_preflight_is_metadata_only();
  test_migration_and_backup_reject_incomplete_symlink_sources();
  test_migration_preflight_rejects_symlink_root();
  test_migration_contract_is_field_level_and_fail_closed();
  test_legacy_account_import_preserves_identity_and_rejects_bad_input();
  test_legacy_learning_import_keeps_history_out_of_formal_progress();
  test_execution_contract_controls_state_and_output_budget();
  test_process_contract_requires_whitelisted_absolute_tools();
  test_test_runner_is_not_a_production_tool();
  test_execution_plan_reuses_both_request_and_process_guards();
  test_process_runner_rejects_unvalidated_plan_without_starting();
  test_execution_service_keeps_validation_before_process_start();
  test_process_runner_executes_and_enforces_limits(
      argc > 1 ? std::filesystem::path(argv[1]) : sibling_process_tool());
  test_process_runner_control_contract(
      argc > 1 ? std::filesystem::path(argv[1]) : sibling_process_tool());
  test_execution_service_compiles_and_runs_cpp(
      argc > 2 ? std::filesystem::path(argv[2]) : std::filesystem::path{});
  test_execution_service_rejects_failed_cpp_compilation(
      argc > 2 ? std::filesystem::path(argv[2]) : std::filesystem::path{});
  test_execution_service_compiles_and_runs_java(
      argc > 3 ? std::filesystem::path(argv[3]) : std::filesystem::path{});
  test_execution_service_runs_external_language("python",
      argc > 4 ? std::filesystem::path(argv[4]) : std::filesystem::path{},
      "print(42)\n", "42\r\n");
  test_execution_service_runs_external_language("javascript",
      argc > 5 ? std::filesystem::path(argv[5]) : std::filesystem::path{},
      "console.log(42)\n", "42\n");
  test_trace_contract_is_ordered_and_bounded();
  test_trace_store_paginates_and_summarizes();
  std::cout << "native core tests passed\n";
  return 0;
}



