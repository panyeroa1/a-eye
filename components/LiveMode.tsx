import React, { useEffect, useRef, useState } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality, type FunctionDeclaration, Type } from "@google/genai";
import { NavigationData } from '../types';

// --- Audio Helpers ---
function createBlob(data: Float32Array): Blob {
  const l = data.length;
  const int16 = new Int16Array(l);
  for (let i = 0; i < l; i++) int16[i] = data[i] * 32768;
  let binary = '';
  const bytes = new Uint8Array(int16.buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) binary += String.fromCharCode(bytes[i]);
  const base64 = btoa(binary);
  return { data: base64, mimeType: 'audio/pcm;rate=16000' } as any;
}

async function decodeAudioData(base64Data: string, ctx: AudioContext): Promise<AudioBuffer> {
  const binaryString = atob(base64Data);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = binaryString.charCodeAt(i);
  const dataInt16 = new Int16Array(bytes.buffer);
  const buffer = ctx.createBuffer(1, dataInt16.length, 24000);
  const channelData = buffer.getChannelData(0);
  for (let i = 0; i < dataInt16.length; i++) channelData[i] = dataInt16[i] / 32768.0;
  return buffer;
}

async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve((reader.result as string).split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

// --- ORCHESTRATOR TOOLS ---
const toolsDef = [
  {
    functionDeclarations: [
      {
        name: "startNavigation",
        description: "Start navigation mode when user asks for directions, location, or 'way to'.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            destination: { type: Type.STRING, description: "The target location name" },
            estimatedDistance: { type: Type.STRING, description: "Estimated distance (e.g. 2.4 miles)" },
            direction: { type: Type.STRING, description: "Direction to turn: STRAIGHT, LEFT, RIGHT, UTURN" }
          },
          required: ["destination", "direction"]
        }
      },
      {
        name: "analyzeSurroundings",
        description: "Trigger a visual snapshot analysis when user asks 'What is this?', 'Read this', or 'Describe scene'.",
        parameters: { type: Type.OBJECT, properties: {} }
      },
      {
        name: "generateHologram",
        description: "Generate an image/hologram when user says 'Imagine...', 'Generate image of...', 'Dream of...'.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            prompt: { type: Type.STRING, description: "The visual description to generate" }
          },
          required: ["prompt"]
        }
      },
      {
        name: "switchCameraSource",
        description: "Switch the video feed source between the Glasses (World View) and the Linked Phone (Self View).",
        parameters: {
          type: Type.OBJECT,
          properties: {
            source: { type: Type.STRING, enum: ["GLASSES", "PHONE"], description: "The target camera source." }
          },
          required: ["source"]
        }
      },
      {
        name: "stopSystem",
        description: "Clear all overlays and stop current task.",
        parameters: { type: Type.OBJECT, properties: {} }
      }
    ]
  }
];

// --- SYSTEM PERSONA ---
const SYSTEM_INSTRUCTION = `
You are Ebo. You are the high-level AI Orchestrator for these smart glasses.
You speak with the voice of 'Fenrir' (deep, clear, authoritative).

CORE DIRECTIVES:
1. **VOICE ONLY**: The user relies entirely on your voice and the HUD.
2. **ORCHESTRATION**: You do not just chat; you CONTROL the interface.
   - If user needs a place -> Call \`startNavigation\`.
   - If user asks what they are looking at -> Call \`analyzeSurroundings\`.
   - If user wants to see something imagined -> Call \`generateHologram\`.
   - If user asks to see "phone camera", "selfie mode", or "myself" -> Call \`switchCameraSource(source="PHONE")\`.
   - If user asks to see "glasses view", "world view", or "what's in front" -> Call \`switchCameraSource(source="GLASSES")\`.
   - If user wants to stop -> Call \`stopSystem\`.

3. **CAMERA CONTROL**:
   - There are two linked views: "GLASSES" (Environment/Rear) and "PHONE" (User/Front).
   - If the user asks for the phone view, switch to it immediately.
   - Confirm the switch: "Visual link established. Displaying Phone Feed." or "Visual link established. Reverting to Glasses Feed."

4. **NAVIGATION BEHAVIOR**:
   - When navigating, be precise. "Route calculated. Head North. 200 meters."
   - Confirm the destination verbally.

5. **VISION BEHAVIOR**:
   - When analyzing, say "Scanning target..." then describe it briefly after the tool executes.

6. **PERSONALITY**:
   - Intelligent, Concise, Proactive.
   - Do not use markdown. Use spoken language.
`;

