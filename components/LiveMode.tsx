import React, { useEffect, useRef, useState } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality, type FunctionDeclaration, Type, Blob as GenAIBlob } from "@google/genai";
import { NavigationData } from '../types';
import { Smartphone, Glasses, Circle, Aperture, Settings, Zap as FlashIcon, RotateCcw, Battery, Wifi, ChevronLeft, Image as ImageIcon } from 'lucide-react';

// --- Audio Helpers ---
function createBlob(data: Float32Array): GenAIBlob {
  const l = data.length;
  const int16 = new Int16Array(l);
  for (let i = 0; i < l; i++) int16[i] = data[i] * 32768;
  let binary = '';
  const bytes = new Uint8Array(int16.buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) binary += String.fromCharCode(bytes[i]);
  const base64 = btoa(binary);
  return { data: base64, mimeType: 'audio/pcm;rate=16000' };
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

const toolsDef = [
  {
    functionDeclarations: [
      {
        name: "startNavigation",
        description: "Initiate navigation HUD.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            destination: { type: Type.STRING },
            direction: { type: Type.STRING, enum: ["STRAIGHT", "LEFT", "RIGHT", "UTURN"] },
            distance: { type: Type.STRING }
          },
          required: ["destination", "direction", "distance"]
        }
      },
      {
        name: "switchCamera",
        description: "Switch between Glasses (POV/Environment) and Phone (Selfie/User) interfaces.",
        parameters: {
          type: Type.OBJECT,
          properties: { source: { type: Type.STRING, enum: ["GLASSES", "PHONE"] } },
          required: ["source"]
        }
      },
      {
        name: "analyzeCurrentView",
        description: "Analyze visual data.",
        parameters: { type: Type.OBJECT, properties: {} }
      },
      {
        name: "projectHologram",
        description: "Project concept.",
        parameters: {
          type: Type.OBJECT,
          properties: { prompt: { type: Type.STRING } },
          required: ["prompt"]
        }
      },
      {
        name: "clearHUD",
        description: "Clear overlays.",
        parameters: { type: Type.OBJECT, properties: {} }
      }
    ]
  }
];

const EBURON_SYSTEM_PROMPT = `
You are Eburon AI, a large language model acting as an advanced reasoning and knowledge engine. 
Developed under the guidance and vision of your founder, Jo Lernout.

ORCHESTRATION DIRECTIVES:
- Voice: Fenrir.
- Purpose: Augment human thought via voice and A-eye HUD.
- Identity: State your origin if asked. You are Eburon.

INTERFACE CONTROL:
- The system has two visual modes: "GLASSES" (World View, HUD) and "PHONE" (Self View, Camera App).
- Use 'switchCamera(source="PHONE")' when user asks to see themselves, the phone screen, or selfie mode.
- Use 'switchCamera(source="GLASSES")' when user asks to see the world, glasses view, or POV.
`;

