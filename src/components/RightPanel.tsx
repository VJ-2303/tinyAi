"use client";

import React, { useState } from "react";
import { Play } from "lucide-react";
import { PreviewPanel } from "./PreviewPanel";
import { ChatPanel } from "./ChatPanel";
import type { FileRecord, PromptRecord } from "@/lib/db";

interface RightPanelProps {
  teamId: string;
  files: FileRecord[];
  runTrigger: number;
  chatHistory: PromptRecord[];
  promptCount: number;
  onSendPrompt: (message: string) => Promise<void>;
  isLocked: boolean;
  lockReason?: string;
  cooldownSeconds?: number;
}

export function RightPanel({
  teamId,
  files,
  runTrigger,
  chatHistory,
  promptCount,
  onSendPrompt,
  isLocked,
  lockReason,
  cooldownSeconds,
}: RightPanelProps) {
  const [activeTab, setActiveTab] = useState<"preview" | "chat">("preview");

  return (
    <div className="h-full flex flex-col bg-zinc-950 overflow-hidden select-none">
      {/* Top Tab Bar to switch between Preview and Chatbot */}
      <div className="h-9 bg-zinc-900 border-b border-zinc-800 flex items-center justify-between px-2 shrink-0">
        <div className="flex items-center space-x-1 h-full font-mono text-xs">
          <button
            onClick={() => setActiveTab("preview")}
            className={`h-7 px-3 rounded-t flex items-center space-x-1.5 transition-colors cursor-pointer ${
              activeTab === "preview"
                ? "bg-zinc-950 text-zinc-100 font-medium"
                : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50"
            }`}
          >
            <Play className="w-3 h-3 fill-current text-emerald-400" />
            <span>Game Preview</span>
          </button>

          <button
            onClick={() => setActiveTab("chat")}
            className={`h-7 px-3 rounded-t flex items-center space-x-1.5 transition-colors cursor-pointer ${
              activeTab === "chat"
                ? "bg-zinc-950 text-zinc-100 font-medium"
                : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50"
            }`}
          >
            <span>AI Terminal</span>
            <span className="ml-1 px-1.5 py-0.2 rounded-full text-[10px] bg-zinc-800 text-zinc-300">
              {promptCount}
            </span>
          </button>
        </div>
      </div>

      {/* Panel Body */}
      <div className="flex-1 overflow-hidden relative">
        <div className={`h-full w-full ${activeTab === "preview" ? "block" : "hidden"}`}>
          <PreviewPanel files={files} runTrigger={runTrigger} />
        </div>
        <div className={`h-full w-full ${activeTab === "chat" ? "block" : "hidden"}`}>
          <ChatPanel
            teamId={teamId}
            history={chatHistory}
            promptCount={promptCount}
            onSendPrompt={onSendPrompt}
            isLocked={isLocked}
            lockReason={lockReason}
            cooldownSeconds={cooldownSeconds}
          />
        </div>
      </div>
    </div>
  );
}
