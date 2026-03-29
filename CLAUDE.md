# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Before starting a new task, review existing rules and hypotheses for this domain.
Apply rules by default. Check if any hypothesis can be tested with today's work.
At the end of each task, extract insights.
Store them in domain folders, e.g.:
/knowLedge/pricing/ knowledge.md
(facts and patterns)
hypotheses.md (need more data)
rules.md
(confirmed - apply by default)
Maintain a /knowledge/INDEX.md
that routes
to each domain folder.
When a hypothesis gets confirmed 5+ times, promote it to a rule.
When a rule gets contradicted by new data, demote it back to a hypothesis.

## What is PIU

PIU is a desktop API management app (Postman alternative) built with Tauri 2.0 (Rust backend) + React 19 + Next.js 16 + Ant Design 6. It's native, offline-first, and stores data in local SQLite.

## Commands

```bash
# Development (full desktop app with hot reload)
bun tauri dev

# Frontend only (Next.js dev server on port 3000)
bun run dev

# Production build
bun run build          # Next.js static export → ./dist
bun tauri build        # Full desktop app bundle

# Linting
bun run lint                                                              # Ant Design v6 deprecation checker
cd src-tauri && cargo fmt                                                 # Rust formatting
cd src-tauri && cargo clippy --all-targets --all-features -- -D warnings  # Rust linting

# Release
./publish.sh           # Auto-increment patch version, tag, push (triggers CI release)
./publish.sh 0.2.0     # Specific version
```

No test infrastructure exists yet. Package manager is **bun**.

## Architecture

### Two-process model (Tauri)

```
┌─────────────────────────────────┐     ┌──────────────────────────────┐
│  Frontend (WebView)             │     │  Backend (Rust)              │
│  React 19 + Next.js 16          │◄───►│  Tauri commands (IPC)        │
│  Ant Design 6 + Tailwind 4      │     │  reqwest HTTP executor       │
│  Zustand 5 stores               │     │  Turso SQLite database       │
└─────────────────────────────────┘     └──────────────────────────────┘
        invoke<T>(cmd, args)                 #[tauri::command]
```

Frontend calls Rust via `invoke()`. Long-running HTTP requests emit `request-progress` events that the frontend listens to via Tauri event system.

### Frontend (`src/app/`)

- **`page.tsx`** — Single-page layout: ProjectList (left) | RequestEditor + ResponseViewer (center) | Sidebar (right)
- **`providers.tsx`** — Ant Design ConfigProvider + App wrapper (dark theme)
- **`stores/`** — 6 Zustand stores: `projectStore`, `collectionStore`, `requestStore`, `responseStore`, `environmentStore`, `updateStore`
- **`types/index.ts`** — All TypeScript interfaces (mirror Rust structs). Includes `defaultRequestConfig()`, `parseConfig()`, `parseQueryParamsFromUrl()` helpers
- **`components/`** — ~20 focused components (editors, modals, viewers, sidebar)

### Backend (`src-tauri/src/`)

- **`lib.rs`** — Tauri setup, DB init with recovery dialog, registers ~30 command handlers
- **`commands/`** — Tauri IPC endpoints (project, collection, request, environment, changelog commands)
- **`db/`** — SQLite layer via turso. Tables: projects, collections, requests, environments, env_variables, app_state, changelog
- **`http/`** — `executor.rs` (reqwest client), `orchestrator.rs` (URL resolution: `host + prefix + path`, `{{var}}` interpolation, auth injection)

### Data flow

```
Component → Zustand store action → invoke() → Rust command → DB/HTTP
                                                    ↓
Component ← Zustand state update ← Tauri event ←───┘ (for async HTTP)
```

### URL resolution model

Requests store only the path. Full URL is built at execution time:
```
env.host + collection.path_prefix + request.url
"https://api.example.com" + "/v1" + "/users/{{userId}}"
```

## Key Conventions

- **Ant Design v6**: See `.claude/rules/antd-v6-reference.md` for full deprecation map. Key changes: `destroyOnClose` → `destroyOnHidden`, `visible` → `open`, style props → `styles` object, children patterns → `items` arrays, `List` component → `Flex` + `.map()`, static methods → `App.useApp()`
- **State management**: Zustand with immutable updates via spread operators. Stores call `invoke()` directly
- **Modals/Drawers**: Always controlled with `open` state, `destroyOnHidden`, form reset on close
- **Message/Modal/Notification API**: Must use `const { message, modal } = App.useApp()`, never static imports

## Git Rules

- **Never push `*-plan.md` files** — Implementation plans are local working documents, not tracked in git. They are gitignored via `*-plan.md`.

## CI/CD

