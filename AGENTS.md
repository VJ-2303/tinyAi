# Tiny AI, Big Brain - Agent Guidelines

Operating guidelines and architectural constraints for AI coding agents in this repository.

---

## 1. System Overview

`tinyAi` is a local-first, single-server hackathon platform engineered for high-concurrency offline and local-area network events (~50 teams).

Key capabilities:
- **Team Workspace (`/`)**: Monaco editor, multi-file management, real-time live preview sandbox, rate-limited AI assistant with context pruning, automated anti-cheat proctoring (fullscreen and tab switch tracking with strike-based lockout).
- **Admin Control Center (`/admin`)**: Timing-safe PIN authentication, authoritative countdown timer orchestration (start/pause/resume/adjust), dynamic task reveal pipeline, live proctoring desk, and remote workstation unlock.
- **Backend**: Native Node.js `node:sqlite` in WAL mode, in-memory tick calculations (zero write lock contention on polling), and OpenAI-compatible vLLM integration with offline fallback.

---

## 2. Core Architecture & Key Modules

| Path | Purpose | Critical Invariants |
|---|---|---|
| `src/lib/db.ts` | SQLite schema, initialization, query methods | Never perform disk writes inside read polling (`getCompetitionState`). Use `PRAGMA synchronous = NORMAL`, WAL mode, 64MB cache. |
| `src/lib/adminAuth.ts` | Admin PIN verification & cookie handling | Use `crypto.timingSafeEqual` to prevent timing attacks. Support both cookie and `x-admin-pin` header. |
| `src/lib/llm.ts` | LLM token estimation & context window pruning | Reverse FIFO pruning to preserve system prompt + latest chat turns within budget. Gracefully fallback if vLLM endpoint is down. |
| `src/app/page.tsx` | Team workstation UI | Enforce dark utilitarian styling. Ensure proctoring triggers strikes only when competition is `RUNNING` and team is unlocked. |
| `src/app/admin/page.tsx` | Admin control deck UI | Clean operational metrics (prompt counts, strikes, files, timer controls). Instant unlock and audit inspection. |
| `src/app/api/` | Next.js App Router API endpoints | Strictly validate payloads. Return lightweight JSON; avoid returning heavy file blobs in telemetry polling endpoints. |

---

## 3. Engineering Rules & Invariants

1. **Zero Write-on-Read Locks**:
   - Status polling endpoint (`GET /api/competition/status`) is hit every 2.5s by all workstations.
   - `getCompetitionState()` in `src/lib/db.ts` calculates elapsed time purely in-memory:
     `calculatedRemaining = Math.max(0, remaining_seconds - Math.floor((now - started_at) / 1000))`
   - Disk writes occur *only* on state transitions (start, pause, resume, adjust, and automatic transition to `ENDED`).

2. **Database Concurrency & Aggregations**:
   - Teams telemetry (`getAllTeamsWithStats()`) uses pre-aggregated `LEFT JOIN` subqueries instead of correlated subqueries to ensure $O(1)$ query time regardless of team count.
   - All foreign keys are configured with `ON DELETE CASCADE`.

3. **Security & Input Sanitization**:
   - `filename` parameters must be sanitized: trim leading slashes/dots and prevent path traversal (`../`).
   - Root `index.html` cannot be deleted (required for live preview sandbox).
   - Admin routes must check `checkAdminAuth(req)` before performing actions.

4. **UI & Theme Discipline**:
   - Maintain clean, dark, utilitarian terminal aesthetic (`bg-[#090d13]`, mono typography, subtle borders, high contrast).
   - Never inject placeholder text, generic AI demo templates, or fluffy marketing copy.

---

## 4. Test Verification Suite

Always run the full test suite before concluding work:

```bash
npm test
```

Individual test runners:
- `npm run test:db` — Database schema, queries, timer bounds, proctoring locks.
- `npm run test:perf` — Pragmas, zero write-on-read lock verification, timer decay, 50-team scale.
- `npm run test:api` — Integration tests for public, team, and admin API routes.
- `npm run test:e2e` — Full competition lifecycle simulation (setup -> sprint -> strike/lockout -> evaluation).
- `npm run test:bughunt` — Team workstation regressions (path traversal, index.html protection, lightweight polling).
- `npm run test:admin-bughunt` — Admin desk regressions (timing safe PIN, order indices, bounds checking).
