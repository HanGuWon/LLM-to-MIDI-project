#include "Util/Base64.h"

namespace
{
int decodeCharacter(const juce::juce_wchar character)
{
    if (character >= 'A' && character <= 'Z')
    {
        return static_cast<int>(character - 'A');
    }

    if (character >= 'a' && character <= 'z')
    {
        return static_cast<int>(character - 'a') + 26;
    }

    if (character >= '0' && character <= '9')
    {
        return static_cast<int>(character - '0') + 52;
    }

    if (character == '+')
    {
        return 62;
    }

    if (character == '/')
    {
        return 63;
    }

    return -1;
}
}

namespace llm_midi::util
{
bool decodeBase64(const juce::String& input, juce::MemoryBlock& output, juce::String& errorMessage)
{
    output.reset();
    errorMessage.clear();

    juce::MemoryOutputStream stream;
    int quartet[4] {};
    int quartetSize = 0;
    int paddingCount = 0;

    for (const auto character : input)
    {
        if (juce::CharacterFunctions::isWhitespace(character))
        {
            continue;
        }

        if (character == '=')
        {
            quartet[quartetSize++] = 0;
            ++paddingCount;
        }
        else
        {
            const auto decoded = decodeCharacter(character);

            if (decoded < 0)
            {
                errorMessage = "Invalid base64 character in MIDI payload.";
                return false;
            }

            quartet[quartetSize++] = decoded;
        }

        if (quartetSize == 4)
        {
            const auto firstByte = static_cast<juce::uint8>((quartet[0] << 2) | (quartet[1] >> 4));
            const auto secondByte = static_cast<juce::uint8>(((quartet[1] & 0x0f) << 4) | (quartet[2] >> 2));
            const auto thirdByte = static_cast<juce::uint8>(((quartet[2] & 0x03) << 6) | quartet[3]);

            stream.writeByte(static_cast<char>(firstByte));

            if (paddingCount < 2)
            {
                stream.writeByte(static_cast<char>(secondByte));
            }

            if (paddingCount == 0)
            {
                stream.writeByte(static_cast<char>(thirdByte));
            }

            quartetSize = 0;
            paddingCount = 0;
        }
    }

    if (quartetSize != 0)
    {
        errorMessage = "Invalid base64 payload length.";
        return false;
    }

    output = stream.getMemoryBlock();
    return true;
}
}
