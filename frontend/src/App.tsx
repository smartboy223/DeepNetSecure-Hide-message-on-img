import { useState, useEffect } from 'react';
import { Shield, Lock, Unlock } from 'lucide-react';
import SenderView from './components/SenderView';
import ReceiverView from './components/ReceiverView';
import CyberBackground from './components/CyberBackground';

export default function App() {
  const [activeTab, setActiveTab] = useState<'send' | 'receive'>('send');

  useEffect(() => {
    document.title = activeTab === 'send' ? 'DeepNetSecure — Encode' : 'DeepNetSecure — Decode';
  }, [activeTab]);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 font-sans selection:bg-cyan-500/30 relative overflow-x-hidden flex flex-col">
      {/* Cyber grid background */}
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#0891b2_1px,transparent_1px),linear-gradient(to_bottom,#0891b2_1px,transparent_1px)] bg-size-[4rem_4rem] mask-[radial-gradient(ellipse_60%_50%_at_50%_0%,#000_70%,transparent_100%)] opacity-[0.03] pointer-events-none" aria-hidden />
      
      {/* Animated Nodes Background */}
      <CyberBackground />

      <header className="border-b border-cyan-900/30 bg-slate-950/80 backdrop-blur-md sticky top-0 z-10">
        <div className="w-full max-w-[min(100%,2200px)] mx-auto px-4 sm:px-8 xl:px-12 min-h-16 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 text-cyan-400">
            <div className="relative flex h-8 w-8 items-center justify-center rounded-lg border border-cyan-500/30 bg-cyan-500/10">
              <Shield className="w-5 h-5" />
              <div className="absolute inset-0 rounded-lg ring-1 ring-inset ring-cyan-500/20 animate-pulse" />
            </div>
            <div>
              <h1 className="text-xl sm:text-2xl font-bold tracking-widest text-slate-100 uppercase">DeepNet<span className="text-cyan-500">Secure</span></h1>
            </div>
          </div>
          <div
            className="flex bg-slate-900/80 p-1 rounded-lg border border-cyan-900/50 font-mono text-sm shrink-0"
            role="group"
            aria-label="Switch between Encode and Decode"
          >
            <button
              type="button"
              onClick={() => setActiveTab('send')}
              className={`px-3 sm:px-4 py-2 rounded-md font-medium transition-all flex items-center gap-2 uppercase tracking-wider ${
                activeTab === 'send' 
                  ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/50 shadow-[0_0_10px_rgba(6,182,212,0.2)]' 
                  : 'text-slate-500 hover:text-cyan-400 hover:bg-slate-800'
              }`}
            >
              <Lock className="w-4 h-4" aria-hidden />
              <span className="hidden sm:inline">Encode</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('receive')}
              className={`px-3 sm:px-4 py-2 rounded-md font-medium transition-all flex items-center gap-2 uppercase tracking-wider ${
                activeTab === 'receive' 
                  ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/50 shadow-[0_0_10px_rgba(6,182,212,0.2)]' 
                  : 'text-slate-500 hover:text-cyan-400 hover:bg-slate-800'
              }`}
            >
              <Unlock className="w-4 h-4" aria-hidden />
              <span className="hidden sm:inline">Decode</span>
            </button>
          </div>
        </div>
      </header>

      <main
        id="panel-main"
        className="w-full max-w-[min(100%,2200px)] mx-auto px-4 sm:px-8 xl:px-12 py-6 sm:py-10 relative z-10 flex-1"
      >
        {activeTab === 'send' ? <SenderView /> : <ReceiverView />}
      </main>

      <footer className="border-t border-cyan-900/30 bg-slate-950/80 backdrop-blur-md relative z-10 mt-auto">
        <div className="w-full max-w-[min(100%,2200px)] mx-auto px-4 sm:px-8 xl:px-12 py-5 flex items-center justify-center sm:justify-start">
          <p className="text-sm font-mono text-slate-500">
            DeepNetSecure local image steganography workspace
          </p>
        </div>
      </footer>
    </div>
  );
}
