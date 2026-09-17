"use client";

import React from "react";
import { Users, Eye, Unlock, ShieldAlert, Award } from "lucide-react";
import type { Team } from "@/lib/db";

interface AdminTeamTableProps {
  teams: (Team & { file_count: number; violation_count: number })[];
  onInspectTeam: (teamId: string) => Promise<void>;
  onUnlockTeam: (teamId: string) => Promise<void>;
}

export function AdminTeamTable({
  teams,
  onInspectTeam,
  onUnlockTeam,
}: AdminTeamTableProps) {
  return (
    <div className="h-full flex flex-col bg-zinc-950 overflow-hidden select-none">
      {/* Header */}
      <div className="h-10 bg-zinc-900/90 border-b border-zinc-800 flex items-center justify-between px-3 shrink-0">
        <div className="flex items-center space-x-2 text-xs font-mono">
          <Users className="w-3.5 h-3.5 text-zinc-400" />
          <span className="font-semibold text-zinc-200 uppercase tracking-wider text-[11px]">
            Live Leaderboard & Evaluator Table
          </span>
          <span className="text-[10px] text-zinc-500 font-normal">
            ({teams.length} team{teams.length !== 1 ? "s" : ""} registered)
          </span>
        </div>

        <div className="flex items-center space-x-1 text-[10px] font-mono text-zinc-500">
          <Award className="w-3 h-3 text-emerald-400" />
          <span>Ranked by AI Efficiency (Fewest Prompts)</span>
        </div>
      </div>

      {/* Table Body */}
      <div className="flex-1 overflow-y-auto">
        {teams.length === 0 ? (
          <div className="py-16 px-4 text-center text-zinc-600 text-xs font-mono space-y-1">
            <Users className="w-8 h-8 mx-auto text-zinc-700 stroke-1" />
            <p>No teams have joined the event yet.</p>
            <p className="text-[11px] text-zinc-700">Teams will appear here as soon as they enter their team name on the home page.</p>
          </div>
        ) : (
          <table className="w-full text-left text-xs font-mono">
            <thead className="bg-zinc-900/80 text-[10px] text-zinc-400 uppercase tracking-wider border-b border-zinc-800 sticky top-0">
              <tr>
                <th className="py-2.5 px-3">#</th>
                <th className="py-2.5 px-3">Team</th>
                <th className="py-2.5 px-3">Prompts Used</th>
                <th className="py-2.5 px-3">Strikes</th>
                <th className="py-2.5 px-3">Files</th>
                <th className="py-2.5 px-3">Status</th>
                <th className="py-2.5 px-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-900 text-zinc-300">
              {teams.map((t, idx) => {
                const isLocked = Boolean(t.is_locked);
                const hasStrikes = t.strike_count > 0;

                return (
                  <tr
                    key={t.id}
                    className="hover:bg-zinc-900/50 transition-colors"
                  >
                    <td className="py-2.5 px-3 text-zinc-500 font-bold">
                      {idx + 1}
                    </td>

                    <td className="py-2.5 px-3 font-semibold text-zinc-100">
                      {t.name}
                    </td>

                    <td className="py-2.5 px-3">
                      <span className="px-2 py-0.5 rounded bg-zinc-900 border border-zinc-800 text-zinc-200">
                        {t.prompt_count}
                      </span>
                    </td>

                    <td className="py-2.5 px-3">
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] border font-bold ${
                          hasStrikes
                            ? isLocked
                              ? "bg-red-950 text-red-300 border-red-800"
                              : "bg-amber-950 text-amber-300 border-amber-800"
                            : "bg-zinc-900 text-zinc-500 border-zinc-800"
                        }`}
                      >
                        {t.strike_count}/3
                      </span>
                    </td>

                    <td className="py-2.5 px-3 text-zinc-400">
                      {t.file_count} files
                    </td>

                    <td className="py-2.5 px-3">
                      {isLocked ? (
                        <span className="text-[10px] px-1.5 py-0.5 bg-red-950/80 text-red-300 border border-red-800 rounded flex items-center space-x-1 w-fit">
                          <ShieldAlert className="w-3 h-3" />
                          <span>LOCKED</span>
                        </span>
                      ) : (
                        <span className="text-[10px] text-emerald-400">Active</span>
                      )}
                    </td>

                    <td className="py-2.5 px-3 text-right space-x-1.5">
                      {hasStrikes && (
                        <button
                          onClick={() => onUnlockTeam(t.id)}
                          title="Reset Strikes & Unlock"
                          className="px-2 py-1 bg-amber-950/80 hover:bg-amber-900 text-amber-300 border border-amber-800 rounded text-[10px] cursor-pointer"
                        >
                          <Unlock className="w-3 h-3 inline mr-1" />
                          <span>Reset</span>
                        </button>
                      )}

                      <button
                        onClick={() => onInspectTeam(t.id)}
                        className="px-2.5 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-100 rounded text-[10px] font-medium transition-colors cursor-pointer"
                      >
                        <Eye className="w-3 h-3 inline mr-1" />
                        <span>Inspect</span>
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
