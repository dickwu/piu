---
name: piu-frontend-sync
description: >
  Analyze a frontend repository to discover all HTTP API calls and cross-reference
  them against a PIU project's backend routes. Use when the user says "sync frontend",
  "validate frontend", "check frontend API calls", "find API mismatches",
  "frontend API audit", "frontend coverage", or "API contract check".
  Identifies missing endpoints, undocumented calls, TypeScript contract violations,
  and can auto-fix by creating missing PIU requests or updating models.
  Supports re-sync with version tracking to detect changes since last audit.
---

# PIU Frontend Sync

## Trigger

Activate when the user says any of: "sync frontend", "validate frontend", "check frontend API calls", "find API mismatches", "frontend API audit", "frontend coverage", "API contract check".

## Prerequisites

A PIU project must already exist with backend routes synced (via backend-sync or manual creation). The user must specify which PIU project to validate against.

## Overview

This skill analyzes a frontend repository to discover all HTTP API calls, then cross-references them against a PIU project's API surface to find mismatches, missing endpoints, and contract violations.

## Helper Scripts

The `skills/scripts/` directory contains reusable utilities:

- **`skills/scripts/piu_mcp.py`** — MCP Streamable HTTP client for CLI and programmatic use. Commands:
  - `overview <project_id>` — formatted project summary with collection/request counts
  - `tool search_requests '{"project_id":"...","query":"..."}'` — search requests by path/name
  - `tool get_project_overview '{"project_id":"..."}'` — raw JSON project data with full request configs
  - `tool get_request '{"request_id":"..."}'` — single request detail with full config
  - `list-models <project_id>` — list data models for contract validation
  - `tool get_model '{"model_id":"..."}'` — get model fields for type comparison
- **`skills/scripts/piu_tools.py`** — Extended MCP client with full tool coverage. Key commands:
  - `tree <project_id>` — Full nested collection tree (most comprehensive view)
  - `execute <request_id>` — Execute an API request and get response
  - `verify <project_id>` — Batch execute all GET requests, report status codes
  - `validate '{"model_id":"...","json_body":"..."}'` — Validate response against data model
  - `sync-status <project_id>` — Version tracking with staleness detection
  - `diff-sync <project_id> <repo_path>` — Compare repo HEAD vs PIU stored commit
  - `changelog '{"entity_type":"request"}'` — Audit trail of changes
  - `model-mermaid <project_id>` — Mermaid class diagram of all models
  - `model-graph <project_id>` — Model relationship graph (JSON)
  - `search <project_id> <query>` — Search requests by name/URL/method
  - `activate-env`, `set-vars` — Environment management

## Workflow

### Step 0: Re-Sync Detection (Version Update Check)

For projects previously audited, check if the frontend repo has changed since last audit.

**0a. Check for stored frontend commit:**

The PIU project's `description` field stores the last audited frontend commit as a metadata line:
```
Frontend audit: <commit_sha> @ <timestamp> from <repo_url>
```

```bash
python3 skills/scripts/piu_tools.py get-project PROJECT_ID
# Check description for "Frontend audit:" line
```

**0b. Compare commits:**
```bash
cd /path/to/frontend/repo
OLD_COMMIT="<from PIU description>"
NEW_COMMIT=$(git rev-parse HEAD)

if [ "$OLD_COMMIT" = "$NEW_COMMIT" ]; then
  echo "No frontend changes since last audit"
  exit 0
fi

# Get changed files
git diff --name-only "$OLD_COMMIT" "$NEW_COMMIT" -- '*.ts' '*.tsx' '*.js' '*.jsx' '*.vue' '*.svelte'
```

**0c. Decision matrix:**

| Scenario | Action |
|----------|--------|
| Same commit | Skip audit, report "already audited" |
| Changed files but no API call files | Update commit marker only |
| API-related files changed | Incremental re-audit (re-scan changed files only) |
| No previous audit exists | Full audit (proceed to Step 1) |

**0d. Incremental re-audit:**

Only scan files that changed since last audit:
```bash
# Get changed API-relevant files
CHANGED=$(git diff --name-only "$OLD_COMMIT" "$NEW_COMMIT" | grep -E '(api|service|hook|store|lib|utils)/')
# Scan only these files for API calls in Step 2
```

### Step 1: Clone & Identify Frontend Framework

```bash
TMPDIR=$(mktemp -d /tmp/piu-frontend-sync-XXXXX)
git clone --depth 1 <url> "$TMPDIR/repo"
cd "$TMPDIR/repo"
COMMIT=$(git rev-parse HEAD)
```

Detect frontend framework and API client:

| Framework | File | Detection Pattern |
|-----------|------|-------------------|
| React | package.json | `react` in dependencies |
| Vue | package.json | `vue` in dependencies |
| Angular | package.json | `@angular/core` in dependencies |
| Svelte | package.json | `svelte` in dependencies |
| Next.js | package.json | `next` in dependencies |
| Nuxt | package.json | `nuxt` in dependencies |

