# piu

> A lightweight desktop API management application — think Postman, but native, fast, and offline-first.

Built with **Tauri 2.0** (Rust backend) + **React 19** + **Next.js** + **Ant Design**.

![piu screenshot](https://github.com/dickwu/piu/assets/placeholder/screenshot.png)

## Features

- 📁 **Nested Collections** — Organize API requests in hierarchical folders with drag-to-move support
- 🗂️ **Project sidebar** — Switch projects from a compact sidebar panel with name, description, and env count badge
- 🚀 **Rust-side HTTP execution** — All requests run via `reqwest` on the Tauri backend (no CORS issues)
- 🗃️ **JSON-based config storage** — Every request config stored as a JSON blob in SQLite
- 🔢 **Version management** — Every change auto-increments a version number per entity with a full changelog
- 🌍 **Environments & Variables** — `{{variable}}` interpolation across URLs, headers, and body; environment host + collection prefix build the full URL at execution time
- ✏️ **Environment rename** — Rename environments inline with duplicate-name prevention
- 🔗 **URL resolution** — Requests store only the path (e.g. `/users/123`); the full URL is `env host + collection prefix + path`. Missing host shows a config prompt before sending
- 🔑 **Auth support** — Bearer token, Basic auth, API key
- ⚡ **Response viewer** — Status, headers, body (auto-formatted JSON), timing
- 🔄 **Auto-updater** — Built-in Tauri updater with signed artifacts
- 🧩 **Data Models** — Per-project typed schemas with named fields, descriptions, required flags, and example values. Link a model to a request to generate sample JSON bodies or validate response shapes inline
- 🧬 **Model Inheritance** — Single-parent inheritance + multi-mixin composition. Fields resolve via strict linearization (parent chain → mixins → own). Cycle detection prevents circular references. Side-by-side diff modal compares parent-child fields or version history
- 🤖 **MCP Server** — 46 built-in tools let Claude (or any MCP client) create projects, send requests, manage collections, search the knowledge graph, and query data model relationships — including a Mermaid class diagram generator, sync status tracking, and OpenAPI spec generation
- 📦 **Move requests freely** — Right-click any request to move it between collections or to project root via a tree picker. Moving the last request out of a collection prompts to delete the empty collection
- 🔄 **PIU-to-PIU Sync** — Sync projects between PIU instances over LAN. One hosts, another connects with IP + port + shared join key. Last-writer-wins conflict resolution via version fields
- 🔗 **Git Commit Tracking** — Projects, collections, and requests track their source git repo URL, commit SHA, and backend framework type. The `get_sync_status` MCP tool detects stale entities by comparing per-entity commit IDs against the project-level commit
- 🛠️ **Backend Sync Skill** — A Claude Code skill that clones a backend repo, detects the framework (Express, FastAPI, Django, Gin, Axum, etc.), extracts routes, and creates PIU projects/collections/requests via MCP — all tagged with the source commit SHA
- 🔍 **Frontend Sync Skill** — A Claude Code skill that scans a frontend repo for HTTP API calls and cross-references them against a PIU project to find mismatches, missing endpoints, and type contract violations
- 🧠 **LLM Search & Knowledge Graph** — FTS5 full-text search across all entity types with BM25 ranking. Auto-generated natural-language descriptions make every entity self-describing. MCP tools: `search_entities`, `find_related_entities`, `get_entity_detail`, `get_api_surface`, `get_project_summary`
- 🔗 **Entity Relations & Backlinks** — Pre-computed relationship graph with bidirectional traversal (Obsidian-style backlinks). Ask "what uses this model?" and get endpoints, collections, and inheritance chains in one call
- 🕸️ **Interactive API Graph** — Sigma.js v3 WebGL graph visualization of project entities (collections, requests, models) and their relationships (7 edge types). Louvain community detection with URL-prefix clustering. Overview/focus cluster navigation, ForceAtlas2 force-directed layout, curved Bezier edges, selection highlighting, path tracing (Shift+click), blast radius analysis, pulse/ripple/glow animations, dark/light theme, and keyboard shortcuts

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | Rust + Tauri 2.0 |
| Frontend | React 19 + Next.js 16 + TypeScript |
| Database | Turso SQLite (local, embedded) |
| State | Zustand 5 |
| UI | Ant Design 6 + Tailwind CSS 4 |
| Graph | Sigma.js 3 + Graphology + ForceAtlas2 |
| HTTP | reqwest 0.13 (Rust-side execution) |
| Package manager | bun |

## Installation

### macOS (Homebrew)

```bash
brew tap dickwu/tap
brew install --cask piu
```

The installer automatically removes the macOS quarantine flag. If you still see a "damaged app" warning:

```bash
sudo xattr -d com.apple.quarantine /Applications/Piu.app
```

### Manual Download

Download the latest release for your platform from [Releases](https://github.com/dickwu/piu/releases).

| Platform | File |
|---|---|
| macOS (Apple Silicon) | `Piu_x.x.x_aarch64.dmg` |
| macOS (Intel) | `Piu_x.x.x_x64.dmg` |
| Windows | `Piu_x.x.x_x64-setup.exe` or `.msi` |
| Linux (Debian/Ubuntu) | `Piu_x.x.x_amd64.deb` |
| Linux (Fedora/RHEL) | `Piu-x.x.x-1.x86_64.rpm` |

## Development

### Prerequisites

- [Rust](https://rustup.rs/) stable
- [Bun](https://bun.sh/) ≥ 1.0
- [Tauri prerequisites](https://tauri.app/start/prerequisites/) for your platform

### Setup

```bash
git clone https://github.com/dickwu/piu.git
cd piu
bun install
bun tauri dev
```

### Project structure

```
piu/
├── skills/                     # Claude Code skills (installable via skills.sh)
│   ├── piu-mcp/SKILL.md        # Full MCP toolkit (46 tools)
│   ├── piu-backend-sync/SKILL.md   # Import backend routes into PIU
│   ├── piu-frontend-sync/SKILL.md  # Validate frontend API calls against PIU
│   └── scripts/                # Bun CLI tools (piu.ts, detect.ts)
├── src/                        # React/Next.js frontend
│   └── app/
│       ├── components/         # UI components (editors, viewers, modals, sidebar, graph)
│       ├── hooks/              # React hooks (useSigma graph renderer)
│       ├── stores/             # Zustand state stores (6 stores)
│       └── types/              # TypeScript types (mirrors Rust structs)
└── src-tauri/                  # Rust backend
    └── src/
        ├── db/                 # Turso SQLite layer
        │   ├── collections.rs  # Collection CRUD + versioning
        │   ├── requests.rs     # API request CRUD + JSON config
        │   ├── environments.rs # Env variables
        │   ├── models.rs       # Data model CRUD + inheritance + cycle detection
        │   └── changelog.rs    # Version history
        ├── commands/           # Tauri IPC commands (~35 handlers)
        ├── mcp.rs              # In-process MCP server (46 tools, LLM-optimized descriptions)
        ├── mcp_relations.rs    # Model graph, hierarchy, and Mermaid diagram generation
        ├── sync.rs             # PIU-to-PIU sync protocol (Axum server + reqwest client)
        └── http/
            ├── executor.rs     # reqwest HTTP engine
            └── orchestrator.rs # URL resolution + {{var}} interpolation + auth
```

## How it works

### Version management

Every create, update, or delete on a collection, request, or environment:
1. Increments that entity's `version` field (starting at `1`)
2. Writes a changelog entry with a human-readable summary and JSON diff

View the full history via the **Changelog** button in the top bar.

### API config storage

Each request's configuration (method, URL, headers, params, body, auth) is stored as a single JSON blob in SQLite:

```json
{
  "method": "POST",
  "url": "/users/{{userId}}",
  "headers": [{ "key": "Authorization", "value": "Bearer {{token}}", "enabled": true }],
  "params": [],
  "body": { "type": "json", "content": "{\"name\": \"test\"}" },
  "auth": { "type": "bearer", "token": "{{token}}" }
}
```

The `url` field stores **only the path**. At execution time the Rust orchestrator builds the full URL as:

```
full URL = environment.host + collection.path_prefix + request.url
         = "https://api.example.com" + "/v1" + "/users/123"
         = "https://api.example.com/v1/users/123"
```

### Environment variables

Create environments (Dev, Staging, Prod) and define `key=value` pairs. Variables are resolved at request-time using `{{variable}}` syntax in any field.

### Git commit tracking

Projects, collections, and requests can each store a `source_commit_id` linking them to the git commit that created or last updated them. Projects also store `source_repo_url` (the origin repo) and `backend_type` (detected framework like `express`, `fastapi`, `axum`).

The MCP `get_sync_status` tool compares each entity's commit against the project-level commit to flag stale entries:

```
Project "my-api" @ commit abc123
├── Collection "users" @ abc123  ✓ synced
├── Collection "auth"  @ def456  ⚠ stale (behind project commit)
└── Request "GET /health" @ abc123  ✓ synced
```

### Claude Code skills

Three [Claude Code skills](https://docs.anthropic.com/en/docs/claude-code/skills) provide full MCP-powered API management. Source files live in `skills/` with Bun-based CLI tools.

#### Install from [skills.sh](https://skills.sh)

```bash
npx skills add dickwu/piu
```

#### Manual installation

```bash
mkdir -p .claude/skills/piu-mcp .claude/skills/piu-backend-sync .claude/skills/piu-frontend-sync
cp skills/piu-mcp/SKILL.md .claude/skills/piu-mcp/SKILL.md
cp skills/piu-backend-sync/SKILL.md .claude/skills/piu-backend-sync/SKILL.md
cp skills/piu-frontend-sync/SKILL.md .claude/skills/piu-frontend-sync/SKILL.md
```

Once installed, Claude Code auto-activates them based on trigger keywords.

#### PIU MCP Toolkit (`skills/piu-mcp/`)

Full reference for all 46 MCP tools. Covers projects, collections, requests, environments, data models, execution, search & discovery, sync tracking, and OpenAPI generation. Includes a Bun CLI wrapper:

```bash
bun skills/scripts/piu.ts tree <project_id>       # Full project tree
bun skills/scripts/piu.ts search <project_id> users  # Search requests
bun skills/scripts/piu.ts execute <request_id>     # Send HTTP request
bun skills/scripts/piu.ts api-surface <project_id> # All endpoints summary
```

#### Backend sync (`skills/piu-backend-sync/`)

Import a backend repo's routes into PIU. Trigger with `sync backend <url>`.

1. Detects framework (Express, FastAPI, Django, Gin, Rails, Axum, Spring, NestJS, Hono, Echo, Fiber, Actix, Hyperf, Laravel — 14 frameworks)
2. Extracts route definitions (methods, paths, route groups/prefixes)
3. Creates PIU project, environment, collections, and requests via MCP — all tagged with the source commit SHA
4. Extracts request/response DTOs and creates Data Models with inheritance
5. Supports incremental re-sync via git commit tracking

#### Frontend sync (`skills/piu-frontend-sync/`)

Validate a frontend repo's API calls against a PIU project. Trigger with `sync frontend <url>`.

1. Scans for HTTP API calls (fetch, axios, ky, ofetch, @tanstack/query, SWR)
2. Cross-references against PIU routes by method + path
3. Reports: **matched**, **missing in PIU** (undocumented calls), **missing in frontend** (dead endpoints), **type mismatches**
4. Optional auto-fix: creates missing PIU requests and models from TypeScript interfaces

## Releasing

```bash
# Full release pipeline — version bump, CI watch, AI release notes
auto-push

# Specific version
auto-push --var release_version=0.2.0

# Skip CI wait and release notes
auto-push --skip ci_wait --skip ci_watch --skip changelog --skip notes --skip publish_notes
```

Powered by [auto-push](https://github.com/dickwu/auto-push). The `.auto-push.json` pipeline runs `publish.sh` (cargo fmt, clippy, version bump, tag, push), waits for CI, then generates and publishes release notes with AI.

The `v*` tag triggers the GitHub Actions release workflow which builds for macOS (arm64 + x64), Linux (deb + rpm), and Windows (MSI + NSIS), publishes a signed GitHub release with updater JSON, and auto-updates the Homebrew cask.

## CI / CD

| Workflow | Trigger | What it does |
|---|---|---|
| `CI` | Push / PR to `main` | Builds all platforms (macOS, Linux, Windows), uploads artifacts |
| `Release` | Push `v*` tag | Builds, signs, creates GitHub Release with updater JSON |

## License

MIT
