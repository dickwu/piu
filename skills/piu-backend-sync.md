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

## Workflow

### Step 1: Clone & Detect Framework

```bash
TMPDIR=$(mktemp -d /tmp/piu-sync-XXXXX)
git clone --depth 1 <url> "$TMPDIR/repo"
cd "$TMPDIR/repo"
COMMIT=$(git rev-parse HEAD)
PROJECT_NAME=$(basename -s .git <url>)
```

Detect the framework from dependency files:

| Framework | File | Detection Pattern |
|-----------|------|-------------------|
| Express | package.json | `"express"` in dependencies |
| Fastify | package.json | `"fastify"` in dependencies |
| NestJS | package.json | `"@nestjs/core"` in dependencies |
| Hono | package.json | `"hono"` in dependencies |
| Django | requirements.txt / pyproject.toml | `django` |
| FastAPI | requirements.txt / pyproject.toml | `fastapi` |
| Flask | requirements.txt / pyproject.toml | `flask` |
| Gin | go.mod | `gin-gonic/gin` |
| Echo | go.mod | `labstack/echo` |
| Fiber | go.mod | `gofiber/fiber` |
| Rails | Gemfile | `rails` gem |
| Axum | Cargo.toml | `axum` in dependencies |
| Actix | Cargo.toml | `actix-web` in dependencies |
| Spring | pom.xml / build.gradle | `spring-boot-starter-web` |

### Step 2: Route Extraction (Framework-Specific)

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

1. **Create Project:**
   ```
   create_project(name=PROJECT_NAME, description="Imported from <url>", source_repo_url=<url>, source_commit_id=COMMIT, backend_type=<detected_framework>)
   ```

2. **Create Environment:**
   ```
   create_environment(project_id=PROJECT_ID, name="Development", host="http://localhost:<framework_default_port>")
   ```
   Default ports: Express/Fastify/NestJS/Hono=3000, Django=8000, FastAPI=8000, Flask=5000, Gin/Echo/Fiber=8080, Rails=3000, Axum/Actix=8080, Spring=8080

3. **Create Collections** (one per route group/prefix):
   ```
   create_collection(project_id=PROJECT_ID, name=<group_name>, path_prefix=<prefix>, source_commit_id=COMMIT)
   ```

4. **Create Requests** (one per route):
   ```
   create_request(collection_id=COLLECTION_ID, name=<handler_name or "METHOD /path">, config={"method":"GET","url":"/path","headers":[],"params":[],"body":{"type":"json","content":""},"auth":{"type":"none"},"description":"Handler: <function_name>"}, source_commit_id=COMMIT)
   ```

### Step 4: Rich Analysis (Optional, Sub-Agent)

For deeper analysis, read handler/controller files to:
- Extract request body types/DTOs → create PIU Data Models
- Extract response types/DTOs → create PIU Data Models
- Link models to requests via `requestModelId`/`responseModelId` in the config
- Add path parameters as request params (e.g., `/users/:id` → param `id`)
- Add query parameter documentation from handler code

### Step 5: Cleanup & Report

```bash
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

## Important Notes

- Always use `search_requests` before creating to avoid duplicates
- Set `source_commit_id` on every entity for future re-sync capability
- Prefer creating one collection per router/controller/blueprint rather than one flat list
- If the repo has a monorepo structure, ask the user which service to import
- For TypeScript projects, prefer reading the actual route definitions over any OpenAPI/Swagger specs (those can be outdated)
