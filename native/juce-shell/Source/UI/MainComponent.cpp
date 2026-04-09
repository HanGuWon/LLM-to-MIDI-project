#include "UI/MainComponent.h"

#include "Protocol/WorkerProtocolJson.h"

namespace
{
constexpr int controlHeight = 24;
constexpr int sectionGap = 10;
constexpr int fieldGap = 8;
}

MainComponent::MainComponent()
{
    workerSession.setListener(this);

    configureLabels();
    configureEditors();
    configureButtons();
    populateDefaultPaths();
    refreshPanels();
    refreshButtonStates();

    setSize(1280, 900);
}

MainComponent::~MainComponent()
{
    workerSession.setListener(nullptr);
}

void MainComponent::resized()
{
    auto area = getLocalBounds().reduced(12);

    statusLabel.setBounds(area.removeFromTop(controlHeight));
    area.removeFromTop(sectionGap);

    auto settingsArea = area.removeFromTop(160);
    auto leftSettings = settingsArea.removeFromLeft(settingsArea.getWidth() / 2).reduced(0, 2);
    auto rightSettings = settingsArea.reduced(0, 2);

    auto layoutLabelAndField = [](juce::Rectangle<int>& targetArea,
                                  juce::Label& label,
                                  juce::Component& field)
    {
        label.setBounds(targetArea.removeFromTop(controlHeight));
        targetArea.removeFromTop(2);
        field.setBounds(targetArea.removeFromTop(controlHeight));
        targetArea.removeFromTop(fieldGap);
    };

    layoutLabelAndField(leftSettings, nodePathLabel, nodePathEditor);
    layoutLabelAndField(leftSettings, workerScriptLabel, workerScriptEditor);
    layoutLabelAndField(leftSettings, abc2midiPathLabel, abc2midiPathEditor);

    layoutLabelAndField(rightSettings, exportDirectoryLabel, exportDirectoryEditor);
    layoutLabelAndField(rightSettings, engineLabel, engineComboBox);

    auto buttonRow = rightSettings.removeFromTop(controlHeight);
    startWorkerButton.setBounds(buttonRow.removeFromLeft(110));
    buttonRow.removeFromLeft(6);
    stopWorkerButton.setBounds(buttonRow.removeFromLeft(110));
    buttonRow.removeFromLeft(6);
    validateButton.setBounds(buttonRow.removeFromLeft(110));
    buttonRow.removeFromLeft(6);
    inspectButton.setBounds(buttonRow.removeFromLeft(110));
    buttonRow.removeFromLeft(6);
    convertButton.setBounds(buttonRow.removeFromLeft(140));

    area.removeFromTop(sectionGap);

    auto mainPanels = area;
    auto abcArea = mainPanels.removeFromLeft(mainPanels.getWidth() / 2);
    auto outputArea = mainPanels;

    abcInputLabel.setBounds(abcArea.removeFromTop(controlHeight));
    abcArea.removeFromTop(4);
    abcInputEditor.setBounds(abcArea);

    diagnosticsLabel.setBounds(outputArea.removeFromTop(controlHeight));
    outputArea.removeFromTop(4);
    auto diagnosticsBounds = outputArea.removeFromTop(outputArea.getHeight() / 2);
    diagnosticsEditor.setBounds(diagnosticsBounds);
    outputArea.removeFromTop(sectionGap);
    resultLabel.setBounds(outputArea.removeFromTop(controlHeight));
    outputArea.removeFromTop(4);
    resultEditor.setBounds(outputArea);
}

void MainComponent::workerStatusChanged(const juce::String& status, const juce::String& detail)
{
    documentState.setWorkerStatus(status, detail);
    refreshPanels();
    refreshButtonStates();
}

void MainComponent::workerLogAppended(const juce::String& text)
{
    documentState.appendDebugLog(text);
    refreshPanels();
}

void MainComponent::requestStateChanged(bool isBusy, const juce::String&)
{
    requestBusy = isBusy;
    refreshButtonStates();
}

void MainComponent::pingCompleted(const juce::String& resultText)
{
    documentState.setLastConvertText(resultText);
    refreshPanels();
}

void MainComponent::validateCompleted(const llm_midi::protocol::ValidatePayload& payload)
{
    documentState.setLastNormalizedAbc(payload.normalizedAbc);
    documentState.setLastDiagnosticsText(payload.diagnosticsText);
    documentState.setLastInspectText(llm_midi::protocol::toPrettyJson(payload.rawJson));
    refreshPanels();
}

