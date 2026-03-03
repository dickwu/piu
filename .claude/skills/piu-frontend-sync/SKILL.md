---
name: piu-frontend-sync
description: >
  Analyze a frontend repository to discover all HTTP API calls and cross-reference
  them against a PIU project's backend routes. Use when the user says "sync frontend",
  "validate frontend", "check frontend API calls", "find API mismatches", or
  "frontend API audit". Identifies missing endpoints, undocumented calls, and
  TypeScript contract violations between frontend code and PIU request definitions.
---

# PIU Frontend Sync

## Trigger

Activate when the user says any of: "sync frontend", "validate frontend", "check frontend API calls", "find API mismatches", "frontend API audit".

## Prerequisites

A PIU project must already exist with backend routes synced (via backend-sync or manual creation). The user must specify which PIU project to validate against.

## Overview

This skill analyzes a frontend repository to discover all HTTP API calls, then cross-references them against a PIU project's API surface to find mismatches, missing endpoints, and contract violations.

## Workflow

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

Use MCP tools to get the target project's API surface:
```
get_project_overview(project_id=<target_project_id>)
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
- Matched: <count> ✅
- Missing in PIU: <count> ⚠️
- Missing in Frontend: <count> ℹ️

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
| POST /users | age | number \| undefined | number (required) | Required in PIU, optional in frontend |

### Recommendations
1. Add missing endpoints to PIU: [list]
2. Review dead endpoints: [list]
3. Fix type mismatches: [list]
```

## Important Notes

- Normalize paths before comparison: strip `/api` prefix, convert `:param` to `{{param}}`
- If the frontend uses a base URL configuration, resolve it before matching
- For monorepo frontends, ask which app to analyze
- Skip test files (`**/*.test.*`, `**/*.spec.*`, `**/__tests__/**`)
- Skip mock/stub files (`**/__mocks__/**`, `**/mocks/**`)
