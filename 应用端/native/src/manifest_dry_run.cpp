#include "manifest_dry_run.hpp"

#include <algorithm>
#include <unordered_map>
#include <unordered_set>

namespace codeweave::content {
namespace {

bool supported_topic_status(std::string_view value) {
  return value == "active" || value == "retired";
}

void issue(ManifestDryRun& result, std::string code, std::string subject, std::string detail) {
  result.issues.push_back({std::move(code), std::move(subject), std::move(detail)});
}

}  // namespace

ManifestDryRun inspect_manifest(const ManifestInput& manifest) {
  ManifestDryRun result;
  result.topic_count = manifest.topics.size();
  result.source_count = manifest.source_registry.size();
  result.published_content_count = manifest.published_content_ids.size();
  result.content_read = false;
  result.writes_performed = false;
  result.migration_committed = false;

  if (manifest.schema_version != 1) {
    issue(result, "invalid_schema", "manifest", "schemaVersion 必须为 1");
  }
  if (!is_stable_id(manifest.vault_id)) {
    issue(result, "invalid_vault_id", "vaultId", "缺少或包含非法字符");
  }
  if (!manifest.unknown_fields.empty()) {
    issue(result, "unknown_fields", "manifest", "存在未纳入迁移白名单的字段，需人工确认");
  }

  std::unordered_set<std::string> source_ids;
  for (const auto& source : manifest.source_registry) {
    if (!is_stable_id(source.source_id)) {
      issue(result, "invalid_source_id", source.source_id, "来源 ID 格式无效");
      continue;
    }
    if (!source_ids.insert(source.source_id).second) {
      ++result.conflict_count;
      issue(result, "duplicate_source_id", source.source_id, "来源登记重复，不能自动择一");
    }
  }

  std::unordered_set<std::string> topic_ids;
  std::unordered_set<std::string> published_ids;
  for (const auto& content_id : manifest.published_content_ids) {
    if (!is_stable_id(content_id)) {
      issue(result, "invalid_published_content_id", content_id, "发布内容 ID 格式无效");
      continue;
    }
    if (!published_ids.insert(content_id).second) {
      ++result.conflict_count;
      issue(result, "duplicate_published_content_id", content_id, "发布内容 ID 重复");
    }
  }

  for (const auto& topic : manifest.topics) {
    bool migratable = true;
    if (!is_stable_id(topic.topic_id)) {
      migratable = false;
      issue(result, "invalid_topic_id", topic.topic_id, "主题 ID 格式无效");
    }
    if (!topic_ids.insert(topic.topic_id).second) {
      migratable = false;
      ++result.conflict_count;
      issue(result, "duplicate_topic_id", topic.topic_id, "主题 ID 重复，不能自动择一");
    }
    const bool absolute_path = topic.path.starts_with('/') || topic.path.starts_with('\\') ||
        (topic.path.size() >= 2 && std::isalpha(static_cast<unsigned char>(topic.path[0])) != 0 && topic.path[1] == ':');
    if (topic.path.empty() || absolute_path || topic.path.find("..") != std::string::npos) {
      migratable = false;
      issue(result, "invalid_topic_path", topic.topic_id, "主题路径为空或包含越界/盘符片段");
    }
    if (topic.title.empty() || topic.title.size() > 512) {
      migratable = false;
      issue(result, "invalid_topic_title", topic.topic_id, "主题标题为空或过长");
    }
    if (!supported_topic_status(topic.status)) {
      migratable = false;
      issue(result, "invalid_topic_status", topic.topic_id, "主题状态不受支持");
    }
    for (const auto& source_id : topic.source_ids) {
      if (!source_ids.contains(source_id)) {
        migratable = false;
        issue(result, "unknown_source", topic.topic_id, "主题引用了未登记来源");
      }
    }
    if (migratable) ++result.migratable_topic_count;
  }

  if (result.conflict_count > 0 || !result.issues.empty()) {
    const bool has_blocking = std::any_of(result.issues.begin(), result.issues.end(), [](const DryRunIssue& value) {
      return value.code != "unknown_fields";
    });
    result.status = has_blocking ? DryRunStatus::Blocked : DryRunStatus::Warning;
  } else {
    result.status = DryRunStatus::Ready;
  }
  return result;
}

}  // namespace codeweave::content
