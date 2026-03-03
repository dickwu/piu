#!/usr/bin/env python3
"""PIU MCP client — Streamable HTTP transport wrapper for CLI and programmatic use.

Usage:
    # Generic tool call
    python3 piu_mcp.py tool <tool_name> '<json_args>'

    # Convenience commands
    python3 piu_mcp.py create-project '{"name":"my-api",...}'
    python3 piu_mcp.py create-collection '{"project_id":"...","name":"Users","path_prefix":"/users"}'
    python3 piu_mcp.py create-request '{"collection_id":"...","name":"List Users","method":"GET","url":"/list"}'

    # Batch import routes from JSON stdin
    cat routes.json | python3 piu_mcp.py batch-requests

    # Batch import collections from JSON stdin
    cat collections.json | python3 piu_mcp.py batch-collections

    # Batch update request bodies from JSON stdin
    cat updates.json | python3 piu_mcp.py batch-update-bodies

    # Create a data model
    python3 piu_mcp.py create-model '{"project_id":"...","name":"LoginRequest","fields":[...]}'

    # Link a model to a request
    python3 piu_mcp.py link-model '{"request_id":"...", "model_type":"request", "model_id":"..."}'

    # Unlink a model from a request
    python3 piu_mcp.py unlink-model '{"request_id":"...", "model_type":"request"}'

    # Get linked models for a request
    python3 piu_mcp.py request-models <request_id>

    # Resolve inherited fields for a model
    python3 piu_mcp.py resolve-fields <model_id>

    # Batch create models from JSON stdin
    cat models.json | python3 piu_mcp.py batch-models

    # Batch link models to requests from JSON stdin
    cat links.json | python3 piu_mcp.py batch-links

    # List all projects
    python3 piu_mcp.py tool list_projects '{}'

    # Get project overview
    python3 piu_mcp.py tool get_project_overview '{"project_id":"..."}'

Environment:
    PIU_MCP_URL  Override MCP server URL (default: http://127.0.0.1:3333/mcp)
"""
import json
import os
import sys
import urllib.error
import urllib.request

MCP_URL = os.environ.get("PIU_MCP_URL", "http://127.0.0.1:3333/mcp")
_session_id = None
_call_id = 0


def _post(payload, session=None):
    headers = {
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
    }
    if session:
        headers["Mcp-Session-Id"] = session
    req = urllib.request.Request(MCP_URL, json.dumps(payload).encode(), headers)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            sid = resp.headers.get("Mcp-Session-Id")
            body = resp.read().decode()
            result = None
            for line in body.splitlines():
                if line.startswith("data: {"):
                    result = json.loads(line[6:])
            return result, sid
    except urllib.error.HTTPError as e:
        print(f"HTTP {e.code}: {e.read().decode()}", file=sys.stderr)
        return None, None
    except urllib.error.URLError as e:
        print(f"Connection error: {e.reason}", file=sys.stderr)
        print("Is PIU running with the MCP server enabled?", file=sys.stderr)
        return None, None


def init():
    """Initialize MCP session. Must be called before any tool calls."""
    global _session_id, _call_id
    _call_id = 1
    result, sid = _post({
        "jsonrpc": "2.0",
        "method": "initialize",
        "id": _call_id,
        "params": {
            "protocolVersion": "2024-11-05",
            "capabilities": {},
            "clientInfo": {"name": "piu-sync", "version": "1.0"},
        },
    })
    _session_id = sid
    _post({"jsonrpc": "2.0", "method": "notifications/initialized"}, sid)
    return result


def call_tool(name, arguments):
    """Call an MCP tool and return the parsed result."""
    global _call_id, _session_id
    if not _session_id:
        init()
    _call_id += 1
    result, _ = _post(
        {
            "jsonrpc": "2.0",
            "method": "tools/call",
            "id": _call_id,
            "params": {"name": name, "arguments": arguments},
        },
        _session_id,
    )
    if result and "result" in result:
        for c in result["result"].get("content", []):
            if c.get("type") == "text":
                try:
                    return json.loads(c["text"])
                except json.JSONDecodeError:
                    return c["text"]
    if result and "error" in result:
        print(f"MCP error: {result['error']}", file=sys.stderr)
    return result


