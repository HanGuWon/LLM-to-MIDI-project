#pragma once

#include <JuceHeader.h>

#include <atomic>
#include <functional>
#include <thread>

#include "Protocol/WorkerProtocolJson.h"
#include "Worker/PipeJsonClient.h"
#include "Worker/WorkerProcessController.h"

class WorkerSession final : private WorkerProcessController::Listener,
                            private PipeJsonClient::Listener
{
public:
    struct LaunchOptions
    {
        juce::String nodeExecutablePath;
        juce::String workerScriptPath;
    };

    struct ConvertOptions
    {
        juce::String engineName;
        juce::String abc2midiPath;
    };

    class Listener
    {
    public:
        virtual ~Listener() = default;
        virtual void workerStatusChanged(const juce::String& status, const juce::String& detail) = 0;
        virtual void workerLogAppended(const juce::String& text) = 0;
        virtual void requestStateChanged(bool isBusy, const juce::String& requestKind) = 0;
        virtual void pingCompleted(const juce::String& resultText) = 0;
        virtual void validateCompleted(const llm_midi::protocol::ValidatePayload& payload) = 0;
        virtual void inspectCompleted(const llm_midi::protocol::InspectPayload& payload) = 0;
        virtual void convertCompleted(const llm_midi::protocol::ConvertPayload& payload) = 0;
        virtual void requestFailed(const juce::String& requestKind,
                                   const juce::String& errorMessage,
                                   const juce::String& rawResponseJson) = 0;
    };

    WorkerSession();
    ~WorkerSession() override;

    void setListener(Listener* newListener);

    bool start(const LaunchOptions& launchOptions, juce::String& errorMessage);
    void stop();

    bool isConnected() const noexcept;
    bool isBusy() const noexcept;

    void ping();
    void validate(const juce::String& abcText);
    void inspect(const juce::String& abcText);
    void convert(const juce::String& abcText, const ConvertOptions& options);
    void shutdown();

private:
    using ParsedResponseHandler = std::function<juce::Result(const llm_midi::protocol::ParsedResponse&)>;

    void postToListener(std::function<void(Listener&)> callback);
    void runRequest(const juce::String& requestKind,
                    const juce::String& requestLine,
                    const ParsedResponseHandler& responseHandler);
    void finishRequest(const juce::String& requestKind);
    void failRequest(const juce::String& requestKind,
                     const juce::String& errorMessage,
                     const juce::String& rawResponseJson);

    void workerProcessStatusChanged(const juce::String& status, const juce::String& detail) override;
    void workerProcessReady(const juce::String& endpointPath) override;
    void workerProcessLogReceived(const juce::String& text) override;
    void workerProcessExited(int exitCode, const juce::String& reason) override;
    void pipeClientDisconnected(const juce::String& reason) override;

    juce::CriticalSection listenerLock;
    Listener* listener = nullptr;

    WorkerProcessController processController;
    PipeJsonClient pipeClient;

    std::atomic<bool> connected { false };
    std::atomic<bool> requestInFlight { false };
    std::atomic<bool> startPending { false };
    std::thread connectThread;
    std::thread requestThread;
};
