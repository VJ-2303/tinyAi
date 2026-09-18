import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";

const TEST_DB_PATH = path.join(process.cwd(), "test-bughunt.db");
process.env.DATABASE_PATH = TEST_DB_PATH;
process.env.ADMIN_PIN = "admin123";

let dbModule: typeof import("../src/lib/db");
let filesRoute: typeof import("../src/app/api/teams/[teamId]/files/route");
let teamRoute: typeof import("../src/app/api/teams/[teamId]/route");
let chatRoute: typeof import("../src/app/api/teams/[teamId]/chat/route");
let violationsRoute: typeof import("../src/app/api/teams/[teamId]/violations/route");
const testTeamId = "bughunt-team";

describe("Bug Hunt Verification Suite", () => {
  before(async () => {
    for (const ext of ["", "-wal", "-shm"]) {
      if (fs.existsSync(TEST_DB_PATH + ext)) {
        try {
          fs.unlinkSync(TEST_DB_PATH + ext);
        } catch {}
      }
    }

    dbModule = await import("../src/lib/db");
    filesRoute = await import("../src/app/api/teams/[teamId]/files/route");
    teamRoute = await import("../src/app/api/teams/[teamId]/route");
    chatRoute = await import("../src/app/api/teams/[teamId]/chat/route");
    violationsRoute = await import("../src/app/api/teams/[teamId]/violations/route");

    dbModule.registerOrResumeTeam("BugHunt Team");
    dbModule.startCompetition(120);
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

  it("prevents deletion of root index.html file", async () => {
    const delReq = new NextRequest(`http://localhost:3000/api/teams/${testTeamId}/files?filename=index.html`, {
      method: "DELETE",
    });
    const delRes = await filesRoute.DELETE(delReq, { params: Promise.resolve({ teamId: testTeamId }) });
    assert.equal(delRes.status, 400);
    const data = await delRes.json();
    assert.match(data.error, /cannot delete root index\.html/i);
  });

  it("blocks path traversal in filename parameter", async () => {
    const badReq = new NextRequest(`http://localhost:3000/api/teams/${testTeamId}/files`, {
      method: "POST",
      body: JSON.stringify({ filename: "../etc/passwd", content: "malicious" }),
    });
    const badRes = await filesRoute.POST(badReq, { params: Promise.resolve({ teamId: testTeamId }) });
    assert.equal(badRes.status, 400);
    const data = await badRes.json();
    assert.match(data.error, /invalid filename path/i);
  });

  it("lightweight team status endpoint returns telemetry without file blobs", async () => {
    const statusReq = new NextRequest(`http://localhost:3000/api/teams/${testTeamId}`);
    const statusRes = await teamRoute.GET(statusReq, { params: Promise.resolve({ teamId: testTeamId }) });
    assert.equal(statusRes.status, 200);
    const data = await statusRes.json();
    assert.equal(data.id, testTeamId);
    assert.equal(typeof data.strike_count, "number");
    assert.equal(typeof data.is_locked, "number");
    assert.equal(typeof data.prompt_count, "number");
    // Verify zero file objects returned to save bandwidth
    assert.equal(data.files, undefined);
  });

  it("rejects empty prompt and does not increment prompt_count", async () => {
    const teamBefore = dbModule.getTeamById(testTeamId)!;
    const initialPromptCount = teamBefore.prompt_count;

    const chatReq = new NextRequest(`http://localhost:3000/api/teams/${testTeamId}/chat`, {
      method: "POST",
      body: JSON.stringify({ message: "   " }),
    });
    const chatRes = await chatRoute.POST(chatReq, { params: Promise.resolve({ teamId: testTeamId }) });
    assert.equal(chatRes.status, 400);

    const teamAfter = dbModule.getTeamById(testTeamId)!;
    assert.equal(teamAfter.prompt_count, initialPromptCount);
  });

  it("prevents deletion of root index.html via path variations and blocks path traversal in DELETE", async () => {
    // 1. Path variation: ./index.html
    const req1 = new NextRequest(`http://localhost:3000/api/teams/${testTeamId}/files?filename=./index.html`, {
      method: "DELETE",
    });
    const res1 = await filesRoute.DELETE(req1, { params: Promise.resolve({ teamId: testTeamId }) });
    assert.equal(res1.status, 400);

    // 2. Path traversal in DELETE: ../secret.txt
    const req2 = new NextRequest(`http://localhost:3000/api/teams/${testTeamId}/files?filename=../secret.txt`, {
      method: "DELETE",
    });
    const res2 = await filesRoute.DELETE(req2, { params: Promise.resolve({ teamId: testTeamId }) });
    assert.equal(res2.status, 400);
    const data2 = await res2.json();
    assert.match(data2.error, /invalid filename path/i);

    // 3. Direct dbModule.deleteFile on index.html returns false
    dbModule.upsertFile(testTeamId, "index.html", "<h1>test</h1>");
    const dbDelResult = dbModule.deleteFile(testTeamId, "index.html");
    assert.equal(dbDelResult, false);
    const files = dbModule.getTeamFiles(testTeamId);
    assert.ok(files.some((f) => f.filename === "index.html"));
  });

  it("proctoring violation route ignores strikes when workstation is already locked", async () => {
    // Lock team
    dbModule.recordViolation(testTeamId, "FOCUS_LOST");
    dbModule.recordViolation(testTeamId, "FOCUS_LOST");
    dbModule.recordViolation(testTeamId, "FOCUS_LOST");

    const team = dbModule.getTeamById(testTeamId)!;
    assert.equal(team.is_locked, 1);
    const strikesBefore = team.strike_count;

    // Send violation while locked
    const req = new NextRequest(`http://localhost:3000/api/teams/${testTeamId}/violations`, {
      method: "POST",
      body: JSON.stringify({ reason: "TAB_SWITCH" }),
    });
    const res = await violationsRoute.POST(req, { params: Promise.resolve({ teamId: testTeamId }) });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.match(data.message, /already locked/i);

    const teamAfter = dbModule.getTeamById(testTeamId)!;
    assert.equal(teamAfter.strike_count, strikesBefore);

    // Unlock team for cleanup
    dbModule.unlockTeam(testTeamId);
  });

  it("handles team slug collisions gracefully without database constraint errors", () => {
    const t1 = dbModule.registerOrResumeTeam("Code Wizards!");
    const t2 = dbModule.registerOrResumeTeam("Code-Wizards");
    assert.notEqual(t1.team.id, t2.team.id);
    assert.ok(t2.team.id.startsWith("code-wizards"));
  });
});
