#pragma once

#include "content_contract.hpp"

#include <string>
#include <string_view>
#include <vector>

namespace codeweave::content {

struct SourceRegistration {
  std::string source_id;
  std::string verification_status;
};

struct TopicRegistration {
  std::string topic_id;
  std::string path;
  std::string title;
  std::string status;
  std::vector<std::string> source_ids;
};

struct ManifestInput {
  int schema_version{};
  std::string vault_id;
  std::vector<TopicRegistration> topics;
  std::vector<std::string> published_content_ids;
  std::vector<SourceRegistration> source_registry;
  std::vector<std::string> unknown_fields;
};

enum class DryRunStatus { Ready, Blocked, Warning };

struct DryRunIssue {
  std::string code;
  std::string subject;
  std::string detail;
};

struct ManifestDryRun {
  DryRunStatus status{DryRunStatus::Blocked};
  size_t topic_count{};
  size_t source_count{};
  size_t published_content_count{};
  size_t migratable_topic_count{};
  size_t conflict_count{};
  std::vector<DryRunIssue> issues;
  bool content_read{};
  bool writes_performed{};
  bool migration_committed{};
};

ManifestDryRun inspect_manifest(const ManifestInput& manifest);

}  // namespace codeweave::content
