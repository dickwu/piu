---
name: piu-backend-sync
description: >
  Analyze a backend repository and automatically import its API routes into PIU as
  projects, collections, requests, and environments via MCP tools. Use when the user
  says "sync backend", "import backend", "import API", "sync repo", "create project
  from repo", or provides a git URL with the word "analyze". Supports 14+ frameworks
  (Express, FastAPI, Django, Gin, Rails, Axum, Spring, NestJS, Hono, Echo, Fiber,
  Actix, Hyperf, Laravel) with automatic route extraction, data model creation, and
  version tracking. Also use when the user mentions importing routes, creating a PIU
  project from code, or converting a codebase to API documentation.
---

# PIU Backend Sync

Analyzes a backend repository, discovers API routes, and creates PIU entities (project, collections, requests, environments) via MCP. Tracks git commit SHA for incremental re-syncs.

## CLI Scripts

All commands use the Bun runtime:

```bash
bun skills/scripts/piu.ts <command> [args...]     # MCP client (46 tools)
bun skills/scripts/detect.ts /path/to/repo         # Framework detection → JSON
```

For full tool reference, see the **piu-mcp** skill.

## Step 0: Re-Sync Detection

For previously imported projects, check if the repo has changed:

```bash
# Check if project exists
bun skills/scripts/piu.ts list-projects

# Compare commits
bun skills/scripts/piu.ts diff-sync PROJECT_ID /path/to/repo
```

| Scenario | Action |
|----------|--------|
| `up_to_date` | Skip, report "already synced" |
| Changes but no route files | Update project commit only |
| Route files changed | Incremental sync (re-scan changed files) |
| No previous import | Full import (Step 1) |

For incremental sync, get the current PIU state and compare:
```bash
bun skills/scripts/piu.ts tree PROJECT_ID
# Then re-extract changed routes and create/update/flag as needed
bun skills/scripts/piu.ts update-project '{"project_id":"...","source_commit_id":"NEW_COMMIT"}'
```

## Step 1: Clone & Detect Framework

```bash
# Remote repo
TMPDIR=$(mktemp -d /tmp/piu-sync-XXXXX)
git clone --depth 1 <url> "$TMPDIR/repo"
REPO="$TMPDIR/repo"

# Or local repo
REPO=/path/to/repo

COMMIT=$(git -C "$REPO" rev-parse HEAD)
DETECT=$(bun skills/scripts/detect.ts "$REPO")
# Returns: {"framework":"express","port":3000,"router_files":["routes/api.js"]}
```

Supported frameworks: Hyperf, Laravel, Express, Fastify, NestJS, Hono, FastAPI, Django, Flask, Gin, Echo, Fiber, Axum, Actix, Rails, Spring.

## Step 2: Route Extraction

Read each router file detected in Step 1 and extract routes by framework pattern:

| Framework | Pattern |
|-----------|---------|
| **Express** | `app.get(`, `router.post(`, `Router()` |
| **NestJS** | `@Get(`, `@Post(`, `@Controller('prefix')` |
| **FastAPI** | `@app.get("/path")`, `@router.post("/path")` |
| **Django** | `urlpatterns` in `urls.py` |
| **Gin/Echo/Fiber** | `.GET("/path"`, `.POST(`, `.Group("/prefix")` |
| **Axum** | `.route("/path", get(handler))`, `Router::new()` |
| **Spring** | `@GetMapping`, `@PostMapping`, `@RequestMapping` |
| **Hyperf/Laravel** | `Router::addGroup`, `Route::get`, FormRequest classes |
| **Rails** | `resources`, `get`, `post` in `config/routes.rb` |

For each route: extract HTTP method, URL path, handler name, group/prefix.

## Step 3: Create PIU Entities

### 3a. Project + Environment

```bash
bun skills/scripts/piu.ts create-project '{"name":"PROJECT_NAME","description":"Imported from <url>","source_repo_url":"<url>","source_commit_id":"COMMIT","backend_type":"FRAMEWORK"}'
# → returns {"id": "PROJECT_ID", ...}

bun skills/scripts/piu.ts create-env '{"project_id":"PROJECT_ID","name":"Development","host":"http://localhost:PORT"}'
```

### 3b. Collections (batch)

```bash
cat <<'EOF' | bun skills/scripts/piu.ts batch-collections
[
  {"project_id":"PROJECT_ID","name":"Users","path_prefix":"/users","description":"User management","source_commit_id":"COMMIT"},
  {"project_id":"PROJECT_ID","name":"Auth","path_prefix":"/auth","description":"Authentication","source_commit_id":"COMMIT"}
]
EOF
```

### 3c. Requests (batch)

For large imports, write one JSON file per collection:

```bash
cat /tmp/piu-routes/users.json | bun skills/scripts/piu.ts batch-requests
```

