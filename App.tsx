
import React from 'react';
import { LiveMode } from './components/LiveMode';

const App: React.FC = () => {
  return (
    <div className="relative w-screen h-screen bg-black overflow-hidden selection:bg-cyan-500/30">
      {/* The entire application is now the Immersive Vision Experience */}
      <LiveMode />
      
      {/* Corner Brackets for global Vision UI feeling */}
      <div className="fixed top-2 left-2 w-8 h-8 border-t-2 border-l-2 border-white/10 rounded-tl-lg pointer-events-none z-[100]"></div>
      <div className="fixed top-2 right-2 w-8 h-8 border-t-2 border-r-2 border-white/10 rounded-tr-lg pointer-events-none z-[100]"></div>
      <div className="fixed bottom-2 left-2 w-8 h-8 border-b-2 border-l-2 border-white/10 rounded-bl-lg pointer-events-none z-[100]"></div>
      <div className="fixed bottom-2 right-2 w-8 h-8 border-b-2 border-r-2 border-white/10 rounded-br-lg pointer-events-none z-[100]"></div>
    </div>
  );
};

export default App;
