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
  Also use when the user asks about API coverage, endpoint validation, or
  frontend-backend contract alignment.
---

# PIU Frontend Sync

Scans a frontend repository for HTTP API calls and cross-references them against a PIU project to find mismatches, missing endpoints, and type contract violations.

## CLI Scripts

This skill bundles `scripts/piu.ts` (relative to this SKILL.md):

```bash
bun scripts/piu.ts <command> [args...]     # MCP client (46 tools)
```

For full tool reference, see the **piu-mcp** skill.

## Prerequisites

A PIU project must exist with backend routes synced (via backend-sync or manual creation).

## Step 0: Re-Sync Detection

For previously audited projects, check if the frontend repo changed:

```bash
# The PIU project description stores the last audited commit:
# "Frontend audit: <commit_sha> @ <timestamp> from <repo_url>"
bun scripts/piu.ts get-project PROJECT_ID
```

```bash
cd /path/to/frontend/repo
OLD_COMMIT="<from PIU description>"
NEW_COMMIT=$(git rev-parse HEAD)

if [ "$OLD_COMMIT" = "$NEW_COMMIT" ]; then
  echo "No frontend changes since last audit"
  exit 0
fi

# Get changed API-related files
git diff --name-only "$OLD_COMMIT" "$NEW_COMMIT" | grep -E '(api|service|hook|store|lib|utils)/'
```

| Scenario | Action |
|----------|--------|
| Same commit | Skip audit |
| Changed but no API files | Update commit marker only |
| API-related files changed | Incremental re-audit (scan changed files only) |
| No previous audit | Full audit (Step 1) |

## Step 1: Clone & Identify Frontend Framework

```bash
TMPDIR=$(mktemp -d /tmp/piu-frontend-sync-XXXXX)
git clone --depth 1 <url> "$TMPDIR/repo"
cd "$TMPDIR/repo"
COMMIT=$(git rev-parse HEAD)
```

Detect from `package.json`:

| Framework | Detection | API Client Detection |
|-----------|-----------|---------------------|
| React | `react` in deps | fetch, axios, ky, @tanstack/react-query, SWR |
| Vue | `vue` in deps | fetch, axios, ofetch, @tanstack/vue-query |
| Angular | `@angular/core` | HttpClient, fetch |
| Svelte | `svelte` in deps | fetch, ky |
| Next.js | `next` in deps | fetch, axios, SWR, @tanstack/react-query |

## Step 2: API Call Discovery

Scan directories in priority order:
1. `**/api/**` — Dedicated API layer
2. `**/services/**` — Service layer
3. `**/hooks/**` — Custom hooks
4. `**/lib/**` — Library utilities
5. `**/store/**` or `**/stores/**` — State management

Search for HTTP call patterns:

| Client | Pattern |
|--------|---------|
| **fetch** | `fetch('/api/users')`, `fetch(API_URL + '/users')` |
| **axios** | `axios.get('/api/users')`, `api.post('/users', data)` |
| **ky** | `ky.get('users')`, `api.get('users').json()` |
| **ofetch** | `$fetch('/api/users')`, `ofetch('/api/users', {method: 'POST'})` |

For each API call, extract:
- HTTP method (GET, POST, PUT, DELETE, PATCH)
- URL path (resolve relative paths, strip baseURL prefixes)
- Request body TypeScript interface (if typed)
- Response TypeScript interface (if typed)
- File and line number

Skip: `**/*.test.*`, `**/*.spec.*`, `**/__tests__/**`, `**/__mocks__/**`

## Step 3: Cross-Reference Against PIU

```bash
# Full project tree with all requests
bun scripts/piu.ts tree PROJECT_ID

# Search for specific endpoints
bun scripts/piu.ts search PROJECT_ID "/users" POST

# Or use the knowledge graph for semantic search
bun scripts/piu.ts search-entities '{"query":"user authentication","project_id":"PROJECT_ID","entity_type":"request"}'

# API surface summary
bun scripts/piu.ts api-surface PROJECT_ID
```

