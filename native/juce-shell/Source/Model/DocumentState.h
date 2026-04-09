#pragma once

#include <JuceHeader.h>

class DocumentState final
{
public:
    struct Settings
    {
        juce::String nodeExecutablePath { "node" };
        juce::String workerScriptPath;
        juce::String abc2midiPath;
        juce::String exportDirectory;
        juce::String engine { "auto" };
    };

    const Settings& getSettings() const noexcept;
    void setSettings(const Settings& newSettings);

    const juce::String& getAbcText() const noexcept;
    void setAbcText(const juce::String& newAbcText);

    const juce::String& getLastNormalizedAbc() const noexcept;
    void setLastNormalizedAbc(const juce::String& newNormalizedAbc);

    const juce::String& getLastDiagnosticsText() const noexcept;
    void setLastDiagnosticsText(const juce::String& newDiagnosticsText);

    const juce::String& getLastInspectText() const noexcept;
    void setLastInspectText(const juce::String& newInspectText);

    const juce::String& getLastConvertText() const noexcept;
    void setLastConvertText(const juce::String& newConvertText);

    const juce::String& getDebugLog() const noexcept;
    void appendDebugLog(const juce::String& text);

    const juce::String& getWorkerStatus() const noexcept;
    const juce::String& getWorkerDetail() const noexcept;
    void setWorkerStatus(const juce::String& newWorkerStatus, const juce::String& newWorkerDetail);

private:
    static juce::String trimLogToLimit(const juce::String& value);

    Settings settings;
    juce::String abcText;
    juce::String lastNormalizedAbc;
    juce::String lastDiagnosticsText;
    juce::String lastInspectText;
    juce::String lastConvertText;
    juce::String debugLog;
    juce::String workerStatus { "Stopped" };
    juce::String workerDetail { "Worker not started." };
};
