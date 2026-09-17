"use client";

import React, { useState } from "react";
import { Plus, Eye, EyeOff, Edit3, Trash2, CheckCircle2, FileText } from "lucide-react";
import type { Task } from "@/lib/db";

interface AdminTaskQueueProps {
  tasks: Task[];
  onCreateTask: (title: string, descriptionMarkdown: string) => Promise<void>;
  onUpdateTask: (id: number, updates: { title?: string; description_markdown?: string; is_revealed?: number }) => Promise<void>;
  onDeleteTask: (id: number) => Promise<void>;
}

export function AdminTaskQueue({
  tasks,
  onCreateTask,
  onUpdateTask,
  onDeleteTask,
}: AdminTaskQueueProps) {
  const [isAdding, setIsAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(false);

  // Editing state
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [updatingTaskId, setUpdatingTaskId] = useState<number | null>(null);

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || loading) return;

    setLoading(true);
    try {
      await onCreateTask(title.trim(), description.trim());
      setTitle("");
      setDescription("");
      setIsAdding(false);
    } finally {
      setLoading(false);
    }
  };

  const startEdit = (task: Task) => {
    setEditingId(task.id);
    setEditTitle(task.title);
    setEditDesc(task.description_markdown);
  };

  const handleEditSubmit = async (id: number) => {
    if (!editTitle.trim() || loading) return;
    setLoading(true);
    try {
      await onUpdateTask(id, {
        title: editTitle.trim(),
        description_markdown: editDesc.trim(),
      });
      setEditingId(null);
    } finally {
      setLoading(false);
    }
  };

  const handleToggleReveal = async (id: number, isRevealed: number) => {
    if (updatingTaskId !== null) return;
    setUpdatingTaskId(id);
    try {
      await onUpdateTask(id, { is_revealed: isRevealed });
    } finally {
      setUpdatingTaskId(null);
    }
  };

  return (
    <div className="h-full flex flex-col bg-zinc-950 border-r border-zinc-800 overflow-hidden select-none">
      {/* Header */}
      <div className="h-10 bg-zinc-900/90 border-b border-zinc-800 flex items-center justify-between px-3 shrink-0">
        <div className="flex items-center space-x-2 text-xs font-mono">
          <FileText className="w-3.5 h-3.5 text-zinc-400" />
          <span className="font-semibold text-zinc-200 uppercase tracking-wider text-[11px]">
            Task Reveal Queue
          </span>
          <span className="text-[10px] text-zinc-500 font-normal">
            ({tasks.filter((t) => t.is_revealed).length}/{tasks.length} live)
          </span>
        </div>

        <button
          onClick={() => setIsAdding(!isAdding)}
          className="px-2 py-0.5 bg-zinc-100 hover:bg-white text-zinc-950 rounded text-[11px] font-mono font-medium flex items-center space-x-1 transition-colors cursor-pointer"
        >
          <Plus className="w-3 h-3" />
          <span>{isAdding ? "Close" : "New Task"}</span>
        </button>
      </div>

      {/* Task Creation Form */}
      {isAdding && (
        <form onSubmit={handleCreateSubmit} className="p-3 bg-zinc-900 border-b border-zinc-800 space-y-2 text-xs font-mono">
          <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block">
            Compose New Task / Twist
          </span>
          <input
            type="text"
            placeholder="Task Title (e.g. Task 1: Player Movement Loop)"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full px-2.5 py-1.5 bg-zinc-950 border border-zinc-700 rounded text-xs text-zinc-100 placeholder-zinc-600 focus:outline-hidden focus:border-zinc-400"
          />
          <textarea
            rows={3}
            placeholder="Description in Markdown (e.g. Render canvas player square; bind Arrow keys; prevent edge clipping)..."
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full px-2.5 py-1.5 bg-zinc-950 border border-zinc-700 rounded text-xs text-zinc-100 placeholder-zinc-600 focus:outline-hidden focus:border-zinc-400 resize-none font-sans"
          />
          <div className="flex justify-end space-x-2 pt-1">
            <button
              type="button"
              onClick={() => setIsAdding(false)}
              className="px-2.5 py-1 text-[11px] text-zinc-400 hover:text-zinc-200"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || !title.trim()}
              className="px-3 py-1 bg-zinc-100 text-zinc-950 rounded font-medium text-[11px] disabled:opacity-40"
            >
              Save as Draft
            </button>
          </div>
        </form>
      )}

      {/* Tasks List */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {tasks.length === 0 ? (
          <div className="py-12 px-4 text-center text-zinc-600 text-xs font-mono space-y-1">
            <p>No tasks created yet.</p>
            <p className="text-[11px] text-zinc-700">Click &quot;New Task&quot; above to compose your initial round and twists.</p>
          </div>
        ) : (
          tasks.map((task) => {
            const isRevealed = Boolean(task.is_revealed);
            const isEditing = editingId === task.id;

            return (
              <div
                key={task.id}
                className={`border rounded p-3 text-xs space-y-2 transition-colors ${
                  isRevealed
                    ? "bg-zinc-900 border-zinc-700/80"
                    : "bg-zinc-950 border-zinc-850"
                }`}
              >
                {/* Task meta & status */}
                <div className="flex items-center justify-between font-mono text-[10px]">
                  <div className="flex items-center space-x-2">
                    <span className="font-bold text-zinc-400">#{task.order_index}</span>
                    <span
                      className={`px-1.5 py-0.2 rounded font-medium uppercase ${
                        isRevealed
                          ? "bg-emerald-950 text-emerald-400 border border-emerald-800"
                          : "bg-zinc-800 text-zinc-400 border border-zinc-700"
                      }`}
                    >
                      {isRevealed ? "Live Revealed" : "Draft"}
                    </span>
                  </div>

                  <div className="flex items-center space-x-1">
                    {!isEditing && (
                      <>
                        <button
                          onClick={() => startEdit(task)}
                          title="Edit Task"
                          className="p-1 text-zinc-500 hover:text-zinc-200"
                        >
                          <Edit3 className="w-3 h-3" />
                        </button>
                        <button
                          onClick={() => {
                            if (confirm(`Delete task "${task.title}"?`)) {
                              onDeleteTask(task.id);
                            }
                          }}
                          title="Delete Task"
                          className="p-1 text-zinc-500 hover:text-red-400"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {/* Edit inline or display */}
                {isEditing ? (
                  <div className="space-y-2 pt-1 font-mono">
                    <input
                      type="text"
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      className="w-full px-2 py-1 bg-zinc-950 border border-zinc-700 rounded text-xs text-zinc-100"
                    />
                    <textarea
                      rows={3}
                      value={editDesc}
                      onChange={(e) => setEditDesc(e.target.value)}
                      className="w-full px-2 py-1 bg-zinc-950 border border-zinc-700 rounded text-xs text-zinc-100 font-sans"
                    />
                    <div className="flex justify-end space-x-1">
                      <button
                        onClick={() => setEditingId(null)}
                        className="px-2 py-0.5 text-[10px] text-zinc-400 hover:text-zinc-200"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={() => handleEditSubmit(task.id)}
                        disabled={loading || !editTitle.trim()}
                        className="px-2.5 py-0.5 text-[10px] bg-zinc-100 text-zinc-900 rounded font-medium disabled:opacity-40"
                      >
                        Save
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <h4 className="font-semibold text-zinc-100 text-sm tracking-tight">
                      {task.title}
                    </h4>
                    <p className="text-zinc-400 text-xs leading-relaxed whitespace-pre-wrap font-sans">
                      {task.description_markdown}
                    </p>

                    {/* Reveal Action Button */}
                    <div className="pt-1 flex items-center justify-between border-t border-zinc-800/60 font-mono text-[11px]">
                      {isRevealed ? (
                        <>
                          <span className="text-[10px] text-emerald-400 flex items-center space-x-1">
                            <CheckCircle2 className="w-3 h-3" />
                            <span>Revealed to teams</span>
                          </span>
                          <button
                            onClick={() => handleToggleReveal(task.id, 0)}
                            disabled={updatingTaskId === task.id}
                            className="px-2 py-0.5 text-[10px] bg-zinc-850 hover:bg-zinc-800 text-zinc-400 rounded flex items-center space-x-1 cursor-pointer disabled:opacity-40"
                          >
                            <EyeOff className="w-3 h-3" />
                            <span>{updatingTaskId === task.id ? "Updating..." : "Hide"}</span>
                          </button>
                        </>
                      ) : (
                        <button
                          onClick={() => handleToggleReveal(task.id, 1)}
                          disabled={updatingTaskId === task.id}
                          className="w-full py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-xs font-medium flex items-center justify-center space-x-1.5 transition-colors cursor-pointer disabled:opacity-40"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          <span>{updatingTaskId === task.id ? "Revealing..." : "Reveal to Teams Now"}</span>
                        </button>
                      )}
                    </div>
                  </>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