Match each frontend call against PIU requests by:
1. **Method match** — HTTP method must be identical
2. **Path match** — Normalize paths (strip `/api` prefix, resolve `:param` ↔ `{{param}}`)

Categorize:
- **MATCHED** — Frontend call has a PIU request
- **MISSING_IN_PIU** — Frontend calls it but PIU doesn't have it
- **MISSING_IN_FRONTEND** — PIU has it but frontend doesn't call it

## Step 4: Contract Validation (MATCHED endpoints)

For matched endpoints with TypeScript interfaces, compare types:

**Frontend types** (from codebase): request body interfaces, response interfaces, path param types.

**PIU Data Models** (from MCP):
```bash
bun scripts/piu.ts request-models REQUEST_ID
bun scripts/piu.ts resolve-fields MODEL_ID
```

Compare field-by-field:
- **Missing fields** — PIU model has a field the frontend doesn't expect
- **Extra fields** — Frontend expects a field PIU model doesn't have
- **Type mismatches** — Field type differs (string vs number)
- **Required/optional** — Disagree on whether a field is required

## Step 4.5: Response Validation (optional)

If the backend is running, validate actual responses:

```bash
# Execute a request
bun scripts/piu.ts execute REQUEST_ID

# Validate response against linked model
bun scripts/piu.ts validate '{"model_id":"RESPONSE_MODEL_ID","response_body":"{...}"}'

# Batch verify all GET endpoints
bun scripts/piu.ts verify PROJECT_ID
```

## Step 5: Report

```bash
rm -rf "$TMPDIR"
```

```
## Frontend API Sync Report

**Frontend Repository:** <url>
**Frontend Commit:** <short_sha>
**Framework:** <detected>
**API Client:** <detected>
**PIU Project:** <name> (ID: <id>)

### Summary
- Total frontend API calls: <N>
- Matched: <count>
- Missing in PIU: <count>
- Missing in Frontend: <count>

### Missing in PIU
| Method | Path | File | Line |
|--------|------|------|------|
| POST | /api/users/bulk | src/api/users.ts | 45 |

### Missing in Frontend
| Method | Path | Collection |
|--------|------|------------|
| DELETE | /users/:id | Users |

### Contract Mismatches
| Endpoint | Field | Frontend Type | PIU Model Type | Issue |
|----------|-------|---------------|----------------|-------|
| POST /users | age | number \| undefined | number (required) | Required in PIU, optional in frontend |

### Recommendations
1. Add missing endpoints to PIU: [list]
2. Review dead endpoints: [list]
3. Fix type mismatches: [list]
```

## Step 5.5: Auto-Fix Mode (optional)

When the user requests auto-fix, create missing PIU entities:

```bash
# Create missing requests
bun scripts/piu.ts create-request '{"collection_id":"...","name":"Bulk Create Users","config":{"method":"POST","url":"/bulk","headers":[],"params":[],"body":{"type":"json","content":""},"auth":{"type":"none"},"description":"..."}}'

# Create models from TypeScript interfaces
bun scripts/piu.ts create-model '{"project_id":"...","name":"BulkCreateRequest","fields":[{"name":"users","field_type":"array","required":true}]}'

# Link model to request
bun scripts/piu.ts link-model '{"request_id":"...","model_type":"request","model_id":"..."}'

# Use entity relations to find what's connected
bun scripts/piu.ts find-related request REQUEST_ID
```

## Update Audit Marker

After audit, store the frontend commit in PIU project description:
```bash
bun scripts/piu.ts update-project '{"project_id":"PROJECT_ID","description":"...\nFrontend audit: <COMMIT> @ <TIMESTAMP> from <REPO_URL>"}'
```

## Notes

- Normalize paths before comparison: strip `/api` prefix, convert `:param` to `{{param}}`
- Resolve base URL configuration before matching
- For monorepo frontends, ask which app to analyze
- Use `api-surface` for a quick view of all PIU endpoints to compare against
- Use `search-entities` for semantic search when path matching is ambiguous
- Use `find-related` to trace entity relationships after auto-fix
- Use `model-mermaid` to visualize the API contract between frontend and backend
