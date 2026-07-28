cmake_minimum_required(VERSION 3.22)
project(DubstationNative VERSION 0.1.0)

include(FetchContent)
FetchContent_Declare(juce
  GIT_REPOSITORY https://github.com/juce-framework/JUCE.git
  GIT_TAG 8.0.4
  GIT_SHALLOW TRUE)
FetchContent_MakeAvailable(juce)

juce_add_gui_app(DubstationNative PRODUCT_NAME "samDub" COMPANY_NAME "samDub")
target_sources(DubstationNative PRIVATE Source/Main.cpp)
target_compile_features(DubstationNative PRIVATE cxx_std_17)
target_compile_definitions(DubstationNative PRIVATE JUCE_WEB_BROWSER=0 JUCE_USE_CURL=0)
target_link_libraries(DubstationNative PRIVATE juce::juce_audio_utils juce::juce_dsp)
