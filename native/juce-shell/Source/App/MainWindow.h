#pragma once

#include <JuceHeader.h>

class MainWindow final : public juce::DocumentWindow
{
public:
    explicit MainWindow(const juce::String& title);
    void closeButtonPressed() override;
};
