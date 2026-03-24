#!/usr/bin/env bun
/**
 * PIU CLI — Streamable HTTP MCP client for all 46 PIU tools.
 *
 * Usage:
 *   bun piu.ts <command> [args...]
 *   bun piu.ts tool <tool_name> '<json>'       # Generic tool call
 *   cat data.json | bun piu.ts batch-requests   # Batch from stdin
 *
 * Environment:
 *   PIU_MCP_URL  Override MCP server URL (default: http://127.0.0.1:3333/mcp)
 */

const MCP_URL = Bun.env.PIU_MCP_URL ?? "http://127.0.0.1:3333/mcp"
let sid: string | null = null
let seq = 0

// ── MCP Transport ─────────────────────────────────────────

async function rpc(method: string, params?: unknown, id?: number) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
  }
  if (sid) headers["Mcp-Session-Id"] = sid

  const payload: Record<string, unknown> = { jsonrpc: "2.0", method }
  if (params !== undefined) payload.params = params
  if (id !== undefined) payload.id = id

  try {
    const r = await fetch(MCP_URL, { method: "POST", headers, body: JSON.stringify(payload) })
    sid ??= r.headers.get("Mcp-Session-Id")
    const text = await r.text()
    for (const line of text.split("\n")) {
      if (line.startsWith("data: {")) return JSON.parse(line.slice(6))
    }
    return null
  } catch (e) {
    console.error(`Connection error: ${e instanceof Error ? e.message : e}`)
    console.error("Is PIU running with the MCP server enabled?")
    process.exit(1)
  }
}

async function init() {
  seq = 1
  await rpc(
    "initialize",
    {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "piu-cli", version: "2.0" },
    },
    seq,
  )
  await rpc("notifications/initialized")
}

async function tool(name: string, args: Record<string, unknown> = {}): Promise<unknown> {
  if (!sid) await init()
  const r = await rpc("tools/call", { name, arguments: args }, ++seq)
  if (r?.result) {
    for (const c of r.result.content ?? []) {
      if (c.type === "text" && c.text) {
        try { return JSON.parse(c.text) } catch { return c.text }
      }
    }
  }
  if (r?.error) console.error("MCP error:", r.error)
  return r
}

// ── Helpers ───────────────────────────────────────────────

function out(data: unknown) {
  console.log(typeof data === "string" ? data : JSON.stringify(data, null, 2))
}

function arg(i: number): string {
  const v = Bun.argv[i + 2]
  if (!v) { console.error(`Missing argument at position ${i}`); process.exit(1) }
  return v
}

function jsonArg(i: number): Record<string, unknown> {
  return JSON.parse(arg(i))
}

function stringify(val: unknown): string {
  return typeof val === "string" ? val : JSON.stringify(val)
}

async function readStdin(): Promise<unknown> {
  return JSON.parse(await Bun.stdin.text())
}

// ── Commands ─────────────────────────────────────────────

