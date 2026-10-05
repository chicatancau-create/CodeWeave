#pragma once

#include "app_core.hpp"
#include "evidence_store.hpp"
#include "progress_store.hpp"

#include <filesystem>
#include <string>
#include <vector>

namespace codeweave::learning {

struct ReviewItem {
  std::string content_id;
  std::string exercise_id;
  std::string latest_at;
  std::string latest_result;
  bool passed{};
  bool independent{};
  std::string hint_level;
  std::size_t evidence_count{};
};

struct ReviewSummary {
  std::size_t evidence_count{};
  std::size_t progress_count{};
  std::size_t passed_count{};
  std::size_t independent_passed_count{};
  std::vector<ReviewItem> items;
};

class ReviewService final {
 public:
  ReviewService(const EvidenceStore& evidence, const ProgressStore& progress)
      : evidence_(evidence), progress_(progress) {}

  app::Result summarize(ReviewSummary& summary) const;

 private:
  const EvidenceStore& evidence_;
  const ProgressStore& progress_;
};

}  // namespace codeweave::learning