- **CI** (`.github/workflows/ci.yml`): Builds macOS (arm64 + x64), Linux (deb + rpm), Windows on push/PR to main
- **Release** (`.github/workflows/release.yml`): Triggered by `v*` tags, creates signed GitHub Release with updater JSON
- `publish.sh` runs `cargo fmt` + `cargo clippy`, bumps versions in Cargo.toml/tauri.conf.json/package.json, creates tag, pushes

---

# PIU Project — Mandatory Rules

## Model Hierarchy & Role Assignment
* **The Lead/Planner:** The main CLI session. Responsible for strategy and `CLAUDE.md` rules. You do not write code; you delegate. Exception: trivial changes (typos, config values, log messages) may be done directly by the Lead without delegation. Intervene **only** when a reviewer flags architectural flaws, strategy incompatibilities, or a retry limit is reached.
* **Blueprint Implementer (`blueprint-implementer`, Sonnet 4.6):** Sub-agent. Writes new features and tests strictly following the Lead's blueprint. Does **not** fix test failures.
* **Debugger (`debugger`, Sonnet 4.6):** Sub-agent. Fixes localized errors, syntax errors, failing tests, and memory leaks flagged by the test suite or reviewers.
* **Code Reviewer (`claude-code-reviewer`, Sonnet 4.6):** Sub-agent. Performs fast-track internal validation (Phase 1).

---

## Pre-Implementation: Actor-Critic Architecture Debate (Phase 0)
**Trigger:** Mandatory for new features, architectural changes, complex business logic, or complex bug fixes.
**Bypass:** Trivial tasks may skip Phase 0. "Trivial" is defined as: (a) any fix of ≤5 lines that does **not** touch files in the Critical Path list below, or (b) changes in Critical Path files that **only** modify logs, config values, or comments — never control flow, arithmetic, or state mutation. If a change is borderline ambiguous, it is **not** trivial — run Phase 0. Examples qualifying for bypass: typo fixes, simple UI tweaks, one-off diagnostic scripts (e.g., pulling VPS logs), or simple config updates.

> **BLOCKING GATE:** Phase 0 is a strict sequential gate. The Lead must wait for Codex to return and the plan to be locked before beginning **any** implementation work. Never run a Codex audit in the background while implementing in parallel — doing so defeats the purpose of pre-implementation review and constitutes a protocol violation.

**1. Draft (Lead):** The Lead writes a strict, step-by-step architectural blueprint detailing business logic, components, data structures, state changes, and execution flow.

**2. Challenge (Codex Skill Bridge):**
Invoke the `codex` skill via `Skill("codex")` in the **foreground** (not background). Configure it to use `gpt-5.3-codex` with `model_reasoning_effort` set to `xhigh`. Pass the following payload:
* **Target Scope:** The proposed architectural blueprint.
* **Intent:** (e.g., "Plan the close-position logic for perpetual arbitrage positions")
* **Focus:** Instruct Codex to ruthlessly audit the plan for **business logic flaws**, strategy deviations, mathematical assumptions, race conditions, state desynchronization, and edge cases in order routing.
* **Format:** Instruct Codex to return actionable critiques strictly formatted as: `[Component] - [Severity] - [Architectural/Logic Flaw] - [Suggested Mitigation]`.

**3. Evaluation & Debate Loop (Iterative):**
The Lead must critically evaluate Codex's critiques against project invariants and broader context. You must **never** blindly accept all findings, nor debate objective facts. Apply this strict dichotomy to Codex's feedback:

* **Path A: Objective Errors (Auto-fix & Comply):** If Codex flags objective mathematical errors, API constraint violations, unit conversion errors, data corruption risks, or obvious race conditions, **do not debate**. Immediately accept the finding, integrate the fix into the blueprint, and proceed to the next iteration.
* **Path B: Subjective/Strategy Choices (Debate & Rebut):** If Codex critiques risk tolerance assumptions (e.g., minimum fees, sample sufficiency, slippage buffers) or disagrees with reasonable architectural design choices, **you must rebut if Codex's suggestion would harm the strategy or throughput**. Present logical counterarguments defending the original architecture or propose a compromise.

**Subsequent Steps in the Loop:**
* Invoke the `codex` skill again via `Skill("codex")`, explicitly commanding it to **"resume the previous Codex session"** so it retains context. Pass the modified blueprint (for Path A) or the Lead's rebuttal (for Path B).
* **Exit Conditions (When to Break the Loop):** Continue the "Draft -> Critique -> Evaluate/Debate" loop until **any** of the following are met:
  1. **Consensus Reached (Lock the Plan):** Codex reports zero objective errors and either agrees with your strategic defense or you've converged on a compromise blueprint. (Proceed to Phase 1).
  2. **Iteration Cap:** You have completed **3 full debate cycles** without reaching agreement. Do **not** start writing code; halt and escalate to the User. (Status: Escalated)
  3. **Subjective/Strategy Deadlock:** The models have fundamental disagreements on strategic assumptions that cannot be resolved by logic alone. Halt and escalate to the User. (Status: Escalated)

