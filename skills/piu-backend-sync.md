---
name: piu-backend-sync
description: >
  Analyze a backend repository and automatically import its API routes into PIU as
  projects, collections, requests, and environments via MCP tools.
  Use when the user says "sync backend", "import backend", "import API", "sync repo",
  "create project from repo", or provides a git URL with the word "analyze".
---

# PIU Backend Sync

## Trigger

Activate when the user says any of: "sync backend", "import backend", "import API", "sync repo", "create project from repo", or provides a git URL with "analyze".

## Overview

This skill analyzes a backend repository to discover API routes, then creates PIU entities (project, collections, requests, environments) via MCP tools. It tracks the git commit SHA so future re-syncs can detect changes.

## Helper Scripts

The `skills/scripts/` directory contains reusable utilities:

- **`skills/scripts/detect_framework.sh`** — Detects backend framework from a repo directory. Returns JSON: `{"framework":"express","port":3000,"router_files":["routes/api.js"]}`
- **`skills/scripts/piu_mcp.py`** — MCP Streamable HTTP client for CLI and programmatic use. Supports individual tool calls, batch-requests, batch-collections, and project overview.

## Workflow

### Step 1: Clone & Detect Framework

For local repos, skip the clone step:
```bash
# Remote repo
TMPDIR=$(mktemp -d /tmp/piu-sync-XXXXX)
git clone --depth 1 <url> "$TMPDIR/repo"
REPO="$TMPDIR/repo"

# Local repo
REPO=<path>
```

Get commit SHA and detect framework using the helper script:
```bash
cd "$REPO"
COMMIT=$(git rev-parse HEAD)
PROJECT_NAME=$(basename "$REPO")

# Auto-detect framework, port, and router files
DETECT=$(bash skills/scripts/detect_framework.sh "$REPO")
FRAMEWORK=$(echo "$DETECT" | python3 -c "import sys,json; print(json.load(sys.stdin)['framework'])")
PORT=$(echo "$DETECT" | python3 -c "import sys,json; print(json.load(sys.stdin)['port'])")
```

The `detect_framework.sh` script checks these frameworks:

| Framework | File | Detection Pattern | Default Port |
|-----------|------|-------------------|-------------|
| Hyperf | composer.json | `"hyperf/framework"` | 9501 |
| Laravel | composer.json | `"laravel/framework"` | 8000 |
| Express | package.json | `"express"` in dependencies | 3000 |
| Fastify | package.json | `"fastify"` in dependencies | 3000 |
| NestJS | package.json | `"@nestjs/core"` in dependencies | 3000 |
| Hono | package.json | `"hono"` in dependencies | 3000 |
| Django | requirements.txt / pyproject.toml | `django` | 8000 |
| FastAPI | requirements.txt / pyproject.toml | `fastapi` | 8000 |
| Flask | requirements.txt / pyproject.toml | `flask` | 5000 |
| Gin | go.mod | `gin-gonic/gin` | 8080 |
| Echo | go.mod | `labstack/echo` | 8080 |
| Fiber | go.mod | `gofiber/fiber` | 8080 |
| Rails | Gemfile | `rails` gem | 3000 |
| Axum | Cargo.toml | `axum` in dependencies | 8080 |
| Actix | Cargo.toml | `actix-web` in dependencies | 8080 |
| Spring | pom.xml / build.gradle | `spring-boot-starter-web` | 8080 |

### Step 2: Route Extraction (Framework-Specific)

**PHP (Hyperf/Laravel):**
- Hyperf: Routes in `config/routers/*.php` using `Router::addGroup('/prefix', function () { Router::post('/path', ...); })`. Can also run `php bin/hyperf.php describe:routes` for a complete route list.
- Laravel: Routes in `routes/*.php` using `Route::get('/path', ...)`, `Route::group(['prefix' => '/api'], ...)`

**Node.js (Express/Fastify/Hono):**
- Search for `app.get(`, `app.post(`, `app.put(`, `app.delete(`, `app.patch(`, `router.get(`, `router.post(`, etc.
- Search for route files in `routes/`, `controllers/`, `api/` directories
- For NestJS: search for `@Get(`, `@Post(`, `@Put(`, `@Delete(`, `@Patch(` decorators and `@Controller('prefix')` decorators

**Python (FastAPI/Flask/Django):**
- FastAPI: `@app.get("/path")`, `@router.get("/path")`, `APIRouter(prefix="/prefix")`
- Flask: `@app.route("/path", methods=["GET"])`, `Blueprint("name", prefix="/prefix")`
- Django: Parse `urlpatterns` in `urls.py` files, or run `python manage.py show_urls` if available

**Go (Gin/Echo/Fiber):**
- Gin: `r.GET("/path"`, `r.POST(`, `r.Group("/prefix")`
- Echo: `e.GET("/path"`, `e.POST(`, `e.Group("/prefix")`
- Fiber: `app.Get("/path"`, `app.Post(`, `app.Group("/prefix")`

