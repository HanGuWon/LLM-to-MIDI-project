#include "LlmMidiShellApplication.h"

#include "MainWindow.h"

const juce::String LlmMidiShellApplication::getApplicationName()
{
    return "LLM to MIDI Shell";
}

const juce::String LlmMidiShellApplication::getApplicationVersion()
{
    return ProjectInfo::versionString;
}

bool LlmMidiShellApplication::moreThanOneInstanceAllowed()
{
    return true;
}

void LlmMidiShellApplication::initialise(const juce::String&)
{
    mainWindow = std::make_unique<MainWindow>(getApplicationName());
}

void LlmMidiShellApplication::shutdown()
{
    mainWindow.reset();
}

void LlmMidiShellApplication::systemRequestedQuit()
{
    quit();
}

void LlmMidiShellApplication::anotherInstanceStarted(const juce::String&)
{
}