const commands: Record<string, () => Promise<void>> = {
  // ── Project ──
  "list-projects": async () => out(await tool("list_projects")),
  "get-project": async () => out(await tool("get_project", { project_id: arg(1) })),
  "create-project": async () => out(await tool("create_project", jsonArg(1))),
  "update-project": async () => out(await tool("update_project", jsonArg(1))),
  "delete-project": async () => out(await tool("delete_project", { project_id: arg(1) })),

  // ── Collection ──
  "list-collections": async () => out(await tool("list_collections", { project_id: arg(1) })),
  "get-collection": async () => out(await tool("get_collection", { collection_id: arg(1) })),
  "create-collection": async () => out(await tool("create_collection", jsonArg(1))),
  "update-collection": async () => out(await tool("update_collection", jsonArg(1))),
  "delete-collection": async () => out(await tool("delete_collection", { collection_id: arg(1) })),

  // ── Request ──
  "list-requests": async () => out(await tool("list_requests", { collection_id: arg(1) })),
  "get-request": async () => out(await tool("get_request", { request_id: arg(1) })),
  "create-request": async () => {
    const a = jsonArg(1)
    if (a.config && typeof a.config !== "string") a.config = JSON.stringify(a.config)
    out(await tool("create_request", a))
  },
  "update-request": async () => {
    const a = jsonArg(1)
    if (a.config && typeof a.config !== "string") a.config = JSON.stringify(a.config)
    out(await tool("update_request", a))
  },
  "delete-request": async () => out(await tool("delete_request", { request_id: arg(1) })),
  "duplicate-request": async () => out(await tool("duplicate_request", { request_id: arg(1) })),

  // ── Environment ──
  "list-envs": async () => out(await tool("list_environments", { project_id: arg(1) })),
  "get-env": async () => out(await tool("get_environment", { environment_id: arg(1) })),
  "create-env": async () => out(await tool("create_environment", jsonArg(1))),
  "update-env": async () => out(await tool("update_environment", jsonArg(1))),
  "delete-env": async () => out(await tool("delete_environment", { environment_id: arg(1) })),
  "activate-env": async () => out(await tool("set_active_environment", jsonArg(1))),
  "get-vars": async () => out(await tool("list_env_variables", { environment_id: arg(1) })),
  "set-vars": async () => {
    const a = jsonArg(1)
    if (a.variables && typeof a.variables !== "string") a.variables = JSON.stringify(a.variables)
    out(await tool("set_env_variables", a))
  },

  // ── Data Models ──
  "list-models": async () => out(await tool("list_models", { project_id: arg(1) })),
  "get-model": async () => out(await tool("get_model", { model_id: arg(1) })),
  "create-model": async () => {
    const a = jsonArg(1)
    if (a.fields && typeof a.fields !== "string") a.fields = JSON.stringify(a.fields)
    if (a.mixin_model_ids && typeof a.mixin_model_ids !== "string") a.mixin_model_ids = JSON.stringify(a.mixin_model_ids)
    out(await tool("create_model", a))
  },
  "update-model": async () => {
    const a = jsonArg(1)
    if (a.fields && typeof a.fields !== "string") a.fields = JSON.stringify(a.fields)
    out(await tool("update_model", a))
  },
  "delete-model": async () => out(await tool("delete_model", { model_id: arg(1) })),
  "generate-body": async () => out(await tool("generate_body_from_model", { model_id: arg(1) })),
  "validate": async () => {
    const a = jsonArg(1)
    if (a.json_body) { a.response_body = a.json_body; delete a.json_body }
    out(await tool("validate_response_against_model", a))
  },
  "resolve-fields": async () => out(await tool("resolve_model_fields", { model_id: arg(1) })),

  // ── Model Relations ──
  "model-graph": async () => out(await tool("get_model_relations", { project_id: arg(1) })),
  "model-hierarchy": async () => out(await tool("get_model_hierarchy", { model_id: arg(1) })),
  "model-mermaid": async () => {
    const r = await tool("get_model_diagram", { project_id: arg(1) })
    console.log(typeof r === "string" ? r : JSON.stringify(r, null, 2))
  },

  // ── Model-Request Linking ──
  "link-model": async () => out(await tool("link_model_to_request", jsonArg(1))),
  "unlink-model": async () => out(await tool("unlink_model_from_request", jsonArg(1))),
  "request-models": async () => out(await tool("get_request_models", { request_id: arg(1) })),

  // ── Execution ──
  "execute": async () => out(await tool("execute_request", { request_id: arg(1) })),

  // ── Search & Discovery ──
  "search-entities": async () => out(await tool("search_entities", jsonArg(1))),
  "find-related": async () => {
    const args: Record<string, unknown> = { entity_type: arg(1), entity_id: arg(2) }
    if (Bun.argv[5]) args.max_depth = parseInt(Bun.argv[5])
    out(await tool("find_related_entities", args))
  },
  "entity-detail": async () =>
    out(await tool("get_entity_detail", { entity_type: arg(1), entity_id: arg(2) })),
  "api-surface": async () => out(await tool("get_api_surface", { project_id: arg(1) })),
  "summary": async () => out(await tool("get_project_summary", { project_id: arg(1) })),

  // ── Sync & Changelog ──
  "changelog": async () => out(await tool("get_changelog", Bun.argv[3] ? jsonArg(1) : {})),
  "generate-spec": async () => out(await tool("generate_openapi_spec", { project_id: arg(1) })),
  "get-spec": async () => out(await tool("get_openapi_spec", { project_id: arg(1) })),

  // ── Generic ──
  "tool": async () => out(await tool(arg(1), Bun.argv[5] ? JSON.parse(Bun.argv[5]) : {})),

  // ── Workflow: search ──
  "search": async () => {
    await init()
    const args: Record<string, unknown> = { project_id: arg(1), query: Bun.argv[4] ?? "/", limit: 50 }
    if (Bun.argv[5]) args.method = Bun.argv[5]
    out(await tool("search_requests", args))
  },

  // ── Workflow: sync-status ──
  "sync-status": async () => {
    await init()
    const s = (await tool("get_sync_status", { project_id: arg(1) })) as Record<string, unknown>
    if (!s || typeof s !== "object") { out(s); return }
    const p = (s.project ?? {}) as Record<string, unknown>
    console.log(`Project:    ${p.name ?? "?"}`)
    console.log(`Repo:       ${p.source_repo_url ?? "-"}`)
    console.log(`Commit:     ${p.source_commit_id ?? "-"}`)
    console.log(`Framework:  ${p.backend_type ?? "-"}`)
    let staleCount = 0
    for (const type of ["collections", "requests", "environments"] as const) {
      const entities = ((s[type] ?? []) as Array<Record<string, unknown>>).filter((e) => e.stale)
      staleCount += entities.length
      if (entities.length) {
        console.log(`\nStale ${type} (${entities.length}):`)
        for (const e of entities.slice(0, 10))
          console.log(`  - ${String(e.name ?? e.id ?? "?").slice(0, 40)}  commit: ${String(e.source_commit_id ?? "?").slice(0, 12)}`)
        if (entities.length > 10) console.log(`  ... and ${entities.length - 10} more`)
      }
    }
    console.log(staleCount === 0 ? "\nAll entities are up to date." : `\nTotal stale: ${staleCount}`)
  },

  // ── Workflow: tree ──
  "tree": async () => {
    await init()
    const data = (await tool("get_project_overview", { project_id: arg(1) })) as Record<string, unknown>
    if (!data || typeof data !== "object") { out(data); return }
    const p = (data.project ?? {}) as Record<string, unknown>
    console.log(`Project: ${p.name ?? "?"}`)
    console.log(`Backend: ${p.backend_type ?? "-"}`)
    console.log(`Commit:  ${String(p.source_commit_id ?? "-").slice(0, 12)}`)
    const envs = (data.environments ?? []) as Array<Record<string, unknown>>
    if (envs.length) {
      console.log("\nEnvironments:")
      for (const env of envs) {
        const active = env.is_active ? " (active)" : ""
        const vars = env.variable_count ?? (env.variables as unknown[] | undefined)?.length ?? 0
        console.log(`  ${String(env.name ?? "?").padEnd(20)}  ${String(env.host ?? "-").padEnd(30)}  ${vars} vars${active}`)
      }
    }
    const cols = (data.collection_tree ?? data.collections ?? []) as Array<Record<string, unknown>>
    let total = 0
    console.log("\nCollections:")
    for (const col of cols) {
      const reqs = (col.requests ?? []) as unknown[]
      total += reqs.length
      console.log(`  ${String(col.name ?? "?").padEnd(25)}  ${String(col.path_prefix ?? "").padEnd(20)}  ${String(reqs.length).padStart(3)} requests`)
      for (const child of (col.children ?? []) as Array<Record<string, unknown>>) {
        const cr = (child.requests ?? []) as unknown[]
        total += cr.length
        console.log(`    └─ ${String(child.name ?? "?").padEnd(21)}  ${String(child.path_prefix ?? "").padEnd(20)}  ${String(cr.length).padStart(3)} requests`)
      }
    }
    console.log(`\n  TOTAL: ${total} requests`)
    const stats = (data.method_stats ?? {}) as Record<string, number>
    if (Object.keys(stats).length)
      console.log(`  Methods: ${Object.entries(stats).sort().map(([m, c]) => `${m}: ${c}`).join(" | ")}`)
  },

  // ── Workflow: overview ──
  "overview": async () => {
    await init()
    const data = (await tool("get_project_overview", { project_id: arg(1) })) as Record<string, unknown>
    if (!data || typeof data !== "object") { out(data); return }
    const p = (data.project ?? {}) as Record<string, unknown>
    console.log(`Project: ${p.name ?? "?"}`)
    console.log(`Backend: ${p.backend_type ?? "-"}`)
    console.log(`Commit:  ${String(p.source_commit_id ?? "-").slice(0, 12)}`)
    let total = 0
    for (const c of (data.collection_tree ?? data.collections ?? []) as Array<Record<string, unknown>>) {
      const cnt = ((c.requests ?? []) as unknown[]).length
      total += cnt
      console.log(`  ${String(c.name ?? "?").padEnd(20)}  ${String(c.path_prefix ?? "").padEnd(15)}  ${String(cnt).padStart(3)} requests`)
    }
    console.log(`\n  TOTAL: ${total} requests`)
  },

  // ── Workflow: verify ──
  "verify": async () => {
    await init()
    const data = (await tool("get_project_overview", { project_id: arg(1) })) as Record<string, unknown>
    if (!data || typeof data !== "object") { out(data); return }
    const cols = (data.collection_tree ?? data.collections ?? []) as Array<Record<string, unknown>>
    const results: Array<{ name: string; url: string; collection: string; status: string; ok: boolean }> = []
    for (const col of cols) {
      for (const req of (col.requests ?? []) as Array<Record<string, unknown>>) {
        let config = req.parsed_config ?? req.config
        if (typeof config === "string") try { config = JSON.parse(config) } catch { config = {} }
        const cfg = (config ?? {}) as Record<string, unknown>
        if (cfg.method !== "GET") continue
        const reqId = String(req.id ?? "")
        const name = String(req.name ?? "?")
        const url = String(cfg.url ?? "")
        try {
          const resp = (await tool("execute_request", { request_id: reqId })) as Record<string, unknown>
          const status = String(resp?.status ?? resp?.status_code ?? "?")
          const n = parseInt(status)
          results.push({ name, url, collection: String(col.name ?? "?"), status, ok: !isNaN(n) && n >= 200 && n < 400 })
        } catch {
          results.push({ name, url, collection: String(col.name ?? "?"), status: "error", ok: false })
        }
      }
    }
    const ok = results.filter((r) => r.ok).length
    console.log(`Verified ${results.length} GET requests:`)
    console.log(`  Passed: ${ok}`)
    console.log(`  Failed: ${results.length - ok}`)
    for (const r of results) console.log(`  ${r.ok ? "OK  " : "FAIL"}  ${r.status.padStart(4)}  ${r.collection.padEnd(15)}  ${r.name}`)
  },

  // ── Workflow: diff-sync ──
  "diff-sync": async () => {
    await init()
    const syncData = (await tool("get_sync_status", { project_id: arg(1) })) as Record<string, unknown>
    if (!syncData || typeof syncData !== "object") { out(syncData); return }
    const project = (syncData.project ?? {}) as Record<string, unknown>
    const oldCommit = String(project.source_commit_id ?? "")
    const repoPath = arg(2)
    const headProc = Bun.spawn(["git", "-C", repoPath, "rev-parse", "HEAD"], { stdout: "pipe" })
    const newCommit = (await new Response(headProc.stdout).text()).trim()
    if (oldCommit === newCommit) { console.log(`Up to date at commit ${newCommit.slice(0, 12)}`); return }
    const base = oldCommit || "HEAD~10"
    const diffProc = Bun.spawn(["git", "-C", repoPath, "diff", "--name-status", base, newCommit], { stdout: "pipe" })
    const diffOutput = (await new Response(diffProc.stdout).text()).trim()
    const added: string[] = [], modified: string[] = [], deleted: string[] = []
    for (const line of diffOutput.split("\n").filter(Boolean)) {
      const [st, ...rest] = line.split("\t")
      const f = rest.join("\t")
      if (st.startsWith("A")) added.push(f)
      else if (st.startsWith("M")) modified.push(f)
      else if (st.startsWith("D")) deleted.push(f)
    }
    console.log("Changes detected:")
    console.log(`  Old commit: ${oldCommit ? oldCommit.slice(0, 12) : "(none)"}`)
    console.log(`  New commit: ${newCommit.slice(0, 12)}`)
    console.log(`  Changed files: ${added.length + modified.length + deleted.length}`)
    if (added.length) console.log(`  Added:    ${added.join(", ")}`)
    if (modified.length) console.log(`  Modified: ${modified.join(", ")}`)
    if (deleted.length) console.log(`  Deleted:  ${deleted.join(", ")}`)
  },

  // ── Batch Commands (stdin) ──
  "batch-requests": async () => {
    const routes = (await readStdin()) as Array<Record<string, unknown>>
    await init()
    let ok = 0
    for (const route of routes) {
      const config = {
        method: route.method ?? "GET",
        url: route.url ?? "",
        headers: route.headers ?? [],
        params: route.params ?? [],
        body: route.body ?? { type: "json", content: "" },
        auth: route.auth ?? { type: "none" },
        description: route.description ?? "",
      }
      const args: Record<string, unknown> = { collection_id: route.collection_id, name: route.name, config: JSON.stringify(config) }
      if (route.source_commit_id) args.source_commit_id = route.source_commit_id
      const r = await tool("create_request", args)
      if (r) ok++
      console.error(`  ${r ? "OK" : "FAIL"}: ${route.name ?? "?"}`)
    }
    out({ total: routes.length, created: ok })
  },

  "batch-collections": async () => {
    const cols = (await readStdin()) as Array<Record<string, unknown>>
    await init()
    const results: Array<Record<string, unknown>> = []
    for (const col of cols) {
      const r = (await tool("create_collection", col)) as Record<string, unknown> | null
      const cid = r?.id ?? "?"
      results.push({ name: col.name ?? "?", id: cid, ok: !!r })
      console.error(`  ${r ? "OK" : "FAIL"}: ${col.name ?? "?"} => ${cid}`)
    }
    out({ total: cols.length, created: results.filter((r) => r.ok).length, collections: results })
  },

  "batch-update-bodies": async () => {
    const updates = (await readStdin()) as Array<Record<string, unknown>>
    await init()
    let ok = 0
    for (const upd of updates) {
      const r = await tool("update_request", { request_id: upd.request_id, config: stringify(upd.config) })
      if (r) ok++
      console.error(`  ${r ? "OK" : "FAIL"}: ${upd.name ?? String(upd.request_id).slice(0, 12)}`)
    }
    out({ total: updates.length, updated: ok })
  },

  "batch-models": async () => {
    const data = (await readStdin()) as Record<string, unknown>
    await init()
    out(await tool("batch_create_models", { project_id: data.project_id, models: stringify(data.models) }))
  },

  "batch-links": async () => {
    const links = await readStdin()
    await init()
    out(await tool("batch_link_models", { links: JSON.stringify(links) }))
  },
}

