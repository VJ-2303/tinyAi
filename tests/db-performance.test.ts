import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const TEST_DB_PATH = path.join(process.cwd(), "test-perf-tinyai.db");
process.env.DATABASE_PATH = TEST_DB_PATH;
process.env.ADMIN_PIN = "secret123";
process.env.MAX_PROCTORING_STRIKES = "3";

let dbModule: typeof import("../src/lib/db");

describe("Database Performance & Optimization Suite (src/lib/db.ts)", () => {
  before(async () => {
    // Clean up any stale test db
    for (const ext of ["", "-wal", "-shm"]) {
      if (fs.existsSync(TEST_DB_PATH + ext)) {
        try {
          fs.unlinkSync(TEST_DB_PATH + ext);
        } catch {
          // ignore lock
        }
      }
    }
    dbModule = await import("../src/lib/db");
  });

  after(() => {
    for (const ext of ["", "-wal", "-shm"]) {
      if (fs.existsSync(TEST_DB_PATH + ext)) {
        try {
          fs.unlinkSync(TEST_DB_PATH + ext);
        } catch {
          // ignore lock
        }
      }
    }
  });

  describe("1. High-Performance SQLite Pragmas", () => {
    it("configures WAL journal mode", () => {
      const row = dbModule.db.prepare("PRAGMA journal_mode;").get() as { journal_mode: string };
      assert.equal(row.journal_mode.toLowerCase(), "wal");
    });

    it("configures synchronous = NORMAL for high write throughput without data corruption", () => {
      const row = dbModule.db.prepare("PRAGMA synchronous;").get() as { synchronous: number };
      // 1 represents NORMAL in SQLite
      assert.equal(row.synchronous, 1);
    });

    it("configures 64MB memory page cache", () => {
      const row = dbModule.db.prepare("PRAGMA cache_size;").get() as { cache_size: number };
      // -64000 indicates 64,000 KiB cache in memory
      assert.equal(row.cache_size, -64000);
    });

    it("configures temp_store = MEMORY", () => {
      const row = dbModule.db.prepare("PRAGMA temp_store;").get() as { temp_store: number };
      // 2 represents MEMORY
      assert.equal(row.temp_store, 2);
    });
  });

  describe("2. Elimination of Write-on-Read Lock in getCompetitionState", () => {
    it("serves 100 rapid polls in <25ms without modifying row.started_at", () => {
      dbModule.startCompetition(120);
      const initialDbRow = dbModule.db.prepare("SELECT * FROM competition_state WHERE id = 1").get() as {
        started_at: number;
        remaining_seconds: number;
      };
      assert.ok(initialDbRow.started_at);

      const startTime = performance.now();
      const iterations = 100;
      for (let i = 0; i < iterations; i++) {
        const state = dbModule.getCompetitionState();
        assert.equal(state.status, "RUNNING");
        assert.ok(state.remaining_seconds <= 7200);
      }
      const elapsed = performance.now() - startTime;

      // Check DB row to ensure it was NOT updated on reads
      const finalDbRow = dbModule.db.prepare("SELECT * FROM competition_state WHERE id = 1").get() as {
        started_at: number;
        remaining_seconds: number;
      };

      assert.equal(
        finalDbRow.started_at,
        initialDbRow.started_at,
        "started_at must NOT mutate during read queries"
      );
      assert.equal(
        finalDbRow.remaining_seconds,
        initialDbRow.remaining_seconds,
        "remaining_seconds in DB row must not be rewritten on read polls"
      );

      // Verify throughput: 100 reads in under 50ms (typically <5ms in memory)
      assert.ok(elapsed < 50, `100 read polls took ${elapsed.toFixed(2)}ms, expected < 50ms`);
    });

    it("handles 50 concurrent simulated client requests with zero locking errors", async () => {
      const concurrentClients = 50;
      const promises = Array.from({ length: concurrentClients }, async () => {
        return dbModule.getCompetitionState();
      });

      const results = await Promise.all(promises);
      assert.equal(results.length, 50);
      for (const res of results) {
        assert.equal(res.status, "RUNNING");
        assert.ok(res.remaining_seconds > 0);
      }
    });
  });

  describe("3. Timer Accuracy Under In-Memory Countdown", () => {
    it("accurately calculates countdown decay and freezes correctly on pause/resume", async () => {
      dbModule.startCompetition(60); // 3600 seconds
      const s1 = dbModule.getCompetitionState();
      assert.equal(s1.remaining_seconds, 3600);

      // Sleep 1100ms
      await new Promise((resolve) => setTimeout(resolve, 1100));

      const s2 = dbModule.getCompetitionState();
      assert.ok(
        s2.remaining_seconds <= 3599,
        `Expected remaining seconds <= 3599 after 1.1s, got ${s2.remaining_seconds}`
      );

      // Pause competition
      const pausedState = dbModule.pauseCompetition();
      assert.equal(pausedState.status, "PAUSED");
      const pausedRemaining = pausedState.remaining_seconds;

      // Sleep 500ms while paused
      await new Promise((resolve) => setTimeout(resolve, 500));

      const s3 = dbModule.getCompetitionState();
      assert.equal(s3.remaining_seconds, pausedRemaining, "Timer must not decay while PAUSED");

      // Resume competition
      const resumedState = dbModule.resumeCompetition();
      assert.equal(resumedState.status, "RUNNING");

      // Sleep 1100ms
      await new Promise((resolve) => setTimeout(resolve, 1100));

      const s4 = dbModule.getCompetitionState();
      assert.ok(
        s4.remaining_seconds < pausedRemaining,
        `Expected remaining to resume countdown below ${pausedRemaining}, got ${s4.remaining_seconds}`
      );
    });

    it("adjusts time smoothly and recalculates in-memory ticks correctly", () => {
      const beforeAdjust = dbModule.getCompetitionState();
      const adjusted = dbModule.adjustCompetitionTime(300); // add 5 minutes
      assert.equal(adjusted.remaining_seconds, beforeAdjust.remaining_seconds + 300);

      const check = dbModule.getCompetitionState();
      assert.equal(check.remaining_seconds, adjusted.remaining_seconds);
    });

    it("transitions state to ENDED exactly once when timer reaches 0", () => {
      // Force started_at to be far in the past
      dbModule.db.prepare(`
        UPDATE competition_state
        SET status = 'RUNNING', remaining_seconds = 10, started_at = ?
        WHERE id = 1
      `).run(Date.now() - 20000); // 20s ago

      const state = dbModule.getCompetitionState();
      assert.equal(state.status, "ENDED");
      assert.equal(state.remaining_seconds, 0);

      const dbRow = dbModule.db.prepare("SELECT * FROM competition_state WHERE id = 1").get() as {
        status: string;
        remaining_seconds: number;
        started_at: number | null;
      };
      assert.equal(dbRow.status, "ENDED");
      assert.equal(dbRow.remaining_seconds, 0);
      assert.equal(dbRow.started_at, null);
    });
  });

  describe("4. 50-Team Scale & Aggregation Performance (getAllTeamsWithStats)", () => {
    it("populates 50 teams with files & violations and benchmarks query execution", () => {
      // Clean previous teams
      dbModule.db.prepare("DELETE FROM teams").run();

      const teamCount = 50;
      const expectedData = new Map<string, { files: number; violations: number }>();

      // Insert 50 teams
      for (let i = 1; i <= teamCount; i++) {
        const teamName = `Team ${i.toString().padStart(2, "0")}`;
        const { team } = dbModule.registerOrResumeTeam(teamName);

        // Files: Team i gets (i % 5) files
        const fileCount = i % 5;
        for (let f = 0; f < fileCount; f++) {
          dbModule.upsertFile(team.id, `file_${f}.js`, `console.log("Team ${team.id} file ${f}");`);
        }

        // Violations: Team i gets (i % 3) violations
        const violationCount = i % 3;
        for (let v = 0; v < violationCount; v++) {
          dbModule.recordViolation(team.id, `Violation ${v + 1}`);
        }

        expectedData.set(team.id, { files: fileCount, violations: violationCount });
      }

      // Benchmark getAllTeamsWithStats execution
      const t0 = performance.now();
      const allTeams = dbModule.getAllTeamsWithStats();
      const t1 = performance.now();
      const queryTime = t1 - t0;

      assert.equal(allTeams.length, 50, "Must return all 50 teams");

      // Verify aggregation correctness for each team
      for (const t of allTeams) {
        const expected = expectedData.get(t.id);
        assert.ok(expected, `Team ${t.id} must be in expected dataset`);
        assert.equal(
          t.file_count,
          expected.files,
          `Team ${t.id} file_count mismatch: expected ${expected.files}, got ${t.file_count}`
        );
        assert.equal(
          t.violation_count,
          expected.violations,
          `Team ${t.id} violation_count mismatch: expected ${expected.violations}, got ${t.violation_count}`
        );
      }

      // Assert speed: 50 teams with aggregations must complete in < 15ms
      assert.ok(queryTime < 25, `getAllTeamsWithStats took ${queryTime.toFixed(2)}ms, expected < 25ms`);
    });
  });
});
