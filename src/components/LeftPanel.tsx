"use client";

import React, { useState } from "react";
import { FileCode, ListTodo, Plus, Trash2, CheckCircle2, ChevronRight, File } from "lucide-react";
import type { Task, FileRecord } from "@/lib/db";

interface LeftPanelProps {
  tasks: Task[];
  files: FileRecord[];
  activeFilename: string;
  onSelectFile: (filename: string) => void;
  onCreateFile: (filename: string) => Promise<void>;
  onDeleteFile: (filename: string) => Promise<void>;
  isLocked: boolean;
}

export function LeftPanel({
  tasks,
  files,
  activeFilename,
  onSelectFile,
  onCreateFile,
  onDeleteFile,
  isLocked,
}: LeftPanelProps) {
  const [activeTab, setActiveTab] = useState<"tasks" | "files">("tasks");
  const [isCreating, setIsCreating] = useState(false);
  const [newFilename, setNewFilename] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = newFilename.trim();
    if (!clean) return;

    if (/[\\/:*?"<>|]/.test(clean)) {
      setCreateError("Filename cannot contain special characters like / \\ : * ? \" < > |");
      return;
    }

    if (!clean.includes(".") || clean.startsWith(".") || clean.endsWith(".")) {
      setCreateError("Include valid extension (e.g. game.js, style.css)");
      return;
    }

    if (clean.length > 50) {
      setCreateError("Filename too long (max 50 chars)");
      return;
    }

    if (files.some((f) => f.filename.toLowerCase() === clean.toLowerCase())) {
      setCreateError(`File '${clean}' already exists`);
      return;
    }

    try {
      await onCreateFile(clean);
      setNewFilename("");
      setIsCreating(false);
      setCreateError(null);
    } catch (err: unknown) {
      setCreateError(err instanceof Error ? err.message : "Failed to create file");
    }
  };

  return (
    <div className="h-full flex flex-col bg-zinc-950 border-r border-zinc-800 select-none overflow-hidden">
      {/* Segmented Tab Switcher */}
      <div className="p-2 border-b border-zinc-800 shrink-0">
        <div className="grid grid-cols-2 bg-zinc-900 p-0.5 rounded border border-zinc-800 text-xs font-mono">
          <button
            onClick={() => setActiveTab("tasks")}
            className={`py-1 rounded flex items-center justify-center space-x-1.5 transition-colors cursor-pointer ${
              activeTab === "tasks"
                ? "bg-zinc-800 text-zinc-100 font-medium"
                : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            <ListTodo className="w-3.5 h-3.5" />
            <span>Tasks</span>
            {tasks.length > 0 && (
              <span className="ml-1 px-1.5 py-0.2 rounded-full text-[10px] bg-zinc-700 text-zinc-200">
                {tasks.length}
              </span>
            )}
          </button>
          <button
            onClick={() => setActiveTab("files")}
            className={`py-1 rounded flex items-center justify-center space-x-1.5 transition-colors cursor-pointer ${
              activeTab === "files"
                ? "bg-zinc-800 text-zinc-100 font-medium"
                : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            <FileCode className="w-3.5 h-3.5" />
            <span>Files</span>
            <span className="ml-1 px-1.5 py-0.2 rounded-full text-[10px] bg-zinc-700 text-zinc-200">
              {files.length}
            </span>
          </button>
        </div>
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === "tasks" ? (
          <div className="p-3 space-y-3">
            {tasks.length === 0 ? (
              <div className="py-8 px-2 text-center text-zinc-500 text-xs space-y-2 font-mono">
                <ListTodo className="w-6 h-6 mx-auto text-zinc-700 stroke-1" />
                <p>No tasks revealed yet.</p>
                <p className="text-[11px] text-zinc-600">
                  Organizers reveal incremental twists during the sprint.
                </p>
              </div>
            ) : (
              tasks.map((task) => (
                <div
                  key={task.id}
                  className="bg-zinc-900 border border-zinc-800 rounded p-3 text-xs space-y-1.5"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-300">
                      Task #{task.order_index}
                    </span>
                    <span className="text-[10px] text-emerald-400 flex items-center space-x-1">
                      <CheckCircle2 className="w-3 h-3" />
                      <span>Revealed</span>
                    </span>
                  </div>
                  <h3 className="font-semibold text-zinc-100 text-sm tracking-tight">
                    {task.title}
                  </h3>
                  <div className="text-zinc-300 text-[11px] leading-relaxed whitespace-pre-wrap font-sans">
                    {task.description_markdown}
                  </div>
                </div>
              ))
            )}
          </div>
        ) : (
          <div className="p-2 space-y-1 font-mono text-xs">
            {/* Header + Add button */}
            <div className="flex items-center justify-between px-2 py-1 text-zinc-400">
              <span className="text-[11px] uppercase tracking-wider text-zinc-500 font-medium">
                Workspace Tree
              </span>
              {!isLocked && (
                <button
                  onClick={() => setIsCreating(true)}
                  title="Create new file"
                  className="p-1 hover:text-zinc-200 hover:bg-zinc-900 rounded transition-colors cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Create file inline input */}
            {isCreating && (
              <form onSubmit={handleCreateSubmit} className="p-1.5 bg-zinc-900 border border-zinc-700 rounded mb-2">
                <input
                  type="text"
                  autoFocus
                  placeholder="e.g. style.css"
                  value={newFilename}
                  onChange={(e) => setNewFilename(e.target.value)}
                  className="w-full px-2 py-1 bg-zinc-950 border border-zinc-700 rounded text-xs text-zinc-100 placeholder-zinc-600 focus:outline-hidden"
                />
                {createError && (
                  <div className="text-[10px] text-red-400 mt-1">{createError}</div>
                )}
                <div className="flex justify-end space-x-1 mt-2">
                  <button
                    type="button"
                    onClick={() => {
                      setIsCreating(false);
                      setCreateError(null);
                    }}
                    className="px-2 py-0.5 text-[10px] text-zinc-400 hover:text-zinc-200"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-2 py-0.5 text-[10px] bg-zinc-100 text-zinc-900 rounded font-medium"
                  >
                    Create
                  </button>
                </div>
              </form>
            )}

            {/* Files list */}
            {files.map((f) => {
              const isActive = f.filename === activeFilename;
              const isRoot = f.filename === "index.html";

              return (
                <div
                  key={f.id}
                  onClick={() => onSelectFile(f.filename)}
                  className={`group flex items-center justify-between px-2 py-1.5 rounded cursor-pointer transition-colors ${
                    isActive
                      ? "bg-zinc-800 text-zinc-100 font-medium border border-zinc-700"
                      : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900 border border-transparent"
                  }`}
                >
                  <div className="flex items-center space-x-2 truncate">
                    <File className={`w-3.5 h-3.5 shrink-0 ${f.filename.endsWith(".js") ? "text-yellow-400" : f.filename.endsWith(".html") ? "text-orange-400" : "text-blue-400"}`} />
                    <span className="truncate">{f.filename}</span>
                  </div>

                  {!isRoot && !isLocked && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (confirm(`Delete ${f.filename}?`)) {
                          onDeleteFile(f.filename);
                        }
                      }}
                      title="Delete file"
                      className="opacity-0 group-hover:opacity-100 p-1 text-zinc-500 hover:text-red-400 transition-opacity"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
