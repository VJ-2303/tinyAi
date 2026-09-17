# Tiny AI, Big Brain — Platform Implementation Plan (Refined)

## 1. Overview
Custom web platform for the **Tiny AI, Big Brain** live hackathon:
- Teams of 2 build an HTML game from scratch on 1 shared workstation.
- Teams prompt a weak (<1B) local LLM served via vLLM (OpenAI-compatible endpoint).
- Strict proctoring: Enforced fullscreen + tab switch / focus-loss detection with a 3-strike lockout policy.
- Admin broadcasts competition start, controls timer, reveals tasks one-by-one, and monitors/unlocks teams.
- System enforces lockouts: no code editing or AI prompting before competition starts or when paused.
- Admin dashboard tracks live prompt counts, proctoring strikes, code files, and allows in-browser game evaluation and prompt log audits.

---

## 2. Tech Stack & Component Libraries

- **Framework**: Next.js 15+ (App Router, TypeScript, Tailwind CSS)
- **Database**: Node.js built-in `node:sqlite` (`DatabaseSync` — zero external C++ compile dependencies)
- **Component Libraries**:
  - **Base UI**: `shadcn/ui` + `@radix-ui/react-*` primitives (dialog, button, input, badge, tooltip, dropdown)
  - **Panels Layout**: `react-resizable-panels` (draggable resizable panels for Tasks, Editor, Preview, Chat)
  - **Code Editor**: `@monaco-editor/react` (VS Code editor engine, multi-file tabs, syntax highlighting)
  - **AI Chat**: `assistant-ui` + `shadcn/ui` (AI chat interface, markdown syntax highlighting, copy-code button, auto-scroll)
  - **Icons**: `lucide-react`
- **State Sync**: 2–3s short polling (robust over LAN, auto-recovers on refresh)
- **Live Preview**: Sandboxed `iframe` with in-memory HTML/CSS/JS injection

---

## 3. Environment Configuration (`.env.local`)

```env
# Server
PORT=3000

# Admin Authentication
ADMIN_PIN=admin123

# vLLM / LLM Service
VLLM_BASE_URL=http://localhost:8000/v1
VLLM_MODEL=Qwen/Qwen2.5-Coder-0.5B-Instruct
VLLM_API_KEY=dummy-key

# AI Rate Limiting & Cooldown
RATE_LIMIT_COOLDOWN_SECONDS=10

# Context Window & Pruning
LLM_CONTEXT_WINDOW_TOKENS=4096
LLM_MAX_OUTPUT_TOKENS=1024
SYSTEM_PROMPT="You are a helpful coding assistant for a fast-paced HTML game hackathon. Keep answers concise, direct, and code-centric."

# Proctoring & Anti-Cheat
MAX_PROCTORING_STRIKES=3
```

---

## 4. Proctoring & Anti-Cheat System

### A. Fullscreen & Tab-Switch Enforcement
- **Fullscreen Entry**: When the competition starts and the team is in the workspace, the application requires entering Fullscreen mode.
- **Detection Triggers**:
  - Exiting Fullscreen (`fullscreenchange` when `!document.fullscreenElement`).
  - Switching tabs or minimizing window (`visibilitychange` when `document.hidden`).
  - Losing window focus (`window.onblur`).
- **3-Strike Policy**:
  - **Strike 1 & 2**: A modal overlay immediately appears ("Warning: Proctoring Violation Detected! You must remain on this page in Fullscreen mode"). Strike is recorded in SQLite and team's strike count increments.
  - **Strike 3**: Workspace is permanently locked with an error screen ("Disqualified / Locked: 3 proctoring violations recorded. Please call the organizer to review").
- **Admin Review & Unlock**:
  - The Admin dashboard highlights teams with strikes in yellow (1–2) or red (3+).
  - Admin can view violation timestamps and reasons.
  - Admin has a 1-click **"Unlock / Reset Strikes"** button to forgive accidental gestures/popups.

---

## 5. Rate Limiting & Context Window Pruning

### A. Strict Cooldown Rate Limiting
- Configurable via `RATE_LIMIT_COOLDOWN_SECONDS` (default: 10 seconds).
- Per-team tracking in database: records `last_prompt_at`.
- If a team submits a prompt before cooldown expires:
  - Server returns HTTP 429: `{ error: "Cooldown active", remainingSeconds: N }`.
  - Frontend UI displays a live cooldown countdown badge on the chat submit button.

### B. Context Window Calculation & Pruning
- **Token Estimation**: Fast character heuristic (~4 characters = 1 token).
- **Available Input Budget**:
  $$\text{Budget} = \text{LLM\_CONTEXT\_WINDOW\_TOKENS} - \text{LLM\_MAX\_OUTPUT\_TOKENS} - \text{SystemPromptTokens} - 100$$