# ── Convenience wrappers ──────────────────────────────────────────────


def create_project(name, description="", source_repo_url=None, source_commit_id=None, backend_type=None):
    args = {"name": name, "description": description}
    if source_repo_url:
        args["source_repo_url"] = source_repo_url
    if source_commit_id:
        args["source_commit_id"] = source_commit_id
    if backend_type:
        args["backend_type"] = backend_type
    return call_tool("create_project", args)


def create_environment(project_id, name, host=""):
    return call_tool("create_environment", {"project_id": project_id, "name": name, "host": host})


def create_collection(project_id, name, path_prefix="", description="", source_commit_id=None, parent_id=None):
    args = {"project_id": project_id, "name": name, "path_prefix": path_prefix, "description": description}
    if source_commit_id:
        args["source_commit_id"] = source_commit_id
    if parent_id:
        args["parent_id"] = parent_id
    return call_tool("create_collection", args)


def create_request(collection_id, name, method="POST", url="", description="", source_commit_id=None):
    config = {
        "method": method,
        "url": url,
        "headers": [],
        "params": [],
        "body": {"type": "json", "content": ""},
        "auth": {"type": "none"},
        "description": description,
    }
    args = {"collection_id": collection_id, "name": name, "config": json.dumps(config)}
    if source_commit_id:
        args["source_commit_id"] = source_commit_id
    return call_tool("create_request", args)


def get_project_overview(project_id):
    return call_tool("get_project_overview", {"project_id": project_id})


def list_projects():
    return call_tool("list_projects", {})


def search_requests(project_id, query):
    return call_tool("search_requests", {"project_id": project_id, "query": query})


def update_request_config(request_id, config):
    """Update a request's config (body, headers, params, etc)."""
    return call_tool("update_request", {"request_id": request_id, "config": json.dumps(config)})


def create_model(project_id, name, description="", fields=None):
    """Create a data model with typed fields."""
    args = {"project_id": project_id, "name": name}
    if description:
        args["description"] = description
    if fields:
        args["fields"] = json.dumps(fields)
    return call_tool("create_model", args)


def list_models(project_id):
    return call_tool("list_models", {"project_id": project_id})


def generate_body(model_id):
    return call_tool("generate_body_from_model", {"model_id": model_id})


def link_model(request_id, model_type, model_id):
    """Link a data model to a request as request or response model."""
    return call_tool("link_model_to_request", {
        "request_id": request_id,
        "model_type": model_type,
        "model_id": model_id,
    })


def unlink_model(request_id, model_type):
    """Remove a model link from a request."""
    return call_tool("unlink_model_from_request", {
        "request_id": request_id,
        "model_type": model_type,
    })


def get_request_models(request_id):
    """Get both linked models (request and response) with resolved fields."""
    return call_tool("get_request_models", {"request_id": request_id})


def resolve_model_fields(model_id):
    """Resolve all fields for a model including inherited and mixin fields."""
    return call_tool("resolve_model_fields", {"model_id": model_id})


def batch_create_models(project_id, models):
    """Bulk create models. Models is a list of dicts with name, description, fields, etc."""
    return call_tool("batch_create_models", {
        "project_id": project_id,
        "models": json.dumps(models),
    })


def batch_link_models(links):
    """Bulk link models to requests. Links is a list of {request_id, model_type, model_id}."""
    return call_tool("batch_link_models", {"links": json.dumps(links)})


# ── CLI ───────────────────────────────────────────────────────────────


def _print_json(data):
    if isinstance(data, (dict, list)):
        print(json.dumps(data, indent=2))
    elif data is not None:
        print(data)
    else:
        print("null")