Format: `[{"collection_id":"...","name":"List Users","method":"GET","url":"/list","description":"..."}]`

For 500+ routes, use parallel subagents each processing a subset.

### 3d. Environment Setup

```bash
bun skills/scripts/piu.ts set-vars '{"environment_id":"ENV_ID","variables":[{"key":"token","value":"your-auth-token","enabled":true}]}'
bun skills/scripts/piu.ts activate-env '{"environment_id":"ENV_ID","project_id":"PROJECT_ID"}'
```

## Step 4: Model Extraction

After creating requests, extract data models from controller schemas.

### Shared base models

Create reusable models first:

```bash
cat <<'EOF' | bun skills/scripts/piu.ts batch-models
{
  "project_id": "PROJECT_ID",
  "models": [
    {"name":"PaginationParams","description":"Common pagination","fields":[{"name":"page","field_type":"integer","required":false,"example":"1"},{"name":"per_page","field_type":"integer","required":false,"example":"20"}]},
    {"name":"ApiResponse","description":"Standard wrapper","fields":[{"name":"code","field_type":"integer","required":true,"example":"0"},{"name":"message","field_type":"string","required":true,"example":"success"},{"name":"data","field_type":"object","required":false}]}
  ]
}
EOF
```

### Per-endpoint models

For each collection, read controller source and extract request/response schemas:

| Framework | Request Schema Source | Response Schema Source |
|-----------|---------------------|----------------------|
| **Hyperf/Laravel** | `$request->input()`, `rules()`, FormRequest | `return $this->response()`, Resource classes |
| **Express/NestJS** | DTO classes, Zod schemas, `req.body` | `res.json()` return types |
| **FastAPI** | Pydantic model type hints | Return type annotations |
| **Go** | Struct tags `json:"field" binding:"required"` | Return struct types |
| **Spring** | `@RequestBody` DTO classes | Response entity types |
| **Axum** | `Json<T>`, `Query<T>` extractor types | Serde structs |

### Link models to requests

```bash
cat <<'EOF' | bun skills/scripts/piu.ts batch-links
[
  {"request_id":"REQ_ID","model_type":"request","model_id":"MODEL_ID"},
  {"request_id":"REQ_ID","model_type":"response","model_id":"RESP_MODEL_ID"}
]
EOF
```

## Step 5: API Documentation

Every request description should be a complete markdown document:

````markdown
## POST /auth/login

Authenticate user credentials and return a JWT token.

### Parameters

| Field | Type | Required | Description | Example |
|-------|------|----------|-------------|---------|
| username | string | Yes | Login name | `admin` |
| password | string | Yes | User password | `secret123` |

### Request Body

```json
{"username": "admin", "password": "secret123"}
```

### Response

Returns `{code: 0, data: {token: "...", expires_in: 3600}}`.

### Notes

- Rate limited to 5 attempts per minute
- See also: POST /auth/refresh
````

Use `batch-update-bodies` to apply descriptions:
```bash
cat updates.json | bun skills/scripts/piu.ts batch-update-bodies
```

## Step 6: Verification

```bash
# Project overview
bun skills/scripts/piu.ts overview PROJECT_ID

# Full tree
bun skills/scripts/piu.ts tree PROJECT_ID

# Execute all GET endpoints (requires running backend + active env)
bun skills/scripts/piu.ts verify PROJECT_ID

# Model visualization
bun skills/scripts/piu.ts model-mermaid PROJECT_ID

# Sync status
bun skills/scripts/piu.ts sync-status PROJECT_ID

# Changelog audit
bun skills/scripts/piu.ts changelog '{"entity_type":"project","entity_id":"PROJECT_ID","limit":20}'

# Search for specific endpoints
bun skills/scripts/piu.ts search PROJECT_ID "/login" POST

# API surface summary
bun skills/scripts/piu.ts api-surface PROJECT_ID
```

## Step 7: Cleanup & Report

```bash
rm -rf "$TMPDIR"  # Only if cloned to temp dir
```

Print summary:
```
## Backend Sync Complete

**Repository:** <url>
**Commit:** <short_sha>
**Framework:** <detected>
**Project ID:** <id>

### Created:
- 1 project, 1 environment
- <N> collections, <M> requests
- <X> models linked to <Y> requests

### Methods: GET: N | POST: N | PUT: N | DELETE: N
```

## Notes

- Always use `search` before creating to avoid duplicates on re-sync
- Set `source_commit_id` on every entity for future re-sync
- One collection per router/controller/blueprint, not one flat list
- For monorepo structures, ask which service to import
- Prefer reading route definitions over OpenAPI/Swagger specs (those can be outdated)
- For re-syncs, run `diff-sync` first to avoid full re-imports
- Use `api-surface` for a quick summary of all endpoints
- Use `find-related` to explore entity relationships