- **Pruning Flow**:
  1. All chat messages are stored permanently in SQLite `prompts` table for UI history and Admin audit.
  2. Before dispatching to vLLM, estimate token length of the entire conversation.
  3. If total tokens > Budget, prune oldest messages (FIFO, turn by turn) until payload fits.
  4. System prompt is always preserved at index 0; latest user prompt is always preserved.
  5. The pruned array is sent to vLLM `/v1/chat/completions`.

---

## 6. Database Schema (`tinyai.db`)

### `competition_state`
- `id` (INTEGER PRIMARY KEY)
- `status` (TEXT: `'NOT_STARTED' | 'RUNNING' | 'PAUSED' | 'ENDED'`)
- `duration_minutes` (INTEGER: default 120)
- `started_at` (INTEGER timestamp ms, nullable)
- `paused_at` (INTEGER timestamp ms, nullable)
- `remaining_seconds` (INTEGER: remaining time countdown)
- `admin_pin` (TEXT: default `'admin123'`)

### `tasks`
- `id` (INTEGER PRIMARY KEY AUTOINCREMENT)
- `order_index` (INTEGER)
- `title` (TEXT)
- `description_markdown` (TEXT)
- `is_revealed` (INTEGER: 0 or 1)
- `revealed_at` (INTEGER timestamp ms, nullable)

### `teams`
- `id` (TEXT PRIMARY KEY)
- `name` (TEXT UNIQUE)
- `prompt_count` (INTEGER DEFAULT 0)
- `strike_count` (INTEGER DEFAULT 0)
- `is_locked` (INTEGER DEFAULT 0)
- `last_prompt_at` (INTEGER timestamp ms, default 0)
- `created_at` (INTEGER timestamp ms)
- `last_active_at` (INTEGER timestamp ms)

### `violations`
- `id` (INTEGER PRIMARY KEY AUTOINCREMENT)
- `team_id` (TEXT, REFERENCES teams(id))
- `reason` (TEXT: `'TAB_SWITCH' | 'FULLSCREEN_EXIT' | 'FOCUS_LOST'`)
- `strike_number` (INTEGER)
- `created_at` (INTEGER timestamp ms)

### `files`
- `id` (INTEGER PRIMARY KEY AUTOINCREMENT)
- `team_id` (TEXT, REFERENCES teams(id))
- `filename` (TEXT)
- `content` (TEXT)
- `updated_at` (INTEGER timestamp ms)
- UNIQUE(`team_id`, `filename`)

### `prompts`
- `id` (INTEGER PRIMARY KEY AUTOINCREMENT)
- `team_id` (TEXT, REFERENCES teams(id))
- `role` (TEXT: `'user' | 'assistant'`)
- `content` (TEXT)
- `created_at` (INTEGER timestamp ms)

---

## 7. API Endpoints

### Public & Team Endpoints
- `GET  /api/competition/status` — State, remaining seconds, revealed tasks list.
- `POST /api/teams/join` — Join or resume team session by name; returns team details & files.
- `GET  /api/teams/[teamId]/files` — List team files.
- `POST /api/teams/[teamId]/files` — Upsert file (filename + content).
- `DELETE /api/teams/[teamId]/files` — Delete a file.
- `POST /api/teams/[teamId]/chat` — Send prompt: verifies lock/cooldown -> counts prompt -> prunes history -> forwards to vLLM -> logs to DB -> returns reply.
- `GET  /api/teams/[teamId]/chat` — Get full unpruned chat history for UI rendering.
- `POST /api/teams/[teamId]/violations` — Report proctoring violation (tab switch / fullscreen exit); returns updated strike count and lock state.

### Admin Endpoints (Protected with `x-admin-pin` header)
- `POST /api/admin/auth` — Verify PIN.
- `POST /api/admin/competition` — Action: `start`, `pause`, `resume`, `end`, `adjust_time`.
- `GET  /api/admin/tasks` — List all tasks (revealed and drafts).
- `POST /api/admin/tasks` — Create draft task.
- `PUT  /api/admin/tasks/[taskId]` — Update or toggle `is_revealed`.
- `DELETE /api/admin/tasks/[taskId]` — Delete task.
- `GET  /api/admin/teams` — List all teams, prompt counts, strike counts, file counts, lock status.
- `GET  /api/admin/teams/[teamId]` — Fetch specific team's code files, live preview data, violation history, and prompt audit transcript.
- `POST /api/admin/teams/[teamId]/unlock` — Reset strikes and unlock team workspace.

---

## 8. UI Layout & User Experience

