#pragma once

#include "mastery_store.hpp"
#include "review_scheduler.hpp"

#include <map>

namespace codeweave::learning {

struct MasterySnapshot {
  std::map<std::string, MasteryRecord> records;
};

class MasteryService final {
 public:
  explicit MasteryService(MasteryStore& store) : store_(store) {}

  app::Result replay(std::size_t plan_length, MasterySnapshot& snapshot) const;
  app::Result replay(const ReviewPlan& plan, MasterySnapshot& snapshot) const;
  app::Result record_evidence(const MasteryEvidence& evidence, std::size_t plan_length,
      bool& duplicate, MasterySnapshot& snapshot);
  app::Result record_evidence(const MasteryEvidence& evidence, const ReviewPlan& plan,
      bool& duplicate, MasterySnapshot& snapshot);

 private:
  MasteryStore& store_;
};

}  // namespace codeweave::learning
