#include <chrono>
#include <cstdlib>
#include <iostream>
#include <string>
#include <thread>

int main(int argc, char** argv) {
  std::size_t emit_bytes = 0;
  unsigned sleep_ms = 0;
  std::string text = "native-test-output\n";
  for (int index = 1; index < argc; ++index) {
    const std::string argument = argv[index];
    if (argument == "--emit-bytes" && index + 1 < argc) {
      emit_bytes = static_cast<std::size_t>(std::strtoull(argv[++index], nullptr, 10));
    } else if (argument == "--sleep-ms" && index + 1 < argc) {
      sleep_ms = static_cast<unsigned>(std::strtoul(argv[++index], nullptr, 10));
    } else if (argument == "--text" && index + 1 < argc) {
      text = argv[++index];
    }
  }
  if (sleep_ms > 0) std::this_thread::sleep_for(std::chrono::milliseconds(sleep_ms));
  if (emit_bytes == 0) {
    std::cout << text << std::flush;
  } else {
    const std::string block(4096, 'x');
    while (emit_bytes > 0) {
      const auto count = std::min(emit_bytes, block.size());
      std::cout.write(block.data(), static_cast<std::streamsize>(count));
      emit_bytes -= count;
    }
    std::cout << std::flush;
  }
  return 0;
}
