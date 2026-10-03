cmake_minimum_required(VERSION 3.22)
project(codeweave_mobile_core LANGUAGES CXX)
set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
add_library(codeweave_mobile_core SHARED src/mobile_core.cpp)
target_include_directories(codeweave_mobile_core PUBLIC include)

add_executable(codeweave_mobile_core_test tests/mobile_core_test.cpp)
target_link_libraries(codeweave_mobile_core_test PRIVATE codeweave_mobile_core)
target_include_directories(codeweave_mobile_core_test PRIVATE include)

enable_testing()
add_test(NAME mobile-core-self-test COMMAND codeweave_mobile_core_test)
