#include "Worker/WorkerSession.h"

#include "Util/JsonHelpers.h"

WorkerSession::WorkerSession()
    : processController(*this),
      pipeClient(*this)
{
}

WorkerSession::~WorkerSession()
{
    setListener(nullptr);
    pipeClient.disconnect();
    processController.terminateNow();

    if (connectThread.joinable())
    {
        connectThread.join();
    }

    if (requestThread.joinable())
    {
        requestThread.join();
    }
}

void WorkerSession::setListener(Listener* newListener)
{
    const juce::ScopedLock lock(listenerLock);
    listener = newListener;
}

bool WorkerSession::start(const LaunchOptions& launchOptions, juce::String& errorMessage)
{
    if (startPending.exchange(true))
    {
        errorMessage = "Worker start is already in progress.";
        return false;
    }

    if (connectThread.joinable())
    {
        connectThread.join();
    }

    pipeClient.disconnect();
    connected.store(false);

    const auto started = processController.startProcess(launchOptions.nodeExecutablePath,
                                                        launchOptions.workerScriptPath,
                                                        errorMessage);

    if (!started)
    {
        startPending.store(false);
        return false;
    }

    return true;
}

void WorkerSession::stop()
{
    shutdown();
}

bool WorkerSession::isConnected() const noexcept
{
    return connected.load();
}

bool WorkerSession::isBusy() const noexcept
{
    return requestInFlight.load();
}

void WorkerSession::ping()
{
    const auto requestId = llm_midi::protocol::createRequestId();
    runRequest("ping",
               llm_midi::protocol::buildPingRequest(requestId),
               [this](const llm_midi::protocol::ParsedResponse& parsedResponse)
               {
                   if (!parsedResponse.ok)
                   {
                       return juce::Result::fail(llm_midi::protocol::buildResponseErrorText(parsedResponse));
                   }

                   postToListener([](Listener& target) { target.pingCompleted("Ping ok."); });
                   return juce::Result::ok();
               });
}

void WorkerSession::validate(const juce::String& abcText)
{
    const auto requestId = llm_midi::protocol::createRequestId();
    runRequest("validate",
               llm_midi::protocol::buildValidateRequest(requestId, abcText),
               [this](const llm_midi::protocol::ParsedResponse& parsedResponse)
               {
                   llm_midi::protocol::ValidatePayload payload;
                   if (const auto result = llm_midi::protocol::parseValidatePayload(parsedResponse, payload); result.failed())
                   {
                       return result;
                   }

                   postToListener([payload](Listener& target) { target.validateCompleted(payload); });
                   return juce::Result::ok();
               });
}

void WorkerSession::inspect(const juce::String& abcText)
{
    const auto requestId = llm_midi::protocol::createRequestId();
    runRequest("inspect",
               llm_midi::protocol::buildInspectRequest(requestId, abcText),
               [this](const llm_midi::protocol::ParsedResponse& parsedResponse)
               {
                   llm_midi::protocol::InspectPayload payload;
                   if (const auto result = llm_midi::protocol::parseInspectPayload(parsedResponse, payload); result.failed())
                   {
                       return result;
                   }

                   postToListener([payload](Listener& target) { target.inspectCompleted(payload); });
                   return juce::Result::ok();
               });
}

void WorkerSession::convert(const juce::String& abcText, const ConvertOptions& options)
{
    const auto requestId = llm_midi::protocol::createRequestId();
    runRequest("convert",
               llm_midi::protocol::buildConvertRequest(requestId,
                                                      abcText,
                                                      options.engineName,
                                                      options.abc2midiPath),
               [this](const llm_midi::protocol::ParsedResponse& parsedResponse)
               {
                   llm_midi::protocol::ConvertPayload payload;
                   if (const auto result = llm_midi::protocol::parseConvertPayload(parsedResponse, payload); result.failed())
                   {
                       return result;
                   }

                   postToListener([payload](Listener& target) { target.convertCompleted(payload); });
                   return juce::Result::ok();
               });
}

void WorkerSession::shutdown()
{
    if (!connected.load())
    {
        processController.terminateNow();
        return;
    }

    const auto requestId = llm_midi::protocol::createRequestId();
    runRequest("shutdown",
               llm_midi::protocol::buildShutdownRequest(requestId),
               [this](const llm_midi::protocol::ParsedResponse& parsedResponse)
               {
                   if (!parsedResponse.ok)
                   {
                       return juce::Result::fail(llm_midi::protocol::buildResponseErrorText(parsedResponse));
                   }

                   postToListener([](Listener& target)
                   {
                       target.workerStatusChanged("Shutting down", "Worker acknowledged shutdown.");
                   });

                   return juce::Result::ok();
               });
}