void MainComponent::inspectCompleted(const llm_midi::protocol::InspectPayload& payload)
{
    documentState.setLastNormalizedAbc(payload.normalizedAbc);
    documentState.setLastDiagnosticsText(payload.diagnosticsText);
    documentState.setLastInspectText(payload.scoreSummary + "\n\nRaw response:\n" + llm_midi::protocol::toPrettyJson(payload.rawJson));
    refreshPanels();
}

void MainComponent::convertCompleted(const llm_midi::protocol::ConvertPayload& payload)
{
    documentState.setLastNormalizedAbc(payload.normalizedAbc);
    documentState.setLastDiagnosticsText(payload.diagnosticsText);

    juce::StringArray summaryLines;
    summaryLines.add("Engine used: " + (payload.engineUsed.isNotEmpty() ? payload.engineUsed : "unknown"));

    if (payload.fallbackSummary.isNotEmpty())
    {
        summaryLines.add("Fallback:");
        summaryLines.add(payload.fallbackSummary);
    }

    if (payload.toolStdout.isNotEmpty())
    {
        summaryLines.add("tool stdout:\n" + payload.toolStdout);
    }

    if (payload.toolStderr.isNotEmpty())
    {
        summaryLines.add("tool stderr:\n" + payload.toolStderr);
    }

    if (payload.ok && payload.hasMidiBytes && payload.hasExportPlan)
    {
        juce::File outputFile;
        if (const auto writeResult = writeMidiFile(payload, outputFile); writeResult.wasOk())
        {
            summaryLines.add("Exported MIDI: " + outputFile.getFullPathName());
            summaryLines.add("Suggested file name: " + payload.exportPlan.suggestedFileName);
        }
        else
        {
            summaryLines.add("Export failed: " + writeResult.getErrorMessage());
        }
    }
    else
    {
        summaryLines.add("Convert did not return a writable MIDI payload.");
    }

    documentState.setLastConvertText(summaryLines.joinIntoString("\n\n")
                                     + "\n\nRaw response:\n"
                                     + llm_midi::protocol::toPrettyJson(payload.rawJson));
    refreshPanels();
}

void MainComponent::requestFailed(const juce::String& requestKind,
                                  const juce::String& errorMessage,
                                  const juce::String& rawResponseJson)
{
    documentState.appendDebugLog("[" + requestKind + "] " + errorMessage + "\n");
    documentState.setLastConvertText(rawResponseJson.isNotEmpty() ? rawResponseJson : errorMessage);
    refreshPanels();
}

void MainComponent::configureEditors()
{
    auto configureSingleLineEditor = [this](juce::TextEditor& editor, const juce::String& emptyText)
    {
        addAndMakeVisible(editor);
        editor.setTextToShowWhenEmpty(emptyText, juce::Colours::grey);
        editor.setMultiLine(false);
        editor.setReturnKeyStartsNewLine(false);
    };

    configureSingleLineEditor(nodePathEditor, "node");
    configureSingleLineEditor(workerScriptEditor, "Absolute path to apps/worker/dist/index.js");
    configureSingleLineEditor(abc2midiPathEditor, "Optional abc2midi path");
    configureSingleLineEditor(exportDirectoryEditor, "Export directory");

    addAndMakeVisible(engineComboBox);
    engineComboBox.addItem("abc2midi", 1);
    engineComboBox.addItem("internal", 2);
    engineComboBox.addItem("auto", 3);
    engineComboBox.setSelectedId(3);

    auto configureMultiLineEditor = [this](juce::TextEditor& editor, bool readOnly, const juce::String& emptyText)
    {
        addAndMakeVisible(editor);
        editor.setMultiLine(true);
        editor.setReturnKeyStartsNewLine(true);
        editor.setReadOnly(readOnly);
        editor.setScrollbarsShown(true);
        editor.setTextToShowWhenEmpty(emptyText, juce::Colours::grey);
    };

    configureMultiLineEditor(abcInputEditor, false, "Paste ABC here.");
    configureMultiLineEditor(diagnosticsEditor, true, "Diagnostics, worker status, and stderr output appear here.");
    configureMultiLineEditor(resultEditor, true, "Inspect and convert results appear here.");
}

