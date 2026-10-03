#include "mobile_core.hpp"
#include <iostream>

int main() {
  if (codeweave::mobile::health_message() != "mobile-core-ready") {
    std::cerr << "unexpected mobile core health message\n";
    return 1;
  }
  return 0;
}
