import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";

const TEST_DB_PATH = path.join(process.cwd(), "test-api.db");
process.env.DATABASE_PATH = TEST_DB_PATH;
process.env.ADMIN_PIN = "admin-secret-pass";
process.env.RATE_LIMIT_COOLDOWN_SECONDS = "5";
process.env.MAX_PROCTORING_STRIKES = "3";
process.env.LLM_CONTEXT_WINDOW_TOKENS = "500";
process.env.LLM_MAX_OUTPUT_TOKENS = "100";

let statusRoute: typeof import("../src/app/api/competition/status/route");
let joinRoute: typeof import("../src/app/api/teams/join/route");
let filesRoute: typeof import("../src/app/api/teams/[teamId]/files/route");
let violationsRoute: typeof import("../src/app/api/teams/[teamId]/violations/route");
let chatRoute: typeof import("../src/app/api/teams/[teamId]/chat/route");
let adminAuthRoute: typeof import("../src/app/api/admin/auth/route");
let adminCompRoute: typeof import("../src/app/api/admin/competition/route");
let adminTasksRoute: typeof import("../src/app/api/admin/tasks/route");
let adminSingleTaskRoute: typeof import("../src/app/api/admin/tasks/[taskId]/route");
let adminSingleTeamRoute: typeof import("../src/app/api/admin/teams/[teamId]/route");
let adminUnlockRoute: typeof import("../src/app/api/admin/teams/[teamId]/unlock/route");