void MainComponent::configureButtons()
{
    addAndMakeVisible(startWorkerButton);
    addAndMakeVisible(stopWorkerButton);
    addAndMakeVisible(validateButton);
    addAndMakeVisible(inspectButton);
    addAndMakeVisible(convertButton);

    startWorkerButton.onClick = [this]
    {
        syncStateFromUi();

        WorkerSession::LaunchOptions launchOptions;
        launchOptions.nodeExecutablePath = documentState.getSettings().nodeExecutablePath;
        launchOptions.workerScriptPath = documentState.getSettings().workerScriptPath;

        juce::String errorMessage;
        if (!workerSession.start(launchOptions, errorMessage))
        {
            documentState.setWorkerStatus("Start failed", errorMessage);
            refreshPanels();
            refreshButtonStates();
        }
    };

    stopWorkerButton.onClick = [this]
    {
        workerSession.stop();
    };

    validateButton.onClick = [this]
    {
        syncStateFromUi();
        workerSession.validate(documentState.getAbcText());
    };

    inspectButton.onClick = [this]
    {
        syncStateFromUi();
        workerSession.inspect(documentState.getAbcText());
    };

    convertButton.onClick = [this]
    {
        syncStateFromUi();

        WorkerSession::ConvertOptions options;
        options.engineName = documentState.getSettings().engine;
        options.abc2midiPath = documentState.getSettings().abc2midiPath;

        workerSession.convert(documentState.getAbcText(), options);
    };
}

void MainComponent::configureLabels()
{
    auto configureLabel = [this](juce::Label& label, const juce::String& text)
    {
        addAndMakeVisible(label);
        label.setText(text, juce::dontSendNotification);
        label.setJustificationType(juce::Justification::centredLeft);
    };

    configureLabel(statusLabel, "Worker status");
    configureLabel(nodePathLabel, "Node executable");
    configureLabel(workerScriptLabel, "Worker script");
    configureLabel(abc2midiPathLabel, "abc2midi path");
    configureLabel(exportDirectoryLabel, "Export directory");
    configureLabel(engineLabel, "Engine");
    configureLabel(abcInputLabel, "ABC input");
    configureLabel(diagnosticsLabel, "Diagnostics and worker output");
    configureLabel(resultLabel, "Result summary / raw JSON");
}

void MainComponent::populateDefaultPaths()
{
    const auto repoRoot = findRepoRoot();
    DocumentState::Settings settings;

    if (repoRoot.exists())
    {
        settings.workerScriptPath = repoRoot.getChildFile("apps/worker/dist/index.js").getFullPathName();
        settings.exportDirectory = repoRoot.getChildFile("exports").getFullPathName();
        documentState.setAbcText(readFixtureIfAvailable(repoRoot, "tests/fixtures/conversion/melody.abc"));
    }
    else
    {
        const auto cwd = juce::File::getCurrentWorkingDirectory();
        settings.workerScriptPath = cwd.getChildFile("apps/worker/dist/index.js").getFullPathName();
        settings.exportDirectory = cwd.getChildFile("exports").getFullPathName();
    }

    documentState.setSettings(settings);

    nodePathEditor.setText(settings.nodeExecutablePath, juce::dontSendNotification);
    workerScriptEditor.setText(settings.workerScriptPath, juce::dontSendNotification);
    abc2midiPathEditor.setText(settings.abc2midiPath, juce::dontSendNotification);
    exportDirectoryEditor.setText(settings.exportDirectory, juce::dontSendNotification);
    engineComboBox.setSelectedId(3, juce::dontSendNotification);
    abcInputEditor.setText(documentState.getAbcText(), juce::dontSendNotification);
    documentState.setWorkerStatus("Stopped", "Worker not started.");
}

void MainComponent::syncStateFromUi()
{
    DocumentState::Settings settings;
    settings.nodeExecutablePath = nodePathEditor.getText().trim();
    settings.workerScriptPath = workerScriptEditor.getText().trim();
    settings.abc2midiPath = abc2midiPathEditor.getText().trim();
    settings.exportDirectory = exportDirectoryEditor.getText().trim();
    settings.engine = engineComboBox.getText().trim();

    documentState.setSettings(settings);
    documentState.setAbcText(abcInputEditor.getText());
}

