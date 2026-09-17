"use client";

import React from "react";
import { AlertTriangle, Lock, Maximize2, ShieldAlert } from "lucide-react";

interface ProctoringOverlayProps {
  isLockedByStrikes: boolean;
  strikeCount: number;
  maxStrikes?: number;
  showWarningModal: boolean;
  needsFullscreen: boolean;
  onEnterFullscreen: () => void;
  onDismissWarning: () => void;
}

export function ProctoringOverlay({
  isLockedByStrikes,
  strikeCount,
  maxStrikes = 3,
  showWarningModal,
  needsFullscreen,
  onEnterFullscreen,
  onDismissWarning,
}: ProctoringOverlayProps) {
  // 1. Permanent lockout screen on Strike 3
  if (isLockedByStrikes) {
    return (
      <div className="fixed inset-0 z-50 bg-black/90 backdrop-blur-md flex items-center justify-center p-4 select-none">
        <div className="w-full max-w-md bg-zinc-950 border border-red-900 rounded-lg p-6 text-center space-y-4 shadow-2xl">
          <div className="w-12 h-12 rounded-full bg-red-950/80 border border-red-800 flex items-center justify-center mx-auto text-red-400">
            <Lock className="w-6 h-6" />
          </div>

          <div>
            <span className="text-[11px] font-mono uppercase tracking-widest text-red-400 font-bold">
              WORKSTATION LOCKED // PROCTORING VIOLATION
            </span>
            <h2 className="text-xl font-bold text-zinc-100 tracking-tight mt-1">
              3 Strikes Recorded
            </h2>
            <p className="text-xs text-zinc-400 mt-2 leading-relaxed">
              This workstation has recorded {strikeCount} proctoring violations (switching tabs, exiting fullscreen, or losing focus).
            </p>
          </div>

          <div className="p-3 bg-zinc-900 border border-zinc-800 rounded text-xs text-zinc-300 font-mono">
            Please call an event organizer to review and unlock your workstation from the Admin panel.
          </div>
        </div>
      </div>
    );
  }

  // 2. Fullscreen prompt modal when competition starts
  if (needsFullscreen) {
    return (
      <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-xs flex items-center justify-center p-4 select-none">
        <div className="w-full max-w-md bg-zinc-900 border border-zinc-800 rounded-lg p-6 text-center space-y-4 shadow-2xl">
          <div className="w-12 h-12 rounded-full bg-emerald-950/80 border border-emerald-800 flex items-center justify-center mx-auto text-emerald-400">
            <Maximize2 className="w-6 h-6" />
          </div>

          <div>
            <span className="text-[11px] font-mono uppercase tracking-widest text-emerald-400 font-bold">
              COMPETITION LIVE
            </span>
            <h2 className="text-lg font-bold text-zinc-100 tracking-tight mt-1">
              Fullscreen Required
            </h2>
            <p className="text-xs text-zinc-400 mt-2 leading-relaxed">
              The organizer has started the event timer. Enter fullscreen mode to begin coding and accessing the AI assistant.
            </p>
          </div>

          <button
            onClick={onEnterFullscreen}
            className="w-full py-2.5 px-4 bg-emerald-600 hover:bg-emerald-500 text-white font-medium text-xs uppercase tracking-wider rounded flex items-center justify-center space-x-2 transition-colors cursor-pointer"
          >
            <Maximize2 className="w-4 h-4" />
            <span>Enter Fullscreen & Begin</span>
          </button>
        </div>
      </div>
    );
  }

  // 3. Strike 1 & 2 Warning Modal
  if (showWarningModal) {
    return (
      <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-xs flex items-center justify-center p-4 select-none">
        <div className="w-full max-w-md bg-zinc-950 border border-amber-800 rounded-lg p-6 text-center space-y-4 shadow-2xl">
          <div className="w-12 h-12 rounded-full bg-amber-950/80 border border-amber-800 flex items-center justify-center mx-auto text-amber-400">
            <AlertTriangle className="w-6 h-6" />
          </div>

          <div>
            <span className="text-[11px] font-mono uppercase tracking-widest text-amber-400 font-bold">
              PROCTORING WARNING // STRIKE {strikeCount}/{maxStrikes}
            </span>
            <h2 className="text-lg font-bold text-zinc-100 tracking-tight mt-1">
              Focus Loss / Tab Switch Detected
            </h2>
            <p className="text-xs text-zinc-400 mt-2 leading-relaxed">
              You switched tabs or exited fullscreen. Leaving this workstation will lead to automatic lockout after {maxStrikes} strikes.
            </p>
          </div>

          <div className="flex space-x-2">
            <button
              onClick={() => {
                onDismissWarning();
                onEnterFullscreen();
              }}
              className="flex-1 py-2 px-4 bg-amber-600 hover:bg-amber-500 text-white font-medium text-xs uppercase tracking-wider rounded transition-colors cursor-pointer"
            >
              Return to Fullscreen
            </button>
          </div>
        </div>
      </div>
    );
  }

  return null;
}