| API Client | File | Detection Pattern |
|------------|------|-------------------|
| fetch | source files | Native `fetch(` calls |
| axios | package.json | `axios` in dependencies |
| ky | package.json | `ky` in dependencies |
| ofetch | package.json | `ofetch` in dependencies |
| @tanstack/query | package.json | `@tanstack/react-query` or `@tanstack/vue-query` |
| SWR | package.json | `swr` in dependencies |

### Step 2: API Call Discovery

Scan these directories (in order of priority):
1. `**/api/**` — Dedicated API layer
2. `**/services/**` — Service layer
3. `**/hooks/**` — Custom hooks (React/Vue)
4. `**/lib/**` — Library utilities
5. `**/utils/**` — Utility functions
6. `**/store/**` or `**/stores/**` — State management with API calls

For each file, search for HTTP call patterns:

**fetch:**
```
fetch(`/api/users`, { method: 'POST' })
fetch('/api/users')
fetch(API_URL + '/users')
```

**axios:**
```
axios.get('/api/users')
axios.post('/api/users', data)
api.get('/users')  // where api = axios.create({ baseURL: '...' })
```

**ky:**
```
ky.get('users')
ky.post('users', { json: data })
api.get('users').json()
```

**ofetch:**
```
$fetch('/api/users')
ofetch('/api/users', { method: 'POST' })
```

For each API call found, extract:
- HTTP method (GET, POST, PUT, DELETE, PATCH)
- URL path (resolve relative paths, strip baseURL prefixes)
- Request body TypeScript interface (if typed)
- Response TypeScript interface (if typed)
- File and line number for reference

### Step 3: Cross-Reference Against PIU

Use `piu_tools.py` for the most comprehensive project view:
```bash
# Full tree with all requests, parsed configs, environments
python3 skills/scripts/piu_tools.py tree <target_project_id>

# Or for raw JSON (for programmatic comparison):
python3 skills/scripts/piu_tools.py tool get_collection_tree '{"project_id":"<target_project_id>"}'
```

For targeted searches:
```bash
# Search for specific endpoints
python3 skills/scripts/piu_tools.py search <project_id> "/users" POST
```

You can also use `piu_mcp.py` for quick lookups:
```bash
python3 skills/scripts/piu_mcp.py overview <target_project_id>
# or for raw JSON:
python3 skills/scripts/piu_mcp.py tool get_project_overview '{"project_id":"<target_project_id>"}'
```

For each frontend API call, match against PIU requests by:
1. **Method match** — HTTP method must be identical
2. **Path match** — Normalize paths (strip leading `/api`, resolve path params like `:id` <-> `{{id}}`)

Categorize each match:
- **MATCHED** — Frontend call has a corresponding PIU request
- **MISSING_IN_PIU** — Frontend calls this endpoint but PIU doesn't have it (potential undocumented endpoint)
- **MISSING_IN_FRONTEND** — PIU has this endpoint but frontend doesn't call it (potential dead endpoint or not yet implemented)

### Step 4: Contract Validation (for MATCHED endpoints)

For matched endpoints, compare TypeScript interfaces:

**Frontend types** (from the codebase):
- Request body interfaces
- Response type interfaces
- Path parameter types

**PIU Data Models** (from MCP):
```
get_model(model_id=<request_model_id>)
get_model(model_id=<response_model_id>)
```

Compare field-by-field:
- **Missing fields** — PIU model has a field the frontend doesn't expect
- **Extra fields** — Frontend expects a field PIU model doesn't have
- **Type mismatches** — Field type differs (e.g., `string` vs `number`)
- **Required/optional disagreements** — Frontend marks optional what PIU marks required, or vice versa

### Step 4.5: Response Validation (Execute & Validate)

For MATCHED endpoints with linked data models, validate that the actual API response conforms to the PIU model definition.

**Prerequisites:** Backend must be running and PIU environment activated.

**4.5a. Execute matched endpoints:**
```bash
# Execute a specific request
python3 skills/scripts/piu_tools.py execute REQUEST_ID
```

**4.5b. Validate response against model:**
```bash
# Get the response model linked to this request
python3 skills/scripts/piu_mcp.py request-models REQUEST_ID
# -> returns { request_model: {...}, response_model: { id: "MODEL_ID", ... } }

# Validate the actual response body
python3 skills/scripts/piu_tools.py validate '{"model_id":"RESPONSE_MODEL_ID","json_body":"<actual_response_json>"}'
```

This catches:
- Missing required fields in actual responses
- Type mismatches between model definition and reality
- Extra fields not documented in the model

**4.5c. Batch validation pattern:**

For large projects, validate a sample of endpoints:
```bash
# Verify all GET endpoints (safe, idempotent)
python3 skills/scripts/piu_tools.py verify PROJECT_ID
```

For each successful response, validate against its linked response model if one exists.

### Step 5: Report

```bash
rm -rf "$TMPDIR"
```

Print structured report:

