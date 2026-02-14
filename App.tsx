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
        // Render inline for the glasses feel
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
      
      {/* --- HUD LAYERS --- */}
      
      {/* Background Ambience (Simulated pass-through dark mode) */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-gray-900 via-black to-black z-0"></div>
      
      {/* Scanlines & Vignette */}
      <div className="absolute inset-0 scanline z-50 pointer-events-none opacity-30"></div>
      <div className="absolute inset-0 hud-overlay z-50 pointer-events-none"></div>

      {/* --- MAIN INTERFACE --- */}

      <div className="relative z-10 flex flex-col h-full p-4 md:p-6">
        
        {/* TOP STATUS BAR (Heads Up Info) */}
        <header className="flex justify-between items-center mb-4 px-2 font-mono-tech text-xs tracking-widest text-cyan-500/80 uppercase">
          <div className="flex items-center gap-4">
            <span className="flex items-center gap-1 text-red-500 animate-blink">
               <div className="w-2 h-2 bg-red-500 rounded-full"></div> REC
            </span>
            <span className="flex items-center gap-1">
              <Wifi size={12} /> 5G+
            </span>
          </div>
          
          <div className="text-glow text-sm">{time}</div>
          
          <div className="flex items-center gap-4">
             <span>EBO-OS v2.1</span>
             <Battery size={14} className="text-green-400"/>
          </div>
        </header>

        {/* CENTER VIEWPORT (The Lens) */}
        <main className="flex-1 relative rounded-2xl border border-white/10 overflow-hidden backdrop-blur-sm bg-black/20 shadow-[0_0_50px_rgba(0,0,0,0.5)_inset]">
           {/* Decorative Corner Brackets */}
           <div className="absolute top-2 left-2 w-4 h-4 border-l-2 border-t-2 border-cyan-500/50 rounded-tl-sm pointer-events-none z-20"></div>
           <div className="absolute top-2 right-2 w-4 h-4 border-r-2 border-t-2 border-cyan-500/50 rounded-tr-sm pointer-events-none z-20"></div>
           <div className="absolute bottom-2 left-2 w-4 h-4 border-l-2 border-b-2 border-cyan-500/50 rounded-bl-sm pointer-events-none z-20"></div>
           <div className="absolute bottom-2 right-2 w-4 h-4 border-r-2 border-b-2 border-cyan-500/50 rounded-br-sm pointer-events-none z-20"></div>
           
           {renderContent()}
        </main>

        {/* BOTTOM NAV DOCK (Widely Thin Interface) */}
        <footer className="mt-6 flex justify-center">
          <div className="glass-hud px-6 py-3 rounded-full flex items-center gap-8 border border-white/10">
            <NavItem 
              icon={<MessageSquare size={20} />} 
              label="CHAT" 
              isActive={currentMode === AppMode.OMNI_CHAT}
              onClick={() => setCurrentMode(AppMode.OMNI_CHAT)}
            />
            <NavItem 
              icon={<Eye size={20} />} 
              label="VIS" 
              isActive={currentMode === AppMode.VISION_LAB}
              onClick={() => setCurrentMode(AppMode.VISION_LAB)}
            />
            
            {/* Center Live Button */}
            <button 
              onClick={() => setCurrentMode(AppMode.LIVE_VOICE)}
              className={`relative group w-12 h-12 flex items-center justify-center rounded-full transition-all ${currentMode === AppMode.LIVE_VOICE ? 'bg-cyan-500 text-black shadow-[0_0_20px_rgba(6,182,212,0.6)]' : 'bg-gray-800 text-cyan-400 hover:bg-gray-700'}`}
            >
               <div className={`absolute inset-0 rounded-full border border-cyan-500 opacity-50 ${currentMode === AppMode.LIVE_VOICE ? 'animate-ping' : ''}`}></div>
               <Mic size={24} />
            </button>

            <NavItem 
              icon={<Radio size={20} />} 
              label="AUD" 
              isActive={currentMode === AppMode.AUDIO_SCRIBE}
              onClick={() => setCurrentMode(AppMode.AUDIO_SCRIBE)}
            />
            <NavItem 
              icon={<Command size={20} />} 
              label="SET" 
              isActive={false}
              onClick={() => {}} // Settings placeholder
            />
          </div>
        </footer>
      </div>
    </div>
  );
};

const NavItem: React.FC<{ 
  icon: React.ReactNode; 
  label: string; 
  isActive: boolean; 
  onClick: () => void; 
}> = ({ icon, label, isActive, onClick }) => (
  <button
    onClick={onClick}
    className={`flex flex-col items-center gap-1 transition-all ${
      isActive 
        ? 'text-cyan-400 scale-110 text-glow' 
        : 'text-gray-500 hover:text-gray-300'
    }`}
  >
    {icon}
    <span className="text-[9px] font-mono-tech tracking-wider">{label}</span>
  </button>
);

export default App;