### Team Workspace (`/`)
- **Top Navigation Bar**:
  - Competition Status & Live Timer (countdown badge in green/amber/red).
  - Team Name badge.
  - Strikes badge (e.g. `Strikes: 0/3`).
  - Prompt Counter badge (e.g. `Prompts Used: 7`).
  - "Run Preview" button (`Ctrl+S` / `Ctrl+Enter`).
  - Save status indicator (`Saved` / `Saving...`).
- **Resizable Multi-Column Layout (`react-resizable-panels`)**:
  - **Left Panel (Collapsible)**:
    - **Tasks Drawer**: Unlocked tasks rendered in Markdown with timestamps.
    - **Files Drawer**: Create File, Delete File, active file selector.
  - **Center Panel**:
    - Monaco Code Editor tabbed by active file (`index.html`, `style.css`, `game.js`).
    - Read-only when competition is `NOT_STARTED`, `PAUSED`, `ENDED`, or `is_locked`.
  - **Right Panel (Split Vertically)**:
    - **Top: Live Game Preview**: Sandboxed `iframe` running team's code with reload button and error log.
    - **Bottom: AI Chatbot (`assistant-ui`)**:
      - Message history with Markdown code blocks & one-click copy.
      - Input field with cooldown timer disabled state.
      - Banner warning: "Each message adds +1 to your team's prompt score."
- **Proctoring Overlays**:
  - **Fullscreen Prompt**: Initial modal requiring entering Fullscreen before entering code area.
  - **Warning Overlay**: Pops up on strike 1 or 2 with warning message and button to re-enter fullscreen.
  - **Lockout Screen**: Pops up on strike 3 or manual admin lock.

### Admin Dashboard (`/admin`)
- **Header**: PIN gate login & quick logout.
- **Competition Controls**:
  - Status indicator (`NOT STARTED`, `RUNNING`, `PAUSED`, `ENDED`).
  - Duration input (minutes), `Start`, `Pause`, `Resume`, `End`, `+5m`, `-5m` buttons.
- **Task Management**:
  - Starts empty. Admin adds tasks dynamically.
  - One-click "Reveal Task" button.
- **Live Team Leaderboard & Evaluator**:
  - Table columns: Rank, Team Name, Prompt Count, Strikes (highlighted in yellow/red), Lock Status, Files Count, Actions.
  - "Inspect Team" Modal:
    - Multi-file code viewer.
    - Live game preview runner (play the team's game inside Admin panel).
    - Violation history log (timestamp and reason for each strike).
    - Prompt audit history: full chronological transcript of team prompts & AI responses.
  - One-click **"Unlock Team / Reset Strikes"** button.

---

## 9. Implementation Steps & Verification

1. **Step 1: Project Setup & Component Libraries**
   - Initialize Next.js project with TypeScript, Tailwind CSS.
   - Install `react-resizable-panels`, `@monaco-editor/react`, `assistant-ui`, `@radix-ui/react-*`, `lucide-react`.
   - Setup `.env.local` with defaults.
   - *Verify*: Clean build `npm run build`.

2. **Step 2: Database Layer (`src/lib/db.ts`)**
   - Implement SQLite schema with `node:sqlite`.
   - Implement CRUD queries for state, tasks, teams, violations, files, prompts.
   - *Verify*: Database creation & test queries succeed.

3. **Step 3: Core API Routes**
   - Competition status & timer math (`/api/competition/status`).
   - Team join, files CRUD (`/api/teams/*`).
   - Violation reporter (`/api/teams/[teamId]/violations`).
   - AI Chat proxy with strict cooldown rate limiting & FIFO token pruning (`/api/teams/[teamId]/chat`).
   - Admin management APIs (`/api/admin/*`, team unlock).
   - *Verify*: Test endpoints with curl/Node script.

4. **Step 4: Team Workspace UI**
   - Build Join modal with localStorage reconnect persistence.
   - Integrate Monaco editor + file manager + sandboxed iframe preview runner.
   - Implement `assistant-ui` chat sidebar with cooldown timer badge.
   - Implement proctoring listeners (`fullscreenchange`, `visibilitychange`, `blur`) + warning & strike 3 lockout modals.
   - *Verify*: Code editing, preview execution, chat cooldown, and strike triggers work seamlessly.

5. **Step 5: Admin Dashboard UI**
   - PIN authentication screen.
   - Timer controls (Start, Pause, Resume, End, Adjustments).
   - Task composer and reveal queue.
   - Live team leaderboard with strike badges, unlock button, game preview runner & prompt log auditor.
   - *Verify*: Admin can control competition, reveal tasks, and inspect/unlock teams.

6. **Step 6: End-to-End Verification**
   - Simulate complete event lifecycle: Join -> Lockout -> Start -> Fullscreen violation test -> Strike 3 lock -> Admin unlock -> Coding & AI prompt with cooldown -> Task reveal -> Finish & evaluation.
