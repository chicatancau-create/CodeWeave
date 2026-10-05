#pragma once

#include "content_contract.hpp"

#include <filesystem>
#include <string>
#include <vector>

namespace codeweave::content {

struct LoadedUnit {
  Unit metadata;
  std::string body;
};

class ContentRepository final {
 public:
  explicit ContentRepository(std::filesystem::path content_root);

  app::Result list_published(std::vector<Unit>& units) const;
  app::Result read_published(std::string_view content_id, LoadedUnit& unit) const;
  app::Result list_exercises(std::string_view content_id, std::vector<Exercise>& exercises) const;
  app::Result read_starter(std::string_view content_id, std::string& language,
      std::string& code, std::string& execution_policy) const;
  app::Result read_hints(std::string_view content_id, std::string& hints) const;

 private:
  std::filesystem::path content_root_;
};

}  // namespace codeweave::content
