#pragma once

#include "app_core.hpp"

#include <string>

namespace codeweave::content {

struct Unit {
  std::string content_id;
  std::string title;
  std::string status;
  std::string language;
  std::string content_hash;
  int schema_version{};
};

struct Exercise {
  std::string content_id;
  std::string exercise_id;
  std::string expected_output;
  std::string hint_level;
};

app::Result validate(const Unit& unit);
app::Result validate(const Exercise& exercise);
bool is_stable_id(std::string_view value);
bool is_content_hash(std::string_view value);
bool is_status(std::string_view value);

}  // namespace codeweave::content