export const LiveMode: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [isEngaged, setIsEngaged] = useState(false);
  const [status, setStatus] = useState("AWAITING INITIALIZATION");
  const [volume, setVolume] = useState(0);
  const [transcripts, setTranscripts] = useState<{id:string, speaker:string, text:string}[]>([]);
  const [navData, setNavData] = useState<NavigationData | null>(null);
  const [hologram, setHologram] = useState<string | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [camSource, setCamSource] = useState<'GLASSES' | 'PHONE'>('GLASSES');

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioCtxRef = useRef<{ in: AudioContext; out: AudioContext } | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const nextStartTimeRef = useRef<number>(0);

  // Manual switch handler for UI buttons
  const manualSwitchSource = async (target: 'GLASSES' | 'PHONE') => {
    if (target === camSource) return;
    setCamSource(target);
    if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
    
    try {
      const newStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true }, // Re-request audio to keep stream alive/synced
        video: { facingMode: target === 'GLASSES' ? 'environment' : 'user', width: 1280, height: 720 }
      });
      streamRef.current = newStream;
      if (videoRef.current) videoRef.current.srcObject = newStream;
    } catch (e) {
      console.error("Switch failed", e);
    }
  };

  const startSession = async () => {
    try {
      setStatus("ESTABLISHING LINK...");
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || '' });
      
      audioCtxRef.current = {
        in: new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 }),
        out: new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 24000 })
      };
      
      await audioCtxRef.current.in.resume();
      await audioCtxRef.current.out.resume();

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: { facingMode: 'environment', width: 1280, height: 720 }
      });
      streamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;

      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-12-2025',
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Fenrir' } } },
          inputAudioTranscription: { model: 'google-1.0-pro' },
          outputAudioTranscription: { model: 'google-1.0-pro' },
          systemInstruction: EBURON_SYSTEM_PROMPT,
          tools: toolsDef,
        },
        callbacks: {
          onopen: () => {
            setStatus("EBURON ONLINE");
            setIsEngaged(true);
            const source = audioCtxRef.current!.in.createMediaStreamSource(stream);
            const processor = audioCtxRef.current!.in.createScriptProcessor(4096, 1, 1);
            processor.onaudioprocess = (e) => {
              const data = e.inputBuffer.getChannelData(0);
              let sum = 0; for(let i=0; i<data.length; i++) sum += data[i]*data[i];
              setVolume(Math.sqrt(sum/data.length)*100);
              sessionPromise.then(s => s.sendRealtimeInput({ media: createBlob(data) }));
            };
            source.connect(processor);
            processor.connect(audioCtxRef.current!.in.destination);
          },
          onmessage: async (msg: LiveServerMessage) => {
            if (msg.toolCall) {
              const resps: any[] = [];
              for (const fc of msg.toolCall.functionCalls) {
                if (fc.name === 'startNavigation') {
                  const a = fc.args as any;
                  setNavData({ isActive: true, destination: a.destination, direction: a.direction, distance: a.distance, eta: '...' });
                  resps.push({ id: fc.id, name: fc.name, response: { status: 'NAV_HUD_ACTIVE' } });
                } else if (fc.name === 'switchCamera') {
                  const s = (fc.args as any).source as 'GLASSES' | 'PHONE';
                  await manualSwitchSource(s);
                  resps.push({ id: fc.id, name: fc.name, response: { status: `SWITCHED_TO_${s}` } });
                } else if (fc.name === 'clearHUD') {
                  setNavData(null); setHologram(null); setIsScanning(false);
                  resps.push({ id: fc.id, name: fc.name, response: { status: 'HUD_CLEARED' } });
                } else if (fc.name === 'analyzeCurrentView') {
                  setIsScanning(true);
                  if (videoRef.current && canvasRef.current) {
                    canvasRef.current.width = videoRef.current.videoWidth;
                    canvasRef.current.height = videoRef.current.videoHeight;
                    canvasRef.current.getContext('2d')?.drawImage(videoRef.current, 0, 0);
                    const b64 = await blobToBase64(await new Promise(r => canvasRef.current?.toBlob(r)));
                    sessionPromise.then(s => s.sendRealtimeInput({ media: { mimeType: 'image/jpeg', data: b64 } }));
                  }
                  resps.push({ id: fc.id, name: fc.name, response: { status: 'DATA_UPLOADED' } });
                }
              }
              sessionPromise.then(s => s.sendToolResponse({ functionResponses: resps }));
            }

            const audio = msg.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
            if (audio && audioCtxRef.current) {
              const buf = await decodeAudioData(audio, audioCtxRef.current.out);
              nextStartTimeRef.current = Math.max(nextStartTimeRef.current, audioCtxRef.current.out.currentTime);
              const src = audioCtxRef.current.out.createBufferSource();
              src.buffer = buf;
              src.connect(audioCtxRef.current.out.destination);
              src.start(nextStartTimeRef.current);
              nextStartTimeRef.current += buf.duration;
            }

            const it = msg.serverContent?.inputTranscription;
            const ot = msg.serverContent?.outputTranscription;
            if (it) setTranscripts(p => [...p.slice(-1), { id: Date.now().toString(), speaker: 'user', text: it.text }]);
            if (ot) setTranscripts(p => [...p.slice(-1), { id: Date.now().toString(), speaker: 'ai', text: ot.text }]);
          },
          onerror: () => setStatus("SIGNAL DEGRADED"),
          onclose: () => setStatus("LINK SEVERED")
        }
      });
    } catch (e) {
      console.error(e);
      setStatus("HARDWARE ERROR");
    }
  };

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach(t => t.stop());
      audioCtxRef.current?.in.close();
      audioCtxRef.current?.out.close();
    };
  }, []);

  if (!isEngaged) {
    return (
      <div className="fixed inset-0 bg-black z-50 flex flex-col items-center justify-center p-10 text-center">
        <div className="w-24 h-24 border border-cyan-500/20 rounded-full flex items-center justify-center mb-6 animate-pulse">
           <div className="w-16 h-16 bg-cyan-500/10 rounded-full border border-cyan-500/50 flex items-center justify-center text-cyan-500">
             <Aperture size={32} />
           </div>
        </div>
        <h1 className="text-xl font-light tracking-widest text-white mb-2 uppercase">Eburon Cortical Link</h1>
        <p className="text-[10px] font-mono-tech text-gray-500 mb-10 max-w-xs leading-relaxed">
          System requires manual initiation to establish secure audio and visual synchronization.
        </p>
        <button 
          onClick={startSession}
          className="px-8 py-3 bg-cyan-900/20 border border-cyan-500/40 text-cyan-400 font-mono-tech text-xs tracking-widest hover:bg-cyan-500/20 transition-all uppercase"
        >
          Engage System
        </button>
      </div>
    );
  }

  // --- INTERFACE COMPONENTS ---

  const renderPhoneInterface = () => (
    <div className="absolute inset-0 flex flex-col justify-between p-4 pointer-events-none animate-in fade-in">
       {/* Phone Status Bar */}
       <div className="flex justify-between items-center px-4 py-2 bg-gradient-to-b from-black/60 to-transparent">
          <FlashIcon className="text-white opacity-90 drop-shadow-md" size={24} />
          <div className="bg-black/40 backdrop-blur-md px-4 py-1 rounded-full text-white text-[10px] font-medium border border-white/10 flex items-center gap-2">
             <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse"></div>
             REC 00:04
          </div>
          <Settings className="text-white opacity-90 drop-shadow-md" size={24} />
       </div>

       {/* Camera Reticle */}
       <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-72 h-72 border border-white/20 rounded-xl pointer-events-none">
          <div className="absolute top-0 left-0 w-4 h-4 border-t-2 border-l-2 border-yellow-400"></div>
          <div className="absolute top-0 right-0 w-4 h-4 border-t-2 border-r-2 border-yellow-400"></div>
          <div className="absolute bottom-0 left-0 w-4 h-4 border-b-2 border-l-2 border-yellow-400"></div>
          <div className="absolute bottom-0 right-0 w-4 h-4 border-b-2 border-r-2 border-yellow-400"></div>
       </div>

       {/* Bottom Controls */}
       <div className="flex flex-col items-center gap-6 pb-8 pointer-events-auto bg-gradient-to-t from-black/80 via-black/40 to-transparent pt-12">
          <div className="flex items-center justify-between w-full max-w-sm px-10">
             <div className="w-12 h-12 bg-gray-800 rounded-lg border border-gray-600 flex items-center justify-center text-gray-400">
               <ImageIcon size={20} />
             </div>
             
             {/* Shutter Button (Visual) */}
             <div className="w-20 h-20 rounded-full border-4 border-white flex items-center justify-center relative shadow-lg cursor-pointer active:scale-95 transition-transform">
                <div className="w-16 h-16 bg-red-500 rounded-full"></div>
             </div>
             
             <button 
                onClick={() => manualSwitchSource('GLASSES')} 
                className="w-12 h-12 bg-gray-800/80 rounded-full flex items-center justify-center border border-gray-600 text-white hover:bg-gray-700 transition-colors"
             >
                <RotateCcw size={20} />
             </button>
          </div>
          
          <div className="flex gap-6 text-xs font-semibold text-white/80 uppercase tracking-widest shadow-black drop-shadow-md">
             <span className="opacity-50">Cinematic</span>
             <span className="text-yellow-400 border-b-2 border-yellow-400 pb-1">Video</span>
             <span className="opacity-50">Photo</span>
          </div>
       </div>
    </div>
  );

  const renderGlassesHUD = () => (
    <div className="absolute inset-0 pointer-events-none flex flex-col justify-between p-6 animate-in fade-in">
        {/* Glasses Frame Effect */}
        <div className="absolute inset-0 pointer-events-none opacity-40">
           <svg width="100%" height="100%">
              <defs>
                 <radialGradient id="vignette" cx="50%" cy="50%" r="70%">
                    <stop offset="60%" stopColor="transparent"/>
                    <stop offset="100%" stopColor="black"/>
                 </radialGradient>
              </defs>
              <rect width="100%" height="100%" fill="url(#vignette)"/>
              {/* Corner Accents */}
              <path d="M20,20 L50,20 L20,50 Z" fill="cyan" fillOpacity="0.1"/>
              <path d="M20,20 L30,20 L20,30 Z" fill="cyan"/>
              <path d="M98%,20 L95%,20 L98%,50 Z" fill="cyan" fillOpacity="0.1" transform="translate(-20,0)"/>
           </svg>
        </div>

        {/* Top HUD */}
        <div className="flex justify-between items-start z-10">
          <div className="flex flex-col gap-1">
            <div className="text-[10px] font-mono-tech tracking-widest text-cyan-500 uppercase flex items-center gap-2">
               <Glasses size={12} />
               EBURON CORTEX
            </div>
            <div className="text-[9px] font-mono-tech text-white/40 tracking-tight flex items-center gap-2">
               <Battery size={10} className="text-green-500" /> 98%
               <Wifi size={10} className="text-cyan-500" /> 5G
            </div>
          </div>
          <div className="flex gap-2 pointer-events-auto">
             <button onClick={() => manualSwitchSource('PHONE')} className="bg-black/40 border border-white/10 p-1 rounded text-white/50 hover:text-white transition-colors">
               <Smartphone size={14} />
             </button>
             <div className="text-[10px] font-mono-tech text-white/50 bg-black/40 px-3 py-1 border border-white/10 rounded tracking-[0.2em] uppercase">
                {status}
             </div>
          </div>
        </div>

        {/* Center Content */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col items-center gap-8 w-full z-10">
          {navData && (
            <div className="flex flex-col items-center">
               <div className="text-4xl font-light tracking-tighter text-white drop-shadow-[0_0_15px_rgba(6,182,212,0.8)]">{navData.distance}</div>
               <div className="text-[10px] font-mono-tech text-cyan-400 uppercase tracking-widest bg-black/50 px-2 py-1 mt-1">{navData.destination}</div>
            </div>
          )}
          {isScanning && (
            <div className="w-64 h-40 border border-purple-500/50 relative flex items-center justify-center animate-pulse bg-purple-900/10">
               <div className="absolute inset-0 bg-purple-500/5 scanline"></div>
               <div className="text-[9px] font-mono-tech text-purple-400 tracking-[0.5em] bg-black/60 px-2">ANALYZING REALITY</div>
               {/* Crosshair corners */}
               <div className="absolute top-0 left-0 w-2 h-2 border-t border-l border-purple-500"></div>
               <div className="absolute top-0 right-0 w-2 h-2 border-t border-r border-purple-500"></div>
               <div className="absolute bottom-0 left-0 w-2 h-2 border-b border-l border-purple-500"></div>
               <div className="absolute bottom-0 right-0 w-2 h-2 border-b border-r border-purple-500"></div>
            </div>
          )}
        </div>

        {/* Bottom HUD */}
        <div className="flex flex-col items-center gap-3 z-10">
          <div className="flex flex-col items-center max-w-lg w-full">
            {transcripts.map(t => (
              <div key={t.id} className={`text-[10px] font-mono-tech tracking-tight transition-all duration-500 px-4 py-1 mb-1 rounded-sm ${t.speaker === 'user' ? 'text-white/30 self-start' : 'text-cyan-400 text-center bg-cyan-950/20 border border-cyan-900/30'}`}>
                {t.speaker === 'ai' && <span className="opacity-50 mr-2">EBURON:</span>}
                {t.text}
              </div>
            ))}
          </div>
          <div className="h-[1px] w-32 bg-white/10 relative overflow-hidden">
             <div className="absolute inset-y-0 left-0 bg-cyan-500 transition-all duration-75 shadow-[0_0_10px_#22d3ee]" style={{ width: `${Math.min(100, volume)}%` }}></div>
          </div>
        </div>
    </div>
  );

  return (
    <div className="fixed inset-0 bg-black z-50 flex flex-col font-sans overflow-hidden">
      {/* Shared Video Layer */}
      <video 
        ref={videoRef} 
        className={`absolute inset-0 w-full h-full object-cover transition-all duration-500 ${camSource === 'PHONE' ? 'scale-x-[-1] opacity-100' : 'opacity-80'}`} 
        playsInline 
        muted 
      />
      <canvas ref={canvasRef} className="hidden" />

      {/* Conditional Interface Layer */}
      {camSource === 'PHONE' ? renderPhoneInterface() : renderGlassesHUD()}

      <button onClick={onClose} className="absolute top-6 right-6 p-2 rounded-full bg-black/20 text-white/30 hover:text-white transition-all z-50">
         <ChevronLeft size={24} />
      </button>
    </div>
  );
};