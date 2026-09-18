import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";

const TEST_DB_PATH = path.join(process.cwd(), "test-task-schedule.db");
process.env.DATABASE_PATH = TEST_DB_PATH;
process.env.ADMIN_PIN = "adminSecretPin999";

let dbModule: typeof import("../src/lib/db");
let statusRoute: typeof import("../src/app/api/competition/status/route");
let adminTasksRoute: typeof import("../src/app/api/admin/tasks/route");
let adminTaskSingleRoute: typeof import("../src/app/api/admin/tasks/[taskId]/route");
let adminCompRoute: typeof import("../src/app/api/admin/competition/route");

describe("Task Auto-Reveal Schedule & Manual Overrides", () => {
  before(async () => {
    for (const ext of ["", "-wal", "-shm"]) {
      if (fs.existsSync(TEST_DB_PATH + ext)) {
        fs.unlinkSync(TEST_DB_PATH + ext);
      }
    }
    dbModule = await import("../src/lib/db");
    statusRoute = await import("../src/app/api/competition/status/route");
    adminTasksRoute = await import("../src/app/api/admin/tasks/route");
    adminTaskSingleRoute = await import("../src/app/api/admin/tasks/[taskId]/route");
    adminCompRoute = await import("../src/app/api/admin/competition/route");
  });

  after(() => {
    for (const ext of ["", "-wal", "-shm"]) {
      if (fs.existsSync(TEST_DB_PATH + ext)) {
        try {
          fs.unlinkSync(TEST_DB_PATH + ext);
        } catch {
          // ignore busy file locks
        }
      }
    }
  });

  describe("1. Database Helper Methods (getTasks, createTask, updateTask)", () => {
    let taskKickoffId: number;
    let taskTwist30Id: number;
    let taskManualId: number;

    it("creates tasks with scheduled reveal_after_minutes", () => {
      const t0 = dbModule.createTask("Task 0: Kickoff", "Initial challenge", 1, 0);
      const t30 = dbModule.createTask("Task 1: Twist at 30m", "Add obstacle physics", 2, 30);
      const tManual = dbModule.createTask("Task 2: Surprise Boss", "Surprise twist", 3, null);

      assert.equal(t0.reveal_after_minutes, 0);
      assert.equal(t0.is_revealed, 0);

      assert.equal(t30.reveal_after_minutes, 30);
      assert.equal(t30.is_revealed, 0);

      assert.equal(tManual.reveal_after_minutes, null);
      assert.equal(tManual.is_revealed, 0);

      taskKickoffId = t0.id;
      taskTwist30Id = t30.id;
      taskManualId = tManual.id;
    });

    it("hides scheduled tasks when competition is not started or elapsedSeconds is negative", () => {
      // elapsedSeconds = -1 represents NOT_STARTED
      const revealed = dbModule.getTasks(true, -1);
      assert.equal(revealed.length, 0);

      // elapsedSeconds omitted defaults to manual only
      const revealedDefault = dbModule.getTasks(true);
      assert.equal(revealedDefault.length, 0);
    });

    it("reveals kickoff task (0m) immediately when elapsedSeconds = 0", () => {
      const revealed = dbModule.getTasks(true, 0);
      assert.equal(revealed.length, 1);
      assert.equal(revealed[0].id, taskKickoffId);
      assert.equal(revealed[0].is_revealed, 1);
    });

    it("keeps 30m twist hidden when elapsedSeconds < 1800 (e.g. 15m = 900s)", () => {
      const revealed = dbModule.getTasks(true, 900);
      assert.equal(revealed.length, 1);
      assert.equal(revealed[0].id, taskKickoffId);
    });

    it("automatically reveals 30m twist when elapsedSeconds >= 1800", () => {
      const revealed = dbModule.getTasks(true, 1800);
      assert.equal(revealed.length, 2);
      assert.equal(revealed[0].id, taskKickoffId);
      assert.equal(revealed[1].id, taskTwist30Id);
      assert.equal(revealed[1].is_revealed, 1);
    });

    it("allows manual reveal override before scheduled time", () => {
      // Manual task has no schedule, reveal manually
      const updatedManual = dbModule.updateTask(taskManualId, { is_revealed: 1 });
      assert.equal(updatedManual?.is_revealed, 1);

      // Now at kickoff (elapsed 0), both Task 0 and Task Manual are revealed
      const revealedAtKickoff = dbModule.getTasks(true, 0);
      assert.equal(revealedAtKickoff.length, 2);
      assert.ok(revealedAtKickoff.some((t) => t.id === taskKickoffId));
      assert.ok(revealedAtKickoff.some((t) => t.id === taskManualId));
    });

    it("allows manual hide override by clearing schedule and setting is_revealed = 0", () => {
      // Hide Task 0 (kickoff)
      const hidden = dbModule.updateTask(taskKickoffId, { is_revealed: 0, reveal_after_minutes: null });
      assert.equal(hidden?.is_revealed, 0);
      assert.equal(hidden?.reveal_after_minutes, null);

      // At elapsed 1800, Task 0 should NOT be returned
      const revealed = dbModule.getTasks(true, 1800);
      assert.ok(!revealed.some((t) => t.id === taskKickoffId));
      assert.ok(revealed.some((t) => t.id === taskTwist30Id));
    });
  });

  describe("2. API Routes Integration (/api/competition/status & /api/admin/tasks)", () => {
    let apiTaskId: number;

    it("creates scheduled task via Admin POST /api/admin/tasks", async () => {
      const req = new NextRequest("http://localhost:3000/api/admin/tasks", {
        method: "POST",
        headers: { "x-admin-pin": "adminSecretPin999" },
        body: JSON.stringify({
          title: "API Scheduled Task",
          description_markdown: "API Twist",
          reveal_after_minutes: 45,
        }),
      });

      const res = await adminTasksRoute.POST(req);
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.task.title, "API Scheduled Task");
      assert.equal(data.task.reveal_after_minutes, 45);
      apiTaskId = data.task.id;
    });

    it("updates scheduled task via Admin PUT /api/admin/tasks/:id", async () => {
      const req = new NextRequest(`http://localhost:3000/api/admin/tasks/${apiTaskId}`, {
        method: "PUT",
        headers: { "x-admin-pin": "adminSecretPin999" },
        body: JSON.stringify({
          reveal_after_minutes: 10,
        }),
      });

      const res = await adminTaskSingleRoute.PUT(req, {
        params: Promise.resolve({ taskId: String(apiTaskId) }),
      });
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.task.reveal_after_minutes, 10);
    });

    it("status route hides scheduled tasks when competition is NOT_STARTED", async () => {
      const res = await statusRoute.GET();
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.status, "NOT_STARTED");
      // apiTaskId (scheduled for 10 min) must not be revealed
      assert.ok(!data.tasks.some((t: { id: number }) => t.id === apiTaskId));
    });

    it("status route auto-reveals task when competition is RUNNING and elapsed time reaches threshold", async () => {
      // Start competition with 60 minutes
      const startReq = new NextRequest("http://localhost:3000/api/admin/competition", {
        method: "POST",
        headers: { "x-admin-pin": "adminSecretPin999" },
        body: JSON.stringify({ action: "start", durationMinutes: 60 }),
      });
      await adminCompRoute.POST(startReq);

      // Create a task scheduled for minute 0 (kickoff)
      const kickoffReq = new NextRequest("http://localhost:3000/api/admin/tasks", {
        method: "POST",
        headers: { "x-admin-pin": "adminSecretPin999" },
        body: JSON.stringify({
          title: "Sprint Start Task",
          description_markdown: "Begin now",
          reveal_after_minutes: 0,
        }),
      });
      const kickoffRes = await adminTasksRoute.POST(kickoffReq);
      const kickoffData = await kickoffRes.json();

      // Check status: kickoff task must be in revealed tasks immediately
      const statusRes = await statusRoute.GET();
      const statusData = await statusRes.json();
      assert.equal(statusData.status, "RUNNING");
      assert.ok(statusData.tasks.some((t: { id: number }) => t.id === kickoffData.task.id));

      // Task scheduled for 10 min must still be hidden
      assert.ok(!statusData.tasks.some((t: { id: number }) => t.id === apiTaskId));
    });

    it("pausing competition freezes elapsed time and prevents future scheduled task leaks", async () => {
      // Pause competition
      const pauseReq = new NextRequest("http://localhost:3000/api/admin/competition", {
        method: "POST",
        headers: { "x-admin-pin": "adminSecretPin999" },
        body: JSON.stringify({ action: "pause" }),
      });
      await adminCompRoute.POST(pauseReq);

      const statusRes = await statusRoute.GET();
      const statusData = await statusRes.json();
      assert.equal(statusData.status, "PAUSED");

      // apiTaskId (10m schedule) is still not reached, remains hidden
      assert.ok(!statusData.tasks.some((t: { id: number }) => t.id === apiTaskId));
    });
  });
});
