"use client";

import React, { useState } from "react";
import { Play, Pause, Square, Plus, Minus, RotateCcw, Clock, LogOut, Users, MessageSquare, AlertTriangle } from "lucide-react";
import { formatTime } from "@/lib/utils";
import type { CompetitionStatus } from "@/lib/db";

interface AdminHeaderProps {
  status: CompetitionStatus;
  remainingSeconds: number;
  durationMinutes: number;
  totalTeams: number;
  totalPrompts: number;
  totalStrikes: number;
  onControlAction: (action: "start" | "pause" | "resume" | "end" | "adjust_time", params?: { durationMinutes?: number; deltaSeconds?: number }) => Promise<void>;
  onLogout: () => void;
}

export function AdminHeader({
  status,
  remainingSeconds,
  durationMinutes,
  totalTeams,
  totalPrompts,
  totalStrikes,
  onControlAction,
  onLogout,
}: AdminHeaderProps) {
  const [customDuration, setCustomDuration] = useState<string>(String(durationMinutes || 120));
  const [loadingAction, setLoadingAction] = useState(false);

  const getParsedDuration = () => {
    const parsed = parseInt(customDuration, 10);
    return Math.max(1, Math.min(600, isNaN(parsed) ? (durationMinutes || 120) : parsed));
  };

  const handleAction = async (action: "start" | "pause" | "resume" | "end" | "adjust_time", params?: { durationMinutes?: number; deltaSeconds?: number }) => {
    setLoadingAction(true);
    try {
      await onControlAction(action, params);
    } finally {
      setLoadingAction(false);
    }
  };

  const getStatusBadge = () => {
    switch (status) {
      case "RUNNING":
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-mono font-medium bg-emerald-950/80 text-emerald-400 border border-emerald-800/80">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 mr-1.5 animate-pulse" />
            LIVE RUNNING
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
            NOT STARTED
          </span>
        );
    }
  };

  return (
    <header className="h-14 bg-zinc-950 border-b border-zinc-800 flex items-center justify-between px-4 shrink-0 select-none">
      {/* Left: Branding & Status */}
      <div className="flex items-center space-x-3">
        <div className="flex items-center space-x-2 font-mono">
          <div className="w-2.5 h-2.5 bg-zinc-100 rotate-45" />
          <span className="text-xs font-bold text-zinc-100 tracking-wider">
            TINY AI, BIG BRAIN // ADMIN
          </span>
        </div>
        {getStatusBadge()}
      </div>

      {/* Center: Live Timer & Primary Controls */}
      <div className="flex items-center space-x-3">
        <div className="flex items-center space-x-2 bg-zinc-900 px-3 py-1 rounded border border-zinc-800">
          <Clock className="w-4 h-4 text-zinc-400" />
          <span className="font-mono font-bold text-sm tracking-widest text-zinc-100">
            {formatTime(remainingSeconds)}
          </span>
        </div>

        {/* Action buttons depending on state */}
        {status === "NOT_STARTED" && (
          <div className="flex items-center space-x-2">
            <div className="flex items-center space-x-1 text-xs font-mono text-zinc-400 bg-zinc-900 border border-zinc-800 rounded px-2 py-1">
              <span>Duration:</span>
              <input
                type="number"
                min={1}
                max={600}
                value={customDuration}
                onChange={(e) => setCustomDuration(e.target.value)}
                className="w-12 bg-zinc-950 border border-zinc-700 rounded text-center text-zinc-100 focus:outline-hidden"
              />
              <span>min</span>
            </div>

            <button
              onClick={() => handleAction("start", { durationMinutes: getParsedDuration() })}
              disabled={loadingAction}
              className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-xs font-mono font-medium flex items-center space-x-1.5 transition-colors cursor-pointer"
            >
              <Play className="w-3.5 h-3.5 fill-current" />
              <span>Start Event</span>
            </button>
          </div>
        )}

        {status === "RUNNING" && (
          <div className="flex items-center space-x-1.5">
            <button
              onClick={() => handleAction("pause")}
              disabled={loadingAction}
              className="px-2.5 py-1 bg-amber-600 hover:bg-amber-500 text-white rounded text-xs font-mono font-medium flex items-center space-x-1 transition-colors cursor-pointer"
            >
              <Pause className="w-3.5 h-3.5 fill-current" />
              <span>Pause</span>
            </button>

            <button
              onClick={() => handleAction("adjust_time", { deltaSeconds: 300 })}
              disabled={loadingAction}
              title="Add 5 minutes"
              className="px-2 py-1 bg-zinc-900 hover:bg-zinc-800 text-zinc-300 border border-zinc-700 rounded text-xs font-mono flex items-center space-x-0.5 cursor-pointer"
            >
              <Plus className="w-3 h-3" />
              <span>5m</span>
            </button>

            <button
              onClick={() => handleAction("adjust_time", { deltaSeconds: -300 })}
              disabled={loadingAction}
              title="Deduct 5 minutes"
              className="px-2 py-1 bg-zinc-900 hover:bg-zinc-800 text-zinc-300 border border-zinc-700 rounded text-xs font-mono flex items-center space-x-0.5 cursor-pointer"
            >
              <Minus className="w-3 h-3" />
              <span>5m</span>
            </button>

            <button
              onClick={() => {
                if (confirm("End competition now? Coding will be frozen for all teams.")) {
                  handleAction("end");
                }
              }}
              disabled={loadingAction}
              className="px-2.5 py-1 bg-red-600 hover:bg-red-500 text-white rounded text-xs font-mono font-medium flex items-center space-x-1 transition-colors cursor-pointer"
            >
              <Square className="w-3.5 h-3.5 fill-current" />
              <span>End Event</span>
            </button>
          </div>
        )}

        {status === "PAUSED" && (
          <div className="flex items-center space-x-1.5">
            <button
              onClick={() => handleAction("resume")}
              disabled={loadingAction}
              className="px-3 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-xs font-mono font-medium flex items-center space-x-1 transition-colors cursor-pointer"
            >
              <Play className="w-3.5 h-3.5 fill-current" />
              <span>Resume</span>
            </button>

            <button
              onClick={() => handleAction("adjust_time", { deltaSeconds: 300 })}
              disabled={loadingAction}
              title="Add 5 minutes"
              className="px-2 py-1 bg-zinc-900 hover:bg-zinc-800 text-zinc-300 border border-zinc-700 rounded text-xs font-mono flex items-center space-x-0.5 cursor-pointer"
            >
              <Plus className="w-3 h-3" />
              <span>5m</span>
            </button>

            <button
              onClick={() => {
                if (confirm("End competition now? Coding will be frozen.")) {
                  handleAction("end");
                }
              }}
              disabled={loadingAction}
              className="px-2.5 py-1 bg-red-600 hover:bg-red-500 text-white rounded text-xs font-mono font-medium flex items-center space-x-1 cursor-pointer"
            >
              <Square className="w-3.5 h-3.5 fill-current" />
              <span>End Event</span>
            </button>
          </div>
        )}

        {status === "ENDED" && (
          <button
            onClick={() => {
              if (confirm("Restart competition from NOT_STARTED state?")) {
                handleAction("start", { durationMinutes: getParsedDuration() });
              }
            }}
            disabled={loadingAction}
            className="px-3 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded text-xs font-mono flex items-center space-x-1.5 cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Restart Event</span>
          </button>
        )}
      </div>

      {/* Right: Telemetry Counts & Logout */}
      <div className="flex items-center space-x-2 text-xs font-mono">
        <div className="flex items-center space-x-1.5 px-2.5 py-1 rounded bg-zinc-900 border border-zinc-800 text-zinc-300">
          <Users className="w-3.5 h-3.5 text-zinc-400" />
          <span>Teams: {totalTeams}</span>
        </div>

        <div className="flex items-center space-x-1.5 px-2.5 py-1 rounded bg-zinc-900 border border-zinc-800 text-zinc-300">
          <MessageSquare className="w-3.5 h-3.5 text-zinc-400" />
          <span>Prompts: {totalPrompts}</span>
        </div>

        <div
          className={`flex items-center space-x-1.5 px-2.5 py-1 rounded border ${
            totalStrikes > 0
              ? "bg-amber-950/60 text-amber-300 border-amber-800"
              : "bg-zinc-900 text-zinc-400 border-zinc-800"
          }`}
        >
          <AlertTriangle className="w-3.5 h-3.5" />
          <span>Violations: {totalStrikes}</span>
        </div>

        <button
          onClick={onLogout}
          title="Sign out of Admin"
          className="p-1.5 text-zinc-500 hover:text-zinc-200 hover:bg-zinc-900 rounded transition-colors cursor-pointer"
        >
          <LogOut className="w-4 h-4" />
        </button>
      </div>
    </header>
  );
}
