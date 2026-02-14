
import { GoogleGenAI, Type, Modality } from "@google/genai";
import { ChatModelType } from "../types";

// Helper to ensure API Client is initialized correctly.
// Strictly using process.env.API_KEY as per the hard requirement.
const getAIClient = () => {
  return new GoogleGenAI({ apiKey: process.env.API_KEY as string });
};

// --- OMNI CHAT SERVICES ---

export const sendChatMessage = async (
  message: string,
  modelType: ChatModelType,
  history: { role: string; parts: { text: string }[] }[],
  location?: GeolocationCoordinates
) => {
  const ai = getAIClient();
  let modelName = 'gemini-3-flash-preview'; 
  let tools: any[] | undefined = undefined;
  let toolConfig: any | undefined = undefined;
  let thinkingConfig: any | undefined = undefined;
  let systemInstruction: string | undefined = undefined;

  switch (modelType) {
    case ChatModelType.FAST:
      modelName = 'gemini-flash-lite-latest';
      systemInstruction = "You are Ebo, a fast and efficient AI assistant.";
      break;
    case ChatModelType.SMART:
      modelName = 'gemini-3-pro-preview';
      // Gemini 3 Pro thinking budget maximum is 32768.
      thinkingConfig = { thinkingBudget: 32768 };
      systemInstruction = "You are Ebo, a deep-thinking AI. Take your time to reason complexly.";
      break;
    case ChatModelType.SEARCH:
      modelName = 'gemini-3-flash-preview';
      tools = [{ googleSearch: {} }];
      systemInstruction = "You are Ebo. Use Google Search to provide up-to-date information.";
      break;
    case ChatModelType.MAPS:
      // Maps grounding is only supported in Gemini 2.5 series models.
      modelName = 'gemini-2.5-flash';
      tools = [{ googleMaps: {} }];
      if (location) {
        toolConfig = {
          retrievalConfig: {
            latLng: {
              latitude: location.latitude,
              longitude: location.longitude,
            },
          },
        };
      }
      systemInstruction = "You are Ebo. Help the user find places using Google Maps.";
      break;
  }

  // Use chat session for context management.
  const chat = ai.chats.create({
    model: modelName,
    config: {
      systemInstruction,
      tools,
      toolConfig,
      thinkingConfig,
    },
    history: history.map(h => ({
      role: h.role,
      parts: h.parts
    }))
  });

  const result = await chat.sendMessage({ message });
  return result;
};

// --- VISION LAB SERVICES ---

export const analyzeMedia = async (
  fileBase64: string,
  mimeType: string,
  prompt: string,
  isVideo: boolean
) => {
  const ai = getAIClient();
  const model = 'gemini-3-pro-preview'; // Used for complex reasoning and media analysis

  const response = await ai.models.generateContent({
    model,
    contents: {
      parts: [
        {
          inlineData: {
            data: fileBase64,
            mimeType: mimeType
          }
        },
        { text: prompt }
      ]
    }
  });

  return response.text;
};

export const generateProImage = async (prompt: string, size: '1K' | '2K' | '4K') => {
  // Always create a new instance right before use to ensure updated API key if selected.
  const ai = getAIClient();
  const model = 'gemini-3-pro-image-preview';
  
  const response = await ai.models.generateContent({
    model,
    contents: { parts: [{ text: prompt }] },
    config: {
      imageConfig: {
        imageSize: size,
        aspectRatio: '1:1'
      }
    }
  });

  // Iterating through parts as an image part is not guaranteed to be the first part.
  for (const part of response.candidates?.[0]?.content?.parts || []) {
    if (part.inlineData) {
      return `data:image/png;base64,${part.inlineData.data}`;
    }
  }
  return null;
};

// --- AUDIO SCRIBE SERVICES ---

export const transcribeAudioFile = async (base64Audio: string, mimeType: string) => {
  const ai = getAIClient();
  const model = 'gemini-3-flash-preview';

  const response = await ai.models.generateContent({
    model,
    contents: {
      parts: [
        {
          inlineData: {
            data: base64Audio,
            mimeType: mimeType
          }
        },
        { text: "Transcribe this audio accurately." }
      ]
    }
  });

  return response.text;
};

// --- TTS SERVICE ---

export const generateSpeech = async (text: string) => {
  const ai = getAIClient();
  const model = 'gemini-2.5-flash-preview-tts';

  const response = await ai.models.generateContent({
    model,
    contents: [{ parts: [{ text }] }],
    config: {
      responseModalities: [Modality.AUDIO],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName: 'Kore' },
        },
      },
    },
  });

  const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
  return base64Audio;
};

// Manual PCM audio decoding following the coding guidelines to avoid standard file header requirements.
export const decodeAudioData = async (
  base64Data: string,
  ctx: AudioContext,
  sampleRate: number = 24000
) => {
  const binaryString = atob(base64Data);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  
  const dataInt16 = new Int16Array(bytes.buffer);
  const numChannels = 1;
  const frameCount = dataInt16.length / numChannels;
  
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);
  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  
  return buffer;
};
