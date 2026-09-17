"use client";

import React, { useState } from "react";
import { Shield, Key, ArrowRight, AlertCircle } from "lucide-react";

interface AdminLoginProps {
  onLogin: (pin: string) => Promise<void>;
}

export function AdminLogin({ onLogin }: AdminLoginProps) {
  const [pin, setPin] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pin.trim()) return;

    setLoading(true);
    setError(null);

    try {
      await onLogin(pin.trim());
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Invalid Admin PIN");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4 select-none">
      <div className="w-full max-w-sm bg-zinc-900 border border-zinc-800 rounded-lg p-6 shadow-2xl">
        <div className="flex items-center space-x-2 text-zinc-400 text-xs font-mono mb-3">
          <Shield className="w-4 h-4 text-zinc-300" />
          <span>ADMINISTRATION GATEWAY</span>
        </div>

        <h1 className="text-xl font-bold text-zinc-100 tracking-tight mb-1">
          Organizer Authentication
        </h1>
        <p className="text-xs text-zinc-400 mb-5 leading-relaxed font-sans">
          Enter the administrator PIN to access event orchestration, live timer controls, and judging telemetry.
        </p>

        {error && (
          <div className="mb-4 p-2.5 bg-red-950/50 border border-red-800/80 rounded text-xs text-red-300 flex items-center space-x-2">
            <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-zinc-300 mb-1.5 uppercase tracking-wider font-mono">
              Admin PIN / Passphrase
            </label>
            <div className="relative">
              <input
                type="password"
                autoFocus
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                placeholder="••••••••"
                disabled={loading}
                className="w-full pl-3 pr-10 py-2 bg-zinc-950 border border-zinc-700 rounded text-sm text-zinc-100 placeholder-zinc-600 focus:outline-hidden focus:border-zinc-400 font-mono transition-colors"
              />
              <Key className="w-4 h-4 text-zinc-500 absolute right-3 top-2.5" />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading || !pin.trim()}
            className="w-full py-2.5 px-4 bg-zinc-100 hover:bg-white text-zinc-950 font-medium text-xs uppercase tracking-wider rounded flex items-center justify-center space-x-2 disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
          >
            <span>{loading ? "Authenticating..." : "Access Dashboard"}</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </form>
      </div>
    </div>
  );
}
