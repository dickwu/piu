---
name: piu-mcp
description: >
  Full PIU API management toolkit — 46 MCP tools for managing projects, collections,
  requests, environments, data models, execution, search, sync, and OpenAPI generation.
  Use this skill whenever you need to interact with PIU — whether creating projects,
  sending API requests, managing environments, querying the knowledge graph, generating
  OpenAPI specs, or any task involving PIU data. Always activate when the user mentions
  PIU, API management, MCP tools, or any operation on API projects/collections/requests.
---

# PIU MCP Toolkit

PIU exposes 46 MCP tools via Streamable HTTP at `http://127.0.0.1:3333/mcp`. The CLI handles session management automatically.

## Prerequisites

- PIU desktop app running with MCP server enabled (Settings > MCP > Start Server)
- Bun runtime installed

## CLI

```bash
bun skills/scripts/piu.ts <command> [args...]
```

All commands that take structured input accept a JSON string argument. All output is JSON.

## Projects (6 tools)

```bash
bun skills/scripts/piu.ts list-projects
bun skills/scripts/piu.ts get-project <project_id>
bun skills/scripts/piu.ts create-project '{"name":"my-api","description":"My API","source_repo_url":"https://github.com/org/repo","backend_type":"express"}'
bun skills/scripts/piu.ts update-project '{"project_id":"...","name":"New Name","source_commit_id":"abc123"}'
bun skills/scripts/piu.ts delete-project <project_id>
```

The `overview` and `tree` workflow commands provide formatted summaries:
```bash
bun skills/scripts/piu.ts overview <project_id>   # Compact summary
bun skills/scripts/piu.ts tree <project_id>        # Full tree with envs, collections, methods
```

## Collections (5 tools)

```bash
bun skills/scripts/piu.ts list-collections <project_id>
bun skills/scripts/piu.ts get-collection <collection_id>
bun skills/scripts/piu.ts create-collection '{"project_id":"...","name":"Users","path_prefix":"/users","description":"User management"}'
bun skills/scripts/piu.ts update-collection '{"collection_id":"...","name":"Auth","path_prefix":"/auth"}'
bun skills/scripts/piu.ts delete-collection <collection_id>
```

Collections support nesting via `parent_id` and shared headers via `shared_headers` (JSON string).

## Requests (6 tools + search)

```bash
bun skills/scripts/piu.ts list-requests <collection_id>
bun skills/scripts/piu.ts get-request <request_id>
bun skills/scripts/piu.ts create-request '{"collection_id":"...","name":"Login","config":{"method":"POST","url":"/login","headers":[],"params":[],"body":{"type":"json","content":"{\"username\":\"admin\"}"},"auth":{"type":"none"},"description":"Authenticate user"}}'
bun skills/scripts/piu.ts update-request '{"request_id":"...","config":{"method":"POST","url":"/login","body":{"type":"json","content":"{}"}}}'
bun skills/scripts/piu.ts delete-request <request_id>
bun skills/scripts/piu.ts duplicate-request <request_id>
bun skills/scripts/piu.ts search <project_id> <query> [method]
```

### Request config shape

```json
{
  "method": "POST",
  "url": "/path",
  "headers": [{"key": "Content-Type", "value": "application/json", "enabled": true}],
  "params": [{"key": "page", "value": "1", "enabled": true}],
  "body": {"type": "json", "content": "{\"key\": \"value\"}"},
  "auth": {"type": "bearer", "token": "{{token}}"},
  "description": "## POST /path\n\nEndpoint description..."
}
```

URL resolution: `env.host + collection.path_prefix + request.url`

## Environments (7 tools)

```bash
bun skills/scripts/piu.ts list-envs <project_id>
bun skills/scripts/piu.ts get-env <environment_id>
bun skills/scripts/piu.ts create-env '{"project_id":"...","name":"Development","host":"http://localhost:3000"}'
bun skills/scripts/piu.ts update-env '{"environment_id":"...","name":"Staging","host":"https://staging.api.com"}'
bun skills/scripts/piu.ts delete-env <environment_id>
bun skills/scripts/piu.ts activate-env '{"environment_id":"...","project_id":"..."}'
bun skills/scripts/piu.ts get-vars <environment_id>
bun skills/scripts/piu.ts set-vars '{"environment_id":"...","variables":[{"key":"token","value":"abc","enabled":true}]}'
```

Activate an environment before executing requests — it sets the host URL for URL resolution.

## Data Models (11 tools)

Models define typed schemas for request/response bodies. They support single-parent inheritance and multi-mixin composition.

```bash
bun skills/scripts/piu.ts list-models <project_id>
bun skills/scripts/piu.ts get-model <model_id>
bun skills/scripts/piu.ts create-model '{"project_id":"...","name":"LoginRequest","description":"Auth payload","fields":[{"name":"username","field_type":"string","required":true,"example":"admin"},{"name":"password","field_type":"string","required":true}]}'
bun skills/scripts/piu.ts update-model '{"model_id":"...","name":"NewName","fields":[...]}'
bun skills/scripts/piu.ts delete-model <model_id>
bun skills/scripts/piu.ts generate-body <model_id>
bun skills/scripts/piu.ts validate '{"model_id":"...","response_body":"{\"code\":0,\"data\":{}}"}'
bun skills/scripts/piu.ts resolve-fields <model_id>
```

Field types: `string`, `integer`, `number`, `boolean`, `array`, `object`, `file`

### Inheritance & Mixins

