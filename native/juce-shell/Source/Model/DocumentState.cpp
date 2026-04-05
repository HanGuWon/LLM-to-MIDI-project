#include "Model/DocumentState.h"

namespace
{
constexpr int maxDebugLogCharacters = 16000;
}

const DocumentState::Settings& DocumentState::getSettings() const noexcept
{
    return settings;
}

void DocumentState::setSettings(const Settings& newSettings)
{
    settings = newSettings;
}

const juce::String& DocumentState::getAbcText() const noexcept
{
    return abcText;
}

void DocumentState::setAbcText(const juce::String& newAbcText)
{
    abcText = newAbcText;
}

const juce::String& DocumentState::getLastNormalizedAbc() const noexcept
{
    return lastNormalizedAbc;
}

void DocumentState::setLastNormalizedAbc(const juce::String& newNormalizedAbc)
{
    lastNormalizedAbc = newNormalizedAbc;
}

const juce::String& DocumentState::getLastDiagnosticsText() const noexcept
{
    return lastDiagnosticsText;
}

void DocumentState::setLastDiagnosticsText(const juce::String& newDiagnosticsText)
{
    lastDiagnosticsText = newDiagnosticsText;
}

const juce::String& DocumentState::getLastInspectText() const noexcept
{
    return lastInspectText;
}

void DocumentState::setLastInspectText(const juce::String& newInspectText)
{
    lastInspectText = newInspectText;
}

const juce::String& DocumentState::getLastConvertText() const noexcept
{
    return lastConvertText;
}

void DocumentState::setLastConvertText(const juce::String& newConvertText)
{
    lastConvertText = newConvertText;
}

const juce::String& DocumentState::getDebugLog() const noexcept
{
    return debugLog;
}

void DocumentState::appendDebugLog(const juce::String& text)
{
    if (text.isEmpty())
    {
        return;
    }

    debugLog = trimLogToLimit(debugLog + text);
}

const juce::String& DocumentState::getWorkerStatus() const noexcept
{
    return workerStatus;
}

const juce::String& DocumentState::getWorkerDetail() const noexcept
{
    return workerDetail;
}

void DocumentState::setWorkerStatus(const juce::String& newWorkerStatus, const juce::String& newWorkerDetail)
{
    workerStatus = newWorkerStatus;
    workerDetail = newWorkerDetail;
}

juce::String DocumentState::trimLogToLimit(const juce::String& value)
{
    if (value.length() <= maxDebugLogCharacters)
    {
        return value;
    }

    return value.substring(value.length() - maxDebugLogCharacters);
}
