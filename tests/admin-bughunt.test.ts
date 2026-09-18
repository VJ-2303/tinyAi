import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";
import { formatTime } from "../src/lib/utils";

const TEST_DB_PATH = path.join(process.cwd(), "test-admin-bughunt.db");
process.env.DATABASE_PATH = TEST_DB_PATH;
process.env.ADMIN_PIN = "secretAdminPin456";

let dbModule: typeof import("../src/lib/db");
let authRoute: typeof import("../src/app/api/admin/auth/route");
let compRoute: typeof import("../src/app/api/admin/competition/route");
let tasksRoute: typeof import("../src/app/api/admin/tasks/route");
let taskSingleRoute: typeof import("../src/app/api/admin/tasks/[taskId]/route");
let teamSingleRoute: typeof import("../src/app/api/admin/teams/[teamId]/route");
let teamUnlockRoute: typeof import("../src/app/api/admin/teams/[teamId]/unlock/route");

describe("Admin Site Bug Hunt Suite", () => {
  before(async () => {
    for (const ext of ["", "-wal", "-shm"]) {
      if (fs.existsSync(TEST_DB_PATH + ext)) {
        try {
          fs.unlinkSync(TEST_DB_PATH + ext);
        } catch {}
      }
    }

    dbModule = await import("../src/lib/db");
    authRoute = await import("../src/app/api/admin/auth/route");
    compRoute = await import("../src/app/api/admin/competition/route");
    tasksRoute = await import("../src/app/api/admin/tasks/route");
    taskSingleRoute = await import("../src/app/api/admin/tasks/[taskId]/route");
    teamSingleRoute = await import("../src/app/api/admin/teams/[teamId]/route");
    teamUnlockRoute = await import("../src/app/api/admin/teams/[teamId]/unlock/route");
  });

  after(() => {
    try {
      dbModule.endCompetition();
    } catch {}
    for (const ext of ["", "-wal", "-shm"]) {
      if (fs.existsSync(TEST_DB_PATH + ext)) {
        try {
          fs.unlinkSync(TEST_DB_PATH + ext);
        } catch {}
      }
    }
  });

  describe("1. Admin Authentication & Session Lifecycle", () => {
    it("timingSafeEqual PIN verification accepts exact PIN and rejects wrong/empty", () => {
      assert.equal(dbModule.verifyAdminPin("secretAdminPin456"), true);
      assert.equal(dbModule.verifyAdminPin("wrongPin"), false);
      assert.equal(dbModule.verifyAdminPin(""), false);
      assert.equal(dbModule.verifyAdminPin(null as unknown as string), false);
    });

    it("POST /api/admin/auth sets admin_pin cookie on valid PIN", async () => {
      const req = new NextRequest("http://localhost:3000/api/admin/auth", {
        method: "POST",
        body: JSON.stringify({ pin: "secretAdminPin456" }),
      });
      const res = await authRoute.POST(req);
      assert.equal(res.status, 200);
      const cookie = res.cookies.get("admin_pin");
      assert.ok(cookie);
      assert.equal(cookie.value, "secretAdminPin456");
    });

    it("DELETE /api/admin/auth clears admin_pin cookie with maxAge: 0", async () => {
      const res = await authRoute.DELETE();
      assert.equal(res.status, 200);
      const cookie = res.cookies.get("admin_pin");
      assert.ok(cookie);
      assert.equal(cookie.maxAge, 0);
    });
  });

  describe("2. Competition State Controls & Bounds", () => {
    it("clamps negative duration to minimum 1 minute on start", async () => {
      const req = new NextRequest("http://localhost:3000/api/admin/competition", {
        method: "POST",
        headers: { "x-admin-pin": "secretAdminPin456" },
        body: JSON.stringify({ action: "start", durationMinutes: -15 }),
      });
      const res = await compRoute.POST(req);
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.state.status, "RUNNING");
      assert.equal(data.state.duration_minutes, 1);
      assert.equal(data.state.remaining_seconds, 60);
    });

    it("safely adjusts time and does not go below zero", async () => {
      const req = new NextRequest("http://localhost:3000/api/admin/competition", {
        method: "POST",
        headers: { "x-admin-pin": "secretAdminPin456" },
        body: JSON.stringify({ action: "adjust_time", deltaSeconds: -9999 }),
      });
      const res = await compRoute.POST(req);
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.state.remaining_seconds, 0);
    });

    it("formatTime handles zero, negative, and large durations without crashing", () => {
      assert.equal(formatTime(0), "00:00");
      assert.equal(formatTime(-10), "00:00");
      assert.equal(formatTime(NaN), "00:00");
      assert.equal(formatTime(3665), "01:01:05");
    });
  });

  describe("3. Task Queue Management & Monotonic Ordering", () => {
    let task1Id: number;
    let task2Id: number;

    it("creates tasks with sequential order_index", async () => {
      const req1 = new NextRequest("http://localhost:3000/api/admin/tasks", {
        method: "POST",
        headers: { "x-admin-pin": "secretAdminPin456" },
        body: JSON.stringify({ title: "Task 1", description_markdown: "Desc 1" }),
      });
      const res1 = await tasksRoute.POST(req1);
      const data1 = await res1.json();
      task1Id = data1.task.id;

      const req2 = new NextRequest("http://localhost:3000/api/admin/tasks", {
        method: "POST",
        headers: { "x-admin-pin": "secretAdminPin456" },
        body: JSON.stringify({ title: "Task 2", description_markdown: "Desc 2" }),
      });
      const res2 = await tasksRoute.POST(req2);
      const data2 = await res2.json();
      task2Id = data2.task.id;

      assert.equal(data1.task.order_index, 1);
      assert.equal(data2.task.order_index, 2);
    });

    it("deleting an earlier task does not cause order_index collision for next task", async () => {
      // Delete task 1
      const delReq = new NextRequest(`http://localhost:3000/api/admin/tasks/${task1Id}`, {
        method: "DELETE",
        headers: { "x-admin-pin": "secretAdminPin456" },
      });
      const delRes = await taskSingleRoute.DELETE(delReq, { params: Promise.resolve({ taskId: String(task1Id) }) });
      assert.equal(delRes.status, 200);

      // Create Task 3: should get nextOrder = 3 (MAX(order_index) + 1), NOT 2 (which collides with task 2)
      const req3 = new NextRequest("http://localhost:3000/api/admin/tasks", {
        method: "POST",
        headers: { "x-admin-pin": "secretAdminPin456" },
        body: JSON.stringify({ title: "Task 3", description_markdown: "Desc 3" }),
      });
      const res3 = await tasksRoute.POST(req3);
      const data3 = await res3.json();
      assert.equal(data3.task.order_index, 3);
    });

    it("rejects empty task title in PUT update", async () => {
      const putReq = new NextRequest(`http://localhost:3000/api/admin/tasks/${task2Id}`, {
        method: "PUT",
        headers: { "x-admin-pin": "secretAdminPin456" },
        body: JSON.stringify({ title: "   " }),
      });
      const putRes = await taskSingleRoute.PUT(putReq, { params: Promise.resolve({ taskId: String(task2Id) }) });
      assert.equal(putRes.status, 400);
      const data = await putRes.json();
      assert.match(data.error, /cannot be empty/i);
    });

    it("revealing then hiding a task sets revealed_at to null", async () => {
      // Reveal task 2
      const revReq = new NextRequest(`http://localhost:3000/api/admin/tasks/${task2Id}`, {
        method: "PUT",
        headers: { "x-admin-pin": "secretAdminPin456" },
        body: JSON.stringify({ is_revealed: 1 }),
      });
      const revRes = await taskSingleRoute.PUT(revReq, { params: Promise.resolve({ taskId: String(task2Id) }) });
      const revData = await revRes.json();
      assert.equal(revData.task.is_revealed, 1);
      assert.ok(revData.task.revealed_at > 0);

      // Hide task 2
      const hideReq = new NextRequest(`http://localhost:3000/api/admin/tasks/${task2Id}`, {
        method: "PUT",
        headers: { "x-admin-pin": "secretAdminPin456" },
        body: JSON.stringify({ is_revealed: 0 }),
      });
      const hideRes = await taskSingleRoute.PUT(hideReq, { params: Promise.resolve({ taskId: String(task2Id) }) });
      const hideData = await hideRes.json();
      assert.equal(hideData.task.is_revealed, 0);
      assert.equal(hideData.task.revealed_at, null);
    });
  });

  describe("4. Team Telemetry & Workstation Unlock", () => {
    const teamName = "Admin Test Team";
    let teamId: string;

    it("retrieves team inspection details and unlocks workstation", async () => {
      const { team } = dbModule.registerOrResumeTeam(teamName);
      teamId = team.id;

      // Incur 3 violations
      dbModule.recordViolation(teamId, "Tab Switch");
      dbModule.recordViolation(teamId, "Window Blur");
      dbModule.recordViolation(teamId, "Fullscreen Exit");

      // Inspect team via admin API
      const inspectReq = new NextRequest(`http://localhost:3000/api/admin/teams/${teamId}`, {
        headers: { "x-admin-pin": "secretAdminPin456" },
      });
      const inspectRes = await teamSingleRoute.GET(inspectReq, { params: Promise.resolve({ teamId }) });
      assert.equal(inspectRes.status, 200);
      const data = await inspectRes.json();
      assert.equal(data.team.is_locked, 1);
      assert.equal(data.team.strike_count, 3);
      assert.equal(data.violations.length, 3);

      // Admin unlocks team
      const unlockReq = new NextRequest(`http://localhost:3000/api/admin/teams/${teamId}/unlock`, {
        method: "POST",
        headers: { "x-admin-pin": "secretAdminPin456" },
      });
      const unlockRes = await teamUnlockRoute.POST(unlockReq, { params: Promise.resolve({ teamId }) });
      assert.equal(unlockRes.status, 200);
      const unlockData = await unlockRes.json();
      assert.equal(unlockData.team.is_locked, 0);
      assert.equal(unlockData.team.strike_count, 0);
    });
  });
});