```bash
# Create base model, then child with parent_model_id
bun skills/scripts/piu.ts create-model '{"project_id":"...","name":"PaginatedResponse","parent_model_id":"BASE_MODEL_ID","fields":[{"name":"items","field_type":"array"}]}'

# Or use mixins for composition
bun skills/scripts/piu.ts create-model '{"project_id":"...","name":"UserList","mixin_model_ids":["PAGINATION_ID","SEARCH_ID"],"fields":[...]}'
```

`resolve-fields` returns all fields including inherited and mixin fields in linearized order.

## Model Relations (6 tools)

```bash
bun skills/scripts/piu.ts model-graph <project_id>      # All model relationships (JSON)
bun skills/scripts/piu.ts model-hierarchy <model_id>     # Ancestry chain for one model
bun skills/scripts/piu.ts model-mermaid <project_id>     # Mermaid class diagram
bun skills/scripts/piu.ts link-model '{"request_id":"...","model_type":"request","model_id":"..."}'
bun skills/scripts/piu.ts unlink-model '{"request_id":"...","model_type":"response"}'
bun skills/scripts/piu.ts request-models <request_id>    # Get linked request + response models
```

`model_type` is either `"request"` or `"response"`.

## Execution (1 tool)

```bash
bun skills/scripts/piu.ts execute <request_id>
```

Resolves URL (`env.host + collection.prefix + request.url`), interpolates `{{variables}}`, injects auth, sends HTTP via reqwest, and returns status, headers, body, timing.

### Batch verification

```bash
bun skills/scripts/piu.ts verify <project_id>    # Execute all GET requests, report pass/fail
```

## Search & Discovery (5 tools)

Full-text search across all entity types with BM25 ranking and entity relationship traversal.

```bash
# FTS5 search across all entities
bun skills/scripts/piu.ts search-entities '{"query":"users","project_id":"...","entity_type":"request","limit":20}'

# Find related entities (Obsidian-style backlinks)
bun skills/scripts/piu.ts find-related <entity_type> <entity_id> [max_depth]

# Detailed view of any entity
bun skills/scripts/piu.ts entity-detail <entity_type> <entity_id>

# Complete API surface for a project (all methods + paths)
bun skills/scripts/piu.ts api-surface <project_id>

# Natural-language project summary
bun skills/scripts/piu.ts summary <project_id>
```

Entity types: `project`, `collection`, `request`, `model`, `environment`

## Sync & Changelog (2 tools)

```bash
bun skills/scripts/piu.ts sync-status <project_id>     # Pretty-print with staleness indicators
bun skills/scripts/piu.ts changelog '{"entity_type":"request","entity_id":"...","limit":20}'
bun skills/scripts/piu.ts diff-sync <project_id> <repo_path>  # Compare repo HEAD vs PIU commit
```

Every entity tracks `source_commit_id`. `sync-status` flags entities whose commit differs from the project-level commit.

## OpenAPI (2 tools)

```bash
bun skills/scripts/piu.ts generate-spec <project_id>   # Generate OpenAPI 3.1 spec from project data
bun skills/scripts/piu.ts get-spec <project_id>         # Retrieve previously generated spec
```

## Batch Operations (5 tools)

All batch commands read JSON from stdin.

```bash
# Batch create requests
cat routes.json | bun skills/scripts/piu.ts batch-requests
# Input: [{"collection_id":"...","name":"List Users","method":"GET","url":"/list"}]

# Batch create collections
cat cols.json | bun skills/scripts/piu.ts batch-collections
# Input: [{"project_id":"...","name":"Users","path_prefix":"/users"}]

# Batch update request configs
cat updates.json | bun skills/scripts/piu.ts batch-update-bodies
# Input: [{"request_id":"...","name":"Login","config":{...}}]

# Batch create models
cat models.json | bun skills/scripts/piu.ts batch-models
# Input: {"project_id":"...","models":[{"name":"LoginRequest","fields":[...]}]}

# Batch link models to requests
cat links.json | bun skills/scripts/piu.ts batch-links
# Input: [{"request_id":"...","model_type":"request","model_id":"..."}]
```

## Generic Tool Call

For any MCP tool not covered by a named command:

```bash
bun skills/scripts/piu.ts tool <tool_name> '<json_args>'
bun skills/scripts/piu.ts tool search_entities '{"query":"auth","entity_type":"request"}'
```

## All 46 MCP Tools

| Domain | Tools |
|--------|-------|
| Projects (6) | `list_projects`, `get_project`, `get_project_overview`, `create_project`, `update_project`, `delete_project` |
| Collections (5) | `list_collections`, `get_collection`, `create_collection`, `update_collection`, `delete_collection` |
| Requests (6) | `list_requests`, `get_request`, `create_request`, `update_request`, `delete_request`, `duplicate_request` |
| Environments (7) | `list_environments`, `get_environment`, `create_environment`, `update_environment`, `delete_environment`, `set_active_environment`, `list_env_variables`, `set_env_variables` |
| Models (8) | `list_models`, `get_model`, `create_model`, `update_model`, `delete_model`, `generate_body_from_model`, `validate_response_against_model`, `resolve_model_fields` |
| Model Batch (2) | `batch_create_models`, `batch_link_models` |
| Model Relations (3) | `get_model_relations`, `get_model_hierarchy`, `get_model_diagram` |
| Linking (3) | `link_model_to_request`, `unlink_model_from_request`, `get_request_models` |
| Execution (1) | `execute_request` |
| Search (6) | `search_requests`, `search_entities`, `find_related_entities`, `get_entity_detail`, `get_api_surface`, `get_project_summary` |
| Sync (2) | `get_sync_status`, `get_changelog` |
| OpenAPI (2) | `generate_openapi_spec`, `get_openapi_spec` |
