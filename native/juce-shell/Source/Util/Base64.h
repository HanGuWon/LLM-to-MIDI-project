#pragma once

#include <JuceHeader.h>

namespace llm_midi::util
{
bool decodeBase64(const juce::String& input, juce::MemoryBlock& output, juce::String& errorMessage);
}
