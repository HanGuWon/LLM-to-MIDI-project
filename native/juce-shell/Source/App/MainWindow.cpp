#include "MainWindow.h"

#include "UI/MainComponent.h"

MainWindow::MainWindow(const juce::String& title)
    : juce::DocumentWindow(title,
                           juce::Desktop::getInstance().getDefaultLookAndFeel()
                               .findColour(juce::ResizableWindow::backgroundColourId),
                           juce::DocumentWindow::allButtons)
{
    setUsingNativeTitleBar(true);
    setResizable(true, true);
    setResizeLimits(960, 720, 1920, 1400);
    setContentOwned(new MainComponent(), true);
    centreWithSize(1280, 900);
    setVisible(true);
}

void MainWindow::closeButtonPressed()
{
    juce::JUCEApplication::getInstance()->systemRequestedQuit();
}
