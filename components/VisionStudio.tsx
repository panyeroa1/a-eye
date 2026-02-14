import React, { useState } from 'react';
import { Upload, Zap, Aperture, AlertCircle, ScanLine, Maximize, FileImage } from 'lucide-react';
import { analyzeMedia, generateProImage } from '../services/geminiService';

export const VisionStudio: React.FC = () => {
  const [mode, setMode] = useState<'SCAN' | 'DREAM'>('DREAM');
  
  // SCAN (Analyze)
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [scanResult, setScanResult] = useState('');
  const [isScanning, setIsScanning] = useState(false);

  // DREAM (Generate)
  const [prompt, setPrompt] = useState('');
  const [genImage, setGenImage] = useState<string | null>(null);
  const [isDreaming, setIsDreaming] = useState(false);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.[0]) {
      const f = e.target.files[0];
      setFile(f);
      const reader = new FileReader();
      reader.onload = (ev) => setPreview(ev.target?.result as string);
      reader.readAsDataURL(f);
    }
  };

  const executeScan = async () => {
    if (!preview || !file) return;
    setIsScanning(true);
    try {
      const base64 = preview.split(',')[1];
      const res = await analyzeMedia(base64, file.type, "Analyze this visual data. Identify objects and context.", file.type.startsWith('video'));
      setScanResult(res || "NO DATA DETECTED.");
    } catch { setScanResult("SCAN FAILURE."); }
    finally { setIsScanning(false); }
  };

  const executeDream = async () => {
    if (!prompt) return;
    if (window.aistudio && !(await window.aistudio.hasSelectedApiKey())) {
      try { await window.aistudio.openSelectKey(); } catch { return; }
    }
    setIsDreaming(true);
    try {
      const res = await generateProImage(prompt, '1K');
      setGenImage(res);
    } catch { alert("GENERATION FAILED"); }
    finally { setIsDreaming(false); }
  };

  return (
    <div className="h-full flex flex-col relative text-cyan-50">
      {/* Viewfinder Overlay Elements */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[80%] h-[60%] border border-cyan-500/20 pointer-events-none"></div>
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-4 h-4 text-cyan-500/50 pointer-events-none">+</div>

      {/* Mode Toggle */}
      <div className="absolute top-4 right-4 z-20 flex flex-col gap-2">
         <button onClick={() => setMode('DREAM')} className={`p-2 rounded border ${mode === 'DREAM' ? 'border-cyan-500 bg-cyan-900/20 text-glow' : 'border-gray-700 text-gray-600'}`}>
            <Zap size={16} />
         </button>
         <button onClick={() => setMode('SCAN')} className={`p-2 rounded border ${mode === 'SCAN' ? 'border-cyan-500 bg-cyan-900/20 text-glow' : 'border-gray-700 text-gray-600'}`}>
            <Aperture size={16} />
         </button>
      </div>

      {mode === 'DREAM' ? (
        <div className="flex-1 flex flex-col justify-end p-6 z-10">
          {genImage ? (
             <div className="absolute inset-0 z-0">
               <img src={genImage} className="w-full h-full object-cover opacity-80" />
               <div className="absolute bottom-0 left-0 right-0 h-1/2 bg-gradient-to-t from-black to-transparent"></div>
             </div>
          ) : (
            <div className="absolute inset-0 flex items-center justify-center text-gray-800 font-mono-tech text-6xl opacity-20 pointer-events-none">
               VISUALIZER
            </div>
          )}

          <div className="relative z-10 bg-black/60 backdrop-blur-sm p-4 rounded-lg border border-white/10 border-l-4 border-l-cyan-500">
             <label className="text-[10px] text-cyan-400 font-mono-tech tracking-widest mb-2 block">PROMPT INPUT (GENERATE)</label>
             <textarea 
               value={prompt}
               onChange={(e) => setPrompt(e.target.value)}
               className="w-full bg-transparent border-none text-white focus:outline-none font-light text-sm resize-none mb-2"
               placeholder="Describe visual output..."
               rows={2}
             />
             <button 
               onClick={executeDream}
               disabled={isDreaming || !prompt}
               className="w-full py-2 bg-cyan-900/40 border border-cyan-500/50 text-cyan-300 text-xs font-mono-tech hover:bg-cyan-500/20 transition-all flex items-center justify-center gap-2"
             >
               {isDreaming ? <ScanLine className="animate-spin" size={14}/> : <Zap size={14}/>} 
               {isDreaming ? "RENDERING..." : "INITIATE GENERATION"}
             </button>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex flex-col z-10 relative">
          {/* Scanner View */}
          <div className="flex-1 relative bg-gray-900/50 flex items-center justify-center overflow-hidden">
             {preview ? (
               file?.type.startsWith('video') 
                 ? <video src={preview} autoPlay loop muted className="w-full h-full object-cover opacity-60 grayscale hover:grayscale-0 transition-all"/>
                 : <img src={preview} className="w-full h-full object-cover opacity-60 grayscale hover:grayscale-0 transition-all" />
             ) : (
               <div className="text-center text-gray-600 font-mono-tech text-xs">
                 <Upload size={32} className="mx-auto mb-2 opacity-50"/>
                 <p>NO SIGNAL SOURCE</p>
                 <p>CLICK TO UPLOAD MEDIA</p>
               </div>
             )}
             
             <input type="file" onChange={handleFile} className="absolute inset-0 opacity-0 cursor-pointer" />
             
             {isScanning && (
               <div className="absolute inset-0 bg-cyan-500/10 z-20 flex items-center justify-center">
                 <div className="w-full h-1 bg-cyan-400 shadow-[0_0_15px_#22d3ee] animate-[bounce_1s_infinite]"></div>
               </div>
             )}
          </div>

          <div className="h-1/3 bg-black/80 backdrop-blur border-t border-cyan-900/50 p-4 overflow-y-auto">
             <div className="flex justify-between items-center mb-2">
                <span className="text-[10px] text-cyan-500 font-mono-tech">ANALYSIS LOG</span>
                <button onClick={executeScan} disabled={!file || isScanning} className="text-xs bg-cyan-900/50 px-3 py-1 rounded border border-cyan-700 text-cyan-300">
                   SCAN TARGET
                </button>
             </div>
             <p className="font-mono-tech text-xs text-green-400 leading-relaxed">
               {scanResult || "Waiting for target acquisition..."}
             </p>
          </div>
        </div>
      )}
    </div>
  );
};
