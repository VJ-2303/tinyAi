"use client";

import React, { useState, useEffect, useCallback } from "react";
import { Group, Panel, Separator } from "react-resizable-panels";
import { AdminHeader } from "@/components/admin/AdminHeader";
import { AdminTaskQueue } from "@/components/admin/AdminTaskQueue";
import { AdminTeamTable } from "@/components/admin/AdminTeamTable";
import { AdminInspectModal } from "@/components/admin/AdminInspectModal";
import { AdminLogin } from "@/components/admin/AdminLogin";
import type { Task, Team, FileRecord, PromptRecord, Violation, CompetitionStatus } from "@/lib/db";

export default function AdminPage() {
  const [adminPin, setAdminPin] = useState<string | null>(null);
  const [authChecked, setAuthChecked] = useState(false);

  // Live competition state
  const [competition, setCompetition] = useState<{
    status: CompetitionStatus;
    remaining_seconds: number;
    duration_minutes: number;
  }>({
    status: "NOT_STARTED",
    remaining_seconds: 7200,
    duration_minutes: 120,
  });

  // Tasks & Teams state
  const [tasks, setTasks] = useState<Task[]>([]);
  const [teams, setTeams] = useState<(Team & { file_count: number; violation_count: number })[]>([]);

  // Inspect Modal state
  const [inspectingTeam, setInspectingTeam] = useState<{
    team: Team;
    files: FileRecord[];
    violations: Violation[];
    prompts: PromptRecord[];
  } | null>(null);

  // 1. Initial auth check from sessionStorage
  useEffect(() => {
    const savedPin = sessionStorage.getItem("tinyai_admin_pin");
    if (savedPin) {
      setAdminPin(savedPin);
    }
    setAuthChecked(true);
  }, []);

  const handleLogin = async (pin: string) => {
    const res = await fetch("/api/admin/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin }),
    });

    if (!res.ok) {
      throw new Error("Invalid Admin PIN");
    }

    sessionStorage.setItem("tinyai_admin_pin", pin);
    setAdminPin(pin);
  };

  const handleLogout = () => {
    sessionStorage.removeItem("tinyai_admin_pin");
    setAdminPin(null);
  };

  // Helper for authenticated requests
  const adminFetch = useCallback(
    async (url: string, options: RequestInit = {}) => {
      const headers = new Headers(options.headers || {});
      if (adminPin) {
        headers.set("x-admin-pin", adminPin);
      }
      return fetch(url, { ...options, headers });
    },
    [adminPin]
  );

  // 2. Poll competition state, tasks, and teams every 2.5 seconds
  const fetchDashboardData = useCallback(async () => {
    if (!adminPin) return;

    try {
      // 1. Status
      const statusRes = await fetch("/api/competition/status");
      if (statusRes.ok) {
        const data = await statusRes.json();
        setCompetition({
          status: data.status,
          remaining_seconds: data.remaining_seconds,
          duration_minutes: data.duration_minutes || 120,
        });
      }

      // 2. Tasks
      const tasksRes = await adminFetch("/api/admin/tasks");
      if (tasksRes.ok) {
        const tasksData = await tasksRes.json();
        setTasks(tasksData.tasks || []);
      }

      // 3. Teams
      const teamsRes = await adminFetch("/api/admin/teams");
      if (teamsRes.ok) {
        const teamsData = await teamsRes.json();
        setTeams(teamsData.teams || []);
      }
    } catch (err: unknown) {
      const isTransient =
        err instanceof TypeError &&
        (err.message.includes("Failed to fetch") ||
          err.message.includes("NetworkError") ||
          err.message.includes("Load failed"));

      if (!isTransient) {
        console.warn("Dashboard poll issue:", err);
      }
    }
  }, [adminPin, adminFetch]);

  useEffect(() => {
    if (!adminPin) return;
    let isMounted = true;

    const poll = async () => {
      if (!isMounted) return;
      await fetchDashboardData();
    };

    poll();
    const interval = setInterval(poll, 2500);
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [adminPin, fetchDashboardData]);

  // 3. Competition Controls
  const handleControlAction = async (
    action: "start" | "pause" | "resume" | "end" | "adjust_time",
    params?: { durationMinutes?: number; deltaSeconds?: number }
  ) => {
    const res = await adminFetch("/api/admin/competition", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, ...params }),
    });

    if (res.ok) {
      const data = await res.json();
      setCompetition({
        status: data.state.status,
        remaining_seconds: data.state.remaining_seconds,
        duration_minutes: data.state.duration_minutes,
      });
    }
  };

  // 4. Task Actions
  const handleCreateTask = async (title: string, descriptionMarkdown: string) => {
    const res = await adminFetch("/api/admin/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, description_markdown: descriptionMarkdown }),
    });

    if (res.ok) {
      const data = await res.json();
      setTasks((prev) => [...prev, data.task]);
    }
  };

  const handleUpdateTask = async (
    id: number,
    updates: { title?: string; description_markdown?: string; is_revealed?: number }
  ) => {
    const res = await adminFetch(`/api/admin/tasks/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    });

    if (res.ok) {
      const data = await res.json();
      setTasks((prev) => prev.map((t) => (t.id === id ? data.task : t)));
    }
  };

  const handleDeleteTask = async (id: number) => {
    const res = await adminFetch(`/api/admin/tasks/${id}`, {
      method: "DELETE",
    });

    if (res.ok) {
      setTasks((prev) => prev.filter((t) => t.id !== id));
    }
  };

  // 5. Team Inspect & Unlock
  const handleInspectTeam = async (teamId: string) => {
    const res = await adminFetch(`/api/admin/teams/${teamId}`);
    if (res.ok) {
      const data = await res.json();
      setInspectingTeam(data);
    }
  };

  const handleUnlockTeam = async (teamId: string) => {
    const res = await adminFetch(`/api/admin/teams/${teamId}/unlock`, {
      method: "POST",
    });

    if (res.ok) {
      const data = await res.json();
      setTeams((prev) =>
        prev.map((t) => (t.id === teamId ? { ...t, is_locked: 0, strike_count: 0 } : t))
      );
      if (inspectingTeam && inspectingTeam.team.id === teamId) {
        setInspectingTeam((prev) =>
          prev ? { ...prev, team: { ...prev.team, is_locked: 0, strike_count: 0 } } : null
        );
      }
    }
  };

  if (!authChecked) {
    return <div className="h-screen w-screen bg-zinc-950" />;
  }

  if (!adminPin) {
    return <AdminLogin onLogin={handleLogin} />;
  }

  const totalPrompts = teams.reduce((acc, t) => acc + (t.prompt_count || 0), 0);
  const totalStrikes = teams.reduce((acc, t) => acc + (t.strike_count || 0), 0);

  return (
    <div className="h-screen w-screen flex flex-col bg-zinc-950 text-zinc-100 overflow-hidden select-none font-sans">
      {/* Top Header Bar with Live Controls */}
      <AdminHeader
        status={competition.status}
        remainingSeconds={competition.remaining_seconds}
        durationMinutes={competition.duration_minutes}
        totalTeams={teams.length}
        totalPrompts={totalPrompts}
        totalStrikes={totalStrikes}
        onControlAction={handleControlAction}
        onLogout={handleLogout}
      />

      {/* Main 2-Column Split Layout */}
      <div className="flex-1 overflow-hidden">
        <Group orientation="horizontal" className="h-full w-full">
          {/* Left Column: Task Queue (Create & Reveal Tasks) */}
          <Panel defaultSize="38%" minSize={300} maxSize={550}>
            <AdminTaskQueue
              tasks={tasks}
              onCreateTask={handleCreateTask}
              onUpdateTask={handleUpdateTask}
              onDeleteTask={handleDeleteTask}
            />
          </Panel>

          <Separator className="w-1 bg-zinc-800 hover:bg-zinc-600 transition-colors cursor-col-resize shrink-0" />

          {/* Right Column: Live Team Leaderboard & Evaluation */}
          <Panel defaultSize="62%" minSize={400}>
            <AdminTeamTable
              teams={teams}
              onInspectTeam={handleInspectTeam}
              onUnlockTeam={handleUnlockTeam}
            />
          </Panel>
        </Group>
      </div>

      {/* Inspect Modal */}
      {inspectingTeam && (
        <AdminInspectModal
          team={inspectingTeam.team}
          files={inspectingTeam.files}
          violations={inspectingTeam.violations}
          prompts={inspectingTeam.prompts}
          onClose={() => setInspectingTeam(null)}
          onUnlockTeam={handleUnlockTeam}
        />
      )}
    </div>
  );
}
