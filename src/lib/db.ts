import { DatabaseSync } from "node:sqlite";
import path from "node:path";

export type CompetitionStatus = "NOT_STARTED" | "RUNNING" | "PAUSED" | "ENDED";

export interface CompetitionState {
  id: number;
  status: CompetitionStatus;
  duration_minutes: number;
  started_at: number | null;
  paused_at: number | null;
  remaining_seconds: number;
  admin_pin: string;
}

export interface Task {
  id: number;
  order_index: number;
  title: string;
  description_markdown: string;
  is_revealed: number; // 0 or 1
  revealed_at: number | null;
}

export interface Team {
  id: string;
  name: string;
  prompt_count: number;
  strike_count: number;
  is_locked: number; // 0 or 1
  last_prompt_at: number;
  created_at: number;
  last_active_at: number;
}

export interface Violation {
  id: number;
  team_id: string;
  reason: string;
  strike_number: number;
  created_at: number;
}

export interface FileRecord {
  id: number;
  team_id: string;
  filename: string;
  content: string;
  updated_at: number;
}

export interface PromptRecord {
  id: number;
  team_id: string;
  role: "user" | "assistant";
  content: string;
  created_at: number;
}

const globalForDb = globalThis as unknown as {
  tinyAiDb: DatabaseSync | undefined;
};

