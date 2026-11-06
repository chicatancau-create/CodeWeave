#include "progress_projection.hpp"

#include <algorithm>
#include <cctype>
#include <regex>
#include <string>
#include <string_view>
#include <unordered_map>

namespace codeweave::learning {
namespace {

struct Section {
  std::string number;
  std::vector<std::string> lines;
};

std::string normalize_newlines(std::string_view text) {
  std::string normalized;
  normalized.reserve(text.size());
  for (size_t index = 0; index < text.size(); ++index) {
    if (text[index] == '\r') {
      if (index + 1 < text.size() && text[index + 1] == '\n') ++index;
      normalized.push_back('\n');
    } else {
      normalized.push_back(text[index]);
    }
  }
  return normalized;
}

std::vector<std::string> lines_of(const std::string& text) {
  std::vector<std::string> lines;
  size_t start = 0;
  while (start <= text.size()) {
    const auto end = text.find('\n', start);
    lines.emplace_back(text.substr(start, end == std::string::npos ? std::string::npos : end - start));
    if (end == std::string::npos) break;
    start = end + 1;
  }
  return lines;
}

std::unordered_map<std::string, Section> sections_of(const std::vector<std::string>& lines) {
  std::unordered_map<std::string, Section> sections;
  std::string current;
  for (const auto& line : lines) {
    if (line.rfind("## ", 0) == 0) {
      const auto title = line.substr(3);
      const auto separator = title.find('.');
      if (separator != std::string::npos && separator > 0 &&
          std::all_of(title.begin(), title.begin() + static_cast<std::ptrdiff_t>(separator),
              [](unsigned char character) { return std::isdigit(character) != 0; })) {
        current = title.substr(0, separator);
        sections[current] = Section{current, {}};
        continue;
      }
    }
    if (!current.empty()) sections[current].lines.push_back(line);
  }
  return sections;
}

std::vector<std::string> table_row(const std::string& line) {
  const auto first = line.find('|');
  if (first == std::string::npos || line.substr(0, first).find_first_not_of(" \t") != std::string::npos) return {};
  std::vector<std::string> cells;
  std::string current;
  bool escaped = false;
  for (size_t index = first; index < line.size(); ++index) {
    const char character = line[index];
    if (escaped) {
      current.push_back(character);
      escaped = false;
    } else if (character == '\\' && index + 1 < line.size() && line[index + 1] == '|') {
      escaped = true;
    } else if (character == '|') {
      cells.push_back(current);
      current.clear();
    } else {
      current.push_back(character);
    }
  }
  if (escaped) current.push_back('\\');
  if (!current.empty()) cells.push_back(current);
  for (auto& cell : cells) {
    const auto begin = cell.find_first_not_of(" \t");
    const auto end = cell.find_last_not_of(" \t");
    cell = begin == std::string::npos ? "" : cell.substr(begin, end - begin + 1);
  }
  if (!cells.empty() && cells.front().empty()) cells.erase(cells.begin());
  if (!cells.empty() && cells.back().empty()) cells.pop_back();
  return cells;
}

bool separator_row(const std::vector<std::string>& cells) {
  if (cells.empty()) return false;
  return std::all_of(cells.begin(), cells.end(), [](const std::string& cell) {
    const auto compact = [&cell] {
      std::string value;
      for (const auto character : cell) {
        if (character != ' ' && character != '\t') value.push_back(character);
      }
      return value;
    }();
    if (compact.size() < 2) return false;
    return std::all_of(compact.begin(), compact.end(), [](char character) {
      return character == '-' || character == ':';
    });
  });
}

std::vector<std::vector<std::string>> first_table(const Section& section) {
  std::vector<std::vector<std::string>> rows;
  bool started = false;
  for (const auto& line : section.lines) {
    const auto row = table_row(line);
    if (row.empty()) {
      if (started) break;
      continue;
    }
    started = true;
    if (!separator_row(row)) rows.push_back(row);
  }
  return rows;
}

std::string plain_cell(std::string value) {
  while (!value.empty() && std::isspace(static_cast<unsigned char>(value.front()))) value.erase(value.begin());
  while (!value.empty() && std::isspace(static_cast<unsigned char>(value.back()))) value.pop_back();
  if (value.size() >= 4 && value.starts_with("**") && value.ends_with("**")) {
    value = value.substr(2, value.size() - 4);
  }
  return value;
}

int column_index(const std::vector<std::string>& header, std::initializer_list<std::string_view> names) {
  for (const auto name : names) {
    for (size_t index = 0; index < header.size(); ++index) {
      if (plain_cell(header[index]) == name) return static_cast<int>(index);
    }
  }
  return -1;
}

std::string cell_of(const std::vector<std::string>& row, int index) {
  return index >= 0 && static_cast<size_t>(index) < row.size() ? plain_cell(row[index]) : "";
}

void require_table(const std::unordered_map<std::string, Section>& sections, std::string_view number,
    std::vector<ProjectionIssue>& issues, std::vector<std::vector<std::string>>& rows) {
  const auto found = sections.find(std::string(number));
  if (found == sections.end()) {
    issues.push_back({"section-" + std::string(number), "section", "缺少编号小节"});
    return;
  }
  rows = first_table(found->second);
  if (rows.size() < 1) issues.push_back({"section-" + std::string(number), "section", "小节内没有可解析的表格"});
}

}  // namespace

ProgressProjection parse_progress(std::string_view markdown) {
  ProgressProjection projection;
  projection.read_only_notice = "本投影只读；环境核验不构成学习证据，不提升任何掌握等级，也不代表阶段通过。";
  const auto normalized = normalize_newlines(markdown);
  const auto lines = lines_of(normalized);
  const auto sections = sections_of(lines);

  for (const auto& line : lines) {
    const auto marker = line.find("最近学习证据");
    if (marker == std::string::npos) continue;
    const auto marker_end = marker + std::string("最近学习证据").size();
    auto date_start = line.find(':', marker_end);
    const auto full_width_colon = line.find("：", marker_end);
    if (date_start == std::string::npos || (full_width_colon != std::string::npos && full_width_colon < date_start)) {
      date_start = full_width_colon;
    }
    if (date_start == std::string::npos) continue;
    size_t begin = date_start + (line.compare(date_start, std::string("：").size(), "：") == 0 ? std::string("：").size() : 1);
    while (begin < line.size() && std::isspace(static_cast<unsigned char>(line[begin]))) ++begin;
    if (begin + 10 <= line.size()) {
      const auto candidate = line.substr(begin, 10);
      if (candidate[4] == '-' && candidate[7] == '-') {
        projection.latest_evidence_on = candidate;
        break;
      }
    }
  }
  if (projection.latest_evidence_on.empty()) {
    projection.unparsed.push_back({"headerDates", "value", "顶部说明行未找到最近学习证据日期"});
  }

  std::vector<std::vector<std::string>> rows;
  require_table(sections, "1", projection.unparsed, rows);
  if (!rows.empty()) {
    const auto value_index = column_index(rows.front(), {"当前值"});
    if (value_index < 0) projection.unparsed.push_back({"section-1", "section", "表头缺少当前值列"});
  }

  rows.clear();
  require_table(sections, "3", projection.unparsed, rows);
  if (!rows.empty()) {
    const auto level_index = column_index(rows.front(), {"等级"});
    const auto status_index = column_index(rows.front(), {"状态"});
    const auto evidence_index = column_index(rows.front(), {"最新证据"});
    if (level_index < 0) {
      projection.unparsed.push_back({"section-3", "section", "表头缺少等级列"});
    } else {
      for (size_t index = 1; index < rows.size(); ++index) {
        const auto skill = cell_of(rows[index], 0);
        if (skill.empty()) continue;
        const auto level_raw = cell_of(rows[index], level_index);
        const auto level = parse_mastery_level(level_raw);
        if (level.kind == MasteryKind::Uncertain && level.label != "无法确认" && level.label != "未核验" &&
            level.label != "待确认" && level.label != "暂估" && level.label != "未填写") {
          projection.unparsed.push_back({"section-3", "value", "等级写法未被识别"});
        }
        projection.mastery.push_back({skill, level, cell_of(rows[index], status_index), cell_of(rows[index], evidence_index)});
      }
    }
  }

  rows.clear();
  require_table(sections, "7", projection.unparsed, rows);
  if (!rows.empty()) {
    for (size_t index = 1; index < rows.size(); ++index) {
      const auto id = cell_of(rows[index], 0);
      if (id.empty()) continue;
      if (id.size() < 2 || id.front() != 'S' || !std::all_of(id.begin() + 1, id.end(), [](unsigned char c) {
            return std::isdigit(c) != 0;
          })) {
        projection.unparsed.push_back({"section-7", "value", "阶段标识未被识别"});
        continue;
      }
      projection.stages.push_back({id, cell_of(rows[index], 1), cell_of(rows[index], 2), cell_of(rows[index], 3)});
    }
  }

  const bool has_section_issue = std::any_of(projection.unparsed.begin(), projection.unparsed.end(),
      [](const ProjectionIssue& issue) { return issue.scope == "section"; });
  projection.status = has_section_issue ? ProgressStatus::StructureUnsupported
      : projection.unparsed.empty() ? ProgressStatus::Ok : ProgressStatus::Partial;
  return projection;
}

}  // namespace codeweave::learning
