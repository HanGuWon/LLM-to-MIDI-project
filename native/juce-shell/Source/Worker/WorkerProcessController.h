#pragma once

#include <JuceHeader.h>

class WorkerProcessController final : private juce::Thread
{
public:
    class Listener
    {
    public:
        virtual ~Listener() = default;
        virtual void workerProcessStatusChanged(const juce::String& status, const juce::String& detail) = 0;
        virtual void workerProcessReady(const juce::String& endpointPath) = 0;
        virtual void workerProcessLogReceived(const juce::String& text) = 0;
        virtual void workerProcessExited(int exitCode, const juce::String& reason) = 0;
    };

    explicit WorkerProcessController(Listener& listenerToUse);
    ~WorkerProcessController() override;

    bool startProcess(const juce::String& nodeExecutablePath,
                      const juce::String& workerScriptPath,
                      juce::String& errorMessage);
    void terminateNow();
    bool isRunning() const;

private:
    void run() override;
    void handleOutputChunk(const char* data, int numBytes);
    void handleOutputLine(const juce::String& line);

    Listener& listener;
    mutable juce::CriticalSection processLock;
    juce::ChildProcess childProcess;
    juce::String outputBuffer;
    bool readySeen = false;
    bool terminateRequested = false;
};
