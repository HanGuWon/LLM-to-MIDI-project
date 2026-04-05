#pragma once

#include <JuceHeader.h>

#include "Model/DocumentState.h"
#include "Worker/WorkerSession.h"

class MainComponent final : public juce::Component,
                            private WorkerSession::Listener
{
public:
    MainComponent();
    ~MainComponent() override;

    void resized() override;

private:
    void workerStatusChanged(const juce::String& status, const juce::String& detail) override;
    void workerLogAppended(const juce::String& text) override;
    void requestStateChanged(bool isBusy, const juce::String& requestKind) override;
    void pingCompleted(const juce::String& resultText) override;
    void validateCompleted(const llm_midi::protocol::ValidatePayload& payload) override;
    void inspectCompleted(const llm_midi::protocol::InspectPayload& payload) override;
    void convertCompleted(const llm_midi::protocol::ConvertPayload& payload) override;
    void requestFailed(const juce::String& requestKind,
                       const juce::String& errorMessage,
                       const juce::String& rawResponseJson) override;

    void configureEditors();
    void configureButtons();
    void configureLabels();
    void populateDefaultPaths();
    void syncStateFromUi();
    void refreshPanels();
    void refreshButtonStates();
    juce::String buildDiagnosticsPanelText() const;
    juce::String buildResultPanelText() const;
    juce::Result writeMidiFile(const llm_midi::protocol::ConvertPayload& payload, juce::File& outputFile) const;

    static juce::File findRepoRoot();
    static juce::String readFixtureIfAvailable(const juce::File& repoRoot, const juce::String& relativePath);

    DocumentState documentState;
    WorkerSession workerSession;
    bool requestBusy = false;

    juce::Label statusLabel;
    juce::Label nodePathLabel;
    juce::Label workerScriptLabel;
    juce::Label abc2midiPathLabel;
    juce::Label exportDirectoryLabel;
    juce::Label engineLabel;
    juce::Label abcInputLabel;
    juce::Label diagnosticsLabel;
    juce::Label resultLabel;

    juce::TextEditor nodePathEditor;
    juce::TextEditor workerScriptEditor;
    juce::TextEditor abc2midiPathEditor;
    juce::TextEditor exportDirectoryEditor;
    juce::ComboBox engineComboBox;

    juce::TextButton startWorkerButton { "Start Worker" };
    juce::TextButton stopWorkerButton { "Stop Worker" };
    juce::TextButton validateButton { "Validate" };
    juce::TextButton inspectButton { "Inspect" };
    juce::TextButton convertButton { "Convert to MIDI" };

    juce::TextEditor abcInputEditor;
    juce::TextEditor diagnosticsEditor;
    juce::TextEditor resultEditor;
};