void MainComponent::refreshPanels()
{
    statusLabel.setText(documentState.getWorkerStatus() + " | " + documentState.getWorkerDetail(),
                        juce::dontSendNotification);
    diagnosticsEditor.setText(buildDiagnosticsPanelText(), juce::dontSendNotification);
    resultEditor.setText(buildResultPanelText(), juce::dontSendNotification);
}

void MainComponent::refreshButtonStates()
{
    const auto connected = workerSession.isConnected();
    const auto canRun = connected && !requestBusy;

    startWorkerButton.setEnabled(!requestBusy && !connected);
    stopWorkerButton.setEnabled(!requestBusy && (connected || documentState.getWorkerStatus() != "Stopped"));
    validateButton.setEnabled(canRun);
    inspectButton.setEnabled(canRun);
    convertButton.setEnabled(canRun);
}

juce::String MainComponent::buildDiagnosticsPanelText() const
{
    juce::StringArray sections;
    sections.add("Worker status: " + documentState.getWorkerStatus());
    sections.add("Worker detail: " + documentState.getWorkerDetail());

    if (documentState.getLastNormalizedAbc().isNotEmpty())
    {
        sections.add("Normalized ABC:\n" + documentState.getLastNormalizedAbc());
    }

    if (documentState.getLastDiagnosticsText().isNotEmpty())
    {
        sections.add("Diagnostics:\n" + documentState.getLastDiagnosticsText());
    }

    if (documentState.getDebugLog().isNotEmpty())
    {
        sections.add("Worker stderr tail:\n" + documentState.getDebugLog());
    }

    return sections.joinIntoString("\n\n");
}

juce::String MainComponent::buildResultPanelText() const
{
    juce::StringArray sections;

    if (documentState.getLastInspectText().isNotEmpty())
    {
        sections.add("Inspect output:\n" + documentState.getLastInspectText());
    }

    if (documentState.getLastConvertText().isNotEmpty())
    {
        sections.add("Convert output:\n" + documentState.getLastConvertText());
    }

    return sections.isEmpty() ? juce::String("No worker output yet.") : sections.joinIntoString("\n\n");
}

juce::Result MainComponent::writeMidiFile(const llm_midi::protocol::ConvertPayload& payload, juce::File& outputFile) const
{
    const auto exportDirectoryPath = documentState.getSettings().exportDirectory.trim();

    if (exportDirectoryPath.isEmpty())
    {
        return juce::Result::fail("Export directory is empty.");
    }

    if (!payload.hasExportPlan || payload.exportPlan.suggestedFileName.isEmpty())
    {
        return juce::Result::fail("Worker convert response did not include a suggested file name.");
    }

    auto exportDirectory = juce::File(exportDirectoryPath);
    if (!exportDirectory.exists())
    {
        const auto createResult = exportDirectory.createDirectory();
        if (createResult.failed())
        {
            return juce::Result::fail("Unable to create export directory: "
                                      + exportDirectory.getFullPathName()
                                      + " | "
                                      + createResult.getErrorMessage());
        }
    }

    outputFile = exportDirectory.getChildFile(payload.exportPlan.suggestedFileName);

    if (!outputFile.replaceWithData(payload.midiBytes.getData(), payload.midiBytes.getSize()))
    {
        return juce::Result::fail("Failed to write MIDI file: " + outputFile.getFullPathName());
    }

    return juce::Result::ok();
}

juce::File MainComponent::findRepoRoot()
{
    auto candidate = juce::File::getCurrentWorkingDirectory();

    for (int depth = 0; depth < 8; ++depth)
    {
        if (candidate.getChildFile("package.json").existsAsFile()
            && candidate.getChildFile("apps/worker").isDirectory())
        {
            return candidate;
        }

        candidate = candidate.getParentDirectory();
    }

    candidate = juce::File::getSpecialLocation(juce::File::currentExecutableFile).getParentDirectory();

    for (int depth = 0; depth < 10; ++depth)
    {
        if (candidate.getChildFile("package.json").existsAsFile()
            && candidate.getChildFile("apps/worker").isDirectory())
        {
            return candidate;
        }

        candidate = candidate.getParentDirectory();
    }

    return {};
}

juce::String MainComponent::readFixtureIfAvailable(const juce::File& repoRoot, const juce::String& relativePath)
{
    const auto fixtureFile = repoRoot.getChildFile(relativePath);
    return fixtureFile.existsAsFile() ? fixtureFile.loadFileAsString() : juce::String();
}