def main():
    if len(sys.argv) < 2 or sys.argv[1] in ("-h", "--help", "help"):
        print(__doc__)
        sys.exit(0)

    cmd = sys.argv[1]

    if cmd == "init":
        _print_json(init())

    elif cmd == "create-project":
        _print_json(create_project(**json.loads(sys.argv[2])))

    elif cmd == "create-env":
        _print_json(create_environment(**json.loads(sys.argv[2])))

    elif cmd == "create-collection":
        _print_json(create_collection(**json.loads(sys.argv[2])))

    elif cmd == "create-request":
        _print_json(create_request(**json.loads(sys.argv[2])))

    elif cmd == "batch-requests":
        routes = json.load(sys.stdin)
        init()
        ok = 0
        for route in routes:
            r = create_request(**route)
            if r is not None:
                ok += 1
            print(f"  {'OK' if r else 'FAIL'}: {route.get('name', '?')}", file=sys.stderr)
        print(json.dumps({"total": len(routes), "created": ok}))

    elif cmd == "batch-collections":
        cols = json.load(sys.stdin)
        init()
        results = []
        for col in cols:
            r = create_collection(**col)
            cid = r.get("id", "?") if isinstance(r, dict) else "?"
            results.append({"name": col.get("name", "?"), "id": cid, "ok": r is not None})
            print(f"  {'OK' if r else 'FAIL'}: {col.get('name', '?')} => {cid}", file=sys.stderr)
        print(json.dumps({"total": len(cols), "created": sum(1 for r in results if r["ok"]), "collections": results}))

    elif cmd == "batch-update-bodies":
        updates = json.load(sys.stdin)
        init()
        ok = 0
        for upd in updates:
            rid = upd["request_id"]
            config = upd["config"]
            r = update_request_config(rid, config)
            if r is not None:
                ok += 1
            name = upd.get("name", rid[:12])
            print(f"  {'OK' if r else 'FAIL'}: {name}", file=sys.stderr)
        print(json.dumps({"total": len(updates), "updated": ok}))

    elif cmd == "create-model":
        _print_json(create_model(**json.loads(sys.argv[2])))

    elif cmd == "list-models":
        pid = sys.argv[2]
        init()
        _print_json(list_models(pid))

    elif cmd == "generate-body":
        mid = sys.argv[2]
        init()
        _print_json(generate_body(mid))

    elif cmd == "link-model":
        _print_json(link_model(**json.loads(sys.argv[2])))

    elif cmd == "unlink-model":
        _print_json(unlink_model(**json.loads(sys.argv[2])))

    elif cmd == "request-models":
        mid = sys.argv[2]
        init()
        _print_json(get_request_models(mid))

    elif cmd == "resolve-fields":
        mid = sys.argv[2]
        init()
        _print_json(resolve_model_fields(mid))

    elif cmd == "batch-models":
        data = json.load(sys.stdin)
        init()
        _print_json(batch_create_models(data["project_id"], data["models"]))

    elif cmd == "batch-links":
        links = json.load(sys.stdin)
        init()
        _print_json(batch_link_models(links))

    elif cmd == "tool":
        name = sys.argv[2]
        args = json.loads(sys.argv[3]) if len(sys.argv) > 3 else {}
        init()
        _print_json(call_tool(name, args))

    elif cmd == "overview":
        pid = sys.argv[2]
        init()
        data = get_project_overview(pid)
        if isinstance(data, dict):
            p = data.get("project", {})
            print(f"Project: {p.get('name')}")
            print(f"Backend: {p.get('backend_type', '-')}")
            print(f"Commit:  {(p.get('source_commit_id') or '-')[:12]}")
            total = 0
            collections = data.get("collection_tree", data.get("collections", []))
            for c in collections:
                cnt = len(c.get("requests", []))
                total += cnt
                name = c.get("name", "?")
                prefix = c.get("path_prefix", "")
                print(f"  {name:20s}  {prefix:15s}  {cnt:3d} requests")
            print(f"\n  TOTAL: {total} requests")
        else:
            _print_json(data)

    else:
        print(f"Unknown command: {cmd}", file=sys.stderr)
        print("Run with --help for usage.", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
