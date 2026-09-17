"use client";

import React, { useEffect, useRef } from "react";
import Editor, { OnMount } from "@monaco-editor/react";
import { Lock, FileCode, Check, Play } from "lucide-react";
import type { FileRecord } from "@/lib/db";

interface CodeEditorProps {
  activeFile: FileRecord | null;
  files: FileRecord[];
  savedFiles?: FileRecord[];
  onSelectFile: (filename: string) => void;
  onChangeContent: (newContent: string) => void;
  onSaveAndRun: () => void;
  isLocked: boolean;
  lockReason?: string;
  isSaving?: boolean;
}

export function CodeEditor({
  activeFile,
  files,
  savedFiles,
  onSelectFile,
  onChangeContent,
  onSaveAndRun,
  isLocked,
  lockReason,
  isSaving,
}: CodeEditorProps) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const editorRef = useRef<any>(null);

  const getLanguage = (filename: string) => {
    if (filename.endsWith(".html") || filename.endsWith(".htm")) return "html";
    if (filename.endsWith(".js") || filename.endsWith(".mjs")) return "javascript";
    if (filename.endsWith(".css")) return "css";
    if (filename.endsWith(".json")) return "json";
    return "plaintext";
  };

  // Check if active file has unsaved modifications
  const currentSavedFile = savedFiles?.find((f) => f.filename === activeFile?.filename);
  const isDirty = Boolean(
    activeFile && currentSavedFile && activeFile.content !== currentSavedFile.content
  );

  // Bind Ctrl+S / Cmd+S and Ctrl+Enter keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === "s" || e.key === "Enter")) {
        e.preventDefault();
        onSaveAndRun();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onSaveAndRun]);

  const handleEditorMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;

    // Define custom dark utilitarian theme
    monaco.editor.defineTheme("pup-dark", {
      base: "vs-dark",
      inherit: true,
      rules: [
        { token: "comment", foreground: "6b7280", fontStyle: "italic" },
        { token: "keyword", foreground: "c084fc" },
        { token: "string", foreground: "86efac" },
        { token: "number", foreground: "fde047" },
      ],
      colors: {
        "editor.background": "#09090b",
        "editor.foreground": "#f4f4f5",
        "editorLineNumber.foreground": "#3f3f46",
        "editorLineNumber.activeForeground": "#a1a1aa",
        "editor.lineHighlightBackground": "#18181b",
        "editorCursor.foreground": "#f4f4f5",
        "editorWhitespace.foreground": "#27272a",
      },
    });
    monaco.editor.setTheme("pup-dark");
  };

  return (
    <div className="h-full flex flex-col bg-zinc-950 border-r border-zinc-800 overflow-hidden relative select-none">
      {/* Tab bar */}
      <div className="h-9 bg-zinc-900/90 border-b border-zinc-800 flex items-center justify-between px-2 shrink-0 overflow-x-auto">
        <div className="flex items-center space-x-1 h-full">
          {files.map((f) => {
            const isActive = f.filename === activeFile?.filename;
            const fileSaved = savedFiles?.find((sf) => sf.filename === f.filename);
            const fileIsDirty = Boolean(fileSaved && f.content !== fileSaved.content);

            return (
              <button
                key={f.id}
                onClick={() => onSelectFile(f.filename)}
                className={`h-7 px-2.5 rounded-t text-xs font-mono flex items-center space-x-1.5 transition-colors cursor-pointer shrink-0 ${
                  isActive
                    ? "bg-zinc-950 text-zinc-100 border-t-2 border-emerald-500 font-medium"
                    : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50"
                }`}
              >
                <FileCode className="w-3.5 h-3.5 text-zinc-400" />
                <span>{f.filename}</span>
                {fileIsDirty && (
                  <span
                    title="Unsaved changes"
                    className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0"
                  />
                )}
              </button>
            );
          })}
        </div>

        {/* Shortcut, Save indicator and Run button */}
        <div className="flex items-center space-x-2 text-[11px] font-mono pr-1 shrink-0">
          {isSaving ? (
            <span className="text-zinc-400 animate-pulse">Saving...</span>
          ) : isDirty ? (
            <span className="flex items-center space-x-1 text-amber-400">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
              <span>Unsaved</span>
            </span>
          ) : (
            <span className="flex items-center space-x-1 text-zinc-500">
              <Check className="w-3 h-3 text-emerald-500" />
              <span>Saved</span>
            </span>
          )}

          <span className="text-zinc-700">|</span>

          <button
            onClick={onSaveAndRun}
            disabled={isLocked || isSaving}
            title="Save changes to server and reload game preview (Ctrl+S)"
            className="flex items-center space-x-1 px-2 py-0.5 bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 disabled:opacity-40 text-white rounded text-[11px] font-medium transition-colors cursor-pointer"
          >
            <Play className="w-3 h-3 fill-current" />
            <span>Save & Run</span>
          </button>
        </div>
      </div>

      {/* Editor Body */}
      <div className="flex-1 relative">
        {activeFile ? (
          <Editor
            height="100%"
            language={getLanguage(activeFile.filename)}
            value={activeFile.content}
            theme="vs-dark"
            onMount={handleEditorMount}
            onChange={(val) => onChangeContent(val || "")}
            options={{
              fontSize: 13,
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
              minimap: { enabled: false },
              scrollBeyondLastLine: false,
              wordWrap: "on",
              tabSize: 2,
              lineNumbers: "on",
              renderWhitespace: "selection",
              readOnly: isLocked,
              cursorBlinking: "smooth",
              padding: { top: 12, bottom: 12 },
              automaticLayout: true,
            }}
          />
        ) : (
          <div className="h-full flex items-center justify-center text-zinc-600 text-xs font-mono">
            No file selected
          </div>
        )}

        {/* Lock Overlay when not running or locked */}
        {isLocked && (
          <div className="absolute inset-0 z-20 bg-zinc-950/90 flex flex-col items-center justify-center p-6 text-center">
            <Lock className="w-8 h-8 text-zinc-400 mb-2" />
            <h3 className="text-sm font-semibold text-zinc-200 uppercase font-mono tracking-wider">
              Editor Locked
            </h3>
            <p className="text-xs text-zinc-400 max-w-sm mt-1">
              {lockReason || "Code editing is currently locked by the competition organizer."}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
