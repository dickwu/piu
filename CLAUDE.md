# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

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

## CI/CD

- **CI** (`.github/workflows/ci.yml`): Builds macOS (arm64 + x64), Linux (deb + rpm), Windows on push/PR to main
- **Release** (`.github/workflows/release.yml`): Triggered by `v*` tags, creates signed GitHub Release with updater JSON
- `publish.sh` runs `cargo fmt` + `cargo clippy`, bumps versions in Cargo.toml/tauri.conf.json/package.json, creates tag, pushes
