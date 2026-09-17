import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";
import { pruneChatHistory, estimateTokens } from "../src/lib/llm";

const TEST_DB_PATH = path.join(process.cwd(), "test-e2e.db");
process.env.DATABASE_PATH = TEST_DB_PATH;
process.env.ADMIN_PIN = "pup-super-admin";
process.env.RATE_LIMIT_COOLDOWN_SECONDS = "2"; // 2s for fast test execution
process.env.MAX_PROCTORING_STRIKES = "3";
process.env.LLM_CONTEXT_WINDOW_TOKENS = "250"; // low window to test pruning
process.env.LLM_MAX_OUTPUT_TOKENS = "50";

let dbModule: typeof import("../src/lib/db");
let statusRoute: typeof import("../src/app/api/competition/status/route");
let joinRoute: typeof import("../src/app/api/teams/join/route");
let filesRoute: typeof import("../src/app/api/teams/[teamId]/files/route");
let violationsRoute: typeof import("../src/app/api/teams/[teamId]/violations/route");
let chatRoute: typeof import("../src/app/api/teams/[teamId]/chat/route");
let adminAuthRoute: typeof import("../src/app/api/admin/auth/route");
let adminCompRoute: typeof import("../src/app/api/admin/competition/route");
let adminTasksRoute: typeof import("../src/app/api/admin/tasks/route");
let adminSingleTaskRoute: typeof import("../src/app/api/admin/tasks/[taskId]/route");
let adminTeamsRoute: typeof import("../src/app/api/admin/teams/route");
let adminSingleTeamRoute: typeof import("../src/app/api/admin/teams/[teamId]/route");
let adminUnlockRoute: typeof import("../src/app/api/admin/teams/[teamId]/unlock/route");