describe("API Routes Integration Tests", () => {
  before(async () => {
    for (const ext of ["", "-wal", "-shm"]) {
      if (fs.existsSync(TEST_DB_PATH + ext)) {
        fs.unlinkSync(TEST_DB_PATH + ext);
      }
    }

    statusRoute = await import("../src/app/api/competition/status/route");
    joinRoute = await import("../src/app/api/teams/join/route");
    filesRoute = await import("../src/app/api/teams/[teamId]/files/route");
    violationsRoute = await import("../src/app/api/teams/[teamId]/violations/route");
    chatRoute = await import("../src/app/api/teams/[teamId]/chat/route");
    adminAuthRoute = await import("../src/app/api/admin/auth/route");
    adminCompRoute = await import("../src/app/api/admin/competition/route");
    adminTasksRoute = await import("../src/app/api/admin/tasks/route");
    adminSingleTaskRoute = await import("../src/app/api/admin/tasks/[taskId]/route");
    adminSingleTeamRoute = await import("../src/app/api/admin/teams/[teamId]/route");
    adminUnlockRoute = await import("../src/app/api/admin/teams/[teamId]/unlock/route");
  });

  after(() => {
    for (const ext of ["", "-wal", "-shm"]) {
      if (fs.existsSync(TEST_DB_PATH + ext)) {
        try {
          fs.unlinkSync(TEST_DB_PATH + ext);
        } catch {}
      }
    }
  });

  let teamId: string;

  describe("Public & Team Routes", () => {
    it("GET /api/competition/status returns NOT_STARTED initially", async () => {
      const res = await statusRoute.GET();
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.status, "NOT_STARTED");
      assert.equal(data.tasks.length, 0);
    });

    it("POST /api/teams/join registers team with default files", async () => {
      const req = new NextRequest("http://localhost:3000/api/teams/join", {
        method: "POST",
        body: JSON.stringify({ name: "Team Velocity" }),
      });
      const res = await joinRoute.POST(req);
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.team.name, "Team Velocity");
      assert.equal(data.team.id, "team-velocity");
      assert.equal(data.isNew, true);
      assert.ok(data.files.length >= 2);
      teamId = data.team.id;
    });

    it("POST /api/teams/[teamId]/files blocks file edits when competition is NOT_STARTED", async () => {
      const req = new NextRequest(`http://localhost:3000/api/teams/${teamId}/files`, {
        method: "POST",
        body: JSON.stringify({ filename: "test.js", content: "console.log('blocked');" }),
      });
      const res = await filesRoute.POST(req, { params: Promise.resolve({ teamId }) });
      assert.equal(res.status, 403);
    });

    it("POST /api/teams/[teamId]/chat blocks prompts when competition is NOT_STARTED", async () => {
      const req = new NextRequest(`http://localhost:3000/api/teams/${teamId}/chat`, {
        method: "POST",
        body: JSON.stringify({ message: "Hello AI" }),
      });
      const res = await chatRoute.POST(req, { params: Promise.resolve({ teamId }) });
      assert.equal(res.status, 403);
    });
  });

  describe("Admin Routes & Competition Controls", () => {
    it("rejects unauthorized admin requests", async () => {
      const req = new NextRequest("http://localhost:3000/api/admin/competition", {
        method: "GET",
      });
      const res = await adminCompRoute.GET(req);
      assert.equal(res.status, 401);
    });

    it("POST /api/admin/auth validates PIN and sets cookie", async () => {
      const badReq = new NextRequest("http://localhost:3000/api/admin/auth", {
        method: "POST",
        body: JSON.stringify({ pin: "wrong" }),
      });
      const badRes = await adminAuthRoute.POST(badReq);
      assert.equal(badRes.status, 401);

      const goodReq = new NextRequest("http://localhost:3000/api/admin/auth", {
        method: "POST",
        body: JSON.stringify({ pin: "admin-secret-pass" }),
      });
      const goodRes = await adminAuthRoute.POST(goodReq);
      assert.equal(goodRes.status, 200);
      assert.ok(goodRes.cookies.get("admin_pin"));
    });

    it("POST /api/admin/competition starts the competition", async () => {
      const req = new NextRequest("http://localhost:3000/api/admin/competition", {
        method: "POST",
        headers: { "x-admin-pin": "admin-secret-pass" },
        body: JSON.stringify({ action: "start", durationMinutes: 60 }),
      });
      const res = await adminCompRoute.POST(req);
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.state.status, "RUNNING");
    });

    it("POST /api/admin/tasks creates and reveals a task", async () => {
      const createReq = new NextRequest("http://localhost:3000/api/admin/tasks", {
        method: "POST",
        headers: { "x-admin-pin": "admin-secret-pass" },
        body: JSON.stringify({
          title: "Round 1: Movement",
          description_markdown: "Add keyboard controls",
        }),
      });
      const createRes = await adminTasksRoute.POST(createReq);
      assert.equal(createRes.status, 200);
      const taskData = await createRes.json();
      const taskId = String(taskData.task.id);

      // Reveal task
      const revealReq = new NextRequest(`http://localhost:3000/api/admin/tasks/${taskId}`, {
        method: "PUT",
        headers: { "x-admin-pin": "admin-secret-pass" },
        body: JSON.stringify({ is_revealed: 1 }),
      });
      const revealRes = await adminSingleTaskRoute.PUT(revealReq, { params: Promise.resolve({ taskId }) });
      assert.equal(revealRes.status, 200);

      // Verify task is visible in public status endpoint
      const statusRes = await statusRoute.GET();
      const statusData = await statusRes.json();
      assert.equal(statusData.tasks.length, 1);
      assert.equal(statusData.tasks[0].title, "Round 1: Movement");
    });
  });

  describe("Active Competition Flow (Files, Chat & Proctoring)", () => {
    it("allows team to save and retrieve files while competition is RUNNING", async () => {
      const req = new NextRequest(`http://localhost:3000/api/teams/${teamId}/files`, {
        method: "POST",
        body: JSON.stringify({ filename: "player.js", content: "class Player {}" }),
      });
      const res = await filesRoute.POST(req, { params: Promise.resolve({ teamId }) });
      assert.equal(res.status, 200);

      const listReq = new NextRequest(`http://localhost:3000/api/teams/${teamId}/files`);
      const listRes = await filesRoute.GET(listReq, { params: Promise.resolve({ teamId }) });
      const listData = await listRes.json();
      assert.ok(listData.files.some((f: { filename: string }) => f.filename === "player.js"));
    });

    it("allows team to prompt AI and enforces strict cooldown (429)", async () => {
      const prompt1Req = new NextRequest(`http://localhost:3000/api/teams/${teamId}/chat`, {
        method: "POST",
        body: JSON.stringify({ message: "How do I move a rectangle with arrow keys?" }),
      });
      const prompt1Res = await chatRoute.POST(prompt1Req, { params: Promise.resolve({ teamId }) });
      assert.equal(prompt1Res.status, 200);
      const data1 = await prompt1Res.json();
      assert.equal(data1.prompt_count, 1);
      assert.ok(data1.message.content);

      // Immediate second prompt should trigger cooldown 429
      const prompt2Req = new NextRequest(`http://localhost:3000/api/teams/${teamId}/chat`, {
        method: "POST",
        body: JSON.stringify({ message: "Immediate follow-up spam" }),
      });
      const prompt2Res = await chatRoute.POST(prompt2Req, { params: Promise.resolve({ teamId }) });
      assert.equal(prompt2Res.status, 429);
      const data2 = await prompt2Res.json();
      assert.ok(data2.remainingCooldown > 0);
    });

    it("streams chat response via SSE when stream=true", async () => {
      // Register dedicated team to avoid cooldown from previous test
      const joinReq = new NextRequest("http://localhost:3000/api/teams/join", {
        method: "POST",
        body: JSON.stringify({ name: "Streaming Warriors" }),
      });
      const joinRes = await joinRoute.POST(joinReq);
      const joinData = await joinRes.json();
      const streamTeamId = joinData.team.id;

      const streamReq = new NextRequest(`http://localhost:3000/api/teams/${streamTeamId}/chat`, {
        method: "POST",
        body: JSON.stringify({ message: "Can you stream this game code?", stream: true }),
      });
      const streamRes = await chatRoute.POST(streamReq, { params: Promise.resolve({ teamId: streamTeamId }) });
      assert.equal(streamRes.status, 200);
      assert.match(streamRes.headers.get("content-type") || "", /text\/event-stream/);

      const reader = streamRes.body?.getReader();
      assert.ok(reader);
      const decoder = new TextDecoder();
      let streamOutput = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        streamOutput += decoder.decode(value);
      }

      assert.match(streamOutput, /data: /);
      assert.match(streamOutput, /"done":true/);
    });

    it("records proctoring violations and locks workstation on 3rd strike", async () => {
      // Strike 1
      const req1 = new NextRequest(`http://localhost:3000/api/teams/${teamId}/violations`, {
        method: "POST",
        body: JSON.stringify({ reason: "TAB_SWITCH" }),
      });
      const res1 = await violationsRoute.POST(req1, { params: Promise.resolve({ teamId }) });
      const d1 = await res1.json();
      assert.equal(d1.strike_count, 1);
      assert.equal(d1.is_locked, 0);

      // Strike 2
      const req2 = new NextRequest(`http://localhost:3000/api/teams/${teamId}/violations`, {
        method: "POST",
        body: JSON.stringify({ reason: "FULLSCREEN_EXIT" }),
      });
      const res2 = await violationsRoute.POST(req2, { params: Promise.resolve({ teamId }) });
      const d2 = await res2.json();
      assert.equal(d2.strike_count, 2);
      assert.equal(d2.is_locked, 0);

      // Strike 3 -> Locks workstation!
      const req3 = new NextRequest(`http://localhost:3000/api/teams/${teamId}/violations`, {
        method: "POST",
        body: JSON.stringify({ reason: "FOCUS_LOST" }),
      });
      const res3 = await violationsRoute.POST(req3, { params: Promise.resolve({ teamId }) });
      const d3 = await res3.json();
      assert.equal(d3.strike_count, 3);
      assert.equal(d3.is_locked, 1);

      // Now code save must be blocked (403)
      const saveReq = new NextRequest(`http://localhost:3000/api/teams/${teamId}/files`, {
        method: "POST",
        body: JSON.stringify({ filename: "game.js", content: "alert(1)" }),
      });
      const saveRes = await filesRoute.POST(saveReq, { params: Promise.resolve({ teamId }) });
      assert.equal(saveRes.status, 403);
    });

    it("admin inspects team files & prompt audit logs, then unlocks team", async () => {
      const inspectReq = new NextRequest(`http://localhost:3000/api/admin/teams/${teamId}`, {
        headers: { "x-admin-pin": "admin-secret-pass" },
      });
      const inspectRes = await adminSingleTeamRoute.GET(inspectReq, { params: Promise.resolve({ teamId }) });
      assert.equal(inspectRes.status, 200);
      const data = await inspectRes.json();
      assert.equal(data.team.id, teamId);
      assert.equal(data.team.is_locked, 1);
      assert.equal(data.violations.length, 3);
      assert.equal(data.prompts.length, 2); // 1 user + 1 assistant

      // Unlock team
      const unlockReq = new NextRequest(`http://localhost:3000/api/admin/teams/${teamId}/unlock`, {
        method: "POST",
        headers: { "x-admin-pin": "admin-secret-pass" },
      });
      const unlockRes = await adminUnlockRoute.POST(unlockReq, { params: Promise.resolve({ teamId }) });
      assert.equal(unlockRes.status, 200);
      const unlockData = await unlockRes.json();
      assert.equal(unlockData.team.is_locked, 0);
      assert.equal(unlockData.team.strike_count, 0);
    });
  });
});
