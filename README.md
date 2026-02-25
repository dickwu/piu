# piu

> A lightweight desktop API management application — think Postman, but native, fast, and offline-first.

Built with **Tauri 2.0** (Rust backend) + **React 19** + **Next.js** + **Ant Design**.

![piu screenshot](https://github.com/dickwu/piu/assets/placeholder/screenshot.png)

## Features

- 📁 **Nested Collections** — Organize API requests in hierarchical folders
- 🚀 **Rust-side HTTP execution** — All requests run via `reqwest` on the Tauri backend (no CORS issues)
- 🗃️ **JSON-based config storage** — Every request config stored as a JSON blob in SQLite
- 🔢 **Version management** — Every change auto-increments a version number per entity with a full changelog
- 🌍 **Environments & Variables** — `{{variable}}` interpolation across URLs, headers, and body
- 🔑 **Auth support** — Bearer token, Basic auth, API key
- ⚡ **Response viewer** — Status, headers, body (auto-formatted JSON), timing
- 🔄 **Auto-updater** — Built-in Tauri updater with signed artifacts

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
| Linux | `piu_x.x.x_amd64.AppImage` |

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
│       ├── components/         # UI components
│       ├── stores/             # Zustand state stores
│       └── types/              # TypeScript types (mirrors Rust structs)
└── src-tauri/                  # Rust backend
    └── src/
        ├── db/                 # Turso SQLite layer
        │   ├── collections.rs  # Collection CRUD + versioning
        │   ├── requests.rs     # API request CRUD + JSON config
        │   ├── environments.rs # Env variables
        │   └── changelog.rs    # Version history
        ├── commands/           # Tauri IPC commands
        └── http/
            └── executor.rs     # reqwest HTTP engine + {{var}} interpolation
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
  "url": "https://api.example.com/users/{{userId}}",
  "headers": [{ "key": "Authorization", "value": "Bearer {{token}}", "enabled": true }],
  "params": [],
  "body": { "type": "json", "content": "{\"name\": \"test\"}" },
  "auth": { "type": "bearer", "token": "{{token}}" }
}
```

### Environment variables

Create environments (Dev, Staging, Prod) and define `key=value` pairs. Variables are resolved at request-time using `{{variable}}` syntax in any field.

## Releasing

```bash
./publish.sh          # auto-increment patch (0.1.0 → 0.1.1)
./publish.sh 0.2.0    # specific version
```

The script bumps versions in `Cargo.toml`, `tauri.conf.json`, and `package.json`, creates a git tag, and pushes. The `v*` tag triggers the GitHub Actions release workflow which builds for macOS (arm64 + x64) and Linux and publishes a signed GitHub release with an updater `latest.json`.

## CI / CD

| Workflow | Trigger | What it does |
|---|---|---|
| `CI` | Push / PR to `main` | Builds all platforms, uploads artifacts |
| `Release` | Push `v*` tag | Builds, signs, creates GitHub Release |

## License

MIT
