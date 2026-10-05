#include "content_repository.hpp"

#include <cassert>
#include <filesystem>
#include <fstream>
#include <random>
#include <string>
#include <string_view>

namespace {
std::string hex(std::string_view input) {
  constexpr char digits[] = "0123456789abcdef";
  std::string result;
  for (const unsigned char c : input) { result.push_back(digits[c >> 4]); result.push_back(digits[c & 0xf]); }
  return result;
}

void write_table(const std::filesystem::path& root) {
  const std::string body = "body\n";
  std::ofstream(root / "catalog.v1.tsv", std::ios::binary) << hex("lesson-01") << '\t' << hex("课程") << '\t'
      << hex("published") << '\t' << hex("python") << '\t'
      << hex("9e2ec912af5dff2a72300863864fc4da04e81999339d9fac5c7590ba8a3f4e11") << '\t' << hex("1") << '\n';
  std::ofstream(root / "lesson-01.txt", std::ios::binary) << body;
  std::ofstream(root / "starter-code.v1.tsv", std::ios::binary) << hex("lesson-01") << '\t' << hex("python") << '\t' << hex("print(1)\n") << '\n';
  std::ofstream(root / "metadata.v1.tsv", std::ios::binary) << hex("lesson-01") << '\t' << hex("lesson") << '\t' << hex("A")
      << '\t' << hex("native") << '\t' << hex("teaching") << '\t' << hex("main.py") << '\n';
  std::filesystem::create_directories(root / "hints");
  std::ofstream(root / "hints.v1.tsv", std::ios::binary) << hex("lesson-01") << '\t' << hex("41ae84877dd3ce346a7d97fc7f493c8e9dcacfa67ce6974ace56baecee9a8411") << '\n';
  std::ofstream(root / "hints" / "lesson-01.txt", std::ios::binary) << "help\n";
}
}

int main() {
  const auto root = std::filesystem::temp_directory_path() /
      ("codeweave-content-delivery-tests-" + std::to_string(std::random_device{}()));
  std::error_code error;
  assert(std::filesystem::create_directory(root));
  write_table(root);
  codeweave::content::ContentRepository repository(root);
  std::string language, code, policy;
  assert(repository.read_starter("lesson-01", language, code, policy).ok);
  assert(language == "python" && code == "print(1)\n" && policy == "native");
  std::string hints;
  assert(repository.read_hints("lesson-01", hints).ok && hints == "help\n");
  assert(!repository.read_starter("unknown", language, code, policy).ok);
  std::ofstream(root / "starter-code.v1.tsv", std::ios::binary | std::ios::trunc) << "zz\tbad\trow\n";
  assert(!repository.read_starter("lesson-01", language, code, policy).ok);
  write_table(root);
  std::ofstream(root / "starter-code.v1.tsv", std::ios::app) << hex("lesson-01") << '\t' << hex("python") << '\t' << hex("other") << '\n';
  assert(!repository.read_starter("lesson-01", language, code, policy).ok);
  write_table(root);
  std::ofstream(root / "starter-code.v1.tsv", std::ios::trunc) << hex("lesson-01") << '\t' << hex("python") << '\t' << "c328" << '\n';
  assert(!repository.read_starter("lesson-01", language, code, policy).ok);
  write_table(root);
  std::ofstream(root / "hints" / "lesson-01.txt", std::ios::trunc) << "tampered";
  assert(!repository.read_hints("lesson-01", hints).ok && hints.empty());
  write_table(root);
  std::ofstream(root / "metadata.v1.tsv", std::ios::trunc) << hex("lesson-01") << '\t' << hex("lesson") << '\t' << hex("A")
      << '\t' << hex("external") << '\t' << hex("external") << '\t' << hex("main.py") << '\n';
  assert(repository.read_starter("lesson-01", language, code, policy).ok && policy == "external");
  std::filesystem::remove_all(root, error);
}