void WorkerSession::postToListener(std::function<void(Listener&)> callback)
{
    Listener* currentListener = nullptr;

    {
        const juce::ScopedLock lock(listenerLock);
        currentListener = listener;
    }

    if (currentListener == nullptr)
    {
        return;
    }

    juce::MessageManager::callAsync([this, callback = std::move(callback)]() mutable
    {
        const juce::ScopedLock lock(listenerLock);
        if (listener != nullptr)
        {
            callback(*listener);
        }
    });
}

void WorkerSession::runRequest(const juce::String& requestKind,
                               const juce::String& requestLine,
                               const ParsedResponseHandler& responseHandler)
{
    if (!connected.load() && requestKind != "shutdown")
    {
        failRequest(requestKind, "Worker is not connected.", {});
        return;
    }

    if (requestInFlight.exchange(true))
    {
        failRequest(requestKind, "A worker request is already in flight.", {});
        return;
    }

    if (requestThread.joinable())
    {
        requestThread.join();
    }

    postToListener([requestKind](Listener& target) { target.requestStateChanged(true, requestKind); });

    requestThread = std::thread([this, requestKind, requestLine, responseHandler]()
    {
        juce::String parseError;
        const auto requestJson = llm_midi::json::parseJson(requestLine, parseError);
        const auto requestId = llm_midi::json::getString(requestJson, "id");

        if (requestId.isEmpty())
        {
            failRequest(requestKind, "Request JSON did not include an id.", {});
            finishRequest(requestKind);
            return;
        }

        juce::String responseLine;
        juce::String transportError;

        if (!pipeClient.transact(requestId, requestLine, 15000, responseLine, transportError))
        {
            failRequest(requestKind, transportError, {});
            finishRequest(requestKind);
            return;
        }

        llm_midi::protocol::ParsedResponse parsedResponse;
        if (const auto parseResult = llm_midi::protocol::parseResponseLine(responseLine, parsedResponse); parseResult.failed())
        {
            failRequest(requestKind, parseResult.getErrorMessage(), responseLine);
            finishRequest(requestKind);
            return;
        }

        if (const auto handlerResult = responseHandler(parsedResponse); handlerResult.failed())
        {
            failRequest(requestKind,
                        handlerResult.getErrorMessage(),
                        llm_midi::protocol::toPrettyJson(parsedResponse.rawJson));
        }

        finishRequest(requestKind);
    });
}

void WorkerSession::finishRequest(const juce::String& requestKind)
{
    requestInFlight.store(false);
    postToListener([requestKind](Listener& target) { target.requestStateChanged(false, requestKind); });
}

void WorkerSession::failRequest(const juce::String& requestKind,
                                const juce::String& errorMessage,
                                const juce::String& rawResponseJson)
{
    postToListener([requestKind, errorMessage, rawResponseJson](Listener& target)
    {
        target.requestFailed(requestKind, errorMessage, rawResponseJson);
    });
}

void WorkerSession::workerProcessStatusChanged(const juce::String& status, const juce::String& detail)
{
    postToListener([status, detail](Listener& target) { target.workerStatusChanged(status, detail); });
}

void WorkerSession::workerProcessReady(const juce::String& endpointPath)
{
    if (connectThread.joinable())
    {
        connectThread.join();
    }

    connectThread = std::thread([this, endpointPath]()
    {
        juce::String errorMessage;

        if (!pipeClient.connectToPipe(endpointPath, errorMessage))
        {
            connected.store(false);
            startPending.store(false);
            failRequest("start", errorMessage, {});
            processController.terminateNow();
            return;
        }

        connected.store(true);
        startPending.store(false);
        postToListener([endpointPath](Listener& target)
        {
            target.workerStatusChanged("Connected", "Pipe connected: " + endpointPath);
        });
    });
}

void WorkerSession::workerProcessLogReceived(const juce::String& text)
{
    postToListener([text](Listener& target) { target.workerLogAppended(text); });
}

void WorkerSession::workerProcessExited(int exitCode, const juce::String& reason)
{
    connected.store(false);
    startPending.store(false);
    pipeClient.disconnect();
    postToListener([exitCode, reason](Listener& target)
    {
        target.workerStatusChanged("Stopped", reason + " Exit code: " + juce::String(exitCode));
    });
}

void WorkerSession::pipeClientDisconnected(const juce::String& reason)
{
    connected.store(false);
    postToListener([reason](Listener& target)
    {
        target.workerStatusChanged("Disconnected", reason);
    });
}
