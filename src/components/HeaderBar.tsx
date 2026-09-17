"use client";

import React from "react";
import { Play, Maximize2, Minimize2, AlertTriangle, MessageSquare, LogOut, Clock } from "lucide-react";
import { formatTime } from "@/lib/utils";

interface HeaderBarProps {
  teamName: string;
  status: "NOT_STARTED" | "RUNNING" | "PAUSED" | "ENDED";
  remainingSeconds: number;
  promptCount: number;
  strikeCount: number;
  maxStrikes?: number;
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
  onRunPreview: () => void;
  onLeaveTeam: () => void;
  isSaving?: boolean;
}

export function HeaderBar({
  teamName,
  status,
  remainingSeconds,
  promptCount,
  strikeCount,
  maxStrikes = 3,
  isFullscreen,
  onToggleFullscreen,
  onRunPreview,
  onLeaveTeam,
  isSaving = false,
}: HeaderBarProps) {
  const getStatusBadge = () => {
    switch (status) {
      case "RUNNING":
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-mono font-medium bg-emerald-950/80 text-emerald-400 border border-emerald-800/80">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 mr-1.5 animate-pulse" />
            LIVE
          </span>
        );
      case "PAUSED":
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-mono font-medium bg-amber-950/80 text-amber-400 border border-amber-800/80">
            PAUSED
          </span>
        );
      case "ENDED":
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-mono font-medium bg-red-950/80 text-red-400 border border-red-800/80">
            ENDED
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-mono font-medium bg-zinc-800 text-zinc-300 border border-zinc-700">
            LOCKED
          </span>
        );
    }
  };

  const isLowTime = status === "RUNNING" && remainingSeconds <= 300;

  return (
    <header className="h-12 bg-zinc-950 border-b border-zinc-800 flex items-center justify-between px-3 shrink-0 select-none">
      {/* Left: Event Title & Status */}
      <div className="flex items-center space-x-3">
        <div className="flex items-center space-x-2">
          <div className="w-2.5 h-2.5 bg-zinc-200 rotate-45" />
          <span className="font-mono text-xs font-semibold text-zinc-100 tracking-wider">
            TINYAI // PUP
          </span>
        </div>
        {getStatusBadge()}
        {isSaving && (
          <span className="text-[10px] text-zinc-500 font-mono animate-pulse">
            Saving...
          </span>
        )}
      </div>

      {/* Center: Live Timer Countdown */}
      <div className="flex items-center space-x-2">
        <Clock className={`w-3.5 h-3.5 ${isLowTime ? "text-red-400 animate-pulse" : "text-zinc-500"}`} />
        <span
          className={`font-mono font-bold text-sm tracking-widest ${
            status === "RUNNING"
              ? isLowTime
                ? "text-red-400 animate-pulse"
                : "text-zinc-100"
              : status === "ENDED"
              ? "text-zinc-500"
              : "text-zinc-400"
          }`}
        >
          {status === "NOT_STARTED" ? "WAITING FOR START" : formatTime(remainingSeconds)}
        </span>
      </div>

      {/* Right: Telemetry & Actions */}
      <div className="flex items-center space-x-2">
        {/* Strikes pill */}
        <div
          title="Proctoring strikes (max 3 before lockout)"
          className={`flex items-center space-x-1.5 px-2 py-1 rounded text-xs font-mono border ${
            strikeCount > 0
              ? strikeCount >= maxStrikes
                ? "bg-red-950/80 text-red-300 border-red-800"
                : "bg-amber-950/80 text-amber-300 border-amber-800"
              : "bg-zinc-900 text-zinc-400 border-zinc-800"
          }`}
        >
          <AlertTriangle className="w-3 h-3" />
          <span>
            {strikeCount}/{maxStrikes}
          </span>
        </div>

        {/* Prompt counter */}
        <div
          title="Total AI Prompts Sent"
          className="flex items-center space-x-1.5 px-2 py-1 rounded text-xs font-mono bg-zinc-900 text-zinc-300 border border-zinc-800"
        >
          <MessageSquare className="w-3 h-3 text-zinc-400" />
          <span>Prompts: {promptCount}</span>
        </div>

        {/* Team Name badge */}
        <div className="px-2 py-1 rounded text-xs font-mono font-medium bg-zinc-800/80 text-zinc-200 border border-zinc-700 max-w-[130px] truncate">
          {teamName}
        </div>

        {/* Run Preview Action Button */}
        <button
          onClick={onRunPreview}
          title="Run / Reload Game Preview (Ctrl+S or Ctrl+Enter)"
          className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white rounded text-xs font-medium flex items-center space-x-1 transition-colors cursor-pointer"
        >
          <Play className="w-3 h-3 fill-current" />
          <span>Run</span>
        </button>

        {/* Fullscreen Toggle */}
        <button
          onClick={onToggleFullscreen}
          title={isFullscreen ? "Exit Fullscreen" : "Enter Fullscreen"}
          className="p-1.5 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-900 rounded border border-zinc-800 transition-colors cursor-pointer"
        >
          {isFullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
        </button>

        {/* Leave Team */}
        <button
          onClick={onLeaveTeam}
          title="Switch Team / Leave"
          className="p-1.5 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900 rounded transition-colors cursor-pointer"
        >
          <LogOut className="w-3.5 h-3.5" />
        </button>
      </div>
    </header>
  );
}