> **Handoff Checkpoint:** Only after reaching Exit Condition 1 (Locked Plan) may the Lead hand the blueprint to `blueprint-implementer`. Do not delegate implementation before the plan is locked. Once the plan is locked, proceed autonomously through Phase 1 and Phase 2 without requesting User confirmation — only escalate under the defined conditions (iteration cap, subjective disagreement, AI conflict).

---

## Post-Implementation: Actor-Critic Review Protocol (Non-Negotiable)
After modifying **any** code in the Critical Path below, you must follow this three-phase pipeline before declaring work complete.

### Phase 1: Internal Validation (Actor Team: Planner + Sub-agents)
Before invoking external tools, you must ensure the code is in a "stable candidate state."

1. **Execution Handoff:** The Lead defines the plan. `blueprint-implementer` writes code.
2. **Adaptive-Thinking Self-Review:** (Delegate to `claude-code-reviewer`) Review logic for race conditions (especially in request execution), memory leaks, and variable shadowing.
3. **Conflict Priority Rule:** Architectural review takes precedence over test results. If tests fail due to architectural changes, evaluate whether tests should be updated to match the new architecture — **never** revert architectural decisions merely to pass old tests.
4. **Test Automation:** `blueprint-implementer` writes or updates relevant tests. If tests fail, delegate to `debugger` for fixes. You **must** run tests and reach a `PASS` state (**all** tests green, zero failures) before entering Phase 2. If pre-existing test failures are found, review them: if the tests are valid and reflect real expectations, update code or tests to make them pass; do not ignore them.
5. **Stability Gate:** Only proceed to Codex when code is functional, passes local linting, and satisfies the current task requirements.

### Phase 2: "Final Boss" Audit (Critic: Codex 5.3 Advanced Reasoning)
Trigger this phase only after Phase 1 succeeds and all tests pass.

**1. Codex Skill Bridge (Fresh Session)**
Launch a **fresh** `codex` skill session via `Skill("codex")` to avoid context bloat from Phase 0. Configure it to use `gpt-5.3-codex` with `high` reasoning effort, passing the following payload:

* **The Standard:** Provide the final "Locked Blueprint" generated at the end of Phase 0.
* **Target Scope:** (e.g., `src-tauri/src/http/executor.rs` @ lines 45-120)
* **Diff:** Provide **only** the `git diff` or specific changed lines.
* **Intent:** (e.g., "Implement high-precision request timeout handling for the HTTP executor")
* **Trade-offs:** (e.g., "Sacrificing 50ms execution speed for an additional pre-flight balance check")
* **Focus:** (e.g., "Focus audit on reentrancy issues in async lock usage, mathematical precision loss, and race conditions")
* **Format:** Instruct Codex to return **only** actionable findings, strictly formatted as bullets: `[File/Line] - [Severity] - [Vulnerability/Flaw] - [Suggested Fix]`.

**2. Execution & Fix Loop (Iterations 2 & 3)**
* **Auto-fix:** Delegate to `debugger` to fix objective errors or security vulnerabilities flagged by Codex.
* **Loop Requirement:** After applying fixes, you **must** invoke the `codex` skill via `Skill("codex")`, explicitly commanding it to **"resume the previous Codex session"** to maintain context, and pass the new diff. You **cannot** self-validate your own fixes.
* **Exit Conditions (When to Break the Loop):** Continue the "Fix -> Re-audit" loop until **any** of the following are met:
  1. **Clean Pass:** Codex reports zero objective functional defects. (Status: Success)
  2. **Subjective Feedback Only:** The **only** remaining issues flagged by Codex are subjective design/feature choices (e.g., API ordering preferences). Do **not** attempt to fix subjective choices; break the loop and escalate to the User. (Status: Escalated)
  3. **Iteration Cap:** You have completed **3 full cycles** but objective errors persist. Do **not** deliver the code; halt and escalate to the User. (Status: Escalated)
  4. **Conflicting AI:** Codex provides contradictory instructions across different iterations. (Status: Escalated)

### Phase 3: Mandatory Handoff Summary + Auto-Commit
Whenever the loop stops (success, cap reached, or escalated), you must provide this status report:

* **Final Status:** [Success / Escalated]
* **Codex Findings:** (Brief bullet points of critical vulnerabilities or logic flaws flagged)
* **Actions Taken:** (Summarize how the code evolved during the review loop)
* **Remaining Items:** (Any subjective design choices or edge cases requiring User final approval)

