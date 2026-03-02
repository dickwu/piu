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
- 🤖 **MCP Server** — 38 built-in tools let Claude (or any MCP client) create projects, send requests, manage collections, and query data model relationships — including a Mermaid class diagram generator
- 📦 **Move-to-Collection** — Right-click any request in the sidebar to move it to a different collection via a tree picker
- 🔄 **PIU-to-PIU Sync** — Sync projects between PIU instances over LAN. One hosts, another connects with IP + port + shared join key. Last-writer-wins conflict resolution via version fields

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | Rust + Tauri 2.0 |
| Frontend | React 19 + Next.js 16 + TypeScript |
| Database | Turso SQLite (local, embedded) |
| State | Zustand 5 |
| UI | Ant Design 6 + Tailwind CSS 4 |
| HTTP | reqwest 0.13 (Rust-side execution) |
| Package manager | bun |

## Installation

Download the latest release for your platform from [Releases](https://github.com/dickwu/piu/releases).

| Platform | File |
|---|---|
| macOS (Apple Silicon) | `piu_x.x.x_aarch64.dmg` |
| macOS (Intel) | `piu_x.x.x_x64.dmg` |
| Windows | `piu_x.x.x_x64-setup.exe` or `.msi` |
| Linux (Debian/Ubuntu) | `piu_x.x.x_amd64.deb` |
| Linux (Fedora/RHEL) | `piu-x.x.x-1.x86_64.rpm` |

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
├── src/                        # React/Next.js frontend
│   └── app/
│       ├── components/         # UI components (editors, viewers, modals, sidebar)
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
        ├── mcp.rs              # In-process MCP server (38 tools)
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

## Releasing

```bash
./publish.sh          # auto-increment patch (0.1.0 → 0.1.1)
./publish.sh 0.2.0    # specific version
```

The script bumps versions in `Cargo.toml`, `tauri.conf.json`, and `package.json`, creates a git tag, and pushes. The `v*` tag triggers the GitHub Actions release workflow which builds for macOS (arm64 + x64), Linux (deb + rpm), and Windows (MSI + NSIS), then publishes a signed GitHub release with an updater `latest.json`.

## CI / CD

| Workflow | Trigger | What it does |
|---|---|---|
| `CI` | Push / PR to `main` | Builds all platforms (macOS, Linux, Windows), uploads artifacts |
| `Release` | Push `v*` tag | Builds, signs, creates GitHub Release with updater JSON |

## License

MIT
