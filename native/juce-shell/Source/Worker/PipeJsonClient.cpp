#include "Worker/PipeJsonClient.h"

#include <cstring>

#include "Util/JsonHelpers.h"

PipeJsonClient::PipeJsonClient(Listener& listenerToUse)
    : juce::Thread("PipeJsonClient"),
      listener(listenerToUse)
{
}

PipeJsonClient::~PipeJsonClient()
{
    disconnect();
}

bool PipeJsonClient::connectToPipe(const juce::String& endpointPath, juce::String& errorMessage)
{
    disconnect();

    const juce::ScopedLock lock(pipeLock);
    if (!namedPipe.openExisting(endpointPath))
    {
        errorMessage = "Failed to connect to pipe endpoint: " + endpointPath;
        return false;
    }

    incomingBuffer.clear();
    connected.store(true);
    startThread();
    errorMessage.clear();
    return true;
}

void PipeJsonClient::disconnect()
{
    connected.store(false);
    signalThreadShouldExit();

    {
        const juce::ScopedLock lock(pipeLock);
        if (namedPipe.isOpen())
        {
            namedPipe.close();
        }
    }

    stopThread(1500);
    failAllPending("Pipe client disconnected.");
}

bool PipeJsonClient::isConnected() const noexcept
{
    return connected.load();
}

bool PipeJsonClient::transact(const juce::String& requestId,
                              const juce::String& ndjsonLine,
                              int timeoutMs,
                              juce::String& responseLine,
                              juce::String& errorMessage)
{
    if (!connected.load())
    {
        errorMessage = "Pipe client is not connected.";
        return false;
    }

    auto pending = std::make_shared<PendingResponse>();

    {
        const juce::ScopedLock lock(pendingLock);
        pendingResponses[requestId.toStdString()] = pending;
    }

    auto lineToSend = ndjsonLine;
    if (!lineToSend.endsWithChar('\n'))
    {
        lineToSend << '\n';
    }

    {
        const juce::ScopedLock lock(pipeLock);
        const auto bytesToWrite = lineToSend.toRawUTF8();
        const auto bytesWritten = namedPipe.write(bytesToWrite,
                                                  static_cast<int>(std::strlen(bytesToWrite)),
                                                  timeoutMs);

        if (bytesWritten <= 0)
        {
            const juce::ScopedLock pendingStateLock(pendingLock);
            pendingResponses.erase(requestId.toStdString());
            errorMessage = "Failed to write request to pipe.";
            return false;
        }
    }

    if (!pending->completionEvent.wait(timeoutMs))
    {
        const juce::ScopedLock lock(pendingLock);
        pendingResponses.erase(requestId.toStdString());
        errorMessage = "Timed out waiting for worker response.";
        return false;
    }

    if (pending->errorMessage.isNotEmpty())
    {
        errorMessage = pending->errorMessage;
        return false;
    }

    responseLine = pending->responseLine;
    errorMessage.clear();
    return true;
}

void PipeJsonClient::run()
{
    char buffer[1024];

    while (!threadShouldExit())
    {
        const int bytesRead = namedPipe.read(buffer, static_cast<int>(sizeof(buffer)), 100);

        if (bytesRead > 0)
        {
            handleIncomingChunk(buffer, bytesRead);
            continue;
        }

        if (bytesRead < 0)
        {
            connected.store(false);
            failAllPending("Pipe read failed or the worker disconnected.");
            listener.pipeClientDisconnected("Pipe read failed or the worker disconnected.");
            return;
        }
    }
}

void PipeJsonClient::handleIncomingChunk(const char* data, int numBytes)
{
    incomingBuffer += juce::String::fromUTF8(data, numBytes);

    for (;;)
    {
        const auto newlineIndex = incomingBuffer.indexOfChar('\n');

        if (newlineIndex < 0)
        {
            break;
        }

        auto line = incomingBuffer.substring(0, newlineIndex);
        incomingBuffer = incomingBuffer.substring(newlineIndex + 1);
        line = line.trimEnd();

        if (line.isNotEmpty())
        {
            handleIncomingLine(line);
        }
    }
}

void PipeJsonClient::handleIncomingLine(const juce::String& line)
{
    juce::String parseError;
    const auto parsed = llm_midi::json::parseJson(line, parseError);

    if (parseError.isNotEmpty())
    {
        return;
    }

    const auto requestId = llm_midi::json::getString(parsed, "id");
    if (requestId.isEmpty())
    {
        return;
    }

    std::shared_ptr<PendingResponse> pending;

    {
        const juce::ScopedLock lock(pendingLock);
        const auto found = pendingResponses.find(requestId.toStdString());

        if (found == pendingResponses.end())
        {
            return;
        }

        pending = found->second;
        pendingResponses.erase(found);
    }

    pending->responseLine = line;
    pending->completionEvent.signal();
}

void PipeJsonClient::failAllPending(const juce::String& errorMessage)
{
    std::unordered_map<std::string, std::shared_ptr<PendingResponse>> pendingToFail;

    {
        const juce::ScopedLock lock(pendingLock);
        pendingToFail.swap(pendingResponses);
    }

    for (auto& entry : pendingToFail)
    {
        entry.second->errorMessage = errorMessage;
        entry.second->completionEvent.signal();
    }
}
