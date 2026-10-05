#include "password_crypto.hpp"

#include "account.hpp"

#include <algorithm>
#include <array>
#include <cstdint>
#include <cctype>
#include <vector>

#ifdef _WIN32
#include <windows.h>
#include <bcrypt.h>
#endif

namespace codeweave::account {
namespace {
constexpr std::uint64_t kN = 16384;
constexpr std::size_t kR = 8;
constexpr std::size_t kP = 1;
constexpr std::size_t kBlockLen = 128 * kR;
constexpr std::size_t kDkLen = 64;

std::string hex_encode(const std::vector<std::uint8_t>& bytes) {
  constexpr char digits[] = "0123456789abcdef"; std::string result; result.reserve(bytes.size() * 2);
  for (const auto byte : bytes) { result.push_back(digits[byte >> 4]); result.push_back(digits[byte & 0x0f]); }
  return result;
}
bool hex_decode(std::string_view value, std::vector<std::uint8_t>& bytes) {
  if (value.size() % 2 != 0) return false;
  const auto digit = [](char value) -> int { if (value >= '0' && value <= '9') return value - '0'; if (value >= 'a' && value <= 'f') return value - 'a' + 10; if (value >= 'A' && value <= 'F') return value - 'A' + 10; return -1; };
  bytes.clear(); bytes.reserve(value.size() / 2);
  for (size_t index = 0; index < value.size(); index += 2) { const int high = digit(value[index]); const int low = digit(value[index + 1]); if (high < 0 || low < 0) return false; bytes.push_back(static_cast<std::uint8_t>((high << 4) | low)); }
  return true;
}
std::uint32_t load32(const std::uint8_t* value) { return static_cast<std::uint32_t>(value[0]) | (static_cast<std::uint32_t>(value[1]) << 8) | (static_cast<std::uint32_t>(value[2]) << 16) | (static_cast<std::uint32_t>(value[3]) << 24); }
void store32(std::uint8_t* value, std::uint32_t word) { value[0] = static_cast<std::uint8_t>(word); value[1] = static_cast<std::uint8_t>(word >> 8); value[2] = static_cast<std::uint8_t>(word >> 16); value[3] = static_cast<std::uint8_t>(word >> 24); }
std::uint32_t rol(std::uint32_t value, unsigned count) { return (value << count) | (value >> (32 - count)); }
void salsa208(std::uint8_t* block) {
  std::array<std::uint32_t, 16> state{}; std::array<std::uint32_t, 16> working{};
  for (size_t i = 0; i < 16; ++i) state[i] = working[i] = load32(block + i * 4);
  for (int round = 0; round < 8; round += 2) {
    working[4] ^= rol(working[0] + working[12], 7); working[8] ^= rol(working[4] + working[0], 9); working[12] ^= rol(working[8] + working[4], 13); working[0] ^= rol(working[12] + working[8], 18);
    working[9] ^= rol(working[5] + working[1], 7); working[13] ^= rol(working[9] + working[5], 9); working[1] ^= rol(working[13] + working[9], 13); working[5] ^= rol(working[1] + working[13], 18);
    working[14] ^= rol(working[10] + working[6], 7); working[2] ^= rol(working[14] + working[10], 9); working[6] ^= rol(working[2] + working[14], 13); working[10] ^= rol(working[6] + working[2], 18);
    working[3] ^= rol(working[15] + working[11], 7); working[7] ^= rol(working[3] + working[15], 9); working[11] ^= rol(working[7] + working[3], 13); working[15] ^= rol(working[11] + working[7], 18);
    working[1] ^= rol(working[0] + working[3], 7); working[2] ^= rol(working[1] + working[0], 9); working[3] ^= rol(working[2] + working[1], 13); working[0] ^= rol(working[3] + working[2], 18);
    working[6] ^= rol(working[5] + working[4], 7); working[7] ^= rol(working[6] + working[5], 9); working[4] ^= rol(working[7] + working[6], 13); working[5] ^= rol(working[4] + working[7], 18);
    working[11] ^= rol(working[10] + working[9], 7); working[8] ^= rol(working[11] + working[10], 9); working[9] ^= rol(working[8] + working[11], 13); working[10] ^= rol(working[9] + working[8], 18);
    working[12] ^= rol(working[15] + working[14], 7); working[13] ^= rol(working[12] + working[15], 9); working[14] ^= rol(working[13] + working[12], 13); working[15] ^= rol(working[14] + working[13], 18);
  }
  for (size_t i = 0; i < 16; ++i) store32(block + i * 4, working[i] + state[i]);
}
void block_mix(const std::vector<std::uint8_t>& input, std::vector<std::uint8_t>& output) {
  std::array<std::uint8_t, 64> x{}; std::vector<std::uint8_t> y(input.size()); std::copy(input.end() - 64, input.end(), x.begin()); const size_t blocks = input.size() / 64;
  for (size_t i = 0; i < blocks; ++i) { for (size_t b = 0; b < 64; ++b) x[b] ^= input[i * 64 + b]; salsa208(x.data()); std::copy(x.begin(), x.end(), y.begin() + i * 64); }
  output.resize(input.size()); for (size_t i = 0; i < blocks / 2; ++i) { std::copy(y.begin() + i * 128, y.begin() + i * 128 + 64, output.begin() + i * 64); std::copy(y.begin() + i * 128 + 64, y.begin() + i * 128 + 128, output.begin() + (blocks / 2 + i) * 64); }
}
void integerify(const std::vector<std::uint8_t>& block, std::uint64_t& value) { const auto* start = block.data() + (2 * kR - 1) * 64; value = static_cast<std::uint64_t>(load32(start)) | (static_cast<std::uint64_t>(load32(start + 4)) << 32); }
#ifdef _WIN32
app::Result pbkdf2(std::string_view password, const std::vector<std::uint8_t>& salt, std::uint32_t iterations, std::vector<std::uint8_t>& output) {
  BCRYPT_ALG_HANDLE algorithm = nullptr;
  if (BCryptOpenAlgorithmProvider(&algorithm, BCRYPT_SHA256_ALGORITHM, nullptr, BCRYPT_ALG_HANDLE_HMAC_FLAG) != 0) return app::Result::failure("打开 SHA-256 提供程序失败");
  const auto status = BCryptDeriveKeyPBKDF2(algorithm, reinterpret_cast<PUCHAR>(const_cast<char*>(password.data())), static_cast<ULONG>(password.size()), const_cast<PUCHAR>(salt.data()), static_cast<ULONG>(salt.size()), iterations, output.data(), static_cast<ULONG>(output.size()), 0);
  BCryptCloseAlgorithmProvider(algorithm, 0); return status == 0 ? app::Result::success() : app::Result::failure("PBKDF2 计算失败");
}
#endif
app::Result derive_scrypt(std::string_view password, const std::vector<std::uint8_t>& salt, std::vector<std::uint8_t>& output) {
#ifndef _WIN32
  (void)password; (void)salt; (void)output; return app::Result::failure("密码验证仅支持 Windows CNG");
#else
  std::vector<std::uint8_t> b(kP * kBlockLen), x(kBlockLen), y(kBlockLen); auto result = pbkdf2(password, salt, 1, b); if (!result.ok) return result; std::vector<std::uint8_t> v(static_cast<size_t>(kN) * kBlockLen);
  for (size_t parallel = 0; parallel < kP; ++parallel) { std::copy(b.begin() + parallel * kBlockLen, b.begin() + (parallel + 1) * kBlockLen, x.begin()); for (std::uint64_t i = 0; i < kN; ++i) { std::copy(x.begin(), x.end(), v.begin() + static_cast<size_t>(i) * kBlockLen); block_mix(x, y); std::swap(x, y); } for (std::uint64_t i = 0; i < kN; ++i) { std::uint64_t integer = 0; integerify(x, integer); const auto offset = static_cast<size_t>(integer & (kN - 1)) * kBlockLen; for (size_t byte = 0; byte < kBlockLen; ++byte) x[byte] ^= v[offset + byte]; block_mix(x, y); std::swap(x, y); } std::copy(x.begin(), x.end(), b.begin() + parallel * kBlockLen); }
  output.resize(kDkLen); return pbkdf2(password, b, 1, output);
#endif
}
}  // namespace
app::Result hash_password_with_salt(std::string_view password, std::string_view salt_hex, std::string& encoded_hash) { if (password.empty() || password.size() > 128 || salt_hex.size() != 32) return app::Result::failure("密码或盐长度无效"); if (!std::all_of(salt_hex.begin(), salt_hex.end(), [](unsigned char value) { return std::isxdigit(value) != 0; })) return app::Result::failure("密码盐格式无效"); std::vector<std::uint8_t> salt(salt_hex.begin(), salt_hex.end()); std::vector<std::uint8_t> derived; const auto result = derive_scrypt(password, salt, derived); if (!result.ok) return result; encoded_hash = "scrypt$v1$" + std::string(salt_hex) + ":" + hex_encode(derived); return app::Result::success("密码哈希已生成"); }
app::Result hash_password(std::string_view password, std::string& encoded_hash) {
#ifndef _WIN32
  (void)password; (void)encoded_hash; return app::Result::failure("密码哈希仅支持 Windows CNG");
#else
  std::array<std::uint8_t, 16> salt{}; if (BCryptGenRandom(nullptr, salt.data(), static_cast<ULONG>(salt.size()), BCRYPT_USE_SYSTEM_PREFERRED_RNG) != 0) return app::Result::failure("生成密码盐失败"); std::vector<std::uint8_t> bytes(salt.begin(), salt.end()); return hash_password_with_salt(password, hex_encode(bytes), encoded_hash);
#endif
}
app::Result verify_password(std::string_view password, std::string_view encoded_hash, bool& matches) { matches = false; if (!is_supported_password_hash(encoded_hash)) return app::Result::failure("密码哈希格式不受支持"); constexpr std::string_view prefix = "scrypt$v1$"; const auto body = encoded_hash.starts_with(prefix) ? encoded_hash.substr(prefix.size()) : encoded_hash; const auto separator = body.find(':'); const auto salt_text = body.substr(0, separator); if (salt_text.size() != 32 || !std::all_of(salt_text.begin(), salt_text.end(), [](unsigned char value) { return std::isxdigit(value) != 0; })) return app::Result::failure("密码盐格式无效"); std::vector<std::uint8_t> salt(salt_text.begin(), salt_text.end()); std::vector<std::uint8_t> expected; if (!hex_decode(body.substr(separator + 1), expected)) return app::Result::failure("密码摘要格式无效"); std::vector<std::uint8_t> actual; const auto result = derive_scrypt(password, salt, actual); if (!result.ok) return result; std::uint8_t difference = static_cast<std::uint8_t>(actual.size() ^ expected.size()); for (size_t index = 0; index < std::max(actual.size(), expected.size()); ++index) { const auto left = index < actual.size() ? actual[index] : 0; const auto right = index < expected.size() ? expected[index] : 0; difference = static_cast<std::uint8_t>(difference | (left ^ right)); } matches = difference == 0; return app::Result::success(matches ? "密码验证通过" : "密码不匹配"); }
}  // namespace codeweave::account
