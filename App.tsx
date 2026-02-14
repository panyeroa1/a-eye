import React, { useState, useEffect } from 'react';
import { MessageSquare, Mic, Eye, Radio, Wifi, Battery, Command } from 'lucide-react';
import { AppMode } from './types';
import { ChatInterface } from './components/ChatInterface';
import { LiveMode } from './components/LiveMode';
import { VisionStudio } from './components/VisionStudio';
import { AudioScribe } from './components/AudioScribe';

const App: React.FC = () => {
  const [currentMode, setCurrentMode] = useState<AppMode>(AppMode.OMNI_CHAT);
  const [time, setTime] = useState(new Date().toLocaleTimeString());

  // Clock for HUD
  useEffect(() => {
    const timer = setInterval(() => setTime(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })), 1000);
    return () => clearInterval(timer);
  }, []);

  const renderContent = () => {
    switch (currentMode) {
      case AppMode.OMNI_CHAT:
        return <ChatInterface />;
      case AppMode.LIVE_VOICE:
        return <LiveMode onClose={() => setCurrentMode(AppMode.OMNI_CHAT)} />;
      case AppMode.VISION_LAB:
        return <VisionStudio />;
      case AppMode.AUDIO_SCRIBE:
        return <AudioScribe />;
      default:
        return <ChatInterface />;
    }
  };

  return (
    <div className="relative w-screen h-screen bg-black overflow-hidden selection:bg-cyan-500/30">
      
      {/* Background Ambience */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-gray-900 via-black to-black z-0"></div>
      
      {/* Scanlines & Vignette */}
      <div className="absolute inset-0 scanline z-50 pointer-events-none opacity-30"></div>
      <div className="absolute inset-0 hud-overlay z-50 pointer-events-none"></div>

      {/* MAIN INTERFACE */}
      <div className="relative z-10 flex flex-col h-full p-4 md:p-6">
        
        {/* TOP STATUS BAR */}
        <header className="flex justify-between items-center mb-4 px-2 font-mono-tech text-[10px] tracking-widest text-cyan-500/80 uppercase">
          <div className="flex items-center gap-4">
            <span className="flex items-center gap-1 text-red-500 animate-blink">
               <div className="w-1.5 h-1.5 bg-red-500 rounded-full"></div> LIVE
            </span>
            <span className="flex items-center gap-1">
              <Wifi size={10} /> LINKED
            </span>
          </div>
          
          <div className="text-glow text-xs">{time}</div>
          
          <div className="flex items-center gap-4">
             <span>EBURON v3.0</span>
             <Battery size={12} className="text-green-400 opacity-60"/>
          </div>
        </header>

        {/* CENTER VIEWPORT */}
        <main className="flex-1 relative rounded-2xl border border-white/5 overflow-hidden backdrop-blur-sm bg-black/20">
           <div className="absolute top-2 left-2 w-3 h-3 border-l border-t border-cyan-500/30 rounded-tl-sm pointer-events-none z-20"></div>
           <div className="absolute top-2 right-2 w-3 h-3 border-r border-t border-cyan-500/30 rounded-tr-sm pointer-events-none z-20"></div>
           <div className="absolute bottom-2 left-2 w-3 h-3 border-l border-b border-cyan-500/30 rounded-bl-sm pointer-events-none z-20"></div>
           <div className="absolute bottom-2 right-2 w-3 h-3 border-r border-b border-cyan-500/30 rounded-br-sm pointer-events-none z-20"></div>
           
           {renderContent()}
        </main>

        {/* BOTTOM NAV DOCK */}
        <footer className="mt-6 flex justify-center">
          <div className="glass-hud px-6 py-2 rounded-full flex items-center gap-8 border border-white/5">
            <NavItem icon={<MessageSquare size={18} />} label="CORE" isActive={currentMode === AppMode.OMNI_CHAT} onClick={() => setCurrentMode(AppMode.OMNI_CHAT)} />
            <NavItem icon={<Eye size={18} />} label="EYE" isActive={currentMode === AppMode.VISION_LAB} onClick={() => setCurrentMode(AppMode.VISION_LAB)} />
            
            <button 
              onClick={() => setCurrentMode(AppMode.LIVE_VOICE)}
              className={`relative group w-10 h-10 flex items-center justify-center rounded-full transition-all ${currentMode === AppMode.LIVE_VOICE ? 'bg-cyan-500 text-black' : 'bg-gray-900 text-cyan-400'}`}
            >
               <div className={`absolute inset-0 rounded-full border border-cyan-500 opacity-20 ${currentMode === AppMode.LIVE_VOICE ? 'animate-ping' : ''}`}></div>
               <Mic size={20} />
            </button>

            <NavItem icon={<Radio size={18} />} label="WAVE" isActive={currentMode === AppMode.AUDIO_SCRIBE} onClick={() => setCurrentMode(AppMode.AUDIO_SCRIBE)} />
            <NavItem icon={<Command size={18} />} label="OS" isActive={false} onClick={() => {}} />
          </div>
        </footer>
      </div>
    </div>
  );
};

const NavItem: React.FC<{ icon: React.ReactNode; label: string; isActive: boolean; onClick: () => void; }> = ({ icon, label, isActive, onClick }) => (
  <button
    onClick={onClick}
    className={`flex flex-col items-center gap-0.5 transition-all ${isActive ? 'text-cyan-400 text-glow' : 'text-gray-600 hover:text-gray-400'}`}
  >
    {icon}
    <span className="text-[8px] font-mono-tech tracking-wider">{label}</span>
  </button>
);

export default App;