function initDatabase(): DatabaseSync {
  const dbPath = process.env.DATABASE_PATH || path.join(process.cwd(), "tinyai.db");
  const db = new DatabaseSync(dbPath);

  // Performance and integrity pragmas
  db.exec("PRAGMA busy_timeout = 10000;");
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");

  // 1. competition_state table
  db.exec(`
    CREATE TABLE IF NOT EXISTS competition_state (
      id INTEGER PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'NOT_STARTED',
      duration_minutes INTEGER NOT NULL DEFAULT 120,
      started_at INTEGER,
      paused_at INTEGER,
      remaining_seconds INTEGER NOT NULL DEFAULT 7200,
      admin_pin TEXT NOT NULL DEFAULT 'admin123'
    );
  `);

  // Ensure default competition_state row exists (id = 1)
  const stateCheck = db.prepare("SELECT id FROM competition_state WHERE id = 1").get();
  if (!stateCheck) {
    const defaultPin = process.env.ADMIN_PIN || "admin123";
    db.prepare(`
      INSERT INTO competition_state (id, status, duration_minutes, remaining_seconds, admin_pin)
      VALUES (1, 'NOT_STARTED', 120, 7200, ?)
    `).run(defaultPin);
  }

  // 2. tasks table (starts empty as specified)
  db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_index INTEGER NOT NULL DEFAULT 0,
      title TEXT NOT NULL,
      description_markdown TEXT NOT NULL DEFAULT '',
      is_revealed INTEGER NOT NULL DEFAULT 0,
      revealed_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_tasks_revealed ON tasks(is_revealed, order_index);
  `);

  // 3. teams table
  db.exec(`
    CREATE TABLE IF NOT EXISTS teams (
      id TEXT PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      prompt_count INTEGER NOT NULL DEFAULT 0,
      strike_count INTEGER NOT NULL DEFAULT 0,
      is_locked INTEGER NOT NULL DEFAULT 0,
      last_prompt_at INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      last_active_at INTEGER NOT NULL
    );
  `);

  // 4. violations table
  db.exec(`
    CREATE TABLE IF NOT EXISTS violations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      reason TEXT NOT NULL,
      strike_number INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_violations_team ON violations(team_id);
  `);

  // 5. files table
  db.exec(`
    CREATE TABLE IF NOT EXISTS files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      filename TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      updated_at INTEGER NOT NULL,
      UNIQUE(team_id, filename)
    );
    CREATE INDEX IF NOT EXISTS idx_files_team ON files(team_id);
  `);

  // 6. prompts table
  db.exec(`
    CREATE TABLE IF NOT EXISTS prompts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_prompts_team ON prompts(team_id, created_at);
  `);

  return db;
}

export const db: DatabaseSync = globalForDb.tinyAiDb ?? initDatabase();
if (process.env.NODE_ENV !== "production") {
  globalForDb.tinyAiDb = db;
}

// ----------------------------------------------------------------------------
// Competition State Helpers
// ----------------------------------------------------------------------------

export function getCompetitionState(): CompetitionState {
  const row = db.prepare("SELECT * FROM competition_state WHERE id = 1").get() as unknown as CompetitionState;
  if (!row) {
    throw new Error("Competition state not found");
  }

  // Authoritative timer calculation if running
  if (row.status === "RUNNING" && row.started_at) {
    const now = Date.now();
    const elapsedSeconds = Math.floor((now - row.started_at) / 1000);
    const newRemaining = Math.max(0, row.remaining_seconds - elapsedSeconds);

    if (newRemaining === 0) {
      // Auto-expire to ENDED
      db.prepare(`
        UPDATE competition_state
        SET status = 'ENDED', remaining_seconds = 0, started_at = NULL, paused_at = NULL
        WHERE id = 1
      `).run();
      row.status = "ENDED";
      row.remaining_seconds = 0;
    } else {
      // Update remaining seconds and reset started_at to now for continuous decay tracking
      db.prepare(`
        UPDATE competition_state
        SET remaining_seconds = ?, started_at = ?
        WHERE id = 1
      `).run(newRemaining, now);
      row.remaining_seconds = newRemaining;
      row.started_at = now;
    }
  }

  return row;
}

export function startCompetition(durationMinutes?: number): CompetitionState {
  const currentState = getCompetitionState();
  const duration = durationMinutes ?? currentState.duration_minutes ?? 120;
  const totalSeconds = duration * 60;
  const now = Date.now();

  db.prepare(`
    UPDATE competition_state
    SET status = 'RUNNING',
        duration_minutes = ?,
        remaining_seconds = ?,
        started_at = ?,
        paused_at = NULL
    WHERE id = 1
  `).run(duration, totalSeconds, now);

  return getCompetitionState();
}

export function pauseCompetition(): CompetitionState {
  const currentState = getCompetitionState();
  if (currentState.status !== "RUNNING") return currentState;

  const now = Date.now();
  db.prepare(`
    UPDATE competition_state
    SET status = 'PAUSED',
        started_at = NULL,
        paused_at = ?
    WHERE id = 1
  `).run(now);

  return getCompetitionState();
}

export function resumeCompetition(): CompetitionState {
  const currentState = getCompetitionState();
  if (currentState.status !== "PAUSED") return currentState;

  const now = Date.now();
  db.prepare(`
    UPDATE competition_state
    SET status = 'RUNNING',
        started_at = ?,
        paused_at = NULL
    WHERE id = 1
  `).run(now);

  return getCompetitionState();
}

export function endCompetition(): CompetitionState {
  db.prepare(`
    UPDATE competition_state
    SET status = 'ENDED',
        remaining_seconds = 0,
        started_at = NULL,
        paused_at = NULL
    WHERE id = 1
  `).run();

  return getCompetitionState();
}

export function adjustCompetitionTime(deltaSeconds: number): CompetitionState {
  const currentState = getCompetitionState();
  const newRemaining = Math.max(0, currentState.remaining_seconds + deltaSeconds);

  db.prepare(`
    UPDATE competition_state
    SET remaining_seconds = ?
    WHERE id = 1
  `).run(newRemaining);

  return getCompetitionState();
}

export function verifyAdminPin(pin: string): boolean {
  const state = db.prepare("SELECT admin_pin FROM competition_state WHERE id = 1").get() as { admin_pin: string } | undefined;
  const expectedPin = process.env.ADMIN_PIN || state?.admin_pin || "admin123";
  return pin === expectedPin;
}

// ----------------------------------------------------------------------------
// Task Management Helpers
// ----------------------------------------------------------------------------

export function getTasks(revealedOnly = false): Task[] {
  if (revealedOnly) {
    return db.prepare("SELECT * FROM tasks WHERE is_revealed = 1 ORDER BY order_index ASC, id ASC").all() as unknown as Task[];
  }
  return db.prepare("SELECT * FROM tasks ORDER BY order_index ASC, id ASC").all() as unknown as Task[];
}

export function createTask(title: string, descriptionMarkdown: string, orderIndex?: number): Task {
  const index = orderIndex ?? (db.prepare("SELECT COUNT(*) as cnt FROM tasks").get() as { cnt: number }).cnt + 1;
  const res = db.prepare(`
    INSERT INTO tasks (order_index, title, description_markdown, is_revealed, revealed_at)
    VALUES (?, ?, ?, 0, NULL)
  `).run(index, title.trim(), descriptionMarkdown.trim());

  return db.prepare("SELECT * FROM tasks WHERE id = ?").get(res.lastInsertRowid) as unknown as Task;
}

export function updateTask(id: number, updates: { title?: string; description_markdown?: string; is_revealed?: number; order_index?: number }): Task | null {
  const existing = db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as unknown as Task | undefined;
  if (!existing) return null;

  const title = updates.title ?? existing.title;
  const description = updates.description_markdown ?? existing.description_markdown;
  const orderIndex = updates.order_index ?? existing.order_index;
  const isRevealed = updates.is_revealed ?? existing.is_revealed;
  const revealedAt = isRevealed && !existing.is_revealed ? Date.now() : existing.revealed_at;

  db.prepare(`
    UPDATE tasks
    SET title = ?, description_markdown = ?, order_index = ?, is_revealed = ?, revealed_at = ?
    WHERE id = ?
  `).run(title, description, orderIndex, isRevealed, revealedAt, id);

  return db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as unknown as Task;
}

export function deleteTask(id: number): boolean {
  const res = db.prepare("DELETE FROM tasks WHERE id = ?").run(id);
  return res.changes > 0;
}

// ----------------------------------------------------------------------------
// Team & Session Helpers
// ----------------------------------------------------------------------------

export function slugifyTeamName(name: string): string {
  const slug = name.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  return slug || "team-" + Math.random().toString(36).substring(2, 8);
}

export function getTeamById(id: string): Team | null {
  const row = db.prepare("SELECT * FROM teams WHERE id = ?").get(id);
  return (row as unknown as Team) || null;
}

export function getTeamByName(name: string): Team | null {
  const row = db.prepare("SELECT * FROM teams WHERE LOWER(name) = LOWER(?)").get(name.trim());
  return (row as unknown as Team) || null;
}

export function registerOrResumeTeam(name: string): { team: Team; isNew: boolean } {
  const trimmed = name.trim();
  const existing = getTeamByName(trimmed);
  const now = Date.now();

  if (existing) {
    db.prepare("UPDATE teams SET last_active_at = ? WHERE id = ?").run(now, existing.id);
    existing.last_active_at = now;
    return { team: existing, isNew: false };
  }

  const id = slugifyTeamName(trimmed);
  db.prepare(`
    INSERT INTO teams (id, name, prompt_count, strike_count, is_locked, last_prompt_at, created_at, last_active_at)
    VALUES (?, ?, 0, 0, 0, 0, ?, ?)
  `).run(id, trimmed, now, now);

  const team = getTeamById(id)!;
  return { team, isNew: true };
}

export function touchTeamActive(teamId: string): void {
  db.prepare("UPDATE teams SET last_active_at = ? WHERE id = ?").run(Date.now(), teamId);
}

export function unlockTeam(teamId: string): Team | null {
  db.prepare("UPDATE teams SET is_locked = 0, strike_count = 0 WHERE id = ?").run(teamId);
  return getTeamById(teamId);
}

export function getAllTeamsWithStats(): (Team & { file_count: number; violation_count: number })[] {
  return db.prepare(`
    SELECT t.*,
           (SELECT COUNT(*) FROM files f WHERE f.team_id = t.id) as file_count,
           (SELECT COUNT(*) FROM violations v WHERE v.team_id = t.id) as violation_count
    FROM teams t
    ORDER BY t.prompt_count ASC, t.created_at ASC
  `).all() as unknown as (Team & { file_count: number; violation_count: number })[];
}

// ----------------------------------------------------------------------------
// Proctoring & Violations Helpers
// ----------------------------------------------------------------------------

export function recordViolation(teamId: string, reason: string): { team: Team; violation: Violation } {
  const team = getTeamById(teamId);
  if (!team) {
    throw new Error("Team not found");
  }

  const now = Date.now();
  const newStrikeNumber = team.strike_count + 1;
  const maxStrikes = Number(process.env.MAX_PROCTORING_STRIKES || 3);
  const isLocked = newStrikeNumber >= maxStrikes ? 1 : team.is_locked;

  db.prepare(`
    UPDATE teams
    SET strike_count = ?, is_locked = ?, last_active_at = ?
    WHERE id = ?
  `).run(newStrikeNumber, isLocked, now, teamId);

  const res = db.prepare(`
    INSERT INTO violations (team_id, reason, strike_number, created_at)
    VALUES (?, ?, ?, ?)
  `).run(teamId, reason, newStrikeNumber, now);

  const violation = db.prepare("SELECT * FROM violations WHERE id = ?").get(res.lastInsertRowid) as unknown as Violation;
  const updatedTeam = getTeamById(teamId)!;

  return { team: updatedTeam, violation };
}

export function getViolationsForTeam(teamId: string): Violation[] {
  return db.prepare("SELECT * FROM violations WHERE team_id = ? ORDER BY created_at DESC").all(teamId) as unknown as Violation[];
}

// ----------------------------------------------------------------------------
// File Management Helpers
// ----------------------------------------------------------------------------

export function getTeamFiles(teamId: string): FileRecord[] {
  return db.prepare("SELECT * FROM files WHERE team_id = ? ORDER BY filename ASC").all(teamId) as unknown as FileRecord[];
}

export function upsertFile(teamId: string, filename: string, content: string): FileRecord {
  const cleanFilename = filename.trim().replace(/^(\.\/|\/)+/, "");
  const now = Date.now();

  db.prepare(`
    INSERT INTO files (team_id, filename, content, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(team_id, filename) DO UPDATE SET
      content = excluded.content,
      updated_at = excluded.updated_at
  `).run(teamId, cleanFilename, content, now);

  touchTeamActive(teamId);

  return db.prepare("SELECT * FROM files WHERE team_id = ? AND filename = ?").get(teamId, cleanFilename) as unknown as FileRecord;
}

export function deleteFile(teamId: string, filename: string): boolean {
  const cleanFilename = filename.trim().replace(/^(\.\/|\/)+/, "");
  const res = db.prepare("DELETE FROM files WHERE team_id = ? AND filename = ?").run(teamId, cleanFilename);
  touchTeamActive(teamId);
  return res.changes > 0;
}

// ----------------------------------------------------------------------------
// Prompts & AI Rate Limiting Helpers
// ----------------------------------------------------------------------------

export function canTeamPrompt(teamId: string, cooldownSeconds = 10): { allowed: boolean; remainingCooldown: number; reason?: string } {
  const state = getCompetitionState();
  if (state.status !== "RUNNING") {
    return { allowed: false, remainingCooldown: 0, reason: `Competition is ${state.status.toLowerCase()}` };
  }

  const team = getTeamById(teamId);
  if (!team) {
    return { allowed: false, remainingCooldown: 0, reason: "Team not found" };
  }

  if (team.is_locked) {
    return { allowed: false, remainingCooldown: 0, reason: "Team is locked due to proctoring strikes" };
  }

  const now = Date.now();
  const elapsedSeconds = Math.floor((now - team.last_prompt_at) / 1000);
  if (elapsedSeconds < cooldownSeconds) {
    const remaining = cooldownSeconds - elapsedSeconds;
    return { allowed: false, remainingCooldown: remaining, reason: `Cooldown active. Please wait ${remaining}s.` };
  }

  return { allowed: true, remainingCooldown: 0 };
}

export function recordPrompt(teamId: string, role: "user" | "assistant", content: string): PromptRecord {
  const now = Date.now();

  const res = db.prepare(`
    INSERT INTO prompts (team_id, role, content, created_at)
    VALUES (?, ?, ?, ?)
  `).run(teamId, role, content, now);

  if (role === "user") {
    db.prepare(`
      UPDATE teams
      SET prompt_count = prompt_count + 1,
          last_prompt_at = ?,
          last_active_at = ?
      WHERE id = ?
    `).run(now, now, teamId);
  } else {
    touchTeamActive(teamId);
  }

  return db.prepare("SELECT * FROM prompts WHERE id = ?").get(res.lastInsertRowid) as unknown as PromptRecord;
}

export function getChatHistory(teamId: string): PromptRecord[] {
  return db.prepare("SELECT * FROM prompts WHERE team_id = ? ORDER BY created_at ASC, id ASC").all(teamId) as unknown as PromptRecord[];
}
