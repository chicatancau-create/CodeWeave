#pragma once

#include "app_core.hpp"
#include "evidence_store.hpp"

#include <QVariantList>
#include <QVariantMap>
#include <filesystem>

class VaultWritebackStore final {
 public:
  VaultWritebackStore(std::filesystem::path owner_root, std::filesystem::path account_root,
      std::filesystem::path vault_root,
      std::string account_id);

  codeweave::app::Result bindOwner();
  codeweave::app::Result ownerStatus(bool& is_owner) const;
  codeweave::app::Result readProgress(QVariantMap& projection) const;
  codeweave::app::Result readEvidence(QVariantList& pending, QVariantList& synced) const;
  codeweave::app::Result preview(const QStringList& evidence_ids, QVariantMap& result);
  codeweave::app::Result commit(const QString& operation_id, const QVariantMap& expected_hashes,
      QVariantMap& result);
  codeweave::app::Result rollback(const QString& operation_id, QVariantMap& result);
  codeweave::app::Result transactions(QVariantList& result) const;

 private:
  std::filesystem::path owner_root_;
  std::filesystem::path account_root_;
  std::filesystem::path vault_root_;
  std::string account_id_;
};
