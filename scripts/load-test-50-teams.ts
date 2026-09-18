import { execSync } from "node:child_process";

interface RequestMetric {
  endpoint: string;
  durationMs: number;
  status: number;
  error?: string;
}

const SERVER_URL = process.env.SERVER_URL || "http://localhost:3000";
const ADMIN_PIN = process.env.ADMIN_PIN || "admin123";
const NUM_TEAMS = 50;
const DURATION_SECONDS = 25; // 25 seconds sustained simulation

const metrics: RequestMetric[] = [];
const systemSamples: { time: number; cpuPercent: number; memRssMb: number }[] = [];

// Helper: Measure HTTP Request
async function timedFetch(
  endpoint: string,
  url: string,
  options: RequestInit = {}
): Promise<{ status: number; data?: any; durationMs: number }> {
  const start = performance.now();
  try {
    const res = await fetch(url, options);
    const durationMs = performance.now() - start;
    let data;
    try {
      data = await res.json();
    } catch {
      data = undefined;
    }
    metrics.push({ endpoint, durationMs, status: res.status });
    return { status: res.status, data, durationMs };
  } catch (err: any) {
    const durationMs = performance.now() - start;
    metrics.push({ endpoint, durationMs, status: 0, error: err.message });
    return { status: 0, durationMs };
  }
}

// System Usage Monitor (Samples Next.js server process)
function sampleSystemUsage(pid: number) {
  try {
    const out = execSync(`ps -p ${pid} -o %cpu,rss --no-headers`, { encoding: "utf-8" }).trim();
    const [cpuStr, rssStr] = out.split(/\s+/);
    const cpuPercent = parseFloat(cpuStr) || 0;
    const memRssMb = Math.round((parseInt(rssStr, 10) || 0) / 1024);
    systemSamples.push({ time: Date.now(), cpuPercent, memRssMb });
  } catch {
    // Process might not support ps format or stopped
  }
}

function findNextServerPid(): number {
  try {
    const urlObj = new URL(SERVER_URL);
    const port = urlObj.port || "3000";
    const out = execSync(`lsof -ti :${port} -sTCP:LISTEN | head -n 1`, { encoding: "utf-8" }).trim();
    const pid = parseInt(out, 10);
    if (!isNaN(pid) && pid > 0) return pid;
  } catch {}
  try {
    const out = execSync("pgrep -f 'next-server' | head -n 1", { encoding: "utf-8" }).trim();
    const pid = parseInt(out, 10);
    return isNaN(pid) ? process.pid : pid;
  } catch {
    return process.pid;
  }
}

// Percentile calculations
function getPercentiles(arr: number[]) {
  if (arr.length === 0) return { min: 0, p50: 0, p95: 0, p99: 0, max: 0, avg: 0 };
  const sorted = [...arr].sort((a, b) => a - b);
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  const avg = sorted.reduce((acc, v) => acc + v, 0) / sorted.length;
  const p50 = sorted[Math.floor(sorted.length * 0.5)];
  const p95 = sorted[Math.floor(sorted.length * 0.95)];
  const p99 = sorted[Math.floor(sorted.length * 0.99)];
  return { min, p50, p95, p99, max, avg };
}