// ── Main ─────────────────────────────────────────────────

const cmd = Bun.argv[2]

if (!cmd || cmd === "-h" || cmd === "--help" || cmd === "help") {
  console.log(`PIU CLI — MCP client for 46 PIU tools (Bun runtime)

Usage: bun piu.ts <command> [args...]

Commands:
  Project:     list-projects, get-project, create-project, update-project, delete-project
  Collection:  list-collections, get-collection, create-collection, update-collection, delete-collection
  Request:     list-requests, get-request, create-request, update-request, delete-request, duplicate-request
  Environment: list-envs, get-env, create-env, update-env, delete-env, activate-env, get-vars, set-vars
  Model:       list-models, get-model, create-model, update-model, delete-model, generate-body, validate, resolve-fields
  Relations:   model-graph, model-hierarchy, model-mermaid, link-model, unlink-model, request-models
  Execution:   execute
  Search:      search, search-entities, find-related, entity-detail, api-surface, summary
  Sync:        sync-status, changelog, diff-sync
  OpenAPI:     generate-spec, get-spec
  Batch:       batch-requests, batch-collections, batch-update-bodies, batch-models, batch-links
  Workflow:    tree, overview, verify
  Generic:     tool <name> '<json>'

Environment:  PIU_MCP_URL  Override server URL (default: http://127.0.0.1:3333/mcp)`)
  process.exit(0)
}

const handler = commands[cmd]
if (!handler) {
  console.error(`Unknown command: ${cmd}\nRun with --help for usage.`)
  process.exit(1)
}

await handler()
