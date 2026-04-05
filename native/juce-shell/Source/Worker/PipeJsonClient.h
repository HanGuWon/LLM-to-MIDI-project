#pragma once

#include <JuceHeader.h>

#include <atomic>
#include <memory>
#include <string>
#include <unordered_map>

class PipeJsonClient final : private juce::Thread
{
public:
    class Listener
    {
    public:
        virtual ~Listener() = default;
        virtual void pipeClientDisconnected(const juce::String& reason) = 0;
    };

    explicit PipeJsonClient(Listener& listenerToUse);
    ~PipeJsonClient() override;

    bool connectToPipe(const juce::String& endpointPath, juce::String& errorMessage);
    void disconnect();
    bool isConnected() const noexcept;

    bool transact(const juce::String& requestId,
                  const juce::String& ndjsonLine,
                  int timeoutMs,
                  juce::String& responseLine,
                  juce::String& errorMessage);

private:
    struct PendingResponse
    {
        juce::WaitableEvent completionEvent;
        juce::String responseLine;
        juce::String errorMessage;
    };

    void run() override;
    void handleIncomingChunk(const char* data, int numBytes);
    void handleIncomingLine(const juce::String& line);
    void failAllPending(const juce::String& errorMessage);

    Listener& listener;
    juce::NamedPipe namedPipe;
    juce::CriticalSection pipeLock;
    juce::String incomingBuffer;
    std::unordered_map<std::string, std::shared_ptr<PendingResponse>> pendingResponses;
    juce::CriticalSection pendingLock;
    std::atomic<bool> connected { false };
};
