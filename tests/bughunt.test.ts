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
});
