
import React, { useEffect, useRef, useState } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality, Type, Blob as GenAIBlob } from "@google/genai";
import { NavigationData, DriveState } from '../types';
import { Navigation, ShieldAlert, MapPin, Compass, Zap, Activity } from 'lucide-react';

// Manual implementation of base64 encoding to follow SDK guidelines.
function encode(bytes: Uint8Array) {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

// Manual implementation of base64 decoding.
function decode(base64: string) {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

// Correct manual audio decoding logic for raw PCM streams as per guidelines.
async function decodeAudioData(
  data: Uint8Array,
  ctx: AudioContext,
  sampleRate: number,
  numChannels: number,
): Promise<AudioBuffer> {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);

  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}

// Helper for preparing audio blobs for real-time input.
function createBlob(data: Float32Array): GenAIBlob {
  const l = data.length;
  const int16 = new Int16Array(l);
  for (let i = 0; i < l; i++) {
    int16[i] = data[i] * 32768;
  }
  return {
    data: encode(new Uint8Array(int16.buffer)),
    mimeType: 'audio/pcm;rate=16000',
  };
}

const toolsDef = [
  {
    functionDeclarations: [
      {
        name: "updateNavigation",
        description: "Update the driving HUD with navigation directions.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            direction: { type: Type.STRING, enum: ["STRAIGHT", "LEFT", "RIGHT", "UTURN", "ARRIVED"] },
            instruction: { type: Type.STRING },
            distance: { type: Type.STRING }
          },
          required: ["direction", "instruction"]
        }
      },
      {
        name: "setSafetyAlert",
        description: "Trigger a visual safety alert on the HUD periphery.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            severity: { type: Type.STRING, enum: ["INFO", "CAUTION", "DANGER"] },
            message: { type: Type.STRING }
          },
          required: ["severity", "message"]
        }
      }
    ]
  }
];

const SYSTEM_PROMPT = `
You are Ebo A-eye Vigilant Mode.
You live inside the user's eyeglasses.
GOAL: Safely guide and inform the user while they are in transit.
CONSTRAINTS:
1. NEVER clutter the center of the screen. Safety is priority #1.
2. Use spatial metadata. You are given location coordinates and camera feed.
3. Be proactive but brief. Speak like a professional flight navigator.
4. If you see a hazard (pothole, pedestrian, red light) via camera, use 'setSafetyAlert'.
5. Provide contextual knowledge about the area (history, shops, safety) via spatial audio.
Voice: Fenrir. Tone: Calm, precise, helpful.
`;

