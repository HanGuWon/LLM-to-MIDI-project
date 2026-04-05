cmake_minimum_required(VERSION 3.22)

project(LlmMidiJuceShell VERSION 0.1.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

if(DEFINED JUCE_SOURCE_DIR AND EXISTS "${JUCE_SOURCE_DIR}/CMakeLists.txt")
  message(STATUS "Using JUCE from JUCE_SOURCE_DIR=${JUCE_SOURCE_DIR}")
  add_subdirectory("${JUCE_SOURCE_DIR}" "${CMAKE_CURRENT_BINARY_DIR}/juce")
else()
  find_package(JUCE CONFIG REQUIRED)
endif()

juce_add_gui_app(llm_midi_juce_shell
  PRODUCT_NAME "LLM to MIDI Shell"
  COMPANY_NAME "HanGuWon"
  VERSION ${PROJECT_VERSION}
  BUNDLE_ID "com.hanguwon.llm-midi-shell"
)

juce_generate_juce_header(llm_midi_juce_shell)

target_sources(llm_midi_juce_shell
  PRIVATE
    Source/Main.cpp
    Source/App/LlmMidiShellApplication.h
    Source/App/LlmMidiShellApplication.cpp
    Source/App/MainWindow.h
    Source/App/MainWindow.cpp
    Source/UI/MainComponent.h
    Source/UI/MainComponent.cpp
    Source/Worker/WorkerProcessController.h
    Source/Worker/WorkerProcessController.cpp
    Source/Worker/PipeJsonClient.h
    Source/Worker/PipeJsonClient.cpp
    Source/Worker/WorkerSession.h
    Source/Worker/WorkerSession.cpp
    Source/Model/DocumentState.h
    Source/Model/DocumentState.cpp
    Source/Protocol/WorkerProtocolJson.h
    Source/Protocol/WorkerProtocolJson.cpp
    Source/Util/Base64.h
    Source/Util/Base64.cpp
    Source/Util/JsonHelpers.h
    Source/Util/JsonHelpers.cpp
)

target_include_directories(llm_midi_juce_shell
  PRIVATE
    Source
)

target_compile_definitions(llm_midi_juce_shell
  PRIVATE
    JUCE_WEB_BROWSER=0
    JUCE_USE_CURL=0
)

target_link_libraries(llm_midi_juce_shell
  PRIVATE
    juce::juce_core
    juce::juce_events
    juce::juce_graphics
    juce::juce_gui_basics
    juce::juce_gui_extra
    juce::juce_recommended_config_flags
    juce::juce_recommended_warning_flags
)
