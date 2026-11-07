cmake_minimum_required(VERSION 3.25)

find_package(Qt6 6.8.3 REQUIRED COMPONENTS Quick Qml QuickControls2)
qt_policy(SET QTP0001 NEW)
qt_policy(SET QTP0004 NEW)

project(CodeWeaveQtShell LANGUAGES CXX)

find_program(CODEWEAVE_NODE_EXECUTABLE NAMES node REQUIRED)
set(CHALLENGE_TEACHING_RUNTIME "${CMAKE_CURRENT_BINARY_DIR}/teaching-runtime.js")
add_custom_command(OUTPUT "${CHALLENGE_TEACHING_RUNTIME}"
  COMMAND "${CODEWEAVE_NODE_EXECUTABLE}" "${CMAKE_SOURCE_DIR}/../scripts/export-teaching-runtime.mjs"
    "${CHALLENGE_TEACHING_RUNTIME}"
  DEPENDS "${CMAKE_SOURCE_DIR}/../scripts/export-teaching-runtime.mjs"
    "${CMAKE_SOURCE_DIR}/../../../网页端/项目/src/engine/teaching-runtime.ts"
  VERBATIM)

set(CMAKE_CXX_STANDARD 23)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)
set(CMAKE_AUTOMOC ON)
set(CMAKE_AUTORCC ON)
set(CMAKE_AUTOUIC ON)
set(CMAKE_MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>DLL")

qt_add_executable(codeweave-qt
  platform/ui_main.cpp
  facade/ui_shell.cpp
  facade/ui_shell_draft.cpp
  facade/ui_shell_account.cpp
  facade/ui_shell_operations.cpp
  facade/ui_shell_challenges.cpp
  facade/ui_shell_lessons.cpp
  facade/ui_shell_checkin.cpp
  facade/checkin_store.cpp
  facade/challenge_submission_store.cpp
  facade/ui_shell.hpp
)
qt_add_resources(codeweave-qt challenge_runtime_resource PREFIX "/challenge"
  BASE "${CMAKE_CURRENT_BINARY_DIR}" FILES "${CHALLENGE_TEACHING_RUNTIME}")

add_library(codeweave-content-qt STATIC
  ../src/app_core.cpp
  ../src/account.cpp
  ../src/account_store.cpp
  ../src/account_service.cpp
  ../src/password_crypto.cpp
  ../src/content_contract.cpp
  ../src/content_repository.cpp
  ../src/backend_task_service.cpp
  ../src/learning_contract.cpp
  ../src/mastery_contract.cpp
  ../src/mastery_store.cpp
  ../src/mastery_service.cpp
  ../src/review_scheduler.cpp
  ../src/operation_index.cpp
  ../src/evidence_store.cpp
  ../src/external_evidence_service.cpp
  ../src/progress_store.cpp
  ../src/progress_projection.cpp
  ../src/review_service.cpp
  ../src/legacy_import.cpp
  ../src/challenge_service.cpp
  ../src/backup_service.cpp
  ../src/content_access.cpp
  ../src/execution_contract.cpp
  ../src/process_contract.cpp
  ../src/execution_plan.cpp
  ../src/process_runner.cpp
  ../src/execution_service.cpp
  ../src/trace_contract.cpp
  ../src/trace_store.cpp
)
set_target_properties(codeweave-content-qt PROPERTIES AUTOMOC OFF AUTOUIC OFF AUTORCC OFF)
target_include_directories(codeweave-content-qt PUBLIC ../src)
target_compile_definitions(codeweave-content-qt PUBLIC WIN32_LEAN_AND_MEAN NOMINMAX)
if (WIN32)
  target_link_libraries(codeweave-content-qt PUBLIC bcrypt)
endif()
if (MSVC)
  set_property(TARGET codeweave-content-qt PROPERTY MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>DLL")
  target_compile_options(codeweave-content-qt PRIVATE /W4 /permissive- /EHsc /utf-8)
endif()

qt_add_qml_module(codeweave-qt
  URI CodeWeave.Ui
  VERSION 1.0
  QML_FILES
    qml/Main.qml
    qml/DesignSystem.qml
    qml/components/NavItem.qml
    qml/components/IconButton.qml
    qml/components/ShellField.qml
    qml/components/PrimaryButton.qml
    qml/components/QuietButton.qml
    qml/components/ShellPopup.qml
    qml/components/ShellDialog.qml
    qml/components/PreferenceToggle.qml
    qml/components/SubjectPill.qml
    qml/components/ChallengeSubmissionPanel.qml
    qml/components/LessonEvidencePanel.qml
    qml/components/CheckinCalendar.qml
    qml/components/ExecutionTracePanel.qml
    qml/components/LearningCatalog.js
    qml/pages/AccountPage.qml
    qml/pages/AnalyticsPage.qml
    qml/pages/ChallengePage.qml
    qml/pages/DraftsPage.qml
    qml/pages/EditorPage.qml
    qml/pages/ReviewPage.qml
    qml/pages/SecurityPage.qml
    qml/pages/PrivacyPage.qml
    qml/pages/StudyPage.qml
    qml/pages/LearningDetailsPage.qml
)

target_include_directories(codeweave-qt PRIVATE facade)
target_link_libraries(codeweave-qt PRIVATE Qt6::Quick Qt6::Qml Qt6::QuickControls2 codeweave-content-qt)
if (WIN32)
  target_link_libraries(codeweave-qt PRIVATE ole32 shell32 uuid)
endif()
if (MSVC)
  target_compile_options(codeweave-qt PRIVATE /W4 /permissive- /EHsc /utf-8)
endif()

set_target_properties(codeweave-qt PROPERTIES
  WIN32_EXECUTABLE TRUE
  OUTPUT_NAME CodeWeaveQtShell
)
if (MSVC)
  # Qt is built with the dynamic MSVC CRT. Keep the executable and its test
  # host on the same runtime as codeweave-content-qt to avoid STL/heap ABI
  # mismatches at the facade boundary.
  set_property(TARGET codeweave-qt PROPERTY MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>DLL")
endif()

set(CODEWEAVE_QT_DEPLOY_SCRIPT "${CMAKE_CURRENT_SOURCE_DIR}/deploy-qt.ps1")
get_filename_component(CODEWEAVE_QT_PREFIX "${Qt6_DIR}/../../.." ABSOLUTE)
set(CODEWEAVE_QT_BIN "${CODEWEAVE_QT_PREFIX}/bin")
get_filename_component(CODEWEAVE_CONTENT_DIR "${CMAKE_SOURCE_DIR}/content" ABSOLUTE)
add_custom_target(codeweave-qt-deploy
  COMMAND ${CMAKE_COMMAND} -E make_directory "${CMAKE_BINARY_DIR}/qt-deploy"
  COMMAND powershell.exe -NoProfile -ExecutionPolicy Bypass -File "${CODEWEAVE_QT_DEPLOY_SCRIPT}"
    -Exe "$<TARGET_FILE:codeweave-qt>"
    -OutputDir "${CMAKE_BINARY_DIR}/qt-deploy"
    -QmlDir "${CMAKE_CURRENT_SOURCE_DIR}/qml"
    -ContentDir "${CODEWEAVE_CONTENT_DIR}"
    -ConfigDir "${CMAKE_SOURCE_DIR}/../config"
    -QtBin "${CODEWEAVE_QT_BIN}"
  DEPENDS codeweave-qt
  VERBATIM
)

if (BUILD_TESTING)
  add_test(NAME qt-qml-load COMMAND ${CMAKE_COMMAND} -E env
    "PATH=${CODEWEAVE_QT_BIN}"
    "QT_QPA_PLATFORM=offscreen"
    "QT_PLUGIN_PATH=${CODEWEAVE_QT_PREFIX}/plugins"
    "QML_IMPORT_PATH=${CODEWEAVE_QT_PREFIX}/qml"
    $<TARGET_FILE:codeweave-qt> --qml-load-smoke "${CMAKE_BINARY_DIR}/qt-qml-smoke-report.json")
  set_tests_properties(qt-qml-load PROPERTIES TIMEOUT 15)
  find_program(CODEWEAVE_QT_TEST_CPP_TOOL NAMES g++.exe clang++.exe cl.exe)
  find_program(CODEWEAVE_QT_TEST_JAVA_TOOL NAMES java.exe)
  find_program(CODEWEAVE_QT_TEST_PYTHON_TOOL NAMES python.exe python3.exe)
  find_program(CODEWEAVE_QT_TEST_JAVASCRIPT_TOOL NAMES node.exe)
  if (CODEWEAVE_QT_TEST_JAVASCRIPT_TOOL)
    add_test(NAME qt-learning-catalog COMMAND "${CODEWEAVE_QT_TEST_JAVASCRIPT_TOOL}"
      --test "${CMAKE_CURRENT_SOURCE_DIR}/tests/learning_catalog_tests.mjs")
  endif()
  add_executable(codeweave-qt-facade-tests
    tests/ui_shell_tests.cpp facade/ui_shell.cpp facade/ui_shell_draft.cpp facade/ui_shell_account.cpp
    facade/ui_shell_operations.cpp facade/ui_shell_challenges.cpp facade/ui_shell_lessons.cpp facade/ui_shell_checkin.cpp
    facade/checkin_store.cpp facade/challenge_submission_store.cpp facade/ui_shell.hpp)
  qt_add_resources(codeweave-qt-facade-tests challenge_runtime_test_resource PREFIX "/challenge"
    BASE "${CMAKE_CURRENT_BINARY_DIR}" FILES "${CHALLENGE_TEACHING_RUNTIME}")
  target_include_directories(codeweave-qt-facade-tests PRIVATE facade)
  target_link_libraries(codeweave-qt-facade-tests PRIVATE Qt6::Core Qt6::Qml codeweave-content-qt)
  if (MSVC)
    set_property(TARGET codeweave-qt-facade-tests PROPERTY MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>DLL")
    target_compile_options(codeweave-qt-facade-tests PRIVATE /UNDEBUG /utf-8 /W4)
  endif()
  if (CODEWEAVE_QT_TEST_CPP_TOOL AND CODEWEAVE_QT_TEST_JAVA_TOOL AND
      CODEWEAVE_QT_TEST_PYTHON_TOOL AND CODEWEAVE_QT_TEST_JAVASCRIPT_TOOL)
    add_test(NAME qt-facade COMMAND ${CMAKE_COMMAND} -E env
      "PATH=${CODEWEAVE_QT_BIN}" $<TARGET_FILE:codeweave-qt-facade-tests>
      "${CODEWEAVE_CONTENT_DIR}" "${CODEWEAVE_QT_TEST_CPP_TOOL}"
      "${CODEWEAVE_QT_TEST_JAVA_TOOL}" "${CODEWEAVE_QT_TEST_PYTHON_TOOL}"
      "${CODEWEAVE_QT_TEST_JAVASCRIPT_TOOL}")
  else()
    add_test(NAME qt-facade COMMAND ${CMAKE_COMMAND} -E env
      "PATH=${CODEWEAVE_QT_BIN}" $<TARGET_FILE:codeweave-qt-facade-tests>
      "${CODEWEAVE_CONTENT_DIR}" "" "" "" "")
    set_tests_properties(qt-facade PROPERTIES LABELS "tools-unavailable")
  endif()
endif()