```
## Frontend API Sync Report

**Frontend Repository:** <url>
**Frontend Commit:** <short_sha>
**Framework:** <detected_framework>
**API Client:** <detected_client>
**PIU Project:** <project_name> (ID: <project_id>)

### Summary
- Total frontend API calls: <N>
- Matched: <count>
- Missing in PIU: <count>
- Missing in Frontend: <count>

### Missing in PIU (Frontend calls these but PIU doesn't have them)
| Method | Path | File | Line |
|--------|------|------|------|
| POST | /api/users/bulk | src/api/users.ts | 45 |

### Missing in Frontend (PIU has these but frontend doesn't call them)
| Method | Path | Collection |
|--------|------|------------|
| DELETE | /users/:id | Users |

### Contract Mismatches (Type disagreements)
| Endpoint | Field | Frontend Type | PIU Model Type | Issue |
|----------|-------|---------------|----------------|-------|
| POST /users | age | number | undefined | number (required) | Required in PIU, optional in frontend |

### Version Tracking
- Frontend commit: <short_sha>
- Previous audit: <old_sha or "first audit">
- PIU project commit: <piu_commit>

### Response Validation (if backend was running)
| Endpoint | Status | Model Valid | Issues |
|----------|--------|-------------|--------|
| GET /users | 200 | Yes | -- |
| POST /users | 201 | No | Missing `created_at` field |

### Auto-Fix Applied (if requested)
- Requests created: <count>
- Models created: <count>
- Links created: <count>

### Model Visualization
```mermaid
<mermaid_diagram_output>
```

### Recommendations
1. Add missing endpoints to PIU: [list]
2. Review dead endpoints: [list]
3. Fix type mismatches: [list]
```

### Step 5.5: Auto-Fix Mode (Optional)

When the user requests auto-fix, automatically create missing PIU entities for endpoints found in the frontend but not in PIU.

**5.5a. Create missing requests:**

For each `MISSING_IN_PIU` endpoint:
```bash
# Find or create the appropriate collection
python3 skills/scripts/piu_tools.py search PROJECT_ID "/prefix"
# If no collection matches the path prefix, create one:
python3 skills/scripts/piu_mcp.py create-collection '{"project_id":"PROJECT_ID","name":"CollectionName","path_prefix":"/prefix"}'

# Create the request
python3 skills/scripts/piu_mcp.py create-request '{"collection_id":"COLLECTION_ID","name":"Endpoint Name","method":"POST","url":"/path"}'
```

**5.5b. Create data models from TypeScript interfaces:**

When the frontend has TypeScript interfaces for request/response types:
```bash
# Extract interface -> create model
python3 skills/scripts/piu_mcp.py create-model '{
  "project_id": "PROJECT_ID",
  "name": "CreateUserRequest",
  "description": "Extracted from frontend src/types/user.ts",
  "fields": [
    {"name": "username", "field_type": "string", "required": true, "example": "john"},
    {"name": "email", "field_type": "string", "required": true, "example": "john@example.com"}
  ]
}'

# Link model to request
python3 skills/scripts/piu_mcp.py link-model '{"request_id":"REQ_ID","model_type":"request","model_id":"MODEL_ID"}'
```

**5.5c. Batch auto-fix pattern:**

For large numbers of missing endpoints:
1. Write all missing endpoint data to `/tmp/piu-autofix/missing.json`
2. Group by collection prefix
3. Create collections first, then batch-create requests:
```bash
cat /tmp/piu-autofix/users.json | python3 skills/scripts/piu_mcp.py batch-requests
```

**5.5d. Model mermaid for documentation:**
```bash
python3 skills/scripts/piu_tools.py model-mermaid PROJECT_ID
```

### Update Audit Marker

After completing the audit, store the frontend commit in the PIU project description:
```bash
python3 skills/scripts/piu_tools.py update-project '{
  "project_id": "PROJECT_ID",
  "description": "...\nFrontend audit: <COMMIT> @ <TIMESTAMP> from <REPO_URL>"
}'
```

This enables incremental re-audits in future runs (Step 0).

## Important Notes

- Normalize paths before comparison: strip `/api` prefix, convert `:param` to `{{param}}`
- If the frontend uses a base URL configuration, resolve it before matching
- For monorepo frontends, ask which app to analyze
- Skip test files (`**/*.test.*`, `**/*.spec.*`, `**/__tests__/**`)
- Skip mock/stub files (`**/__mocks__/**`, `**/mocks/**`)
- For re-audits, always check Step 0 first to avoid unnecessary full scans
- Use `piu_tools.py tree` instead of `piu_mcp.py overview` for the most comprehensive PIU data
- Store the frontend commit in PIU project description for future re-sync detection
- Use `verify` + `validate` to confirm API responses match data models (requires running backend)
- Auto-fix mode creates PIU entities from frontend TypeScript types — always review before committing
- For monorepo frontends with multiple API clients, analyze each client separately
- Use `model-mermaid` to visualize the API contract between frontend and backend
- When auto-fixing, always create the collection first, then batch-create requests within it
- Use `changelog` after auto-fix to audit what was created
