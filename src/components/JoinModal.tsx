"use client";

import React, { useState } from "react";
import { Terminal, ArrowRight, ShieldAlert } from "lucide-react";

interface JoinModalProps {
  onJoin: (teamName: string) => Promise<void>;
}

export function JoinModal({ onJoin }: JoinModalProps) {
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;

    setLoading(true);
    setError(null);

    try {
      await onJoin(trimmed);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to enter workspace");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4">
      <div className="w-full max-w-md bg-zinc-900 border border-zinc-800 rounded-lg p-6 shadow-2xl">
        <div className="flex items-center space-x-2 text-zinc-400 text-xs font-mono mb-3">
          <Terminal className="w-4 h-4 text-zinc-300" />
          <span>PROMPT UNDER PRESSURE // LIVE HACKATHON</span>
        </div>

        <h1 className="text-xl font-bold text-zinc-100 tracking-tight mb-1">
          Workstation Registration
        </h1>
        <p className="text-xs text-zinc-400 mb-6 leading-relaxed">
          Enter your team name to access the code environment. One shared workstation per team of 2.
        </p>

        {error && (
          <div className="mb-4 p-3 bg-red-950/50 border border-red-800/80 rounded text-xs text-red-300 flex items-start space-x-2">
            <ShieldAlert className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-zinc-300 mb-1.5 uppercase tracking-wider font-mono">
              Team Name
            </label>
            <input
              type="text"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. VelocityDevs"
              disabled={loading}
              className="w-full px-3 py-2 bg-zinc-950 border border-zinc-700 rounded text-sm text-zinc-100 placeholder-zinc-600 focus:outline-hidden focus:border-zinc-400 font-mono transition-colors"
            />
          </div>

          <div className="bg-zinc-950/60 border border-zinc-800/80 rounded p-3 text-[11px] text-zinc-400 space-y-1">
            <div className="font-semibold text-zinc-300">Rules in brief:</div>
            <div>• All code and prompts are locked until organizer starts the event.</div>
            <div>• Fullscreen enforced during active sprint; tab-switches count strikes.</div>
            <div>• Build completely from scratch; prompts to weak AI are tracked.</div>
          </div>

          <button
            type="submit"
            disabled={loading || !name.trim()}
            className="w-full py-2.5 px-4 bg-zinc-100 hover:bg-white text-zinc-950 font-medium text-xs uppercase tracking-wider rounded flex items-center justify-center space-x-2 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <span>{loading ? "Entering..." : "Enter Workspace"}</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </form>
      </div>
    </div>
  );
}
