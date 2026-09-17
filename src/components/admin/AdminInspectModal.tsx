"use client";

import React, { useState, useMemo, useEffect } from "react";
import { X, Play, Code, MessageSquare, AlertTriangle, RotateCw, Copy, Check, Unlock, ExternalLink } from "lucide-react";
import Editor from "@monaco-editor/react";
import type { Team, FileRecord, PromptRecord, Violation } from "@/lib/db";

interface AdminInspectModalProps {
  team: Team;
  files: FileRecord[];
  violations: Violation[];
  prompts: PromptRecord[];
  onClose: () => void;
  onUnlockTeam: (teamId: string) => Promise<void>;
}

export function AdminInspectModal({
  team,
  files,
  violations,
  prompts,
  onClose,
  onUnlockTeam,
}: AdminInspectModalProps) {
  const [activeTab, setActiveTab] = useState<"game" | "code" | "prompts" | "violations">("game");
  const [activeFilename, setActiveFilename] = useState<string>(files[0]?.filename || "index.html");
  const [gameReloadKey, setGameReloadKey] = useState(0);
  const [copied, setCopied] = useState(false);
  const [unlocking, setUnlocking] = useState(false);

  // Close modal on Escape key press
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  // Bundle files for live playable game iframe
  const bundledHtml = useMemo(() => {
    const indexHtml = files.find((f) => f.filename === "index.html")?.content || "<h3>No index.html</h3>";
    const cssFiles = files.filter((f) => f.filename.endsWith(".css"));
    const jsFiles = files.filter((f) => f.filename.endsWith(".js"));

    const combinedCss = cssFiles.map((f) => f.content).join("\n");

    const errorCatcherScript = `
<script>
  window.onerror = function(msg, url, lineNo) {
    try {
      var banner = document.getElementById('tinyai-eval-error');
      if (!banner) {
        banner = document.createElement('div');
        banner.id = 'tinyai-eval-error';
        banner.style.cssText = 'position:fixed;bottom:0;left:0;right:0;background:rgba(127,29,29,0.95);color:#fca5a5;font-family:monospace;font-size:12px;padding:8px 12px;border-top:1px solid #ef4444;z-index:999999;word-break:break-word;';
        document.body.appendChild(banner);
      }
      banner.innerHTML = '<strong>[Runtime Error' + (lineNo ? ' Line ' + lineNo : '') + ']:</strong> ' + String(msg);
    } catch(e) {}
    return false;
  };
  window.addEventListener('unhandledrejection', function(event) {
    try {
      var reason = event.reason;
      var msg = reason ? (reason.message || reason.toString()) : 'Unhandled Promise Rejection';
      var banner = document.getElementById('tinyai-eval-error');
      if (!banner) {
        banner = document.createElement('div');
        banner.id = 'tinyai-eval-error';
        banner.style.cssText = 'position:fixed;bottom:0;left:0;right:0;background:rgba(127,29,29,0.95);color:#fca5a5;font-family:monospace;font-size:12px;padding:8px 12px;border-top:1px solid #ef4444;z-index:999999;word-break:break-word;';
        document.body.appendChild(banner);
      }
      banner.innerHTML = '<strong>[Promise Rejection]:</strong> ' + String(msg);
    } catch(e) {}
  });
</script>
`;

    const canvasFullStyle = `
<style>
  html, body {
    margin: 0;
    padding: 0;
    width: 100%;
    height: 100%;
    overflow: hidden;
    background: #000;
  }
  canvas {
    display: block;
    width: 100%;
    height: 100%;
  }
</style>
`;

    let html = indexHtml;

    // 1. Replace local stylesheet links with inlined styles
    html = html.replace(/<link\b([^>]*)\bhref=["'](?!https?:\/\/|\/\/)([^"']+)["']([^>]*)\/?>/gi, (match, before, href) => {
      const cleanHref = href.replace(/^\.\//, "").replace(/^\//, "");
      const matchedCss = files.find((f) => f.filename === cleanHref);
      if (matchedCss) {
        return `<style>\n/* Inlined: ${matchedCss.filename} */\n${matchedCss.content}\n</style>`;
      }
      return match;
    });

    // 2. Replace local script tags matching local files
    html = html.replace(/<script\b([^>]*)\bsrc=["'](?!https?:\/\/|\/\/)([^"']+)["']([^>]*)>([\s\S]*?)<\/script>/gi, (match, before, src) => {
      const cleanSrc = src.replace(/^\.\//, "").replace(/^\//, "");
      const matchedJs = files.find((f) => f.filename === cleanSrc);
      if (matchedJs) {
        return `<script>\n// Inlined: ${matchedJs.filename}\n${matchedJs.content}\n</script>`;
      }
      return match;
    });

    // 3. Combine remaining CSS not yet inlined
    const remainingCss = cssFiles
      .filter((f) => !html.includes(`/* Inlined: ${f.filename} */`))
      .map((f) => `/* ${f.filename} */\n${f.content}`)
      .join("\n");

    const headInjections = `${errorCatcherScript}\n${canvasFullStyle}${remainingCss ? `\n<style>\n${remainingCss}\n</style>` : ""}`;

    if (html.includes("<head>")) {
      html = html.replace("<head>", `<head>\n${headInjections}`);
    } else {
      html = `${headInjections}\n${html}`;
    }

    // 4. Inject remaining JS not yet inlined before </body>
    const remainingJs = jsFiles
      .filter((f) => !html.includes(`// Inlined: ${f.filename}`))
      .map((f) => `// Inlined: ${f.filename}\n${f.content}`)
      .join("\n");

    if (remainingJs.trim()) {
      if (html.includes("</body>")) {
        html = html.replace("</body>", `<script>\n${remainingJs}\n</script>\n</body>`);
      } else {
        html += `<script>\n${remainingJs}\n</script>`;
      }
    }

    return html;
  }, [files]);

  const activeFile = files.find((f) => f.filename === activeFilename) || files[0];

  const handleCopyFileContent = () => {
    if (!activeFile) return;
    if (navigator.clipboard?.writeText) {
      navigator.clipboard
        .writeText(activeFile.content)
        .then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        })
        .catch(() => {});
    }
  };

  const handleUnlock = async () => {
    setUnlocking(true);
    try {
      await onUnlockTeam(team.id);
    } finally {
      setUnlocking(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4 select-none">
      <div className="w-full max-w-5xl h-[85vh] bg-zinc-950 border border-zinc-800 rounded-lg flex flex-col shadow-2xl overflow-hidden font-sans">
        {/* Modal Header */}
        <div className="h-12 bg-zinc-900 border-b border-zinc-800 flex items-center justify-between px-4 shrink-0 font-mono">
          <div className="flex items-center space-x-3">
            <span className="font-bold text-zinc-100 text-sm">{team.name}</span>
            <span className="text-zinc-600">|</span>
            <span className="text-xs text-zinc-400">Prompts: {team.prompt_count}</span>
            <span className="text-zinc-600">|</span>
            <span
              className={`text-xs px-2 py-0.5 rounded border ${
                team.strike_count > 0
                  ? team.is_locked
                    ? "bg-red-950/80 text-red-300 border-red-800"
                    : "bg-amber-950/80 text-amber-300 border-amber-800"
                  : "bg-zinc-800 text-zinc-400 border-zinc-700"
              }`}
            >
              Strikes: {team.strike_count}/3 {team.is_locked ? "(LOCKED)" : ""}
            </span>
          </div>

          <div className="flex items-center space-x-2">
            {team.strike_count > 0 && (
              <button
                onClick={handleUnlock}
                disabled={unlocking}
                className="px-2.5 py-1 bg-amber-600 hover:bg-amber-500 text-white rounded text-xs flex items-center space-x-1 cursor-pointer transition-colors"
              >
                <Unlock className="w-3.5 h-3.5" />
                <span>{unlocking ? "Resetting..." : "Unlock / Reset Strikes"}</span>
              </button>
            )}

            <button
              onClick={onClose}
              className="p-1.5 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 rounded transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="h-10 bg-zinc-900/60 border-b border-zinc-800 flex items-center px-4 space-x-1 shrink-0 font-mono text-xs">
          <button
            onClick={() => setActiveTab("game")}
            className={`px-3 py-1.5 rounded flex items-center space-x-1.5 transition-colors cursor-pointer ${
              activeTab === "game"
                ? "bg-zinc-800 text-zinc-100 font-medium border border-zinc-700"
                : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            <Play className="w-3.5 h-3.5 fill-current text-emerald-400" />
            <span>Play Game</span>
          </button>

          <button
            onClick={() => setActiveTab("code")}
            className={`px-3 py-1.5 rounded flex items-center space-x-1.5 transition-colors cursor-pointer ${
              activeTab === "code"
                ? "bg-zinc-800 text-zinc-100 font-medium border border-zinc-700"
                : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            <Code className="w-3.5 h-3.5 text-zinc-300" />
            <span>Code Files ({files.length})</span>
          </button>

          <button
            onClick={() => setActiveTab("prompts")}
            className={`px-3 py-1.5 rounded flex items-center space-x-1.5 transition-colors cursor-pointer ${
              activeTab === "prompts"
                ? "bg-zinc-800 text-zinc-100 font-medium border border-zinc-700"
                : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            <MessageSquare className="w-3.5 h-3.5 text-zinc-300" />
            <span>Prompt Audit ({prompts.filter((p) => p.role === "user").length})</span>
          </button>

          <button
            onClick={() => setActiveTab("violations")}
            className={`px-3 py-1.5 rounded flex items-center space-x-1.5 transition-colors cursor-pointer ${
              activeTab === "violations"
                ? "bg-zinc-800 text-zinc-100 font-medium border border-zinc-700"
                : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
            <span>Violations Log ({violations.length})</span>
          </button>
        </div>

        {/* Tab Body */}
        <div className="flex-1 overflow-hidden relative">
          {/* TAB 1: Playable Game Runner */}
          {activeTab === "game" && (
            <div className="h-full flex flex-col bg-black relative">
              <div className="h-8 bg-zinc-900 border-b border-zinc-800 flex items-center justify-between px-3 shrink-0 text-xs font-mono text-zinc-400">
                <span>Live Evaluator Sandbox</span>
                <button
                  onClick={() => setGameReloadKey((k) => k + 1)}
                  className="flex items-center space-x-1 hover:text-zinc-100 cursor-pointer"
                >
                  <RotateCw className="w-3 h-3" />
                  <span>Restart Game</span>
                </button>
              </div>
              <div className="flex-1 flex items-center justify-center bg-black">
                <iframe
                  key={gameReloadKey}
                  title="Team Game"
                  srcDoc={bundledHtml}
                  sandbox="allow-scripts allow-modals"
                  className="w-full h-full border-none"
                />
              </div>
            </div>
          )}

          {/* TAB 2: Code Browser */}
          {activeTab === "code" && (
            <div className="h-full flex flex-col bg-zinc-950">
              {/* File switcher bar */}
              <div className="h-9 bg-zinc-900 border-b border-zinc-800 flex items-center justify-between px-3 shrink-0 font-mono text-xs">
                <div className="flex items-center space-x-1">
                  {files.map((f) => (
                    <button
                      key={f.id}
                      onClick={() => setActiveFilename(f.filename)}
                      className={`px-2.5 py-1 rounded text-xs ${
                        activeFilename === f.filename
                          ? "bg-zinc-950 text-zinc-100 border border-zinc-700 font-medium"
                          : "text-zinc-400 hover:text-zinc-200"
                      }`}
                    >
                      {f.filename}
                    </button>
                  ))}
                </div>

                <button
                  onClick={handleCopyFileContent}
                  className="flex items-center space-x-1 text-xs text-zinc-400 hover:text-zinc-200 cursor-pointer"
                >
                  {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                  <span>{copied ? "Copied" : "Copy File"}</span>
                </button>
              </div>

              <div className="flex-1">
                {files.length === 0 ? (
                  <div className="flex items-center justify-center h-full text-zinc-500 font-mono text-xs">
                    No files found for this team.
                  </div>
                ) : activeFile ? (
                  <Editor
                    key={activeFile.filename}
                    path={activeFile.filename}
                    height="100%"
                    language={activeFile.filename.endsWith(".js") ? "javascript" : activeFile.filename.endsWith(".css") ? "css" : "html"}
                    value={activeFile.content}
                    theme="vs-dark"
                    options={{
                      readOnly: true,
                      fontSize: 13,
                      minimap: { enabled: false },
                      scrollBeyondLastLine: false,
                    }}
                  />
                ) : null}
              </div>
            </div>
          )}

          {/* TAB 3: Prompt Audit Transcript */}
          {activeTab === "prompts" && (
            <div className="h-full overflow-y-auto p-4 space-y-4 bg-zinc-950 text-xs font-mono">
              {prompts.length === 0 ? (
                <div className="text-center py-12 text-zinc-600">
                  No prompts recorded for this team.
                </div>
              ) : (
                prompts.map((p, idx) => {
                  const isUser = p.role === "user";
                  return (
                    <div
                      key={p.id || idx}
                      className={`p-3 rounded border ${
                        isUser
                          ? "bg-zinc-900/90 border-zinc-700/80 text-zinc-100"
                          : "bg-zinc-950 border-zinc-850 text-zinc-300"
                      }`}
                    >
                      <div className="flex items-center justify-between text-[10px] text-zinc-500 mb-1.5">
                        <span className="uppercase font-bold tracking-wider">
                          {isUser ? "Team Prompt" : "AI Response"}
                        </span>
                        <span>{new Date(p.created_at).toLocaleTimeString()}</span>
                      </div>
                      <pre className="whitespace-pre-wrap break-words font-sans text-xs leading-relaxed select-text">
                        {p.content}
                      </pre>
                    </div>
                  );
                })
              )}
            </div>
          )}

          {/* TAB 4: Violations Log */}
          {activeTab === "violations" && (
            <div className="h-full overflow-y-auto p-4 bg-zinc-950 text-xs font-mono">
              {violations.length === 0 ? (
                <div className="text-center py-12 text-zinc-600">
                  Zero proctoring violations recorded for this team. Clean workstation.
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="grid grid-cols-3 text-[10px] text-zinc-500 uppercase tracking-wider pb-2 border-b border-zinc-800 font-bold">
                    <span>Strike #</span>
                    <span>Violation Reason</span>
                    <span>Timestamp</span>
                  </div>
                  {violations.map((v) => (
                    <div
                      key={v.id}
                      className="grid grid-cols-3 py-2 border-b border-zinc-900 text-zinc-300"
                    >
                      <span className="text-amber-400 font-bold">Strike #{v.strike_number}</span>
                      <span>{v.reason}</span>
                      <span className="text-zinc-500">
                        {new Date(v.created_at).toLocaleTimeString()}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