**Ruby (Rails):**
- Parse `config/routes.rb` for `resources`, `get`, `post`, etc.
- Or run `rails routes` if possible

**Java (Spring):**
- Search for `@RequestMapping`, `@GetMapping`, `@PostMapping`, `@PutMapping`, `@DeleteMapping`, `@PatchMapping`
- Look for `@RestController` class-level prefix

**Rust (Axum/Actix):**
- Axum: Search for `.route("/path", get(handler))`, `Router::new()` patterns
- Actix: Search for `web::resource("/path").route(web::get().to(handler))` patterns

For each route found, extract:
- HTTP method (GET, POST, PUT, DELETE, PATCH)
- URL path
- Handler function name (for generating description)
- Group/prefix information (for collection mapping)

### Step 3: Create PIU Entities via MCP

Use `skills/scripts/piu_mcp.py` for all MCP operations. Ensure PIU is running with the MCP server enabled (`PIU_MCP_URL` defaults to `http://127.0.0.1:3333/mcp`).

**3a. Create project and environment:**
```bash
python3 skills/scripts/piu_mcp.py create-project '{"name":"PROJECT_NAME","description":"Imported from <url>","source_repo_url":"<url>","source_commit_id":"COMMIT","backend_type":"FRAMEWORK"}'
python3 skills/scripts/piu_mcp.py create-env '{"project_id":"PROJECT_ID","name":"Development","host":"http://localhost:PORT"}'
```

**3b. Create collections (batch):**

Write a JSON array to stdin:
```bash
cat <<'EOF' | python3 skills/scripts/piu_mcp.py batch-collections
[
  {"project_id":"PROJECT_ID","name":"Users","path_prefix":"/users","description":"User management","source_commit_id":"COMMIT"},
  {"project_id":"PROJECT_ID","name":"Auth","path_prefix":"/auth","description":"Authentication","source_commit_id":"COMMIT"}
]
EOF
```

**3c. Create requests (batch with parallel subagents):**

For large imports (100+ routes), use this pattern:
1. Write one JSON file per collection to a temp directory:
   ```
   /tmp/piu-routes/users.json    → [{"collection_id":"...","name":"List Users","method":"GET","url":"/list"}, ...]
   /tmp/piu-routes/auth.json     → [{"collection_id":"...","name":"Login","method":"POST","url":"/login"}, ...]
   ```
2. Launch parallel haiku subagents, each processing one or more JSON files:
   ```bash
   cat /tmp/piu-routes/users.json | python3 skills/scripts/piu_mcp.py batch-requests
   ```
3. Each subagent independently initializes its own MCP session and batches through its routes.

This pattern enables importing 500+ routes in under 30 seconds.

**Request config format:**
```json
{
  "method": "GET",
  "url": "/path",
  "headers": [],
  "params": [],
  "body": {"type": "json", "content": ""},
  "auth": {"type": "none"},
  "description": "Handler: function_name"
}
```

### Step 4: API Documentation Enrichment (Subagent Pattern)

After initial route import, enrich every request with body schemas, descriptions, and data models so LLMs can later consume the API surface programmatically. This step uses **parallel subagents** to read controller/handler source code and extract request parameters at scale.

#### 4a. Preparation — Query PIU for Existing Requests

Before enriching, get the full request list per collection to map request IDs to routes:

```bash
# Get all requests in a collection
python3 skills/scripts/piu_mcp.py tool search_requests '{"project_id":"PROJECT_ID","query":"/"}'
```

Each request has an `id`, `name`, and `config` (JSON with method, url, body, description). You need the `id` to update it later.

#### 4b. Parallel Subagent Orchestration

Split enrichment work across **parallel subagents** (one per collection or controller group). Each subagent:

1. **Reads** the controller/handler source files for its assigned collection
2. **Extracts** request parameters (fields, types, required/optional, descriptions)
3. **Writes** a JSON update file to a shared temp directory

**Launch pattern (use `Agent` tool with `model: "haiku"` for cost efficiency):**

```
For each collection group, launch a subagent with this prompt:

"Read these controller files: [file1.php, file2.php, ...]
For each route handler, extract:
- All request input fields ($request->input('field'), validation rules, type hints)
- Field types (string, integer, boolean, array, file, object)
- Whether each field is required or optional
- A human-readable description for each endpoint

Write the results as a JSON array to /tmp/piu-enrich/<collection_name>.json
Format: [{"request_id":"...","name":"...","fields":[{"name":"field","type":"string","required":true}],"description":"..."}]"
```

**Recommended grouping for large projects (500+ routes):**

| Project Size | Subagents | Routes per Agent |
|-------------|-----------|-----------------|
| < 50 routes | 1-2 | All |
| 50-200 routes | 3-5 | ~40-50 each |
| 200-500 routes | 5-8 | ~40-60 each |
| 500+ routes | 8-12 | ~50-80 each |

#### 4c. Framework-Specific Extraction Patterns

Each subagent should look for these patterns based on the detected framework:

| Framework | Where to find params |
|-----------|---------------------|
| **Hyperf/Laravel** | `$request->input('field')`, `$request->validated()`, `FormRequest` classes, validation rules in `rules()` method, `$request->file('field')` for uploads |
| **Express** | `req.body.field`, `req.params.field`, `req.query.field`, Joi/Zod validation schemas |
| **FastAPI** | Function parameter type hints, Pydantic model classes, `Query()`, `Body()`, `Path()` |
| **NestJS** | DTO classes with class-validator decorators (`@IsString()`, `@IsOptional()`, `@IsNumber()`) |
| **Django** | `request.data['field']`, serializer classes, `ModelSerializer` field definitions |
| **Spring** | `@RequestBody` DTO classes, `@RequestParam`, `@PathVariable` annotations |
| **Gin/Echo/Fiber** | Struct tags (`json:"field" binding:"required"`), `c.Bind()`, `c.Query()`, `c.Param()` |
| **Axum** | `Json<T>` extractor types, `Query<T>`, `Path<T>` with serde structs |

#### 4d. Create Data Models in PIU

After extraction, create PIU Data Models for reusable request/response schemas:

```bash
python3 skills/scripts/piu_mcp.py create-model '{
  "project_id": "PROJECT_ID",
  "name": "LoginRequest",
  "description": "Authentication login payload",
  "fields": [
    {"name": "username", "field_type": "string", "description": "User login name", "required": true, "example": "admin"},
    {"name": "password", "field_type": "string", "description": "User password", "required": true, "example": "secret123"}
  ]
}'
```

Field types: `string`, `integer`, `number`, `boolean`, `array`, `object`, `file`

Models serve as reusable schemas that LLMs can reference when generating API requests. Link models to requests via `requestModelId` in the config.

#### 4e. Batch Update Request Bodies

Collect all subagent outputs and batch-update request configs with enriched bodies and descriptions:

```bash
cat <<'EOF' | python3 skills/scripts/piu_mcp.py batch-update-bodies
[
  {
    "request_id": "REQ_ID",
    "name": "Login",
    "config": {
      "method": "POST", "url": "/auth/login",
      "headers": [{"key": "Content-Type", "value": "application/json", "enabled": true}],
      "params": [],
      "body": {"type": "json", "content": "{\"username\": \"admin\", \"password\": \"secret\"}"},
      "auth": {"type": "none"},
      "description": "Authenticate user credentials and return a JWT access token. Requires username and password fields.",
      "requestModelId": "MODEL_ID"
    }
  }
]
EOF
```

**Description field is critical for LLM consumers.** Write descriptions that explain:
- What the endpoint does (business purpose)
- Required vs optional parameters
- Expected response format
- Authentication requirements
- Side effects (creates/deletes/modifies resources)

#### 4f. MCP Verification

After enrichment, verify the results via MCP:

```bash
# 1. Project overview — check request counts match expectations
python3 skills/scripts/piu_mcp.py overview PROJECT_ID

# 2. Spot-check enriched requests — verify body and description populated
python3 skills/scripts/piu_mcp.py tool search_requests '{"project_id":"PROJECT_ID","query":"login"}'

# 3. List models — verify data models were created
python3 skills/scripts/piu_mcp.py list-models PROJECT_ID

# 4. Generate sample body from model — verify model fields produce valid JSON
python3 skills/scripts/piu_mcp.py generate-body MODEL_ID

# 5. Full sync status — verify commit tracking
python3 skills/scripts/piu_mcp.py tool get_sync_status '{"project_id":"PROJECT_ID"}'
```

**Verification checklist:**
- [ ] Every POST/PUT/PATCH request has a non-empty `body.content`
- [ ] Every request has a meaningful `description` (not just "Handler: functionName")
- [ ] Data models exist for shared request/response schemas
- [ ] Models are linked to requests via `requestModelId`/`responseModelId`
- [ ] `source_commit_id` is set on all entities

### Step 5: Cleanup & Report

```bash
# Only if cloned to temp dir
rm -rf "$TMPDIR"
```

Print a summary:
```
## Backend Sync Complete

**Repository:** <url>
**Commit:** <short_sha>
**Framework:** <detected_framework>
**Project ID:** <project_id>

### Created:
- 1 project
- 1 environment (Development @ http://localhost:<port>)
- <N> collections
- <M> requests

### Route Breakdown:
- GET: <count>
- POST: <count>
- PUT: <count>
- DELETE: <count>
- PATCH: <count>
```

Verify with:
```bash
python3 skills/scripts/piu_mcp.py overview PROJECT_ID
```

## Important Notes

- Always use `search_requests` before creating to avoid duplicates on re-sync
- Set `source_commit_id` on every entity for future re-sync capability
- Prefer creating one collection per router/controller/blueprint rather than one flat list
- If the repo has a monorepo structure, ask the user which service to import
- For TypeScript projects, prefer reading the actual route definitions over any OpenAPI/Swagger specs (those can be outdated)
- For PHP Hyperf projects, `php bin/hyperf.php describe:routes` provides a complete route list as a quick cross-reference