**Auto-Commit Rules (Success Only):** When the final status is "Success", immediately create a git commit for all changed files without waiting to be asked. Stage **only** the files touched by the current task (never use `git add -A`). Commit message format: `fix:` / `feat:` / `refactor:` as appropriate, with a concise body summarizing the bugs fixed or features added. **Always** append `Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>` at the end. **Never** auto-commit under "Escalated" status — wait for User approval first.

### Fallback When Codex Is Unavailable
If Codex cannot be invoked during Phase 0 or Phase 2, do **not** self-validate. Immediately escalate the current state of the blueprint or code changes to the User. (Status: Escalated)

> **Skill Name:** The Codex skill is registered as `codex` (not `skill-codex`). Always invoke via `Skill("codex")`. The plugin package is named `skill-codex`, but the internal skill name is `codex`.

---

### Critical Path (Always Triggers Review):
- `src-tauri/src/http/executor.rs` — HTTP request execution, timeout handling, response streaming
- `src-tauri/src/http/orchestrator.rs` — URL resolution, variable interpolation, auth injection
- `src-tauri/src/db/` — All database operations (data integrity)
- `src-tauri/src/commands/` — Tauri IPC command handlers (frontend-backend contract)
- `src/app/stores/` — Zustand stores (application state management)

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **piu** (1836 symbols, 4340 relationships, 154 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> If any GitNexus tool warns the index is stale, run `npx gitnexus analyze` in terminal first.

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `gitnexus_impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `gitnexus_detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `gitnexus_query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `gitnexus_context({name: "symbolName"})`.

## When Debugging

1. `gitnexus_query({query: "<error or symptom>"})` — find execution flows related to the issue
2. `gitnexus_context({name: "<suspect function>"})` — see all callers, callees, and process participation
3. `READ gitnexus://repo/piu/process/{processName}` — trace the full execution flow step by step
4. For regressions: `gitnexus_detect_changes({scope: "compare", base_ref: "main"})` — see what your branch changed

## When Refactoring

- **Renaming**: MUST use `gitnexus_rename({symbol_name: "old", new_name: "new", dry_run: true})` first. Review the preview — graph edits are safe, text_search edits need manual review. Then run with `dry_run: false`.
- **Extracting/Splitting**: MUST run `gitnexus_context({name: "target"})` to see all incoming/outgoing refs, then `gitnexus_impact({target: "target", direction: "upstream"})` to find all external callers before moving code.
- After any refactor: run `gitnexus_detect_changes({scope: "all"})` to verify only expected files changed.

## Never Do

- NEVER edit a function, class, or method without first running `gitnexus_impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `gitnexus_rename` which understands the call graph.
- NEVER commit changes without running `gitnexus_detect_changes()` to check affected scope.

## Tools Quick Reference

| Tool | When to use | Command |
|------|-------------|---------|
| `query` | Find code by concept | `gitnexus_query({query: "auth validation"})` |
| `context` | 360-degree view of one symbol | `gitnexus_context({name: "validateUser"})` |
| `impact` | Blast radius before editing | `gitnexus_impact({target: "X", direction: "upstream"})` |
| `detect_changes` | Pre-commit scope check | `gitnexus_detect_changes({scope: "staged"})` |
| `rename` | Safe multi-file rename | `gitnexus_rename({symbol_name: "old", new_name: "new", dry_run: true})` |
| `cypher` | Custom graph queries | `gitnexus_cypher({query: "MATCH ..."})` |

## Impact Risk Levels

| Depth | Meaning | Action |
|-------|---------|--------|
| d=1 | WILL BREAK — direct callers/importers | MUST update these |
| d=2 | LIKELY AFFECTED — indirect deps | Should test |
| d=3 | MAY NEED TESTING — transitive | Test if critical path |

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/piu/context` | Codebase overview, check index freshness |
| `gitnexus://repo/piu/clusters` | All functional areas |
| `gitnexus://repo/piu/processes` | All execution flows |
| `gitnexus://repo/piu/process/{name}` | Step-by-step execution trace |

## Self-Check Before Finishing

Before completing any code modification task, verify:
1. `gitnexus_impact` was run for all modified symbols
2. No HIGH/CRITICAL risk warnings were ignored
3. `gitnexus_detect_changes()` confirms changes match expected scope
4. All d=1 (WILL BREAK) dependents were updated

## Keeping the Index Fresh

After committing code changes, the GitNexus index becomes stale. Re-run analyze to update it:

```bash
npx gitnexus analyze
```

If the index previously included embeddings, preserve them by adding `--embeddings`:

```bash
npx gitnexus analyze --embeddings
```

To check whether embeddings exist, inspect `.gitnexus/meta.json` — the `stats.embeddings` field shows the count (0 means no embeddings). **Running analyze without `--embeddings` will delete any previously generated embeddings.**

> Claude Code users: A PostToolUse hook handles this automatically after `git commit` and `git merge`.

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->
