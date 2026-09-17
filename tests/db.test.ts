import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const TEST_DB_PATH = path.join(process.cwd(), "test-tinyai.db");
process.env.DATABASE_PATH = TEST_DB_PATH;
process.env.ADMIN_PIN = "secret123";
process.env.MAX_PROCTORING_STRIKES = "3";

// Dynamic import after setting environment variable
let dbModule: typeof import("../src/lib/db");

describe("Database Layer (src/lib/db.ts)", () => {
  before(async () => {
    // Clean up any stale test db
    for (const ext of ["", "-wal", "-shm"]) {
      if (fs.existsSync(TEST_DB_PATH + ext)) {
        fs.unlinkSync(TEST_DB_PATH + ext);
      }
    }
    dbModule = await import("../src/lib/db");
  });

  after(() => {
    // Clean up test db files
    for (const ext of ["", "-wal", "-shm"]) {
      if (fs.existsSync(TEST_DB_PATH + ext)) {
        try {
          fs.unlinkSync(TEST_DB_PATH + ext);
        } catch {
          // ignore busy file on windows/certain locks
        }
      }
    }
  });

  describe("Competition State & Timer", () => {
    it("initializes with NOT_STARTED and default duration", () => {
      const state = dbModule.getCompetitionState();
      assert.equal(state.status, "NOT_STARTED");
      assert.equal(state.duration_minutes, 120);
      assert.equal(state.remaining_seconds, 7200);
      assert.equal(dbModule.verifyAdminPin("secret123"), true);
      assert.equal(dbModule.verifyAdminPin("wrongpin"), false);
    });

    it("starts competition with custom duration", () => {
      const state = dbModule.startCompetition(90);
      assert.equal(state.status, "RUNNING");
      assert.equal(state.duration_minutes, 90);
      assert.equal(state.remaining_seconds, 5400);
      assert.ok(state.started_at);
    });

    it("pauses and resumes competition", () => {
      const paused = dbModule.pauseCompetition();
      assert.equal(paused.status, "PAUSED");
      assert.equal(paused.started_at, null);
      assert.ok(paused.paused_at);

      const resumed = dbModule.resumeCompetition();
      assert.equal(resumed.status, "RUNNING");
      assert.ok(resumed.started_at);
      assert.equal(resumed.paused_at, null);
    });

    it("adjusts competition time (+/- seconds)", () => {
      const current = dbModule.getCompetitionState();
      const adjusted = dbModule.adjustCompetitionTime(300); // +5 min
      assert.equal(adjusted.remaining_seconds, current.remaining_seconds + 300);
    });

    it("ends competition", () => {
      const ended = dbModule.endCompetition();
      assert.equal(ended.status, "ENDED");
      assert.equal(ended.remaining_seconds, 0);
    });
  });

  describe("Tasks Management", () => {
    let taskId1: number;
    let taskId2: number;

    it("starts with empty tasks list", () => {
      const tasks = dbModule.getTasks();
      assert.equal(tasks.length, 0);
    });

    it("creates tasks", () => {
      const t1 = dbModule.createTask("Task 1: Setup", "Build core player canvas");
      const t2 = dbModule.createTask("Task 2: Obstacles", "Spawn falling rocks");
      assert.equal(t1.title, "Task 1: Setup");
      assert.equal(t1.is_revealed, 0);
      assert.equal(t2.title, "Task 2: Obstacles");
      taskId1 = t1.id;
      taskId2 = t2.id;
    });

    it("filters revealed tasks", () => {
      assert.equal(dbModule.getTasks(true).length, 0);

      const updated = dbModule.updateTask(taskId1, { is_revealed: 1 });
      assert.ok(updated);
      assert.equal(updated.is_revealed, 1);
      assert.ok(updated.revealed_at);

      const revealed = dbModule.getTasks(true);
      assert.equal(revealed.length, 1);
      assert.equal(revealed[0].id, taskId1);
    });

    it("deletes a task", () => {
      const deleted = dbModule.deleteTask(taskId2);
      assert.equal(deleted, true);
      const allTasks = dbModule.getTasks();
      assert.equal(allTasks.length, 1);
      assert.equal(allTasks[0].id, taskId1);
    });
  });

  describe("Teams, Proctoring & Violations", () => {
    let teamId: string;

    it("registers a new team and slugifies id", () => {
      const { team, isNew } = dbModule.registerOrResumeTeam("Cyber Hawks 42!");
      assert.equal(isNew, true);
      assert.equal(team.name, "Cyber Hawks 42!");
      assert.equal(team.id, "cyber-hawks-42");
      assert.equal(team.prompt_count, 0);
      assert.equal(team.strike_count, 0);
      assert.equal(team.is_locked, 0);
      teamId = team.id;
    });

    it("resumes an existing team without duplicating", () => {
      const { team, isNew } = dbModule.registerOrResumeTeam("cyber hawks 42!");
      assert.equal(isNew, false);
      assert.equal(team.id, teamId);
    });

    it("records violations and increments strike count", () => {
      const { team: t1, violation: v1 } = dbModule.recordViolation(teamId, "TAB_SWITCH");
      assert.equal(t1.strike_count, 1);
      assert.equal(t1.is_locked, 0);
      assert.equal(v1.strike_number, 1);
      assert.equal(v1.reason, "TAB_SWITCH");

      const { team: t2 } = dbModule.recordViolation(teamId, "FULLSCREEN_EXIT");
      assert.equal(t2.strike_count, 2);
      assert.equal(t2.is_locked, 0);
    });

    it("locks team on 3rd strike", () => {
      const { team: t3 } = dbModule.recordViolation(teamId, "FOCUS_LOST");
      assert.equal(t3.strike_count, 3);
      assert.equal(t3.is_locked, 1);

      const violations = dbModule.getViolationsForTeam(teamId);
      assert.equal(violations.length, 3);
    });

    it("unlocks team and resets strikes", () => {
      const unlocked = dbModule.unlockTeam(teamId);
      assert.ok(unlocked);
      assert.equal(unlocked.is_locked, 0);
      assert.equal(unlocked.strike_count, 0);
    });
  });

  describe("Files Management", () => {
    const teamId = "cyber-hawks-42";

    it("upserts and retrieves files", () => {
      dbModule.upsertFile(teamId, "index.html", "<!DOCTYPE html><html><body>Game</body></html>");
      dbModule.upsertFile(teamId, "game.js", "console.log('init');");

      const files = dbModule.getTeamFiles(teamId);
      assert.equal(files.length, 2);
      assert.equal(files[0].filename, "game.js");
      assert.equal(files[1].filename, "index.html");

      // Update existing file
      dbModule.upsertFile(teamId, "index.html", "<!DOCTYPE html><html><body>Updated</body></html>");
      const updatedFiles = dbModule.getTeamFiles(teamId);
      assert.equal(updatedFiles.length, 2);
      assert.match(updatedFiles[1].content, /Updated/);
    });

    it("deletes a file", () => {
      const deleted = dbModule.deleteFile(teamId, "game.js");
      assert.equal(deleted, true);

      const files = dbModule.getTeamFiles(teamId);
      assert.equal(files.length, 1);
      assert.equal(files[0].filename, "index.html");
    });
  });

  describe("Prompts & Cooldown", () => {
    const teamId = "cyber-hawks-42";

    it("blocks prompts when competition is ENDED", () => {
      const check = dbModule.canTeamPrompt(teamId, 10);
      assert.equal(check.allowed, false);
      assert.match(check.reason!, /competition is ended/i);
    });

    it("records prompt and enforces cooldown when RUNNING", () => {
      dbModule.startCompetition(60);

      const initialCheck = dbModule.canTeamPrompt(teamId, 10);
      assert.equal(initialCheck.allowed, true);

      // Record user prompt
      const p1 = dbModule.recordPrompt(teamId, "user", "How to add collision?");
      assert.equal(p1.role, "user");

      const team = dbModule.getTeamById(teamId);
      assert.equal(team?.prompt_count, 1);

      // Record assistant reply
      dbModule.recordPrompt(teamId, "assistant", "Use AABB box collision check.");

      const history = dbModule.getChatHistory(teamId);
      assert.equal(history.length, 2);
      assert.equal(history[0].role, "user");
      assert.equal(history[1].role, "assistant");

      // Cooldown should be active immediately after
      const cdCheck = dbModule.canTeamPrompt(teamId, 10);
      assert.equal(cdCheck.allowed, false);
      assert.ok(cdCheck.remainingCooldown > 0);
    });

    it("blocks prompt if team is locked", () => {
      // Force 3 strikes
      dbModule.recordViolation(teamId, "TAB_SWITCH");
      dbModule.recordViolation(teamId, "TAB_SWITCH");
      dbModule.recordViolation(teamId, "TAB_SWITCH");

      const check = dbModule.canTeamPrompt(teamId, 0);
      assert.equal(check.allowed, false);
      assert.match(check.reason!, /locked/i);
    });
  });
});
