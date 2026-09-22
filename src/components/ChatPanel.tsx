"use client";

import React, { useState, useEffect, useRef } from "react";
import { Send, Copy, Check, Clock, Bot } from "lucide-react";
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

/**
 * Robust copy helper supporting both modern navigator.clipboard
 * and document.execCommand fallback for non-HTTPS / LAN IP environments.
 */
async function copyToClipboard(text: string): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall through to legacy fallback
    }
  }

  if (typeof document !== "undefined") {
    try {
      const el = document.createElement("textarea");
      el.value = text;
      el.setAttribute("readonly", "");
      el.style.position = "fixed";
      el.style.left = "-9999px";
      el.style.top = "-9999px";
      document.body.appendChild(el);
      el.select();
      el.setSelectionRange(0, 99999);
      const successful = document.execCommand("copy");
      document.body.removeChild(el);
      if (successful) return true;
    } catch {
      // Both approaches failed
    }
  }

  return false;
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
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll to bottom of chat on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [history, isSending]);

  // Auto-resize textarea height when input text changes (extends as prompt grows)
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    // Reset height temporarily to correctly compute scrollHeight on deletion
    el.style.height = "0px";
    const scrollHeight = el.scrollHeight;
    // Min height: 42px (~1-2 lines), Max height: 180px (~8-9 lines)
    const targetHeight = Math.min(Math.max(scrollHeight, 42), 180);
    el.style.height = `${targetHeight}px`;
  }, [input]);

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
      // Restore input text so team doesn't lose what they typed
      setInput(clean);
      if (err && typeof err === "object" && "remainingCooldown" in err) {
        const remaining = Number((err as { remainingCooldown?: number }).remainingCooldown);
        if (remaining > 0) {
          setCooldownRemaining(remaining);
        }
      }
    } finally {
      setIsSending(false);
    }
  };

  const handleCopy = async (text: string, key: string) => {
    const success = await copyToClipboard(text);
    if (success) {
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 2000);
    }
  };

  // Render markdown text with custom code block highlighting & copy buttons
  const renderMessageContent = (content: string, msgIndex: number) => {
    // Matches ```lang code ``` blocks, supporting CRLF/LF and trailing unclosed blocks
    const codeBlockRegex = /```([a-zA-Z0-9_-]*)[^\S\r\n]*\r?\n([\s\S]*?)(?:```|$)/g;
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
      const currentBlockKey = `code-${msgIndex}-${blockIndex}`;
      const isBlockCopied = copiedKey === currentBlockKey;

      parts.push(
        <div
          key={currentBlockKey}
          className="my-2 bg-black border border-zinc-800 rounded overflow-hidden text-xs font-mono"
        >
          <div className="h-6 bg-zinc-900 border-b border-zinc-800 flex items-center justify-between px-2 text-[10px] text-zinc-400">
            <span className="uppercase font-semibold">{lang}</span>
            <button
              type="button"
              onClick={() => handleCopy(code, currentBlockKey)}
              className="flex items-center space-x-1 hover:text-zinc-100 transition-colors cursor-pointer"
              title="Copy code snippet"
            >
              {isBlockCopied ? (
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
      {/* Messages list */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {history.length === 0 ? (
          <div className="h-full flex items-center justify-center text-zinc-600 text-xs font-mono">
            <span>Terminal ready. Send a prompt to query model.</span>
          </div>
        ) : (
          history.map((msg, idx) => {
            const isUser = msg.role === "user";
            // Don't render empty assistant bubble before first token arrives
            if (!isUser && !msg.content) return null;

            const msgKey = `msg-${msg.id || idx}`;
            const isMsgCopied = copiedKey === msgKey;

            return (
              <div
                key={msg.id || idx}
                className={`flex text-xs ${isUser ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[88%] rounded p-2.5 leading-relaxed font-sans text-xs select-text group relative ${
                    isUser
                      ? "bg-zinc-800 text-zinc-100 border border-zinc-700 whitespace-pre-wrap"
                      : "bg-zinc-900 text-zinc-300 border border-zinc-800"
                  }`}
                >
                  {!isUser && (
                    <div className="flex items-center justify-between pb-1.5 mb-1.5 border-b border-zinc-800/80 text-[10px] text-zinc-500 font-mono">
                      <span className="font-semibold text-zinc-400 flex items-center space-x-1">
                        <Bot className="w-3 h-3 text-zinc-400" />
                        <span>AI Assistant</span>
                      </span>
                      <button
                        type="button"
                        onClick={() => handleCopy(msg.content, msgKey)}
                        title="Copy full response"
                        className="opacity-60 group-hover:opacity-100 transition-opacity flex items-center space-x-1 text-zinc-400 hover:text-zinc-100 cursor-pointer"
                      >
                        {isMsgCopied ? (
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
                  )}

                  {isUser ? msg.content : renderMessageContent(msg.content, idx)}
                </div>
              </div>
            );
          })
        )}

        {isSending && (
          <div className="flex items-center space-x-2 text-xs text-zinc-400 font-mono py-1">
            <span className="w-2 h-2 rounded-full bg-zinc-500 animate-pulse" />
            <span className="text-[11px] animate-pulse">Querying model...</span>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input bar */}
      <form
        onSubmit={handleSubmit}
        className="p-2 bg-zinc-900 border-t border-zinc-800 shrink-0 select-none"
      >
        <div className="relative flex items-end">
          <textarea
            ref={textareaRef}
            rows={1}
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
                ? lockReason || "Terminal locked"
                : cooldownRemaining > 0
                ? `Cooldown active: ${cooldownRemaining}s remaining...`
                : "Enter prompt query (Enter to send, Shift+Enter for newline)..."
            }
            disabled={isLocked || isSending || cooldownRemaining > 0}
            className="w-full pl-2.5 pr-20 py-2.5 bg-zinc-950 border border-zinc-800 rounded text-xs text-zinc-100 placeholder-zinc-600 focus:outline-hidden focus:border-zinc-500 font-mono resize-none overflow-y-auto min-h-[42px] max-h-[180px] leading-relaxed disabled:opacity-50 disabled:cursor-not-allowed"
          />

          <button
            type="submit"
            disabled={isLocked || isSending || !input.trim() || cooldownRemaining > 0}
            className="absolute right-2 bottom-2 px-2.5 py-1.5 bg-zinc-100 hover:bg-white text-zinc-900 rounded text-[11px] font-mono font-medium flex items-center space-x-1 disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
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
