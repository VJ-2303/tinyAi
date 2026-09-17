"use client";

import React, { useState, useEffect, useRef } from "react";
import { Send, Copy, Check, Clock } from "lucide-react";
import type { PromptRecord } from "@/lib/db";

interface ChatPanelProps {
  teamId: string;
  history: PromptRecord[];
  promptCount: number;
  onSendPrompt: (message: string) => Promise<void>;
  isLocked: boolean;
  lockReason?: string;
  cooldownSeconds?: number;
}

export function ChatPanel({
  history,
  promptCount,
  onSendPrompt,
  isLocked,
  lockReason,
  cooldownSeconds = 10,
}: ChatPanelProps) {
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [cooldownRemaining, setCooldownRemaining] = useState(0);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom of chat
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [history, isSending]);

  // Cooldown countdown timer
  useEffect(() => {
    if (cooldownRemaining <= 0) return;

    const timer = setInterval(() => {
      setCooldownRemaining((prev) => Math.max(0, prev - 1));
    }, 1000);

    return () => clearInterval(timer);
  }, [cooldownRemaining]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = input.trim();
    if (!clean || isSending || isLocked || cooldownRemaining > 0) return;

    setIsSending(true);
    setInput("");

    try {
      await onSendPrompt(clean);
      setCooldownRemaining(cooldownSeconds);
    } catch (err: unknown) {
      console.error("Chat error:", err);
    } finally {
      setIsSending(false);
    }
  };

  const handleCopyCode = (codeText: string, index: number) => {
    navigator.clipboard.writeText(codeText);
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  // Render markdown text with custom code block highlighting & copy buttons
  const renderMessageContent = (content: string, msgIndex: number) => {
    const codeBlockRegex = /```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g;
    const parts = [];
    let lastIndex = 0;
    let match;
    let blockIndex = 0;

    while ((match = codeBlockRegex.exec(content)) !== null) {
      if (match.index > lastIndex) {
        parts.push(
          <span key={`text-${lastIndex}`} className="whitespace-pre-wrap">
            {content.slice(lastIndex, match.index)}
          </span>
        );
      }

      const lang = match[1] || "code";
      const code = match[2].trim();
      const currentBlockId = msgIndex * 100 + blockIndex;

      parts.push(
        <div
          key={`code-${currentBlockId}`}
          className="my-2 bg-black border border-zinc-800 rounded overflow-hidden text-xs font-mono"
        >
          <div className="h-6 bg-zinc-900 border-b border-zinc-800 flex items-center justify-between px-2 text-[10px] text-zinc-400">
            <span className="uppercase">{lang}</span>
            <button
              onClick={() => handleCopyCode(code, currentBlockId)}
              className="flex items-center space-x-1 hover:text-zinc-100 transition-colors cursor-pointer"
            >
              {copiedIndex === currentBlockId ? (
                <>
                  <Check className="w-3 h-3 text-emerald-400" />
                  <span className="text-emerald-400">Copied</span>
                </>
              ) : (
                <>
                  <Copy className="w-3 h-3" />
                  <span>Copy</span>
                </>
              )}
            </button>
          </div>
          <pre className="p-2.5 overflow-x-auto text-zinc-200 leading-relaxed select-text">
            <code>{code}</code>
          </pre>
        </div>
      );

      blockIndex++;
      lastIndex = match.index + match[0].length;
    }

    if (lastIndex < content.length) {
      parts.push(
        <span key={`text-${lastIndex}`} className="whitespace-pre-wrap">
          {content.slice(lastIndex)}
        </span>
      );
    }

    return parts;
  };

  return (
    <div className="h-full flex flex-col bg-zinc-950 overflow-hidden select-none">
      {/* Chat header */}
      <div className="h-9 bg-zinc-900/90 border-b border-zinc-800 flex items-center justify-between px-3 shrink-0">
        <div className="flex items-center space-x-2 text-xs font-mono text-zinc-300">
          <span className="font-semibold text-zinc-200 uppercase tracking-wider text-[11px]">
            AI Assistant (&lt;1B LLM)
          </span>
        </div>
        <span className="text-[10px] font-mono text-zinc-400 px-1.5 py-0.5 rounded bg-zinc-800">
          Score: {promptCount} prompts
        </span>
      </div>

      {/* Messages list */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {history.length === 0 ? (
          <div className="py-12 px-4 text-center text-zinc-500 text-xs space-y-1.5 font-mono">
            <p className="font-medium text-zinc-300">Ask coding or syntax questions</p>
            <p className="text-[11px] text-zinc-600 max-w-xs mx-auto">
              Weak models cannot reason multi-step architecture. Ask for small, self-contained functions or math logic.
            </p>
          </div>
        ) : (
          history.map((msg, idx) => {
            const isUser = msg.role === "user";
            return (
              <div
                key={msg.id || idx}
                className={`flex text-xs ${isUser ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[88%] rounded p-2.5 leading-relaxed font-sans text-xs select-text ${
                    isUser
                      ? "bg-zinc-800 text-zinc-100 border border-zinc-700 whitespace-pre-wrap"
                      : "bg-zinc-900 text-zinc-300 border border-zinc-800"
                  }`}
                >
                  <div className="text-[10px] font-mono text-zinc-500 mb-1 uppercase tracking-wider font-semibold">
                    {isUser ? "Team" : "Assistant"}
                  </div>
                  {isUser ? msg.content : renderMessageContent(msg.content, idx)}
                </div>
              </div>
            );
          })
        )}

        {isSending && (
          <div className="flex items-center space-x-2 text-xs text-zinc-400 font-mono py-1">
            <span className="w-2 h-2 rounded-full bg-zinc-500 animate-pulse" />
            <span className="text-[11px] animate-pulse">Assistant generating response...</span>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input bar */}
      <form
        onSubmit={handleSubmit}
        className="p-2 bg-zinc-900 border-t border-zinc-800 shrink-0 select-none"
      >
        <div className="relative">
          <textarea
            rows={2}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSubmit(e);
              }
            }}
            placeholder={
              isLocked
                ? lockReason || "Chat locked"
                : cooldownRemaining > 0
                ? `Cooldown active: ${cooldownRemaining}s remaining...`
                : "Ask for code or math logic (Enter to send, Shift+Enter for newline)..."
            }
            disabled={isLocked || isSending || cooldownRemaining > 0}
            className="w-full pl-2.5 pr-20 py-2 bg-zinc-950 border border-zinc-800 rounded text-xs text-zinc-100 placeholder-zinc-600 focus:outline-hidden focus:border-zinc-500 font-mono resize-none disabled:opacity-50 disabled:cursor-not-allowed"
          />

          <button
            type="submit"
            disabled={isLocked || isSending || !input.trim() || cooldownRemaining > 0}
            className="absolute right-2 bottom-2.5 px-2.5 py-1 bg-zinc-100 hover:bg-white text-zinc-900 rounded text-[11px] font-mono font-medium flex items-center space-x-1 disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
          >
            {cooldownRemaining > 0 ? (
              <>
                <Clock className="w-3 h-3" />
                <span>{cooldownRemaining}s</span>
              </>
            ) : isSending ? (
              <span>...</span>
            ) : (
              <>
                <span>Send</span>
                <Send className="w-3 h-3" />
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
