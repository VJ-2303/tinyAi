# Tiny AI, Big Brain

High-performance, self-hosted hackathon platform engineered for high-stakes AI-assisted coding competitions. Designed for offline and local-area network (LAN) events supporting 50+ concurrent teams with zero external database dependencies.

---

## Key Features

### 1. Team Workstation (`/`)
- **Monaco Code Editor**: Multi-file tabbed IDE (`index.html`, `style.css`, `script.js`, etc.) with syntax highlighting, keyboard shortcuts, and auto-save.
- **Sandboxed Live Preview**: Real-time rendering of client-side web applications and HTML5 canvas games inside a secure, isolated iframe sandbox.
- **AI Coding Assistant**: Built-in conversational AI with token budget management, reverse-FIFO context pruning, and strict rate-limiting cooldowns (10s default) to prevent prompt spamming.
- **Anti-Cheat Proctoring**: Automated tracking of window blur, tab switching, and fullscreen exits. Incurs strikes for infractions; automatically locks the workstation on the 3rd strike.
- **Progressive Task Feed**: Real-time task board where organizers reveal challenge specifications dynamically throughout competition rounds.

### 2. Admin Command Center (`/admin`)
- **Authoritative Competition Clock**: Master control over competition states (`NOT_STARTED`, `RUNNING`, `PAUSED`, `ENDED`) with duration configuration, mid-event time adjustments (+/- minutes), and emergency freezes.
- **Dynamic Task Management**: Create, edit, reorder (monotonic indexing), and reveal/hide challenge specifications on the fly.
- **Live Proctoring Desk**: Real-time telemetry monitoring all teams, strike counts, prompt usage, file counts, and lock status.
- **Remote Workstation Unlock**: Clear strikes and restore workstation access after investigating infractions.
- **Full Audit Inspection**: Deep-dive inspector for judges to review code files, playable previews, and complete prompt history transcripts.

### 3. High-Concurrency SQLite Engine
- **Node.js Native SQLite (`node:sqlite`)**: Single-file storage running in WAL (Write-Ahead Logging) mode with `PRAGMA synchronous = NORMAL` and 64MB memory page caching.
- **Zero Write-on-Read Lock Polling**: In-memory countdown decay computation prevents SQLite write-lock contention during rapid 2.5s polling across 50+ concurrent teams.
- **Pre-aggregated Telemetry**: $O(1)$ team leaderboard aggregations using pre-computed join subqueries.

---

## Architecture & Tech Stack

| Layer | Technology |
|---|---|
| **Framework** | Next.js 16 (App Router with Turbopack) |
| **Frontend** | React 19, Tailwind CSS v4, Lucide React, Assistant UI |
| **Code Editor** | Monaco Editor (`@monaco-editor/react`) |
| **Database** | Node.js built-in `node:sqlite` (`DatabaseSync`) |
| **LLM Gateway** | OpenAI-compatible endpoint (vLLM / Ollama) with offline fallback |
| **Testing** | Node.js Test Runner (`node:test`) + `tsx` |

---

## Quick Start

### Prerequisites
- Node.js >= 22.0.0 (required for built-in `node:sqlite`)
- npm, pnpm, or yarn

### Installation
```bash
# 1. Clone repository
git clone https://github.com/your-org/tinyai.git
cd tinyai

# 2. Install dependencies
npm install

# 3. Start development server
npm run dev
```

Workstation will be available at `http://localhost:3000`, and Admin Console at `http://localhost:3000/admin`.

---

## Production & LAN Deployment

For hosting the event over a local Wi-Fi router or LAN switch for ~50 teams:

```bash
# Build production bundle with Turbopack
npm run build

# Start production server on all network interfaces
npm run start -- -H 0.0.0.0 -p 3000
```

Teams access the workstation at `http://<HOST_LOCAL_IP>:3000`.

---

## Configuration (`.env`)

All parameters have production-safe defaults and can be customized via environment variables:

| Variable | Default | Description |
|---|---|---|
| `DATABASE_PATH` | `./tinyai.db` | Absolute or relative path to SQLite database file |
| `ADMIN_PIN` | `admin123` | Master secret PIN for `/admin` authentication |
| `MAX_PROCTORING_STRIKES` | `3` | Number of tab/fullscreen infractions before locking workstation |
| `RATE_LIMIT_COOLDOWN_SECONDS` | `10` | Cooldown duration between consecutive AI prompts |
| `VLLM_BASE_URL` | `http://localhost:8000/v1` | Base URL of local inference server (vLLM, Ollama, LocalAI) |
| `VLLM_MODEL` | `Qwen/Qwen2.5-Coder-0.5B-Instruct` | Target model name |
| `VLLM_API_KEY` | `dummy-key` | API key for local inference server (if required) |
| `LLM_CONTEXT_WINDOW_TOKENS` | `4096` | Context limit budget for AI prompt trimming |
| `LLM_MAX_OUTPUT_TOKENS` | `1024` | Maximum tokens allowed in LLM completion response |
| `SYSTEM_PROMPT` | *(Default prompt)* | Custom system instructions injected into AI assistant |

> **Note on Local AI**: If no local LLM endpoint is running at `VLLM_BASE_URL`, the platform automatically uses a built-in offline coding assistant fallback without crashing.

---

## Verification & Test Suite

The project includes an automated test harness with 71 tests across 6 suites:

```bash
# Run complete test suite
npm test

# Run individual test suites
npm run test:db             # Database layer, schemas, constraints, and timer bounds
npm run test:perf           # Concurrency, pragmas, zero write-on-read lock, and 50-team scale
npm run test:api            # Next.js API route integrations (auth, files, chat, proctoring)
npm run test:e2e            # Complete event lifecycle simulation (setup -> sprint -> lock -> judge)
npm run test:bughunt        # Path traversal prevention, index.html protection, payload optimizations
npm run test:admin-bughunt  # Timing-safe PIN verification, monotonic task ordering, boundary clamps
```

---

## Event Operations Playbook

1. **Pre-Event Setup**:
   - Set a strong `ADMIN_PIN` in `.env.local`.
   - Log into `/admin`, verify clock is in `NOT_STARTED` status.
   - Draft round challenges in the Task Queue (leave hidden).
2. **Team Check-In**:
   - Instruct participants to open the LAN address and enter their Team Name.
   - Initial starter canvas files (`index.html`, `style.css`, `script.js`) are pre-populated.
   - Workstation remains in pre-event lockout mode (coding and AI chat disabled) until kickoff.
3. **Competition Kickoff**:
   - Admin sets duration (e.g. 120 minutes) and clicks **Start Competition**.
   - Reveal Task 1 in the Admin Task Queue.
   - All workstations immediately unlock and timer begins live countdown.
4. **During Event**:
   - Admin reveals subsequent tasks as rounds advance.
   - Monitor the Proctoring Desk for strike spikes. If a workstation is locked due to accidental OS notifications, verify and click **Unlock Workstation**.
5. **Event Conclusion**:
   - Timer auto-expires at zero, or Admin triggers **End Competition**.
   - All team workspaces freeze.
   - Judges open the Team Inspector on `/admin` to evaluate submitted code, test playable games, and review prompt audit transcripts.
