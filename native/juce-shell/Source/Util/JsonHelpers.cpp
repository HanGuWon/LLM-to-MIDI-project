#include "Util/JsonHelpers.h"

namespace llm_midi::json
{
juce::var parseJson(const juce::String& text, juce::String& errorMessage)
{
    juce::var parsed;
    const auto parseResult = juce::JSON::parse(text, parsed);

    if (parseResult.failed())
    {
        errorMessage = parseResult.getErrorMessage();
        return {};
    }

    errorMessage.clear();
    return parsed;
}

ObjectPtr getObject(const juce::var& value)
{
    return value.getDynamicObject();
}

juce::var getProperty(const juce::var& value, const juce::Identifier& propertyName)
{
    if (auto object = getObject(value))
    {
        return object->getProperty(propertyName);
    }

    return {};
}

juce::String getString(const juce::var& value, const juce::Identifier& propertyName)
{
    const auto property = getProperty(value, propertyName);
    return property.isString() ? property.toString() : juce::String();
}

bool getBool(const juce::var& value, const juce::Identifier& propertyName, bool defaultValue)
{
    const auto property = getProperty(value, propertyName);

    if (property.isBool())
    {
        return static_cast<bool>(property);
    }

    return defaultValue;
}

juce::String toPrettyJson(const juce::var& value)
{
    return juce::JSON::toString(value, true);
}

juce::String toSingleLineJson(const juce::var& value)
{
    return juce::JSON::toString(value, false);
}
}
