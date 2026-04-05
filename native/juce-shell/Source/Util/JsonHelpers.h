#pragma once

#include <JuceHeader.h>

namespace llm_midi::json
{
using ObjectPtr = juce::DynamicObject::Ptr;

juce::var parseJson(const juce::String& text, juce::String& errorMessage);
ObjectPtr getObject(const juce::var& value);
juce::var getProperty(const juce::var& value, const juce::Identifier& propertyName);
juce::String getString(const juce::var& value, const juce::Identifier& propertyName);
bool getBool(const juce::var& value, const juce::Identifier& propertyName, bool defaultValue = false);
juce::String toPrettyJson(const juce::var& value);
juce::String toSingleLineJson(const juce::var& value);
}
