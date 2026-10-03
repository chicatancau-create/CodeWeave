cmake_minimum_required(VERSION 3.25)
project(CodeWeaveNative LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 23)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

add_executable(codeweave-native WIN32 src/main.cpp)
target_compile_definitions(codeweave-native PRIVATE UNICODE _UNICODE WIN32_LEAN_AND_MEAN NOMINMAX)
if (MSVC)
  target_compile_options(codeweave-native PRIVATE /W4 /permissive- /EHsc)
else()
  target_compile_options(codeweave-native PRIVATE -Wall -Wextra -Wpedantic)
endif()

include(CTest)
if (BUILD_TESTING)
  add_test(NAME native-startup COMMAND codeweave-native --self-test)
endif()
