"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import { Group, Panel, Separator } from "react-resizable-panels";
import { HeaderBar } from "@/components/HeaderBar";
import { LeftPanel } from "@/components/LeftPanel";
import { CodeEditor } from "@/components/CodeEditor";
import { RightPanel } from "@/components/RightPanel";
import { JoinModal } from "@/components/JoinModal";
import { ProctoringOverlay } from "@/components/ProctoringOverlay";
import type { Task, FileRecord, PromptRecord, Team } from "@/lib/db";

export default function WorkspacePage() {
  // Session & Team state
  const [team, setTeam] = useState<Team | null>(null);
  const [files, setFiles] = useState<FileRecord[]>([]);
  const [savedFiles, setSavedFiles] = useState<FileRecord[]>([]);
  const [activeFilename, setActiveFilename] = useState<string>("index.html");
  const [chatHistory, setChatHistory] = useState<PromptRecord[]>([]);
  const [isSaving, setIsSaving] = useState(false);

  // Competition state
  const [competition, setCompetition] = useState<{
    status: "NOT_STARTED" | "RUNNING" | "PAUSED" | "ENDED";
    remaining_seconds: number;
    tasks: Task[];
  }>({
    status: "NOT_STARTED",
    remaining_seconds: 7200,
    tasks: [],
  });

  // Runner & UI state
  const [runTrigger, setRunTrigger] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showWarningModal, setShowWarningModal] = useState(false);
  const [needsFullscreen, setNeedsFullscreen] = useState(false);

  // Track if competition just became RUNNING to prompt fullscreen
  const prevStatusRef = useRef(competition.status);

  // --------------------------------------------------------------------------
  // 1. Initial Load & Session Restore
  // --------------------------------------------------------------------------
  const joinTeam = useCallback(async (teamName: string) => {
    const res = await fetch("/api/teams/join", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: teamName }),
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || "Failed to join");
    }

    const data = await res.json();
    setTeam(data.team);
    setFiles(data.files || []);
    setSavedFiles(data.files || []);
    if (data.files?.length > 0) {
      setActiveFilename(data.files[0].filename);
    }

    localStorage.setItem("tinyai_team_name", data.team.name);
    localStorage.setItem("tinyai_team_id", data.team.id);

    // Fetch existing chat history
    const chatRes = await fetch(`/api/teams/${data.team.id}/chat`);
    if (chatRes.ok) {
      const chatData = await chatRes.json();
      setChatHistory(chatData.history || []);
    }
  }, []);

  useEffect(() => {
    let ignore = false;
    const restoreSession = async () => {
      const savedName = localStorage.getItem("tinyai_team_name");
      if (savedName && !ignore) {
        try {
          await joinTeam(savedName);
        } catch {
          if (!ignore) {
            localStorage.removeItem("tinyai_team_name");
            localStorage.removeItem("tinyai_team_id");
          }
        }
      }
    };
    restoreSession();
    return () => {
      ignore = true;
    };
  }, [joinTeam]);

  // Polling guard
  const isPollingRef = useRef(false);

  // --------------------------------------------------------------------------
  // 2. State Synchronization Short Polling (every 2.5s)
  // --------------------------------------------------------------------------
  const teamId = team?.id;
  const isTeamLocked = Boolean(team?.is_locked);

  const fetchStatus = useCallback(async () => {
    if (isPollingRef.current) return;
    isPollingRef.current = true;

    try {
      const res = await fetch("/api/competition/status");
      if (!res.ok) return;
      const data = await res.json();

      setCompetition((prev) => {
        if (
          prev.status === data.status &&
          prev.remaining_seconds === data.remaining_seconds &&
          prev.tasks.length === (data.tasks?.length || 0)
        ) {
          return prev;
        }
        return {
          status: data.status,
          remaining_seconds: data.remaining_seconds,
          tasks: data.tasks || [],
        };
      });

      // Prompt fullscreen if transitioning to RUNNING
      if (prevStatusRef.current !== "RUNNING" && data.status === "RUNNING") {
        if (!document.fullscreenElement) {
          setNeedsFullscreen(true);
        }
      }
      prevStatusRef.current = data.status;

      // Only poll team status if workstation is currently locked (to detect organizer unlock)
      if (teamId && isTeamLocked) {
        const teamRes = await fetch(`/api/teams/${teamId}`);
        if (teamRes.ok) {
          const teamData = await teamRes.json();
          setTeam((prev) => {
            if (!prev) return null;
            if (
              prev.strike_count === teamData.strike_count &&
              prev.is_locked === teamData.is_locked &&
              prev.prompt_count === teamData.prompt_count
            ) {
              return prev;
            }
            return { ...prev, ...teamData };
          });
        }
      }
    } catch (err: unknown) {
      // Ignore transient network blips, server restarts, or offline hiccups during background polling
      const isTransient =
        err instanceof TypeError &&
        (err.message.includes("Failed to fetch") ||
          err.message.includes("NetworkError") ||
          err.message.includes("Load failed"));

      if (!isTransient) {
        console.warn("Status polling issue:", err);
      }
    } finally {
      isPollingRef.current = false;
    }
  }, [teamId, isTeamLocked]);

  useEffect(() => {
    let isMounted = true;

    const poll = async () => {
      if (!isMounted) return;
      await fetchStatus();
    };

    poll();
    const interval = setInterval(poll, 2500);
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [fetchStatus]);

  // --------------------------------------------------------------------------
  // 3. Fullscreen & Proctoring Triggers
  // --------------------------------------------------------------------------
  const enterFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      document.documentElement
        .requestFullscreen()
        .then(() => {
          setIsFullscreen(true);
          setNeedsFullscreen(false);
          setShowWarningModal(false);
        })
        .catch((err) => console.error("Fullscreen request failed:", err));
    } else {
      setIsFullscreen(true);
      setNeedsFullscreen(false);
      setShowWarningModal(false);
    }
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      enterFullscreen();
    } else {
      document.exitFullscreen().then(() => setIsFullscreen(false)).catch(() => {});
    }
  }, [enterFullscreen]);

  // Smooth local 1-second timer tick while status is RUNNING
  useEffect(() => {
    if (competition.status !== "RUNNING") return;
    const timer = setInterval(() => {
      setCompetition((prev) => {
        if (prev.status !== "RUNNING" || prev.remaining_seconds <= 0) return prev;
        return { ...prev, remaining_seconds: Math.max(0, prev.remaining_seconds - 1) };
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [competition.status]);

  // Proctoring debounce guard to avoid cascading strikes on single alt-tab
  const lastReportedViolationRef = useRef(0);

  // Report proctoring violation to backend
  const reportViolation = useCallback(
    async (reason: "TAB_SWITCH" | "FULLSCREEN_EXIT" | "FOCUS_LOST") => {
      if (!team || competition.status !== "RUNNING" || team.is_locked) return;

      const now = Date.now();
      // Ignore cascading window events within 2 seconds of each other
      if (now - lastReportedViolationRef.current < 2000) {
        return;
      }
      lastReportedViolationRef.current = now;

      try {
        const res = await fetch(`/api/teams/${team.id}/violations`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason }),
        });

        if (res.ok) {
          const data = await res.json();
          setTeam((prev) => (prev ? { ...prev, strike_count: data.strike_count, is_locked: data.is_locked } : null));

          if (data.is_locked) {
            setShowWarningModal(false);
          } else if (data.strike_count > 0) {
            setShowWarningModal(true);
          }
        }
      } catch (err) {
        console.error("Violation report failed:", err);
      }
    },
    [team, competition.status]
  );

  // Attach window event listeners for proctoring
  useEffect(() => {
    if (!team || competition.status !== "RUNNING") return;

    const handleVisibilityChange = () => {
      if (document.hidden) {
        reportViolation("TAB_SWITCH");
      }
    };

    const handleBlur = () => {
      // Short delay to avoid blur during internal focus switches
      setTimeout(() => {
        if (!document.hasFocus()) {
          reportViolation("FOCUS_LOST");
        }
      }, 300);
    };

    const handleFullscreenChange = () => {
      const isNowFs = Boolean(document.fullscreenElement);
      setIsFullscreen(isNowFs);
      if (!isNowFs && competition.status === "RUNNING") {
        reportViolation("FULLSCREEN_EXIT");
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("blur", handleBlur);
    document.addEventListener("fullscreenchange", handleFullscreenChange);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("blur", handleBlur);
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
    };
  }, [team, competition.status, reportViolation]);

  // --------------------------------------------------------------------------
  // 4. File Management & Code Editing
  // --------------------------------------------------------------------------
  const activeFile = files.find((f) => f.filename === activeFilename) || files[0] || null;

  const handleUpdateFileContent = (filename: string, newContent: string) => {
    setFiles((prev) =>
      prev.map((f) => (f.filename === filename ? { ...f, content: newContent } : f))
    );
  };

  const handleSaveAndRun = useCallback(async () => {
    if (!team) return;
    setIsSaving(true);

    try {
      // Collect modified files between working `files` and `savedFiles`
      const dirtyFiles = files.filter((f) => {
        const saved = savedFiles.find((sf) => sf.filename === f.filename);
        return !saved || saved.content !== f.content;
      });

      // If activeFile is set, ensure it's included in save payload
      const filesToSave = dirtyFiles.length > 0 ? dirtyFiles : activeFile ? [activeFile] : [];

      await Promise.all(
        filesToSave.map((f) =>
          fetch(`/api/teams/${team.id}/files`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              filename: f.filename,
              content: f.content,
            }),
          })
        )
      );

      // Only after pressing save, files are stored and preview reloads
      setSavedFiles(files);
      setRunTrigger((prev) => prev + 1);
    } catch (err) {
      console.error("Failed to save file:", err);
    } finally {
      setIsSaving(false);
    }
  }, [team, activeFile, files, savedFiles]);

  const handleCreateFile = async (filename: string) => {
    if (!team) return;

    if (files.some((f) => f.filename.toLowerCase() === filename.toLowerCase())) {
      throw new Error(`File '${filename}' already exists`);
    }

    const res = await fetch(`/api/teams/${team.id}/files`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filename, content: `// ${filename}\n` }),
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || "Failed to create file");
    }

    const data = await res.json();
    setFiles((prev) => [...prev.filter((f) => f.filename !== filename), data.file]);
    setSavedFiles((prev) => [...prev.filter((f) => f.filename !== filename), data.file]);
    setActiveFilename(filename);
  };

  const handleDeleteFile = async (filename: string) => {
    if (!team) return;
    const res = await fetch(`/api/teams/${team.id}/files?filename=${encodeURIComponent(filename)}`, {
      method: "DELETE",
    });

    if (res.ok) {
      setFiles((prev) => prev.filter((f) => f.filename !== filename));
      setSavedFiles((prev) => prev.filter((f) => f.filename !== filename));
      if (activeFilename === filename) {
        setActiveFilename("index.html");
      }
      // Re-run preview to unload deleted file from runtime
      setRunTrigger((prev) => prev + 1);
    }
  };

  // --------------------------------------------------------------------------
  // 5. AI Chat Action
  // --------------------------------------------------------------------------
  const handleSendPrompt = async (message: string) => {
    if (!team) return;

    // Optimistically append user message
    const tempUserMsg: PromptRecord = {
      id: Date.now(),
      team_id: team.id,
      role: "user",
      content: message,
      created_at: Date.now(),
    };
    setChatHistory((prev) => [...prev, tempUserMsg]);
    setTeam((prev) => (prev ? { ...prev, prompt_count: prev.prompt_count + 1 } : null));

    try {
      const res = await fetch(`/api/teams/${team.id}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
      });

      if (!res.ok) {
        const err = await res.json();
        // Rollback optimistic message and prompt count on failure
        setChatHistory((prev) => prev.filter((m) => m.id !== tempUserMsg.id));
        setTeam((prev) => (prev ? { ...prev, prompt_count: Math.max(0, prev.prompt_count - 1) } : null));
        const errorWithCooldown = new Error(err.error || "Failed to get AI response") as Error & {
          remainingCooldown?: number;
        };
        if (typeof err.remainingCooldown === "number") {
          errorWithCooldown.remainingCooldown = err.remainingCooldown;
        }
        throw errorWithCooldown;
      }

      const data = await res.json();
      setChatHistory((prev) => [...prev, data.message]);
      if (typeof data.prompt_count === "number") {
        setTeam((prev) => (prev ? { ...prev, prompt_count: data.prompt_count } : null));
      }
    } catch (err) {
      throw err;
    }
  };

  const handleLeaveTeam = () => {
    if (confirm("Leave this workstation session? Your code will remain safely saved.")) {
      localStorage.removeItem("tinyai_team_name");
      localStorage.removeItem("tinyai_team_id");
      setTeam(null);
      setFiles([]);
      setSavedFiles([]);
      setChatHistory([]);
      setActiveFilename("index.html");
      setRunTrigger(0);
    }
  };

  // Lock status calculation
  const isWorkspaceLocked =
    competition.status !== "RUNNING" || (team ? Boolean(team.is_locked) : false);

  const lockReason =
    competition.status === "NOT_STARTED"
      ? "Competition has not started. Waiting for organizer to start timer."
      : competition.status === "PAUSED"
      ? "Competition is temporarily paused by organizer."
      : competition.status === "ENDED"
      ? "Competition has ended. Code is frozen for judging."
      : team?.is_locked
      ? "Workstation locked due to 3 proctoring strikes. Call organizer."
      : undefined;

  return (
    <div className="h-screen w-screen flex flex-col bg-zinc-950 text-zinc-100 overflow-hidden select-none">
      {/* Top Utility Header Bar */}
      <HeaderBar
        teamName={team?.name || "No Team"}
        status={competition.status}
        remainingSeconds={competition.remaining_seconds}
        promptCount={team?.prompt_count || 0}
        strikeCount={team?.strike_count || 0}
        isFullscreen={isFullscreen}
        onToggleFullscreen={toggleFullscreen}
        onRunPreview={handleSaveAndRun}
        onLeaveTeam={handleLeaveTeam}
        isSaving={isSaving}
      />

      {/* 3-Column Resizable Layout */}
      <div className="flex-1 overflow-hidden">
        <Group orientation="horizontal" className="h-full w-full">
          {/* Left Column: Tasks & Files */}
          <Panel defaultSize="22%" minSize={200} maxSize={450}>
            <LeftPanel
              tasks={competition.tasks}
              files={files}
              activeFilename={activeFilename}
              onSelectFile={setActiveFilename}
              onCreateFile={handleCreateFile}
              onDeleteFile={handleDeleteFile}
              isLocked={isWorkspaceLocked}
            />
          </Panel>

          <Separator className="w-1 bg-zinc-800 hover:bg-zinc-600 transition-colors cursor-col-resize shrink-0" />

          {/* Center Column: Monaco Code Editor */}
          <Panel defaultSize="45%" minSize={300}>
            <CodeEditor
              activeFile={activeFile}
              files={files}
              savedFiles={savedFiles}
              onSelectFile={setActiveFilename}
              onChangeContent={handleUpdateFileContent}
              onSaveAndRun={handleSaveAndRun}
              isLocked={isWorkspaceLocked}
              lockReason={lockReason}
              isSaving={isSaving}
            />
          </Panel>

          <Separator className="w-1 bg-zinc-800 hover:bg-zinc-600 transition-colors cursor-col-resize shrink-0" />

          {/* Right Column: Switch between Game Preview & AI Chat */}
          <Panel defaultSize="33%" minSize={260}>
            <RightPanel
              teamId={team?.id || ""}
              files={savedFiles}
              runTrigger={runTrigger}
              chatHistory={chatHistory}
              promptCount={team?.prompt_count || 0}
              onSendPrompt={handleSendPrompt}
              isLocked={isWorkspaceLocked}
              lockReason={lockReason}
              cooldownSeconds={Number(process.env.RATE_LIMIT_COOLDOWN_SECONDS || 10)}
            />
          </Panel>
        </Group>
      </div>

      {/* Join Modal if not logged in */}
      {!team && <JoinModal onJoin={joinTeam} />}

      {/* Proctoring & Lock Overlays */}
      <ProctoringOverlay
        isLockedByStrikes={Boolean(team?.is_locked)}
        strikeCount={team?.strike_count || 0}
        showWarningModal={showWarningModal}
        needsFullscreen={needsFullscreen}
        onEnterFullscreen={enterFullscreen}
        onDismissWarning={() => setShowWarningModal(false)}
      />
    </div>
  );
}