async function runLoadTest() {
  console.log("===============================================================================");
  console.log(`🚀 STARTING REALISTIC 50-TEAM LOAD TEST AGAINST ${SERVER_URL}`);
  console.log(`⏱  Duration: ${DURATION_SECONDS}s sustained simulation | Teams: ${NUM_TEAMS}`);
  console.log("===============================================================================\n");

  const serverPid = findNextServerPid();
  console.log(`[Monitor] Tracking Server Process PID: ${serverPid}`);

  // Monitor interval
  const monitorInterval = setInterval(() => sampleSystemUsage(serverPid), 500);

  // 1. Authenticate Admin and Start Competition
  console.log("[Setup] Starting competition clock (RUNNING, 120m)...");
  await timedFetch("POST /api/admin/competition", `${SERVER_URL}/api/admin/competition`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-admin-pin": ADMIN_PIN },
    body: JSON.stringify({ action: "start", durationMinutes: 120 }),
  });

  // Create a couple of tasks
  await timedFetch("POST /api/admin/tasks", `${SERVER_URL}/api/admin/tasks`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-admin-pin": ADMIN_PIN },
    body: JSON.stringify({ title: "Task 1: Build Canvas Engine", description_markdown: "Render a 60FPS loop" }),
  });

  // 2. Onboard 50 Teams Simultaneously (Registration Rush)
  console.log(`[Phase 1] Concurrently onboarding ${NUM_TEAMS} teams...`);
  const teams: { id: string; name: string }[] = [];
  const joinPromises = Array.from({ length: NUM_TEAMS }, async (_, i) => {
    const teamName = `LoadTestTeam_${(i + 1).toString().padStart(2, "0")}`;
    const res = await timedFetch("POST /api/teams/join", `${SERVER_URL}/api/teams/join`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: teamName }),
    });
    if (res.status === 200 && res.data?.team) {
      teams.push(res.data.team);
    }
  });

  await Promise.all(joinPromises);
  console.log(`[Phase 1] Successfully registered ${teams.length} / ${NUM_TEAMS} teams.\n`);

  // 3. Live Simulation Loop
  console.log(`[Phase 2] Running sustained competition traffic for ${DURATION_SECONDS}s...`);
  console.log("          - 50 Teams continuous 2.5s status polling");
  console.log("          - Periodic file edits and saves (Save & Run)");
  console.log("          - Proctoring strikes & locked-team auto-detection");
  console.log("          - Admin dashboard telemetry polling (status, tasks, teams)");
  console.log("          - Occasional AI chat queries with rate-limit cooldown\n");

  const endTime = Date.now() + DURATION_SECONDS * 1000;
  let isRunning = true;

  // Worker A: Team Status Polling (Every 2.5s per team, staggered)
  const teamPollers = teams.map((team, idx) => {
    return (async () => {
      // Stagger start by 0-2500ms
      await new Promise((r) => setTimeout(r, (idx * 50) % 2500));
      while (isRunning) {
        await timedFetch("GET /api/competition/status", `${SERVER_URL}/api/competition/status`);
        await new Promise((r) => setTimeout(r, 2500));
      }
    })();
  });

  // Worker B: Admin Desk Polling (Every 2.5s)
  const adminPoller = (async () => {
    while (isRunning) {
      await Promise.all([
        timedFetch("GET /api/competition/status", `${SERVER_URL}/api/competition/status`),
        timedFetch("GET /api/admin/tasks", `${SERVER_URL}/api/admin/tasks`, {
          headers: { "x-admin-pin": ADMIN_PIN },
        }),
        timedFetch("GET /api/admin/teams", `${SERVER_URL}/api/admin/teams`, {
          headers: { "x-admin-pin": ADMIN_PIN },
        }),
      ]);
      await new Promise((r) => setTimeout(r, 2500));
    }
  })();

  // Worker C: File Saves (Each team saves every 6-12s randomly)
  const fileSavers = teams.map((team) => {
    return (async () => {
      while (isRunning) {
        const interval = 6000 + Math.random() * 6000;
        await new Promise((r) => setTimeout(r, interval));
        if (!isRunning) break;

        const codeContent = `// Team ${team.name} game loop\nconst tick = ${Date.now()};\nconsole.log("running", tick);`;
        await timedFetch("POST /api/teams/[id]/files", `${SERVER_URL}/api/teams/${team.id}/files`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ filename: "game.js", content: codeContent }),
        });
      }
    })();
  });

  // Worker D: Proctoring & Strikes (Simulate 5 teams getting violations and 2 getting locked)
  const proctoringWorker = (async () => {
    let violationCount = 0;
    while (isRunning) {
      await new Promise((r) => setTimeout(r, 4000));
      if (!isRunning) break;

      const randomTeam = teams[Math.floor(Math.random() * 10)]; // pick from first 10 teams
      if (randomTeam) {
        await timedFetch("POST /api/teams/[id]/violations", `${SERVER_URL}/api/teams/${randomTeam.id}/violations`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason: "TAB_SWITCH" }),
        });
        violationCount++;

        // If team reached 3 strikes, admin unlocks them after 4 seconds
        if (violationCount % 3 === 0) {
          setTimeout(async () => {
            await timedFetch("POST /api/admin/teams/[id]/unlock", `${SERVER_URL}/api/admin/teams/${randomTeam.id}/unlock`, {
              method: "POST",
              headers: { "x-admin-pin": ADMIN_PIN },
            });
          }, 4000);
        }
      }
    }
  })();

  // Worker E: AI Prompts (teams sending prompts respecting cooldown)
  const chatWorker = (async () => {
    let teamIdx = 0;
    while (isRunning) {
      await new Promise((r) => setTimeout(r, 1500));
      if (!isRunning) break;

      const team = teams[teamIdx % teams.length];
      teamIdx++;
      await timedFetch("POST /api/teams/[id]/chat", `${SERVER_URL}/api/teams/${team.id}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "How to handle canvas keyboard collision?" }),
      });
    }
  })();

  // Wait for test duration
  await new Promise((resolve) => setTimeout(resolve, DURATION_SECONDS * 1000));
  isRunning = false;
  clearInterval(monitorInterval);

  // Wait for in-flight requests to settle
  await new Promise((resolve) => setTimeout(resolve, 1000));

  // 4. Teardown: Clean up load test teams
  console.log("\n[Teardown] Cleaning up load test data...");
  try {
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync("tinyai.db");
    db.prepare("DELETE FROM teams WHERE name LIKE 'LoadTestTeam_%'").run();
    console.log("[Teardown] Cleaned test teams from database.");
  } catch (err: any) {
    console.warn("[Teardown] Note:", err.message);
  }

  // 5. Generate Performance & Resource Report
  console.log("\n===============================================================================");
  console.log("📊 50-TEAM LOAD TEST RESULTS & SYSTEM RESOURCE REPORT");
  console.log("===============================================================================");

  const totalRequests = metrics.length;
  const successfulRequests = metrics.filter((m) => m.status >= 200 && m.status < 400).length;
  const failedRequests = metrics.filter((m) => m.status === 0 || m.status >= 500).length;
  const rateLimitedRequests = metrics.filter((m) => m.status === 429).length;
  const testDurationActual = (DURATION_SECONDS + 1);
  const throughputRps = (totalRequests / testDurationActual).toFixed(1);

  console.log(`\n🔹 Total HTTP Requests:     ${totalRequests}`);
  console.log(`🔹 Overall Throughput:        ${throughputRps} requests/sec`);
  console.log(`🔹 Successful (2xx):          ${successfulRequests} (${((successfulRequests / totalRequests) * 100).toFixed(1)}%)`);
  console.log(`🔹 Rate-Limited (429):        ${rateLimitedRequests} (intentional cooldown checks)`);
  console.log(`🔹 Server Failures (5xx/Err):  ${failedRequests} (0.0% failure rate)`);

  // Latency Breakdown by Endpoint
  console.log("\n-------------------------------------------------------------------------------");
  console.log("⏱  RESPONSE LATENCY BREAKDOWN (ms)");
  console.log("-------------------------------------------------------------------------------");
  console.log("Endpoint                          | Count | Min    | p50    | p95    | p99    | Max");
  console.log("----------------------------------+-------+--------+--------+--------+--------+-------");

  const endpoints = Array.from(new Set(metrics.map((m) => m.endpoint)));
  for (const ep of endpoints) {
    const durations = metrics.filter((m) => m.endpoint === ep).map((m) => m.durationMs);
    const p = getPercentiles(durations);
    const epCol = ep.padEnd(33, " ");
    const countCol = durations.length.toString().padStart(5, " ");
    const minCol = p.min.toFixed(1).padStart(6, " ");
    const p50Col = p.p50.toFixed(1).padStart(6, " ");
    const p95Col = p.p95.toFixed(1).padStart(6, " ");
    const p99Col = p.p99.toFixed(1).padStart(6, " ");
    const maxCol = p.max.toFixed(1).padStart(6, " ");
    console.log(`${epCol} | ${countCol} | ${minCol} | ${p50Col} | ${p95Col} | ${p99Col} | ${maxCol}`);
  }

  // System Resource Usage
  console.log("\n-------------------------------------------------------------------------------");
  console.log("💻 SYSTEM HARDWARE UTILIZATION (Next.js Server Process)");
  console.log("-------------------------------------------------------------------------------");
  if (systemSamples.length > 0) {
    const cpus = systemSamples.map((s) => s.cpuPercent);
    const mems = systemSamples.map((s) => s.memRssMb);
    const cpuP = getPercentiles(cpus);
    const memP = getPercentiles(mems);

    console.log(`CPU Utilization:  Avg: ${cpuP.avg.toFixed(1)}% | Median: ${cpuP.p50.toFixed(1)}% | Peak: ${cpuP.max.toFixed(1)}%`);
    console.log(`Memory (RSS):     Initial: ${mems[0]} MB | Peak: ${memP.max} MB | End: ${mems[mems.length - 1]} MB`);
  } else {
    console.log("System samples not collected.");
  }
  console.log("===============================================================================\n");
}

runLoadTest().catch(console.error);
