#include "Protocol/WorkerProtocolJson.h"

#include "Util/Base64.h"
#include "Util/JsonHelpers.h"

namespace
{
constexpr const char* protocolVersion = "v1";

juce::var makeBaseRequest(const juce::String& requestId, const juce::String& kind)
{
    auto* object = new juce::DynamicObject();
    object->setProperty("id", requestId);
    object->setProperty("protocolVersion", protocolVersion);
    object->setProperty("kind", kind);
    return juce::var(object);
}

juce::Result ensureSuccessResponse(const llm_midi::protocol::ParsedResponse& parsedResponse)
{
    if (!parsedResponse.ok)
    {
        return juce::Result::fail(llm_midi::protocol::buildResponseErrorText(parsedResponse));
    }

    return juce::Result::ok();
}

juce::String getOptionalString(const juce::var& value, const juce::Identifier& propertyName)
{
    return llm_midi::json::getString(value, propertyName);
}
}

namespace llm_midi::protocol
{
juce::String createRequestId()
{
    return juce::Uuid().toString();
}

juce::String buildPingRequest(const juce::String& requestId)
{
    return llm_midi::json::toSingleLineJson(makeBaseRequest(requestId, "ping"));
}

juce::String buildValidateRequest(const juce::String& requestId, const juce::String& abcText)
{
    auto request = makeBaseRequest(requestId, "validate");
    request.getDynamicObject()->setProperty("abcText", abcText);
    return llm_midi::json::toSingleLineJson(request);
}

juce::String buildInspectRequest(const juce::String& requestId, const juce::String& abcText)
{
    auto request = makeBaseRequest(requestId, "inspect");
    request.getDynamicObject()->setProperty("abcText", abcText);
    return llm_midi::json::toSingleLineJson(request);
}

juce::String buildConvertRequest(const juce::String& requestId,
                                 const juce::String& abcText,
                                 const juce::String& engineName,
                                 const juce::String& abc2midiPath)
{
    auto request = makeBaseRequest(requestId, "convert");
    auto* object = request.getDynamicObject();
    object->setProperty("abcText", abcText);
    object->setProperty("engine", engineName);
    object->setProperty("includeMidiBase64", true);

    if (abc2midiPath.isNotEmpty())
    {
        object->setProperty("abc2midiPath", abc2midiPath);
    }

    return llm_midi::json::toSingleLineJson(request);
}

juce::String buildShutdownRequest(const juce::String& requestId)
{
    return llm_midi::json::toSingleLineJson(makeBaseRequest(requestId, "shutdown"));
}

juce::Result parseReadyLine(const juce::String& line, juce::String& endpointPath)
{
    juce::String errorMessage;
    const auto parsed = llm_midi::json::parseJson(line, errorMessage);

    if (errorMessage.isNotEmpty())
    {
        return juce::Result::fail("Worker ready line was not valid JSON.");
    }

    if (llm_midi::json::getString(parsed, "kind") != "ready"
        || llm_midi::json::getString(parsed, "protocolVersion") != protocolVersion
        || llm_midi::json::getString(parsed, "transport") != "pipe")
    {
        return juce::Result::fail("Worker ready line did not match the expected pipe ready event.");
    }

    const auto endpoint = llm_midi::json::getProperty(parsed, "endpoint");
    endpointPath = llm_midi::json::getString(endpoint, "path");

    if (endpointPath.isEmpty())
    {
        return juce::Result::fail("Worker ready line did not include a pipe endpoint path.");
    }

    return juce::Result::ok();
}

juce::Result parseResponseLine(const juce::String& line, ParsedResponse& parsedResponse)
{
    juce::String errorMessage;
    parsedResponse = {};
    parsedResponse.rawJson = llm_midi::json::parseJson(line, errorMessage);

    if (errorMessage.isNotEmpty())
    {
        return juce::Result::fail("Worker response was not valid JSON.");
    }

    parsedResponse.id = llm_midi::json::getString(parsedResponse.rawJson, "id");
    parsedResponse.kind = llm_midi::json::getString(parsedResponse.rawJson, "kind");
    parsedResponse.ok = llm_midi::json::getBool(parsedResponse.rawJson, "ok", false);

    if (llm_midi::json::getString(parsedResponse.rawJson, "protocolVersion") != protocolVersion)
    {
        return juce::Result::fail("Worker response used an unexpected protocol version.");
    }

    if (parsedResponse.id.isEmpty() || parsedResponse.kind.isEmpty())
    {
        return juce::Result::fail("Worker response was missing required id or kind fields.");
    }

    if (parsedResponse.ok)
    {
        parsedResponse.payload = llm_midi::json::getProperty(parsedResponse.rawJson, "result");
    }
    else
    {
        const auto errorObject = llm_midi::json::getProperty(parsedResponse.rawJson, "error");
        parsedResponse.errorCode = llm_midi::json::getString(errorObject, "code");
        parsedResponse.errorMessage = llm_midi::json::getString(errorObject, "message");
    }

    parsedResponse.diagnosticsText = formatDiagnostics(parsedResponse.ok
        ? llm_midi::json::getProperty(parsedResponse.payload, "diagnostics")
        : llm_midi::json::getProperty(parsedResponse.rawJson, "diagnostics"));

    return juce::Result::ok();
}

juce::Result parseValidatePayload(const ParsedResponse& parsedResponse, ValidatePayload& payload)
{
    payload = {};
    payload.rawJson = parsedResponse.rawJson;

    if (const auto result = ensureSuccessResponse(parsedResponse); result.failed())
    {
        return result;
    }

    payload.ok = llm_midi::json::getBool(parsedResponse.payload, "ok", false);
    payload.normalizedAbc = llm_midi::json::getString(parsedResponse.payload, "normalizedAbc");
    payload.diagnosticsText = formatDiagnostics(llm_midi::json::getProperty(parsedResponse.payload, "diagnostics"));
    return juce::Result::ok();
}

juce::Result parseInspectPayload(const ParsedResponse& parsedResponse, InspectPayload& payload)
{
    payload = {};
    payload.rawJson = parsedResponse.rawJson;

    if (const auto result = ensureSuccessResponse(parsedResponse); result.failed())
    {
        return result;
    }

    payload.ok = llm_midi::json::getBool(parsedResponse.payload, "ok", false);
    payload.normalizedAbc = llm_midi::json::getString(parsedResponse.payload, "normalizedAbc");
    payload.diagnosticsText = formatDiagnostics(llm_midi::json::getProperty(parsedResponse.payload, "diagnostics"));

    const auto score = llm_midi::json::getProperty(parsedResponse.payload, "score");
    payload.scoreSummary = score.isVoid() ? juce::String("No canonical score returned.") : toPrettyJson(score);
    return juce::Result::ok();
}

juce::Result parseConvertPayload(const ParsedResponse& parsedResponse, ConvertPayload& payload)
{
    payload = {};
    payload.rawJson = parsedResponse.rawJson;

    if (const auto result = ensureSuccessResponse(parsedResponse); result.failed())
    {
        return result;
    }

    payload.ok = llm_midi::json::getBool(parsedResponse.payload, "ok", false);
    payload.normalizedAbc = llm_midi::json::getString(parsedResponse.payload, "normalizedAbc");
    payload.diagnosticsText = formatDiagnostics(llm_midi::json::getProperty(parsedResponse.payload, "diagnostics"));
    payload.toolStdout = getOptionalString(parsedResponse.payload, "toolStdout");
    payload.toolStderr = getOptionalString(parsedResponse.payload, "toolStderr");
    payload.engineUsed = getOptionalString(parsedResponse.payload, "engineUsed");

    const auto fallback = llm_midi::json::getProperty(parsedResponse.payload, "fallback");
    if (!fallback.isVoid())
    {
        payload.fallbackSummary = llm_midi::json::toPrettyJson(fallback);
    }

    const auto exportPlanVar = llm_midi::json::getProperty(parsedResponse.payload, "exportPlan");
    if (!exportPlanVar.isVoid())
    {
        payload.exportPlan.title = getOptionalString(exportPlanVar, "title");
        payload.exportPlan.slug = getOptionalString(exportPlanVar, "slug");
        payload.exportPlan.contentHash = getOptionalString(exportPlanVar, "contentHash");
        payload.exportPlan.suggestedFileName = getOptionalString(exportPlanVar, "suggestedFileName");
        payload.hasExportPlan = payload.exportPlan.suggestedFileName.isNotEmpty();
    }

    const auto midiBase64 = getOptionalString(parsedResponse.payload, "midiBase64");
    if (midiBase64.isNotEmpty())
    {
        juce::String decodeError;
        if (!llm_midi::util::decodeBase64(midiBase64, payload.midiBytes, decodeError))
        {
            return juce::Result::fail(decodeError);
        }

        payload.hasMidiBytes = payload.midiBytes.getSize() > 0;
    }

    return juce::Result::ok();
}

juce::String buildResponseErrorText(const ParsedResponse& parsedResponse)
{
    juce::StringArray pieces;
    pieces.add(parsedResponse.kind.isNotEmpty() ? parsedResponse.kind : "request");

    if (parsedResponse.errorCode.isNotEmpty())
    {
        pieces.add(parsedResponse.errorCode);
    }

    if (parsedResponse.errorMessage.isNotEmpty())
    {
        pieces.add(parsedResponse.errorMessage);
    }

    if (parsedResponse.diagnosticsText.isNotEmpty())
    {
        pieces.add(parsedResponse.diagnosticsText);
    }

    return pieces.joinIntoString(": ");
}

juce::String formatDiagnostics(const juce::var& diagnosticsVar)
{
    if (diagnosticsVar.isVoid())
    {
        return "No diagnostics.";
    }

    if (!diagnosticsVar.isArray())
    {
        return llm_midi::json::toPrettyJson(diagnosticsVar);
    }

    const auto* array = diagnosticsVar.getArray();
    if (array == nullptr || array->isEmpty())
    {
        return "No diagnostics.";
    }

    juce::StringArray lines;

    for (const auto& entry : *array)
    {
        const auto severity = getOptionalString(entry, "severity");
        const auto code = getOptionalString(entry, "code");
        const auto message = getOptionalString(entry, "message");
        const auto blocked = llm_midi::json::getBool(entry, "blocked", false);

        juce::StringArray lineParts;
        lineParts.add(severity.isNotEmpty() ? severity.toUpperCase() : "INFO");

        if (code.isNotEmpty())
        {
            lineParts.add(code);
        }

        if (blocked)
        {
            lineParts.add("blocked");
        }

        const auto prefix = lineParts.joinIntoString(" | ");
        lines.add(prefix.isNotEmpty() ? prefix + " | " + message : message);
    }

    return lines.joinIntoString("\n");
}

juce::String toPrettyJson(const juce::var& value)
{
    return llm_midi::json::toPrettyJson(value);
}
}