export const LiveMode: React.FC = () => {
  const [isLinked, setIsLinked] = useState(false);
  const [nav, setNav] = useState<NavigationData | null>(null);
  const [alert, setAlert] = useState<{ severity: string; message: string } | null>(null);
  const [driveState, setDriveState] = useState<DriveState>({ speed: 0, heading: 0, streetName: 'SCANNING...', isDriving: false });
  
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioCtxRef = useRef<{ in: AudioContext; out: AudioContext } | null>(null);
  const nextStartTimeRef = useRef<number>(0);

  const startCoPilot = async () => {
    try {
      // Re-initialize GoogleGenAI for every start session to ensure the correct API key is used.
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY as string });
      audioCtxRef.current = {
        in: new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 }),
        out: new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 24000 })
      };

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: { facingMode: 'environment', width: 1280, height: 720 }
      });

      if (videoRef.current) videoRef.current.srcObject = stream;

      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-12-2025',
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Fenrir' } } },
          systemInstruction: SYSTEM_PROMPT,
          tools: toolsDef,
        },
        callbacks: {
          onopen: () => {
            setIsLinked(true);
            // Establish Geolocation Background Task
            navigator.geolocation.watchPosition((pos) => {
              const { latitude, longitude, speed, heading } = pos.coords;
              setDriveState(prev => ({
                ...prev,
                speed: Math.round((speed || 0) * 2.237), // mph
                heading: heading || 0,
                isDriving: (speed || 0) > 2
              }));
              
              // Always use sessionPromise to send data to prevent stale closure issues.
              sessionPromise.then(s => {
                s.sendRealtimeInput({
                  media: { 
                    data: btoa(`Lat: ${latitude}, Lng: ${longitude}, Speed: ${speed}m/s`), 
                    mimeType: 'text/plain' 
                  }
                });
              });
            });

            // Audio Input Pipeline
            const source = audioCtxRef.current!.in.createMediaStreamSource(stream);
            const processor = audioCtxRef.current!.in.createScriptProcessor(4096, 1, 1);
            processor.onaudioprocess = (e) => {
              const data = e.inputBuffer.getChannelData(0);
              sessionPromise.then(s => s.sendRealtimeInput({ media: createBlob(data) }));
            };
            source.connect(processor);
            processor.connect(audioCtxRef.current!.in.destination);

            // Visual background telemetry. Using sessionPromise ensures synchronization.
            setInterval(() => {
              if (videoRef.current && canvasRef.current) {
                const ctx = canvasRef.current.getContext('2d');
                canvasRef.current.width = 480;
                canvasRef.current.height = 270;
                ctx?.drawImage(videoRef.current, 0, 0, 480, 270);
                canvasRef.current.toBlob((blob) => {
                  if (blob) {
                    const reader = new FileReader();
                    reader.onloadend = () => {
                      const b64 = (reader.result as string).split(',')[1];
                      sessionPromise.then(s => s.sendRealtimeInput({ media: { data: b64, mimeType: 'image/jpeg' } }));
                    };
                    reader.readAsDataURL(blob);
                  }
                }, 'image/jpeg', 0.5);
              }
            }, 1500);
          },
          onmessage: async (msg: LiveServerMessage) => {
            if (msg.toolCall) {
              const resps: any[] = [];
              for (const fc of msg.toolCall.functionCalls) {
                if (fc.name === 'updateNavigation') {
                  const a = fc.args as any;
                  setNav({ isActive: true, ...a });
                  resps.push({ id: fc.id, name: fc.name, response: { status: 'HUD_NAV_UPDATED' } });
                } else if (fc.name === 'setSafetyAlert') {
                  const a = fc.args as any;
                  setAlert(a);
                  setTimeout(() => setAlert(null), 5000);
                  resps.push({ id: fc.id, name: fc.name, response: { status: 'ALERT_RENDERED' } });
                }
              }
              sessionPromise.then(s => s.sendToolResponse({ functionResponses: resps }));
            }

            const audio = msg.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
            if (audio && audioCtxRef.current) {
              // Using manual decoding logic for PCM data.
              const buf = await decodeAudioData(decode(audio), audioCtxRef.current.out, 24000, 1);
              // Maintain gapless playback queue using nextStartTime tracking.
              nextStartTimeRef.current = Math.max(nextStartTimeRef.current, audioCtxRef.current.out.currentTime);
              const src = audioCtxRef.current.out.createBufferSource();
              src.buffer = buf;
              src.connect(audioCtxRef.current.out.destination);
              src.start(nextStartTimeRef.current);
              nextStartTimeRef.current += buf.duration;
            }
          }
        }
      });
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div className="fixed inset-0 bg-black overflow-hidden font-mono-tech select-none">
      <video ref={videoRef} className="absolute inset-0 w-full h-full object-cover opacity-60 grayscale-[0.3]" playsInline muted autoPlay />
      <canvas ref={canvasRef} className="hidden" />

      <div className={`absolute inset-0 transition-colors duration-500 pointer-events-none ${
        alert?.severity === 'DANGER' ? 'bg-red-500/10 border-[12px] border-red-500/30' : 
        alert?.severity === 'CAUTION' ? 'bg-amber-500/10 border-[12px] border-amber-500/30' : ''
      }`} />

      {!isLinked ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/90 z-50">
           <div className="w-24 h-24 border-2 border-cyan-500/20 rounded-full flex items-center justify-center mb-6">
              <div className="w-16 h-16 border-t-2 border-cyan-500 rounded-full animate-spin"></div>
           </div>
           <h2 className="text-cyan-500 tracking-[0.4em] mb-4 text-sm">INITIALIZING CO-PILOT...</h2>
           <button onClick={startCoPilot} className="px-8 py-3 bg-cyan-900/20 border border-cyan-500/50 text-cyan-400 text-xs tracking-widest hover:bg-cyan-500/20 transition-all">
             BOOT SYSTEM
           </button>
        </div>
      ) : (
        <div className="absolute inset-0 p-8 flex flex-col justify-between pointer-events-none">
          <div className="flex justify-between items-start opacity-60">
             <div className="space-y-1">
                <div className="flex items-center gap-2 text-cyan-400 text-[10px] tracking-widest">
                   <Activity size={12} className="animate-pulse" /> EBO CO-PILOT v4.2
                </div>
                <div className="text-[14px] text-white/80 font-light flex items-center gap-2">
                   <Compass size={14} className="text-cyan-500" /> {driveState.heading.toFixed(0)}° N
                </div>
             </div>
             <div className="text-right space-y-1">
                <div className="text-[24px] text-white leading-none">{driveState.speed} <span className="text-[10px] text-cyan-500 uppercase tracking-tighter">MPH</span></div>
                <div className="text-[9px] text-cyan-500/50 uppercase">Latent Analysis Active</div>
             </div>
          </div>

          <div className="flex-1 flex items-center justify-center">
             <div className="w-1 h-1 bg-cyan-500 rounded-full opacity-20" />
          </div>

          <div className="flex flex-col items-center gap-6">
             {alert && (
                <div className="bg-black/60 backdrop-blur-xl px-6 py-2 border-l-2 border-l-red-500 flex items-center gap-3 animate-in slide-in-from-bottom duration-300">
                   <ShieldAlert size={16} className="text-red-500 animate-bounce" />
                   <span className="text-white text-xs uppercase tracking-wider">{alert.message}</span>
                </div>
             )}

             {nav && (
                <div className="flex flex-col items-center gap-1 opacity-80">
                   <div className="flex items-center gap-4 bg-white/5 backdrop-blur-md px-6 py-3 rounded-full border border-white/10">
                      <div className={`transition-transform duration-500 ${
                        nav.direction === 'LEFT' ? '-rotate-90' : 
                        nav.direction === 'RIGHT' ? 'rotate-90' : 
                        nav.direction === 'UTURN' ? 'rotate-180' : ''
                      }`}>
                         <Navigation size={20} className="text-cyan-400 fill-cyan-400/20" />
                      </div>
                      <div className="flex flex-col">
                         <span className="text-white text-xs font-light">{nav.instruction}</span>
                         <span className="text-[10px] text-cyan-500/60 uppercase">{nav.distance}</span>
                      </div>
                   </div>
                </div>
             )}

             <div className="w-full flex justify-between items-end opacity-40 text-[8px] tracking-[0.2em] text-cyan-500/50">
                <div className="flex items-center gap-2">
                   <MapPin size={10} /> {driveState.streetName}
                </div>
                <div className="flex items-center gap-4">
                   <span>DATA ENCRYPTED</span>
                   <span>VOICE LINK: 100%</span>
                   <Zap size={10} className="text-yellow-500" />
                </div>
             </div>
          </div>
          <div className="absolute inset-0 scanline opacity-[0.05]" />
        </div>
      )}
    </div>
  );
};