describe("Full Event Lifecycle End-to-End Simulation", () => {
  before(async () => {
    for (const ext of ["", "-wal", "-shm"]) {
      if (fs.existsSync(TEST_DB_PATH + ext)) {
        fs.unlinkSync(TEST_DB_PATH + ext);
      }
    }

    dbModule = await import("../src/lib/db");
    statusRoute = await import("../src/app/api/competition/status/route");
    joinRoute = await import("../src/app/api/teams/join/route");
    filesRoute = await import("../src/app/api/teams/[teamId]/files/route");
    violationsRoute = await import("../src/app/api/teams/[teamId]/violations/route");
    chatRoute = await import("../src/app/api/teams/[teamId]/chat/route");
    adminAuthRoute = await import("../src/app/api/admin/auth/route");
    adminCompRoute = await import("../src/app/api/admin/competition/route");
    adminTasksRoute = await import("../src/app/api/admin/tasks/route");
    adminSingleTaskRoute = await import("../src/app/api/admin/tasks/[taskId]/route");
    adminTeamsRoute = await import("../src/app/api/admin/teams/route");
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

  let team1Id: string;
  let team2Id: string;
  let task1Id: string;
  let task2Id: string;

  // --------------------------------------------------------------------------
  // Phase 1: Pre-Event Setup & Lockout Verification
  // --------------------------------------------------------------------------
  describe("Phase 1: Pre-Event Setup & Gatekeeping", () => {
    it("1.1 Admin authenticates with PIN", async () => {
      const authReq = new NextRequest("http://localhost:3000/api/admin/auth", {
        method: "POST",
        body: JSON.stringify({ pin: "pup-super-admin" }),
      });
      const res = await adminAuthRoute.POST(authReq);
      assert.equal(res.status, 200);
      assert.ok(res.cookies.get("admin_pin"));
    });

    it("1.2 Admin drafts initial round tasks (hidden from teams)", async () => {
      // Draft Task 1
      const t1Req = new NextRequest("http://localhost:3000/api/admin/tasks", {
        method: "POST",
        headers: { "x-admin-pin": "pup-super-admin" },
        body: JSON.stringify({
          title: "Round 1: Canvas Arena",
          description_markdown: "Setup player avatar and bounds collision.",
        }),
      });
      const t1Res = await adminTasksRoute.POST(t1Req);
      const t1Data = await t1Res.json();
      task1Id = String(t1Data.task.id);

      // Draft Task 2 (The Twist)
      const t2Req = new NextRequest("http://localhost:3000/api/admin/tasks", {
        method: "POST",
        headers: { "x-admin-pin": "pup-super-admin" },
        body: JSON.stringify({
          title: "Twist 1: Inverted Controls Hazard",
          description_markdown: "Red zones temporarily invert arrow key directions.",
        }),
      });
      const t2Res = await adminTasksRoute.POST(t2Req);
      const t2Data = await t2Res.json();
      task2Id = String(t2Data.task.id);

      assert.ok(task1Id);
      assert.ok(task2Id);
    });

    it("1.3 Teams register and receive pristine starter canvas", async () => {
      // Team 1
      const join1Req = new NextRequest("http://localhost:3000/api/teams/join", {
        method: "POST",
        body: JSON.stringify({ name: "Cyber Hawks" }),
      });
      const j1Res = await joinRoute.POST(join1Req);
      const j1Data = await j1Res.json();
      team1Id = j1Data.team.id;
      assert.equal(j1Data.team.name, "Cyber Hawks");
      assert.ok(j1Data.files.length >= 2); // index.html + game.js

      // Team 2
      const join2Req = new NextRequest("http://localhost:3000/api/teams/join", {
        method: "POST",
        body: JSON.stringify({ name: "Pixel Knights" }),
      });
      const j2Res = await joinRoute.POST(join2Req);
      const j2Data = await j2Res.json();
      team2Id = j2Data.team.id;
      assert.equal(j2Data.team.name, "Pixel Knights");
    });

    it("1.4 Status check confirms 0 tasks revealed and NOT_STARTED state", async () => {
      const res = await statusRoute.GET();
      const data = await res.json();
      assert.equal(data.status, "NOT_STARTED");
      assert.equal(data.tasks.length, 0); // drafts are hidden!
    });

    it("1.5 Pre-event lockout strictly forbids coding and AI prompts", async () => {
      // Code save attempt
      const codeReq = new NextRequest(`http://localhost:3000/api/teams/${team1Id}/files`, {
        method: "POST",
        body: JSON.stringify({ filename: "game.js", content: "alert('cheat');" }),
      });
      const codeRes = await filesRoute.POST(codeReq, { params: Promise.resolve({ teamId: team1Id }) });
      assert.equal(codeRes.status, 403);

      // AI chat prompt attempt
      const chatReq = new NextRequest(`http://localhost:3000/api/teams/${team1Id}/chat`, {
        method: "POST",
        body: JSON.stringify({ message: "Give me snake game code" }),
      });
      const chatRes = await chatRoute.POST(chatReq, { params: Promise.resolve({ teamId: team1Id }) });
      assert.equal(chatRes.status, 403);
    });
  });

  // --------------------------------------------------------------------------
  // Phase 2: Competition Kickoff & Active Sprint
  // --------------------------------------------------------------------------
  describe("Phase 2: Competition Kickoff & Live Sprint", () => {
    it("2.1 Admin starts competition with 120-minute countdown", async () => {
      const startReq = new NextRequest("http://localhost:3000/api/admin/competition", {
        method: "POST",
        headers: { "x-admin-pin": "pup-super-admin" },
        body: JSON.stringify({ action: "start", durationMinutes: 120 }),
      });
      const startRes = await adminCompRoute.POST(startReq);
      assert.equal(startRes.status, 200);
      const data = await startRes.json();
      assert.equal(data.state.status, "RUNNING");
      assert.equal(data.state.duration_minutes, 120);
    });

    it("2.2 Admin reveals Task 1 to teams", async () => {
      const revReq = new NextRequest(`http://localhost:3000/api/admin/tasks/${task1Id}`, {
        method: "PUT",
        headers: { "x-admin-pin": "pup-super-admin" },
        body: JSON.stringify({ is_revealed: 1 }),
      });
      const revRes = await adminSingleTaskRoute.PUT(revReq, { params: Promise.resolve({ taskId: task1Id }) });
      assert.equal(revRes.status, 200);

      // Verify teams receive Task 1 on status poll
      const statusRes = await statusRoute.GET();
      const statusData = await statusRes.json();
      assert.equal(statusData.status, "RUNNING");
      assert.equal(statusData.tasks.length, 1);
      assert.equal(statusData.tasks[0].title, "Round 1: Canvas Arena");
    });

    it("2.3 Team 1 saves game code successfully in workspace", async () => {
      const saveReq = new NextRequest(`http://localhost:3000/api/teams/${team1Id}/files`, {
        method: "POST",
        body: JSON.stringify({
          filename: "game.js",
          content: `
            const canvas = document.getElementById('gameCanvas');
            const ctx = canvas.getContext('2d');
            let player = { x: 50, y: 50, size: 20, vx: 0, vy: 0 };
            function loop() {
              ctx.clearRect(0, 0, canvas.width, canvas.height);
              ctx.fillStyle = '#48bb78';
              ctx.fillRect(player.x, player.y, player.size, player.size);
              requestAnimationFrame(loop);
            }
            loop();
          `,
        }),
      });
      const saveRes = await filesRoute.POST(saveReq, { params: Promise.resolve({ teamId: team1Id }) });
      assert.equal(saveRes.status, 200);
    });

    it("2.4 AI Chat: prompt counter increments, offline fallback responds, and cooldown activates", async () => {
      const promptReq = new NextRequest(`http://localhost:3000/api/teams/${team1Id}/chat`, {
        method: "POST",
        body: JSON.stringify({ message: "How to handle arrow key movement without lag?" }),
      });
      const promptRes = await chatRoute.POST(promptReq, { params: Promise.resolve({ teamId: team1Id }) });
      assert.equal(promptRes.status, 200);
      const data = await promptRes.json();
      assert.equal(data.prompt_count, 1);
      assert.match(data.message.content, /vLLM Offline Mode/);

      // Immediate second prompt triggers 429 Cooldown
      const spamReq = new NextRequest(`http://localhost:3000/api/teams/${team1Id}/chat`, {
        method: "POST",
        body: JSON.stringify({ message: "Second prompt too fast" }),
      });
      const spamRes = await chatRoute.POST(spamReq, { params: Promise.resolve({ teamId: team1Id }) });
      assert.equal(spamRes.status, 429);
      const spamData = await spamRes.json();
      assert.ok(spamData.remainingCooldown > 0);
    });

    it("2.5 Context Window Pruning: FIFO prunes oldest history while keeping budget & system prompt", () => {
      const systemPrompt = "System instructions for HTML game.";
      // Build 10 simulated conversation turns (each ~50 chars)
      const mockHistory: { role: "user" | "assistant"; content: string }[] = [];
      for (let i = 1; i <= 10; i++) {
        mockHistory.push({ role: "user", content: `Question ${i}: How do I implement feature ${i} in game canvas?` });
        mockHistory.push({ role: "assistant", content: `Answer ${i}: Use function updateFeature${i}() with state math.` });
      }

      // Prune with low context budget (200 tokens total budget)
      const pruned = pruneChatHistory(systemPrompt, mockHistory, 250, 50);

      // System prompt must always be index 0
      assert.equal(pruned[0].role, "system");
      assert.equal(pruned[0].content, systemPrompt);

      // Total pruned items must be less than full 20 items (older turns dropped!)
      assert.ok(pruned.length < mockHistory.length + 1);

      // Latest question and answer must be preserved at end
      assert.match(pruned[pruned.length - 1].content, /Answer 10/);
      assert.match(pruned[pruned.length - 2].content, /Question 10/);

      // Verify total token estimate of pruned payload fits budget
      const totalTokens = pruned.reduce((acc, m) => acc + estimateTokens(m.content) + 4, 0);
      assert.ok(totalTokens <= 250);
    });
  });

  // --------------------------------------------------------------------------
  // Phase 3: Proctoring Violations, Strike Lockout & Admin Unlock
  // --------------------------------------------------------------------------
  describe("Phase 3: Proctoring Violations & Lockout Enforcement", () => {
    it("3.1 Team 2 incurs Strike 1 (tab switch) and Strike 2 (fullscreen exit)", async () => {
      // Strike 1
      const s1 = await violationsRoute.POST(
        new NextRequest(`http://localhost:3000/api/teams/${team2Id}/violations`, {
          method: "POST",
          body: JSON.stringify({ reason: "TAB_SWITCH" }),
        }),
        { params: Promise.resolve({ teamId: team2Id }) }
      );
      const d1 = await s1.json();
      assert.equal(d1.strike_count, 1);
      assert.equal(d1.is_locked, 0);

      // Strike 2
      const s2 = await violationsRoute.POST(
        new NextRequest(`http://localhost:3000/api/teams/${team2Id}/violations`, {
          method: "POST",
          body: JSON.stringify({ reason: "FULLSCREEN_EXIT" }),
        }),
        { params: Promise.resolve({ teamId: team2Id }) }
      );
      const d2 = await s2.json();
      assert.equal(d2.strike_count, 2);
      assert.equal(d2.is_locked, 0);
    });

    it("3.2 Team 2 incurs Strike 3 -> Workstation immediately locks (is_locked = 1)", async () => {
      const s3 = await violationsRoute.POST(
        new NextRequest(`http://localhost:3000/api/teams/${team2Id}/violations`, {
          method: "POST",
          body: JSON.stringify({ reason: "FOCUS_LOST" }),
        }),
        { params: Promise.resolve({ teamId: team2Id }) }
      );
      const d3 = await s3.json();
      assert.equal(d3.strike_count, 3);
      assert.equal(d3.is_locked, 1);

      // Workstation is now locked: Code saves rejected with 403
      const saveBlocked = await filesRoute.POST(
        new NextRequest(`http://localhost:3000/api/teams/${team2Id}/files`, {
          method: "POST",
          body: JSON.stringify({ filename: "game.js", content: "forbidden code" }),
        }),
        { params: Promise.resolve({ teamId: team2Id }) }
      );
      assert.equal(saveBlocked.status, 403);

      // AI Chat rejected with 403
      const chatBlocked = await chatRoute.POST(
        new NextRequest(`http://localhost:3000/api/teams/${team2Id}/chat`, {
          method: "POST",
          body: JSON.stringify({ message: "Help me unlock" }),
        }),
        { params: Promise.resolve({ teamId: team2Id }) }
      );
      assert.equal(chatBlocked.status, 403);
    });

    it("3.3 Admin views Team 2 on leaderboard and unlocks workstation", async () => {
      const listReq = new NextRequest("http://localhost:3000/api/admin/teams", {
        headers: { "x-admin-pin": "pup-super-admin" },
      });
      const listRes = await adminTeamsRoute.GET(listReq);
      const listData = await listRes.json();
      const t2Entry = listData.teams.find((t: { id: string }) => t.id === team2Id);
      assert.equal(t2Entry.strike_count, 3);
      assert.equal(t2Entry.is_locked, 1);

      // Admin clicks 1-click Unlock
      const unlockReq = new NextRequest(`http://localhost:3000/api/admin/teams/${team2Id}/unlock`, {
        method: "POST",
        headers: { "x-admin-pin": "pup-super-admin" },
      });
      const unlockRes = await adminUnlockRoute.POST(unlockReq, { params: Promise.resolve({ teamId: team2Id }) });
      assert.equal(unlockRes.status, 200);
      const unlockData = await unlockRes.json();
      assert.equal(unlockData.team.is_locked, 0);
      assert.equal(unlockData.team.strike_count, 0);
    });
  });

  // --------------------------------------------------------------------------
  // Phase 4: Event Conclusion & Judge Evaluation
  // --------------------------------------------------------------------------
  describe("Phase 4: Event Conclusion & Evaluation Suite", () => {
    it("4.1 Admin ends competition -> Status becomes ENDED and coding freezes", async () => {
      const endReq = new NextRequest("http://localhost:3000/api/admin/competition", {
        method: "POST",
        headers: { "x-admin-pin": "pup-super-admin" },
        body: JSON.stringify({ action: "end" }),
      });
      const endRes = await adminCompRoute.POST(endReq);
      const endData = await endRes.json();
      assert.equal(endData.state.status, "ENDED");
      assert.equal(endData.state.remaining_seconds, 0);

      // Coding is now frozen for all teams
      const postEndSave = await filesRoute.POST(
        new NextRequest(`http://localhost:3000/api/teams/${team1Id}/files`, {
          method: "POST",
          body: JSON.stringify({ filename: "game.js", content: "late edit" }),
        }),
        { params: Promise.resolve({ teamId: team1Id }) }
      );
      assert.equal(postEndSave.status, 403);
    });

    it("4.2 Judge inspects Team 1: code files, playable game data, and prompt audit transcript", async () => {
      const inspectReq = new NextRequest(`http://localhost:3000/api/admin/teams/${team1Id}`, {
        headers: { "x-admin-pin": "pup-super-admin" },
      });
      const inspectRes = await adminSingleTeamRoute.GET(inspectReq, { params: Promise.resolve({ teamId: team1Id }) });
      assert.equal(inspectRes.status, 200);
      const inspectData = await inspectRes.json();

      // Verify code files are intact
      assert.ok(inspectData.files.length >= 2);
      const gameJs = inspectData.files.find((f: { filename: string }) => f.filename === "game.js");
      assert.match(gameJs.content, /player/);

      // Verify prompt audit log has full chronological record
      assert.equal(inspectData.prompts.length, 2); // 1 user + 1 assistant
      assert.equal(inspectData.prompts[0].role, "user");
      assert.match(inspectData.prompts[0].content, /arrow key movement/);
      assert.equal(inspectData.prompts[1].role, "assistant");

      // Verify team final prompt count
      assert.equal(inspectData.team.prompt_count, 1);
    });
  });
});
