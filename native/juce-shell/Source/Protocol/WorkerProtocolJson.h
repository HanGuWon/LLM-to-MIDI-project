#pragma once

#include <JuceHeader.h>

namespace llm_midi::protocol
{
struct ParsedResponse
{
    juce::String id;
    juce::String kind;
    bool ok = false;
    juce::String errorCode;
    juce::String errorMessage;
    juce::String diagnosticsText;
    juce::var rawJson;
    juce::var payload;
};

struct ExportPlan
{
    juce::String title;
    juce::String slug;
    juce::String contentHash;
    juce::String suggestedFileName;
};

struct ValidatePayload
{
    bool ok = false;
    juce::String normalizedAbc;
    juce::String diagnosticsText;
    juce::var rawJson;
};

struct InspectPayload
{
    bool ok = false;
    juce::String normalizedAbc;
    juce::String diagnosticsText;
    juce::String scoreSummary;
    juce::var rawJson;
};

struct ConvertPayload
{
    bool ok = false;
    juce::String normalizedAbc;
    juce::String diagnosticsText;
    juce::String toolStdout;
    juce::String toolStderr;
    juce::String engineUsed;
    juce::String fallbackSummary;
    bool hasExportPlan = false;
    ExportPlan exportPlan;
    bool hasMidiBytes = false;
    juce::MemoryBlock midiBytes;
    juce::var rawJson;
};

juce::String createRequestId();
juce::String buildPingRequest(const juce::String& requestId);
juce::String buildValidateRequest(const juce::String& requestId, const juce::String& abcText);
juce::String buildInspectRequest(const juce::String& requestId, const juce::String& abcText);
juce::String buildConvertRequest(const juce::String& requestId,
                                 const juce::String& abcText,
                                 const juce::String& engineName,
                                 const juce::String& abc2midiPath);
juce::String buildShutdownRequest(const juce::String& requestId);

juce::Result parseReadyLine(const juce::String& line, juce::String& endpointPath);
juce::Result parseResponseLine(const juce::String& line, ParsedResponse& parsedResponse);
juce::Result parseValidatePayload(const ParsedResponse& parsedResponse, ValidatePayload& payload);
juce::Result parseInspectPayload(const ParsedResponse& parsedResponse, InspectPayload& payload);
juce::Result parseConvertPayload(const ParsedResponse& parsedResponse, ConvertPayload& payload);
juce::String buildResponseErrorText(const ParsedResponse& parsedResponse);
juce::String formatDiagnostics(const juce::var& diagnosticsVar);
juce::String toPrettyJson(const juce::var& value);
}
