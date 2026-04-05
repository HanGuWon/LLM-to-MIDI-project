#include "Worker/WorkerProcessController.h"

#include "Protocol/WorkerProtocolJson.h"

WorkerProcessController::WorkerProcessController(Listener& listenerToUse)
    : juce::Thread("WorkerProcessController"),
      listener(listenerToUse)
{
}

WorkerProcessController::~WorkerProcessController()
{
    terminateNow();
}

bool WorkerProcessController::startProcess(const juce::String& nodeExecutablePath,
                                          const juce::String& workerScriptPath,
                                          juce::String& errorMessage)
{
    const juce::File workerScript(workerScriptPath);
    if (!workerScript.existsAsFile())
    {
        errorMessage = "Worker script path does not exist: " + workerScriptPath;
        return false;
    }

    const juce::ScopedLock lock(processLock);

    if (childProcess.isRunning())
    {
        errorMessage = "Worker process is already running.";
        return false;
    }

    stopThread(1500);
    outputBuffer.clear();
    readySeen = false;
    terminateRequested = false;

    listener.workerProcessStatusChanged("Starting", "Launching Node worker in pipe mode.");

    juce::StringArray arguments;
    arguments.add(nodeExecutablePath);
    arguments.add(workerScript.getFullPathName());
    arguments.add("--transport");
    arguments.add("pipe");

    if (!childProcess.start(arguments, juce::ChildProcess::wantStdOut | juce::ChildProcess::wantStdErr))
    {
        errorMessage = "Failed to launch worker process.";
        listener.workerProcessStatusChanged("Start failed", errorMessage);
        return false;
    }

    listener.workerProcessStatusChanged("Waiting for ready", "Waiting for the worker ready line on stdout.");
    startThread();
    return true;
}

void WorkerProcessController::terminateNow()
{
    {
        const juce::ScopedLock lock(processLock);
        terminateRequested = true;

        if (childProcess.isRunning())
        {
            childProcess.kill();
        }
    }

    stopThread(1500);
}

bool WorkerProcessController::isRunning() const
{
    const juce::ScopedLock lock(processLock);
    return childProcess.isRunning();
}

void WorkerProcessController::run()
{
    char buffer[512];

    for (;;)
    {
        const int bytesRead = childProcess.readProcessOutput(buffer, static_cast<int>(sizeof(buffer)));

        if (bytesRead > 0)
        {
            handleOutputChunk(buffer, bytesRead);
            continue;
        }

        if (!childProcess.isRunning())
        {
            break;
        }

        wait(25);
    }

    if (outputBuffer.isNotEmpty())
    {
        handleOutputLine(outputBuffer.trimEnd());
        outputBuffer.clear();
    }

    const auto exitCode = static_cast<int>(childProcess.getExitCode());
    const auto reason = terminateRequested ? "Worker terminated." : "Worker exited or disconnected.";
    listener.workerProcessExited(exitCode, reason);
}

void WorkerProcessController::handleOutputChunk(const char* data, int numBytes)
{
    outputBuffer += juce::String::fromUTF8(data, numBytes);

    for (;;)
    {
        const auto newlineIndex = outputBuffer.indexOfChar('\n');

        if (newlineIndex < 0)
        {
            break;
        }

        auto line = outputBuffer.substring(0, newlineIndex);
        outputBuffer = outputBuffer.substring(newlineIndex + 1);
        line = line.trimEnd();

        if (line.isNotEmpty())
        {
            handleOutputLine(line);
        }
    }
}

void WorkerProcessController::handleOutputLine(const juce::String& line)
{
    if (!readySeen)
    {
        juce::String endpointPath;
        if (llm_midi::protocol::parseReadyLine(line, endpointPath).wasOk())
        {
            readySeen = true;
            listener.workerProcessStatusChanged("Pipe ready", endpointPath);
            listener.workerProcessReady(endpointPath);
            return;
        }
    }

    listener.workerProcessLogReceived(line + "\n");
}