interface TranscriptItem {
  id: string;
  speaker: 'user' | 'ai';
  text: string;
  isFinal: boolean;
}

export const LiveMode: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  // State
  const [status, setStatus] = useState("EBO ONLINE");
  const [volume, setVolume] = useState(0);
  const [transcripts, setTranscripts] = useState<TranscriptItem[]>([]);
  
  // HUD States
  const [navData, setNavData] = useState<NavigationData | null>(null);
  const [generatedImage, setGeneratedImage] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [cameraSource, setCameraSource] = useState<'GLASSES' | 'PHONE'>('GLASSES');
  
  const mountedRef = useRef(true);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Audio Contexts
  const inputContextRef = useRef<AudioContext | null>(null);
  const outputContextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const sessionPromiseRef = useRef<Promise<any> | null>(null);

  // Helper to switch camera stream
  const switchCameraStream = async (target: 'GLASSES' | 'PHONE') => {
    try {
      // 1. Stop current video tracks only (keep audio if possible, or restart both)
      // Simpler to restart both to ensure sync and permissions
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop());
      }

      // 2. Define Constraints
      const constraints: MediaStreamConstraints = {
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1
        },
        video: {
          facingMode: target === 'GLASSES' ? 'environment' : 'user',
          width: { ideal: 1280 },
          height: { ideal: 720 }
        }
      };

      // 3. Get New Stream
      const newStream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = newStream;
      setCameraSource(target);

      // 4. Update Video Element
      if (videoRef.current) {
        videoRef.current.srcObject = newStream;
        videoRef.current.play();
      }

      // 5. Update Audio Processing Node
      if (inputContextRef.current && sessionPromiseRef.current) {
         // Disconnect old source
         if (audioSourceRef.current) {
            audioSourceRef.current.disconnect();
         }
         
         // Create new source
         const ctx = inputContextRef.current;
         const source = ctx.createMediaStreamSource(newStream);
         audioSourceRef.current = source;
         
         // Reconnect to existing processor (we assume processor is still alive in the closure of initARSession, 
         // but that closure holds reference to the *old* source variable if we aren't careful.
         // Actually, the processor is connected to destination. The source connects to processor.
         // We need to access the processor. 
         // Strategy: We will re-run the setup logic in initARSession or simple hack:
         // Since the `processor` variable inside `initARSession` is not accessible here, 
         // we might need to store processor in a Ref too.
      }
      
      return newStream;
    } catch (e) {
      console.error("Camera switch failed", e);
      setStatus("LINK FAILED");
      return null;
    }
  };
  
  // We need a ref for the processor to reconnect it
  const processorRef = useRef<ScriptProcessorNode | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    
    const initARSession = async () => {
      try {
        const apiKey = process.env.API_KEY;
        if (!apiKey) throw new Error("API_KEY_MISSING");

        const ai = new GoogleGenAI({ apiKey });
        
        inputContextRef.current = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
        outputContextRef.current = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 24000 });
        
        // --- 1. INITIAL HARDWARE ACCESS (Default to Glasses) ---
        const stream = await navigator.mediaDevices.getUserMedia({ 
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
            channelCount: 1
          }, 
          video: {
            facingMode: 'environment',
            width: { ideal: 1280 },
            height: { ideal: 720 }
          } 
        });
        streamRef.current = stream;

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play();
        }

        // --- 2. ORCHESTRATOR CONNECTION ---
        const sessionPromise = ai.live.connect({
          model: 'gemini-2.5-flash-native-audio-preview-12-2025',
          config: {
            responseModalities: [Modality.AUDIO],
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Fenrir' } } }, 
            inputAudioTranscription: { model: "google-1.0-pro" }, 
            outputAudioTranscription: { model: "google-1.0-pro" },
            systemInstruction: SYSTEM_INSTRUCTION,
            tools: toolsDef,
          },
          callbacks: {
            onopen: () => {
              if (mountedRef.current) setStatus("SYSTEM READY");
              
              const ctx = inputContextRef.current!;
              const source = ctx.createMediaStreamSource(stream);
              audioSourceRef.current = source;
              
              const processor = ctx.createScriptProcessor(4096, 1, 1);
              processorRef.current = processor;
              
              processor.onaudioprocess = (e) => {
                const inputData = e.inputBuffer.getChannelData(0);
                let sum = 0;
                for(let i=0; i<inputData.length; i++) sum += inputData[i]*inputData[i];
                if(mountedRef.current) setVolume(Math.sqrt(sum/inputData.length)*100);
                
                const pcmBlob = createBlob(inputData);
                sessionPromise.then((s: any) => s.sendRealtimeInput({ media: pcmBlob }));
              };
              source.connect(processor);
              processor.connect(ctx.destination);
            },
            onmessage: async (msg: LiveServerMessage) => {
              if (!mountedRef.current) return;
              
              // --- A. ORCHESTRATOR LOGIC (TOOL HANDLING) ---
              if (msg.toolCall) {
                const functionResponses: any[] = [];
                for (const fc of msg.toolCall.functionCalls) {
                  let result: any = { status: "ok" };

                  if (fc.name === "startNavigation") {
                    const args = fc.args as any;
                    setNavData({
                      isActive: true,
                      destination: args.destination,
                      direction: (args.direction as any) || 'STRAIGHT',
                      distance: args.estimatedDistance || 'Calculating...',
                      eta: '5 min'
                    });
                    setGeneratedImage(null);
                    setIsAnalyzing(false);
                    result = { status: "Navigation Overlay Active" };
                  } 
                  else if (fc.name === "analyzeSurroundings") {
                    setIsAnalyzing(true);
                    setNavData(null);
                    setGeneratedImage(null);
                    
                    if (videoRef.current && canvasRef.current) {
                        const canvas = canvasRef.current;
                        const video = videoRef.current;
                        canvas.width = video.videoWidth;
                        canvas.height = video.videoHeight;
                        canvas.getContext('2d')?.drawImage(video, 0, 0);
                        const base64 = await blobToBase64(await new Promise(r => canvas.toBlob(r)));
                        
                        sessionPromise.then(s => s.sendRealtimeInput({ 
                            media: { mimeType: 'image/jpeg', data: base64 } 
                        }));
                    }
                    result = { status: "Visual Data Sent to Cortex" };
                  }
                  else if (fc.name === "switchCameraSource") {
                     const args = fc.args as any;
                     const target = args.source === 'PHONE' ? 'PHONE' : 'GLASSES';
                     
                     // Trigger the switch logic
                     const newStream = await switchCameraStream(target);
                     
                     // IMPORTANT: We must manually update the audio node connection here
                     if (newStream && inputContextRef.current && processorRef.current) {
                        const ctx = inputContextRef.current;
                        const newSource = ctx.createMediaStreamSource(newStream);
                        audioSourceRef.current = newSource;
                        newSource.connect(processorRef.current);
                     }

                     result = { status: `Visual Feed Switched to ${target}` };
                  }
                  else if (fc.name === "generateHologram") {
                    setNavData(null);
                    setIsAnalyzing(false);
                    setGeneratedImage("https://source.unsplash.com/random/800x800/?futuristic," + (fc.args as any).prompt);
                    result = { status: "Hologram Projection Active" };
                  }
                  else if (fc.name === "stopSystem") {
                    setNavData(null);
                    setGeneratedImage(null);
                    setIsAnalyzing(false);
                    result = { status: "System Standby" };
                  }
                  
                  functionResponses.push({
                    id: fc.id,
                    name: fc.name,
                    response: result
                  });
                }
                sessionPromise.then(s => s.sendToolResponse({ functionResponses }));
              }

              // --- B. AUDIO OUTPUT ---
              const base64Audio = msg.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
              if (base64Audio && outputContextRef.current) {
                const ctx = outputContextRef.current;
                const buffer = await decodeAudioData(base64Audio, ctx);
                nextStartTimeRef.current = Math.max(nextStartTimeRef.current, ctx.currentTime);
                const source = ctx.createBufferSource();
                source.buffer = buffer;
                source.connect(ctx.destination);
                source.start(nextStartTimeRef.current);
                nextStartTimeRef.current += buffer.duration;
              }

              // --- C. TRANSCRIPTION LOG ---
              const inputTrans = msg.serverContent?.inputTranscription;
              const outputTrans = msg.serverContent?.outputTranscription;

              if (inputTrans) {
                 setTranscripts(prev => [...prev.slice(-1), { id: Date.now().toString(), speaker: 'user', text: inputTrans.text, isFinal: false }]);
              }
              if (outputTrans) {
                 setTranscripts(prev => [...prev.slice(-1), { id: Date.now().toString(), speaker: 'ai', text: outputTrans.text, isFinal: false }]);
              }
            },
            onclose: () => { if(mountedRef.current) setStatus("LINK LOST"); },
            onerror: () => { if(mountedRef.current) setStatus("RECONNECTING"); }
          }
        });
        sessionPromiseRef.current = sessionPromise;

      } catch (e) {
        console.error(e);
        if(mountedRef.current) setStatus("HW ERROR");
      }
    };

    initARSession();

    return () => {
      mountedRef.current = false;
      streamRef.current?.getTracks().forEach(t => t.stop());
      inputContextRef.current?.close();
      outputContextRef.current?.close();
    };
  }, []);


  // --- RENDER HELPERS ---
  const renderDirectionArrow = (dir: string) => {
    switch(dir) {
        case 'LEFT': return (
            <svg width="100" height="100" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-cyan-400 drop-shadow-[0_0_10px_rgba(34,211,238,0.8)]">
                <path d="M9 10L4 15L9 20" />
                <path d="M20 4v7a4 4 0 0 1-4 4H4" />
            </svg>
        );
        case 'RIGHT': return (
            <svg width="100" height="100" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-cyan-400 drop-shadow-[0_0_10px_rgba(34,211,238,0.8)]">
                <path d="M15 10L20 15L15 20" />
                <path d="M4 4v7a4 4 0 0 0 4 4h12" />
            </svg>
        );
        case 'UTURN': return (
            <svg width="100" height="100" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-cyan-400 drop-shadow-[0_0_10px_rgba(34,211,238,0.8)]">
                <path d="M4 10c0-4.4 3.6-8 8-8s8 3.6 8 8v5" />
                <path d="M14 15l-4 4-4-4" />
            </svg>
        );
        default: return (
            <svg width="100" height="100" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-cyan-400 drop-shadow-[0_0_10px_rgba(34,211,238,0.8)]">
                <path d="M12 22V2" />
                <path d="M5 9l7-7 7 7" />
            </svg>
        );
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col font-sans select-none">
      
      {/* 1. VIDEO FEED (THE EYE) */}
      <video 
        ref={videoRef} 
        className="absolute inset-0 w-full h-full object-cover opacity-90 transition-all duration-500"
        playsInline 
        muted 
        style={{ transform: cameraSource === 'PHONE' ? 'scaleX(-1)' : 'none' }} // Mirror if selfie mode
      />
      <canvas ref={canvasRef} className="hidden" />

      {/* 2. OVERLAY LAYER (THE HUD) */}
      <div className="absolute inset-0 pointer-events-none flex flex-col justify-between p-6">
        
        {/* TOP BAR: Minimal Status */}
        <div className="flex justify-between items-start">
            <div className="flex flex-col gap-1">
                <div className="text-[10px] font-mono-tech tracking-[0.2em] text-cyan-500/80">EBO ORCHESTRATOR</div>
                <div className="text-xs font-mono-tech text-white/50">{status}</div>
                <div className="text-[10px] font-mono-tech text-cyan-300 bg-cyan-900/30 px-2 py-0.5 rounded border border-cyan-500/20 inline-block w-fit">
                   SRC: {cameraSource}
                </div>
            </div>
            {/* NO ICONS, JUST TEXT */}
            <div className="flex gap-4">
                {isAnalyzing && <div className="text-xs font-mono-tech text-purple-400 animate-pulse">[ANALYZING]</div>}
                <div className="text-xs font-mono-tech text-red-500 animate-blink flex items-center gap-2">
                    <div className="w-2 h-2 bg-red-500 rounded-full"></div>
                    [REC]
                </div>
            </div>
        </div>

        {/* CENTER CONTENT: Dynamic Cards */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-md flex flex-col items-center justify-center gap-4">
            
            {/* A. NAVIGATION HUD */}
            {navData && (
                <div className="flex items-center gap-6 animate-in fade-in zoom-in duration-300">
                    <div className="w-24 h-24 flex items-center justify-center border border-cyan-500/30 bg-black/40 backdrop-blur-md rounded-full shadow-[0_0_30px_rgba(6,182,212,0.2)]">
                        {renderDirectionArrow(navData.direction)}
                    </div>
                    <div className="flex flex-col">
                        <span className="text-4xl font-light text-white drop-shadow-md">{navData.distance}</span>
                        <span className="text-sm font-mono-tech text-cyan-300 tracking-wider uppercase">{navData.destination}</span>
                    </div>
                </div>
            )}

            {/* B. VISION ANALYSIS OVERLAY */}
            {isAnalyzing && (
                <div className="w-64 h-64 border-2 border-dashed border-purple-500/50 rounded-xl relative animate-pulse flex items-center justify-center">
                    <div className="absolute top-0 left-0 w-4 h-4 border-t-2 border-l-2 border-purple-400"></div>
                    <div className="absolute top-0 right-0 w-4 h-4 border-t-2 border-r-2 border-purple-400"></div>
                    <div className="absolute bottom-0 left-0 w-4 h-4 border-b-2 border-l-2 border-purple-400"></div>
                    <div className="absolute bottom-0 right-0 w-4 h-4 border-b-2 border-r-2 border-purple-400"></div>
                    <span className="text-xs font-mono-tech text-purple-300 bg-black/50 px-2">SCANNING OBJECT</span>
                </div>
            )}

            {/* C. GENERATED HOLOGRAM */}
            {generatedImage && (
                <div className="relative rounded-lg overflow-hidden border border-white/20 shadow-2xl animate-in fade-in duration-700">
                    <img src={generatedImage} alt="Hologram" className="w-64 h-64 object-cover opacity-90" />
                    <div className="absolute bottom-0 left-0 right-0 bg-black/60 p-2 text-center text-[10px] font-mono-tech text-white">
                        GENERATED REALITY LAYER
                    </div>
                </div>
            )}
        </div>

        {/* BOTTOM BAR: Transcription Log (Very Small) */}
        <div className="flex flex-col items-center gap-2 pb-8 opacity-80">
            {transcripts.map((t) => (
                <div 
                    key={t.id}
                    className={`text-center max-w-[80%] transition-all duration-300 ${
                        t.speaker === 'user' 
                        ? 'text-[10px] font-mono-tech text-gray-400' 
                        : 'text-sm font-light text-cyan-100 drop-shadow-[0_0_5px_rgba(6,182,212,0.5)]'
                    }`}
                >
                    {t.speaker === 'ai' && <span className="text-[9px] text-cyan-500 mr-2 tracking-widest">EBO:</span>}
                    {t.text}
                </div>
            ))}
            
            {/* Voice Activity Line */}
            <div className="h-[2px] w-24 bg-gray-800 rounded-full overflow-hidden mt-2">
                <div 
                    className="h-full bg-cyan-400 transition-all duration-75"
                    style={{ width: `${Math.min(100, volume)}%`, opacity: volume > 0 ? 1 : 0 }}
                />
            </div>
        </div>
      </div>
      
      {/* Hidden Close for Desktop testing */}
      <div className="absolute top-0 right-0 w-16 h-16 z-50 cursor-pointer" onClick={onClose}></div>
    </div>
  );
};
