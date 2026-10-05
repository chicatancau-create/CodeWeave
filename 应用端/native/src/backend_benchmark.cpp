#include "account_service.hpp"
#include "backup_service.hpp"
#include "legacy_import.hpp"

#include <chrono>
#include <cstdint>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <random>
#include <string>
#include <string_view>
#include <vector>

#ifdef _WIN32
#include <windows.h>
#endif

namespace {

using Clock = std::chrono::steady_clock;
constexpr int kSamples = 5;
constexpr std::string_view kPassword = "Benchmark-Password-123!";
constexpr std::string_view kPasswordHash =
    "0123456789abcdef0123456789abcdef:d17d0629e32ad3ac88ab78b388a13cb98d41fa6ed2e104e81b80e25bc66af3008a31dd0a0a9fa8bef5b167c25ca65cb0c9278b211bd5ab1270f7104cadd89486";

struct Sample {
  bool ok{};
  std::uint64_t duration_us{};
};

struct Operation {
  std::string name;
  std::vector<Sample> samples;
};

std::string json_escape(std::string_view value) {
  std::string escaped;
  escaped.reserve(value.size());
  for (const auto character : value) {
    switch (character) {
      case '\\': escaped += "\\\\"; break;
      case '"': escaped += "\\\""; break;
      case '\n': escaped += "\\n"; break;
      case '\r': escaped += "\\r"; break;
      case '\t': escaped += "\\t"; break;
      default: escaped.push_back(character); break;
    }
  }
  return escaped;
}

std::string unique_suffix() {
#ifdef _WIN32
  return std::to_string(static_cast<unsigned long long>(GetCurrentProcessId())) + "-" +
      std::to_string(static_cast<unsigned long long>(GetTickCount64()));
#else
  return std::to_string(static_cast<unsigned long long>(
      std::chrono::duration_cast<std::chrono::microseconds>(
          Clock::now().time_since_epoch()).count()));
#endif
}

std::filesystem::path make_run_root() {
  const auto root = std::filesystem::temp_directory_path() /
      ("codeweave-u0a-backend-" + unique_suffix());
  std::error_code error;
  if (!std::filesystem::create_directories(root, error) || error) return {};
  return root;
}

template <typename Function>
Sample measure(Function&& function) {
  const auto started = Clock::now();
  const auto result = function();
  const auto finished = Clock::now();
  const auto duration = std::chrono::duration_cast<std::chrono::microseconds>(finished - started);
  return {result, static_cast<std::uint64_t>(duration.count())};
}

bool write_text(const std::filesystem::path& path, std::string_view contents) {
  std::error_code error;
  std::filesystem::create_directories(path.parent_path(), error);
  if (error) return false;
  std::ofstream output(path, std::ios::binary | std::ios::trunc);
  output.write(contents.data(), static_cast<std::streamsize>(contents.size()));
  return output.good();
}

bool prepare_backup_source(const std::filesystem::path& source) {
  std::error_code error;
  if (!std::filesystem::create_directories(source / "profile", error) || error) return false;
  if (!write_text(source / ".native.marker", "synthetic benchmark source\n")) return false;
  for (int index = 0; index < 32; ++index) {
    const auto relative = std::filesystem::path("course") /
        ("unit-" + std::to_string(index % 8)) /
        ("sample-" + std::to_string(index) + ".txt");
    std::string contents(4096, static_cast<char>('A' + (index % 26)));
    contents += "\n";
    if (!write_text(source / relative, contents)) return false;
  }
  return true;
}

bool prepare_users_json(const std::filesystem::path& source) {
  const std::string json = "[{\"id\":\"benchmark-user\",\"name\":\"Benchmark\","
      "\"email\":\"benchmark@example.test\",\"phone\":\"\",\"passwordHash\":\"" +
      std::string(kPasswordHash) + "\"}]";
  return write_text(source, json);
}

bool prepare_learning_json(const std::filesystem::path& source) {
  constexpr std::string_view json =
      "{\"schema\":\"codeweave.learning-data\",\"version\":1,"
      "\"exportedAt\":\"2026-10-05\",\"scope\":\"benchmark-user\","
      "\"categories\":[{\"base\":\"code-canvas.challenge-progress.v2\","
      "\"category\":\"account\",\"label\":\"Benchmark\"}],"
      "\"data\":{\"code-canvas.challenge-progress.v2:benchmark-user\":"
      "{\"data\":{}}}}";
  return write_text(source, json);
}

Sample measure_backup(const std::filesystem::path& run_root) {
  const auto source = run_root / "backup-source";
  const auto target = run_root / "backup-target";
  if (!prepare_backup_source(source)) return {};
  codeweave::backup::Report report;
  return measure([&] {
    return codeweave::backup::create_native_backup(source, target, report).ok;
  });
}

Sample measure_users_import(const std::filesystem::path& run_root) {
  const auto source = run_root / "users.json";
  const auto target = run_root / "users-target";
  if (!prepare_users_json(source)) return {};
  codeweave::migration::LegacyImportReport report;
  return measure([&] {
    return codeweave::migration::import_legacy_users(source, target, report).ok;
  });
}

Sample measure_learning_import(const std::filesystem::path& run_root) {
  const auto source = run_root / "learning.json";
  const auto target = run_root / "learning-target";
  if (!prepare_learning_json(source)) return {};
  codeweave::migration::LegacyImportReport report;
  return measure([&] {
    const auto result = codeweave::migration::import_legacy_learning(source, "benchmark-user", target, report);
    if (!result.ok) std::cerr << "legacy_learning_import: " << result.message << '\n';
    return result.ok;
  });
}

Sample measure_register(const std::filesystem::path& run_root) {
  codeweave::account::AccountStore store(run_root / "register");
  codeweave::account::AccountService service(store);
  return measure([&] {
    return service.register_account("Benchmark", "register@example.test", kPassword).ok;
  });
}

bool prepare_account(codeweave::account::AccountService& service) {
  return service.register_account("Benchmark", "login@example.test", kPassword).ok;
}

Sample measure_login(const std::filesystem::path& run_root) {
  codeweave::account::AccountStore store(run_root / "login");
  codeweave::account::AccountService service(store);
  if (!prepare_account(service) || !service.logout().ok) return {};
  return measure([&] {
    return service.login("login@example.test", kPassword).ok;
  });
}

Sample measure_change_password(const std::filesystem::path& run_root) {
  codeweave::account::AccountStore store(run_root / "change-password");
  codeweave::account::AccountService service(store);
  if (!prepare_account(service)) return {};
  return measure([&] {
    return service.change_password(kPassword, "Benchmark-Password-456!").ok;
  });
}

void write_json(const std::filesystem::path& output, const std::filesystem::path& run_root,
    const std::vector<Operation>& operations) {
  std::error_code error;
  std::filesystem::create_directories(output.parent_path(), error);
  if (error) throw std::runtime_error("cannot create evidence directory");
  std::ofstream file(output, std::ios::binary | std::ios::trunc);
  if (!file) throw std::runtime_error("cannot open evidence output");
  file << "{\n  \"schema\": \"codeweave.backend-timing.v1\",\n"
       << "  \"status\": \"raw_samples\",\n"
       << "  \"sample_count\": " << kSamples << ",\n"
       << "  \"fixture\": \"synthetic-isolated\",\n"
       << "  \"run_root_not_recorded\": true,\n"
       << "  \"operations\": [\n";
  for (std::size_t operation_index = 0; operation_index < operations.size(); ++operation_index) {
    const auto& operation = operations[operation_index];
    file << "    {\"name\":\"" << json_escape(operation.name) << "\",\"samples\":[";
    for (std::size_t sample_index = 0; sample_index < operation.samples.size(); ++sample_index) {
      const auto& sample = operation.samples[sample_index];
      if (sample_index != 0) file << ',';
      file << "{\"ok\":" << (sample.ok ? "true" : "false")
           << ",\"duration_us\":" << sample.duration_us << '}';
    }
    file << "]}" << (operation_index + 1 == operations.size() ? "\n" : ",\n");
  }
  file << "  ]\n}\n";
  if (!file.good()) throw std::runtime_error("cannot write evidence output");
  (void)run_root;
}

}  // namespace

