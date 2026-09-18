"use client";

import React, { useState } from "react";
import { Plus, Eye, EyeOff, Edit3, Trash2, CheckCircle2, FileText, Clock } from "lucide-react";
import type { Task } from "@/lib/db";

interface AdminTaskQueueProps {
  tasks: Task[];
  competitionStatus?: string;
  elapsedSeconds?: number;
  onCreateTask: (title: string, descriptionMarkdown: string, revealAfterMinutes?: number | null) => Promise<void>;
  onUpdateTask: (id: number, updates: { title?: string; description_markdown?: string; is_revealed?: number; reveal_after_minutes?: number | null }) => Promise<void>;
  onDeleteTask: (id: number) => Promise<void>;
}

export function AdminTaskQueue({
  tasks,
  competitionStatus,
  elapsedSeconds,
  onCreateTask,
  onUpdateTask,
  onDeleteTask,
}: AdminTaskQueueProps) {
  const [isAdding, setIsAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [revealAfterMinutes, setRevealAfterMinutes] = useState("");
  const [loading, setLoading] = useState(false);

  // Editing state
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [editRevealAfter, setEditRevealAfter] = useState("");
  const [updatingTaskId, setUpdatingTaskId] = useState<number | null>(null);

  const getTaskStatus = (task: Task) => {
    const isManuallyRevealed = Boolean(task.is_revealed);
    const hasSchedule = task.reveal_after_minutes !== null && task.reveal_after_minutes !== undefined;
    const isScheduleMet = hasSchedule && elapsedSeconds !== undefined && elapsedSeconds >= 0 && elapsedSeconds >= (task.reveal_after_minutes! * 60);
    const isLive = isManuallyRevealed || isScheduleMet;

    let badgeLabel = "Draft";
    let badgeStyle = "bg-zinc-800 text-zinc-400 border border-zinc-700";

    if (isManuallyRevealed) {
      badgeLabel = "Live (Manual)";
      badgeStyle = "bg-emerald-950 text-emerald-400 border border-emerald-800";
    } else if (isScheduleMet) {
      badgeLabel = `Live (Auto: +${task.reveal_after_minutes}m)`;
      badgeStyle = "bg-teal-950 text-teal-300 border border-teal-800";
    } else if (hasSchedule) {
      badgeLabel = `Scheduled: +${task.reveal_after_minutes}m`;
      badgeStyle = "bg-amber-950/80 text-amber-400 border border-amber-800";
    }

    return { isLive, isManuallyRevealed, hasSchedule, isScheduleMet, badgeLabel, badgeStyle };
  };

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || loading) return;

    setLoading(true);
    try {
      const parsedMinutes = revealAfterMinutes.trim() !== "" ? parseInt(revealAfterMinutes.trim(), 10) : null;
      await onCreateTask(
        title.trim(),
        description.trim(),
        parsedMinutes !== null && !isNaN(parsedMinutes) && parsedMinutes >= 0 ? parsedMinutes : null
      );
      setTitle("");
      setDescription("");
      setRevealAfterMinutes("");
      setIsAdding(false);
    } finally {
      setLoading(false);
    }
  };

  const startEdit = (task: Task) => {
    setEditingId(task.id);
    setEditTitle(task.title);
    setEditDesc(task.description_markdown);
    setEditRevealAfter(
      task.reveal_after_minutes !== null && task.reveal_after_minutes !== undefined
        ? String(task.reveal_after_minutes)
        : ""
    );
  };

  const handleEditSubmit = async (id: number) => {
    if (!editTitle.trim() || loading) return;
    setLoading(true);
    try {
      const parsedMinutes = editRevealAfter.trim() !== "" ? parseInt(editRevealAfter.trim(), 10) : null;
      await onUpdateTask(id, {
        title: editTitle.trim(),
        description_markdown: editDesc.trim(),
        reveal_after_minutes: parsedMinutes !== null && !isNaN(parsedMinutes) && parsedMinutes >= 0 ? parsedMinutes : null,
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
      if (isRevealed === 0) {
        await onUpdateTask(id, { is_revealed: 0, reveal_after_minutes: null });
      } else {
        await onUpdateTask(id, { is_revealed: 1 });
      }
    } finally {
      setUpdatingTaskId(null);
    }
  };

  const liveCount = tasks.filter((t) => getTaskStatus(t).isLive).length;

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
            ({liveCount}/{tasks.length} live)
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
          <div className="space-y-1">
            <label className="text-[10px] text-zinc-400 flex items-center space-x-1">
              <Clock className="w-3 h-3 text-zinc-500" />
              <span>Reveal Schedule (minutes after start, optional):</span>
            </label>
            <input
              type="number"
              min="0"
              placeholder="e.g. 0 (kickoff), 30 (+30 min). Leave empty for manual."
              value={revealAfterMinutes}
              onChange={(e) => setRevealAfterMinutes(e.target.value)}
              className="w-full px-2.5 py-1 bg-zinc-950 border border-zinc-700 rounded text-xs text-zinc-100 placeholder-zinc-600 focus:outline-hidden focus:border-zinc-400"
            />
          </div>
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
              Save Task
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
            const { isLive, hasSchedule, isScheduleMet, isManuallyRevealed, badgeLabel, badgeStyle } = getTaskStatus(task);
            const isEditing = editingId === task.id;

            return (
              <div
                key={task.id}
                className={`border rounded p-3 text-xs space-y-2 transition-colors ${
                  isLive
                    ? "bg-zinc-900 border-zinc-700/80"
                    : "bg-zinc-950 border-zinc-850"
                }`}
              >
                {/* Task meta & status */}
                <div className="flex items-center justify-between font-mono text-[10px]">
                  <div className="flex items-center space-x-2">
                    <span className="font-bold text-zinc-400">#{task.order_index}</span>
                    <span className={`px-1.5 py-0.2 rounded font-medium uppercase ${badgeStyle}`}>
                      {badgeLabel}
                    </span>
                  </div>

                  <div className="flex items-center space-x-1">
                    {!isEditing && (
                      <>
                        <button
                          onClick={() => startEdit(task)}
                          title="Edit Task"
                          className="p-1 text-zinc-500 hover:text-zinc-200 cursor-pointer"
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
                          className="p-1 text-zinc-500 hover:text-red-400 cursor-pointer"
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
                    <div className="space-y-1">
                      <label className="text-[10px] text-zinc-400 flex items-center space-x-1">
                        <Clock className="w-3 h-3 text-zinc-500" />
                        <span>Reveal Schedule (minutes after start, empty = manual):</span>
                      </label>
                      <input
                        type="number"
                        min="0"
                        placeholder="e.g. 0, 30. Leave empty for manual only."
                        value={editRevealAfter}
                        onChange={(e) => setEditRevealAfter(e.target.value)}
                        className="w-full px-2 py-1 bg-zinc-950 border border-zinc-700 rounded text-xs text-zinc-100"
                      />
                    </div>
                    <div className="flex justify-end space-x-1 pt-1">
                      <button
                        onClick={() => setEditingId(null)}
                        className="px-2 py-0.5 text-[10px] text-zinc-400 hover:text-zinc-200 cursor-pointer"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={() => handleEditSubmit(task.id)}
                        disabled={loading || !editTitle.trim()}
                        className="px-2.5 py-0.5 text-[10px] bg-zinc-100 text-zinc-900 rounded font-medium disabled:opacity-40 cursor-pointer"
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
                      {isLive ? (
                        <>
                          <span className="text-[10px] text-emerald-400 flex items-center space-x-1">
                            <CheckCircle2 className="w-3 h-3" />
                            <span>
                              {isScheduleMet && !isManuallyRevealed
                                ? `Live (Auto +${task.reveal_after_minutes}m)`
                                : "Revealed to teams"}
                            </span>
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
                          <span>
                            {updatingTaskId === task.id
                              ? "Revealing..."
                              : hasSchedule
                              ? `Reveal to Teams Now (Scheduled +${task.reveal_after_minutes}m)`
                              : "Reveal to Teams Now"}
                          </span>
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