int main(int argc, char** argv) {
  if (argc != 3 || std::string_view(argv[1]) != "--out") {
    std::cerr << "usage: codeweave-backend-benchmark --out <evidence.json>\n";
    return 2;
  }
  const auto output = std::filesystem::path(argv[2]);
  const auto run_root = make_run_root();
  if (run_root.empty()) {
    std::cerr << "failed to create isolated benchmark root\n";
    return 1;
  }

  std::vector<Operation> operations{
      {"native_backup", {}}, {"legacy_users_import", {}},
      {"legacy_learning_import", {}}, {"account_register", {}},
      {"account_login", {}}, {"account_change_password", {}}};
  for (int sample = 0; sample < kSamples; ++sample) {
    const auto sample_root = run_root / ("sample-" + std::to_string(sample));
    operations[0].samples.push_back(measure_backup(sample_root));
    operations[1].samples.push_back(measure_users_import(sample_root));
    operations[2].samples.push_back(measure_learning_import(sample_root));
    operations[3].samples.push_back(measure_register(sample_root));
    operations[4].samples.push_back(measure_login(sample_root));
    operations[5].samples.push_back(measure_change_password(sample_root));
  }

  try {
    write_json(output, run_root, operations);
  } catch (const std::exception& error) {
    std::cerr << error.what() << '\n';
    std::error_code ignored;
    std::filesystem::remove_all(run_root, ignored);
    return 1;
  }
  std::error_code cleanup_error;
  std::filesystem::remove_all(run_root, cleanup_error);
  if (cleanup_error) {
    std::cerr << "benchmark completed but isolated root cleanup failed\n";
    return 1;
  }
  return 0;
}
