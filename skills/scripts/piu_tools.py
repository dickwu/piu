#!/usr/bin/env python3
"""PIU Tools — Extended MCP client with full tool coverage and workflow commands.

Builds on piu_mcp.py core. Provides wrappers for ALL 46 MCP tools plus
high-level workflow commands for re-sync, verification, and diffing.

Usage:
    # ── Project ──────────────────────────────────────────────────
    python3 piu_tools.py list-projects
    python3 piu_tools.py get-project <project_id>
    python3 piu_tools.py tree <project_id>                    # Full collection tree with all requests
    python3 piu_tools.py update-project '{"project_id":"...","name":"New Name"}'
    python3 piu_tools.py delete-project <project_id>

    # ── Collection ───────────────────────────────────────────────
    python3 piu_tools.py list-collections <project_id>
    python3 piu_tools.py get-collection <collection_id>
    python3 piu_tools.py update-collection '{"collection_id":"...","name":"New"}'
    python3 piu_tools.py delete-collection <collection_id>

    # ── Request ──────────────────────────────────────────────────
    python3 piu_tools.py list-requests <collection_id>
    python3 piu_tools.py get-request <request_id>
    python3 piu_tools.py delete-request <request_id>
    python3 piu_tools.py duplicate-request <request_id>
    python3 piu_tools.py search <project_id> <query>          # Search requests

    # ── Environment ──────────────────────────────────────────────
    python3 piu_tools.py list-envs <project_id>
    python3 piu_tools.py get-env <env_id>
    python3 piu_tools.py update-env '{"environment_id":"...","name":"Staging"}'
    python3 piu_tools.py delete-env <env_id>
    python3 piu_tools.py activate-env '{"environment_id":"...","project_id":"..."}'
    python3 piu_tools.py get-vars <env_id>
    python3 piu_tools.py set-vars '{"environment_id":"...","variables":[...]}'

    # ── Data Models ──────────────────────────────────────────────
    python3 piu_tools.py get-model <model_id>
    python3 piu_tools.py update-model '{"model_id":"...","name":"NewName"}'
    python3 piu_tools.py delete-model <model_id>
    python3 piu_tools.py validate '{"model_id":"...","json_body":"..."}'
    python3 piu_tools.py model-graph <project_id>
    python3 piu_tools.py model-hierarchy <model_id>
    python3 piu_tools.py model-mermaid <project_id>

    # ── Execution & Verification ─────────────────────────────────
    python3 piu_tools.py execute <request_id>                 # Execute HTTP request
    python3 piu_tools.py verify <project_id>                  # Execute all GET requests, report status

    # ── Sync & Changelog ─────────────────────────────────────────
    python3 piu_tools.py sync-status <project_id>
    python3 piu_tools.py changelog '{"entity_type":"request","limit":20}'
    python3 piu_tools.py diff-sync <project_id> <repo_path>  # Compare repo HEAD vs PIU commit

    # ── Passthrough ──────────────────────────────────────────────
    python3 piu_tools.py tool <tool_name> '<json_args>'       # Generic MCP tool call

Environment:
    PIU_MCP_URL  Override MCP server URL (default: http://127.0.0.1:3333/mcp)
"""
import json
import os
import subprocess
import sys

# Import core from piu_mcp
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from piu_mcp import init, call_tool, _print_json  # noqa: E402


# ============ Project Tools ============


def list_projects():
    return call_tool("list_projects", {})


def get_project_overview(project_id):
    return call_tool("get_project_overview", {"project_id": project_id})


def get_collection_tree(project_id):
    """Most comprehensive view: full project with all collections, requests, configs, envs."""
    return call_tool("get_project_overview", {"project_id": project_id})


def update_project(project_id, **kwargs):
    args = {"project_id": project_id, **kwargs}
    return call_tool("update_project", args)


def delete_project(project_id):
    return call_tool("delete_project", {"project_id": project_id})


# ============ Collection Tools ============


def list_collections(project_id):
    return call_tool("list_collections", {"project_id": project_id})


def get_collection(collection_id):
    return call_tool("get_collection", {"collection_id": collection_id})


def update_collection(collection_id, **kwargs):
    args = {"collection_id": collection_id, **kwargs}
    return call_tool("update_collection", args)


def delete_collection(collection_id):
    return call_tool("delete_collection", {"collection_id": collection_id})


# ============ Request Tools ============


def list_requests(collection_id):
    return call_tool("list_requests", {"collection_id": collection_id})


def get_request(request_id):
    return call_tool("get_request", {"request_id": request_id})


def delete_request(request_id):
    return call_tool("delete_request", {"request_id": request_id})


def duplicate_request(request_id):
    return call_tool("duplicate_request", {"request_id": request_id})


def search_requests(project_id, query, method=None, limit=50):
    args = {"project_id": project_id, "query": query, "limit": limit}
    if method:
        args["method"] = method
    return call_tool("search_requests", args)


# ============ Environment Tools ============


def list_environments(project_id):
    return call_tool("list_environments", {"project_id": project_id})


def get_environment(environment_id):
    return call_tool("get_environment", {"environment_id": environment_id})


def update_environment(environment_id, **kwargs):
    args = {"environment_id": environment_id, **kwargs}
    return call_tool("update_environment", args)


def delete_environment(environment_id):
    return call_tool("delete_environment", {"environment_id": environment_id})


def activate_environment(environment_id, project_id):
    return call_tool("set_active_environment", {
        "environment_id": environment_id,
        "project_id": project_id,
    })


def get_env_variables(environment_id):
    return call_tool("list_env_variables", {"environment_id": environment_id})


def set_env_variables(environment_id, variables):
    return call_tool("set_env_variables", {
        "environment_id": environment_id,
        "variables": json.dumps(variables) if isinstance(variables, list) else variables,
    })


# ============ Data Model Tools ============


def get_model(model_id):
    return call_tool("get_model", {"model_id": model_id})


def update_model(model_id, **kwargs):
    args = {"model_id": model_id}
    for k, v in kwargs.items():
        if k == "fields" and isinstance(v, list):
            args[k] = json.dumps(v)
        else:
            args[k] = v
    return call_tool("update_model", args)


def delete_model(model_id):
    return call_tool("delete_model", {"model_id": model_id})


def validate_response(model_id, json_body):
    return call_tool("validate_response_against_model", {
        "model_id": model_id,
        "json_body": json_body if isinstance(json_body, str) else json.dumps(json_body),
    })


def get_model_graph(project_id):
    return call_tool("get_model_relations", {"project_id": project_id})


def get_model_hierarchy(model_id):
    return call_tool("get_model_hierarchy", {"model_id": model_id})


def get_model_mermaid(project_id):
    return call_tool("get_model_diagram", {"project_id": project_id})


# ============ Execution Tools ============


def execute_request(request_id):
    """Execute an API request by ID. Resolves URL, interpolates vars, sends HTTP."""
    return call_tool("execute_request", {"request_id": request_id})


# ============ Sync & Changelog Tools ============


def get_sync_status(project_id):
    return call_tool("get_sync_status", {"project_id": project_id})


def get_changelog(entity_type=None, entity_id=None, limit=50, offset=0):
    args = {"limit": limit, "offset": offset}
    if entity_type:
        args["entity_type"] = entity_type
    if entity_id:
        args["entity_id"] = entity_id
    return call_tool("get_changelog", args)


# ============ High-Level Workflow Commands ============


def verify_project(project_id):
    """Execute all GET requests in a project and report status codes.

    Returns a summary of which endpoints are reachable and which fail.
    Only executes GET requests (safe, idempotent).
    """
    init()
    tree = get_collection_tree(project_id)
    if not isinstance(tree, dict):
        return {"error": "Failed to get project tree", "detail": tree}

    results = []
    collections = tree.get("collection_tree", tree.get("collections", []))

    for col in collections:
        for req in col.get("requests", []):
            config = req.get("parsed_config", req.get("config", {}))
            if isinstance(config, str):
                try:
                    config = json.loads(config)
                except json.JSONDecodeError:
                    config = {}

            method = config.get("method", "GET")
            if method != "GET":
                continue

            req_id = req.get("id", "")
            name = req.get("name", "?")
            url = config.get("url", "")

            try:
                resp = execute_request(req_id)
                status = "?"
                if isinstance(resp, dict):
                    status = resp.get("status", resp.get("status_code", "?"))
                results.append({
                    "name": name,
                    "url": url,
                    "collection": col.get("name", "?"),
                    "status": status,
                    "ok": 200 <= int(str(status)) < 400 if str(status).isdigit() else False,
                })
            except Exception as e:
                results.append({
                    "name": name,
                    "url": url,
                    "collection": col.get("name", "?"),
                    "status": "error",
                    "ok": False,
                    "error": str(e),
                })

    ok_count = sum(1 for r in results if r["ok"])
    return {
        "total_get_requests": len(results),
        "passed": ok_count,
        "failed": len(results) - ok_count,
        "results": results,
    }


def diff_sync(project_id, repo_path):
    """Compare current repo HEAD against PIU's stored commit.

    Returns:
        - old_commit: what PIU has stored
        - new_commit: current repo HEAD
        - changed_files: files that changed between commits
        - added/modified/deleted route files (filtered by framework detection)
    """
    init()

    sync_status = get_sync_status(project_id)
    if not isinstance(sync_status, dict):
        return {"error": "Failed to get sync status", "detail": sync_status}

    project = sync_status.get("project", {})
    old_commit = project.get("source_commit_id", "")
    repo_url = project.get("source_repo_url", "")

    # Get current HEAD
    try:
        new_commit = subprocess.check_output(
            ["git", "-C", repo_path, "rev-parse", "HEAD"],
            text=True,
        ).strip()
    except subprocess.CalledProcessError:
        return {"error": f"Failed to get HEAD from {repo_path}"}

    if old_commit == new_commit:
        return {
            "status": "up_to_date",
            "commit": new_commit,
            "message": "No changes since last sync",
        }

    # Get changed files between commits
    changed_files = []
    added_files = []
    modified_files = []
    deleted_files = []

    try:
        if old_commit:
            diff_output = subprocess.check_output(
                ["git", "-C", repo_path, "diff", "--name-status", old_commit, new_commit],
                text=True,
            ).strip()
        else:
            diff_output = subprocess.check_output(
                ["git", "-C", repo_path, "diff", "--name-status", "HEAD~10", "HEAD"],
                text=True,
            ).strip()

        for line in diff_output.splitlines():
            if not line.strip():
                continue
            parts = line.split("\t", 1)
            if len(parts) == 2:
                status_char, filepath = parts
                changed_files.append(filepath)
                if status_char.startswith("A"):
                    added_files.append(filepath)
                elif status_char.startswith("M"):
                    modified_files.append(filepath)
                elif status_char.startswith("D"):
                    deleted_files.append(filepath)
    except subprocess.CalledProcessError:
        pass

    # Detect framework to filter route-relevant files
    detect_script = os.path.join(os.path.dirname(os.path.abspath(__file__)), "detect_framework.sh")
    router_files = []
    framework = "unknown"
    try:
        detect_output = subprocess.check_output(
            ["bash", detect_script, repo_path],
            text=True,
        ).strip()
        detect_data = json.loads(detect_output)
        framework = detect_data.get("framework", "unknown")
        router_files = detect_data.get("router_files", [])
    except (subprocess.CalledProcessError, json.JSONDecodeError):
        pass

    # Normalize router file paths to be relative
    repo_abs = os.path.abspath(repo_path)
    router_rel = set()
    for rf in router_files:
        rf_abs = os.path.abspath(rf)
        if rf_abs.startswith(repo_abs):
            router_rel.add(os.path.relpath(rf_abs, repo_abs))

    # Filter changed files to route-relevant ones
    route_changes = {
        "added": [f for f in added_files if f in router_rel],
        "modified": [f for f in modified_files if f in router_rel],
        "deleted": [f for f in deleted_files if f in router_rel],
    }

    # Check per-entity staleness from sync_status
    stale_entities = []
    for entity_type in ["collections", "requests", "environments"]:
        entities = sync_status.get(entity_type, [])
        for ent in entities:
            if ent.get("stale", False):
                stale_entities.append({
                    "type": entity_type.rstrip("s"),
                    "id": ent.get("id", "?"),
                    "name": ent.get("name", "?"),
                    "entity_commit": ent.get("source_commit_id", ""),
                })

    return {
        "status": "changes_detected",
        "old_commit": old_commit or "(none — first sync)",
        "new_commit": new_commit,
        "framework": framework,
        "total_changed_files": len(changed_files),
        "route_changes": route_changes,
        "has_route_changes": any(route_changes.values()),
        "stale_entities": stale_entities,
        "repo_url": repo_url,
    }


def print_tree(project_id):
    """Pretty-print the full collection tree."""
    init()
    tree = get_collection_tree(project_id)
    if not isinstance(tree, dict):
        _print_json(tree)
        return

    project = tree.get("project", {})
    print(f"Project: {project.get('name', '?')}")
    print(f"Backend: {project.get('backend_type', '-')}")
    print(f"Commit:  {(project.get('source_commit_id') or '-')[:12]}")

    envs = tree.get("environments", [])
    if envs:
        print(f"\nEnvironments:")
        for env in envs:
            active = " (active)" if env.get("is_active") else ""
            var_count = env.get("variable_count", len(env.get("variables", [])))
            print(f"  {env.get('name', '?'):20s}  {env.get('host', '-'):30s}  {var_count} vars{active}")

    stats = tree.get("method_stats", {})
    collections = tree.get("collection_tree", tree.get("collections", []))
    total = 0
    print(f"\nCollections:")
    for col in collections:
        reqs = col.get("requests", [])
        total += len(reqs)
        name = col.get("name", "?")
        prefix = col.get("path_prefix", "")
        print(f"  {name:25s}  {prefix:20s}  {len(reqs):3d} requests")

        # Print nested children if any
        for child in col.get("children", []):
            child_reqs = child.get("requests", [])
            total += len(child_reqs)
            child_name = f"  └─ {child.get('name', '?')}"
            child_prefix = child.get("path_prefix", "")
            print(f"  {child_name:25s}  {child_prefix:20s}  {len(child_reqs):3d} requests")

    print(f"\n  TOTAL: {total} requests")
    if stats:
        methods = " | ".join(f"{m}: {c}" for m, c in sorted(stats.items()))
        print(f"  Methods: {methods}")


def print_sync_status(project_id):
    """Pretty-print sync status with staleness indicators."""
    init()
    status = get_sync_status(project_id)
    if not isinstance(status, dict):
        _print_json(status)
        return

    project = status.get("project", {})
    print(f"Project:    {project.get('name', '?')}")
    print(f"Repo:       {project.get('source_repo_url', '-')}")
    print(f"Commit:     {project.get('source_commit_id', '-')}")
    print(f"Framework:  {project.get('backend_type', '-')}")

    stale_count = 0
    for entity_type in ["collections", "requests", "environments"]:
        entities = status.get(entity_type, [])
        stale = [e for e in entities if e.get("stale", False)]
        stale_count += len(stale)
        if stale:
            print(f"\nStale {entity_type} ({len(stale)}):")
            for e in stale[:10]:
                print(f"  - {e.get('name', e.get('id', '?'))[:40]}  commit: {(e.get('source_commit_id') or '?')[:12]}")
            if len(stale) > 10:
                print(f"  ... and {len(stale) - 10} more")

    if stale_count == 0:
        print("\nAll entities are up to date.")
    else:
        print(f"\nTotal stale entities: {stale_count}")


# ============ CLI ============


def main():
    if len(sys.argv) < 2 or sys.argv[1] in ("-h", "--help", "help"):
        print(__doc__)
        sys.exit(0)

    cmd = sys.argv[1]

    # ── Project ──────────────────────────────────────────────
    if cmd == "list-projects":
        init()
        _print_json(list_projects())

    elif cmd == "get-project":
        init()
        _print_json(get_project_overview(sys.argv[2]))

    elif cmd == "tree":
        print_tree(sys.argv[2])

    elif cmd == "update-project":
        init()
        _print_json(update_project(**json.loads(sys.argv[2])))

    elif cmd == "delete-project":
        init()
        _print_json(delete_project(sys.argv[2]))

    # ── Collection ───────────────────────────────────────────
    elif cmd == "list-collections":
        init()
        _print_json(list_collections(sys.argv[2]))

    elif cmd == "get-collection":
        init()
        _print_json(get_collection(sys.argv[2]))

    elif cmd == "update-collection":
        init()
        _print_json(update_collection(**json.loads(sys.argv[2])))

    elif cmd == "delete-collection":
        init()
        _print_json(delete_collection(sys.argv[2]))

    # ── Request ──────────────────────────────────────────────
    elif cmd == "list-requests":
        init()
        _print_json(list_requests(sys.argv[2]))

    elif cmd == "get-request":
        init()
        _print_json(get_request(sys.argv[2]))

    elif cmd == "delete-request":
        init()
        _print_json(delete_request(sys.argv[2]))

    elif cmd == "duplicate-request":
        init()
        _print_json(duplicate_request(sys.argv[2]))

    elif cmd == "search":
        init()
        pid = sys.argv[2]
        query = sys.argv[3] if len(sys.argv) > 3 else "/"
        method = sys.argv[4] if len(sys.argv) > 4 else None
        _print_json(search_requests(pid, query, method=method))

    # ── Environment ──────────────────────────────────────────
    elif cmd == "list-envs":
        init()
        _print_json(list_environments(sys.argv[2]))

    elif cmd == "get-env":
        init()
        _print_json(get_environment(sys.argv[2]))

    elif cmd == "update-env":
        init()
        _print_json(update_environment(**json.loads(sys.argv[2])))

    elif cmd == "delete-env":
        init()
        _print_json(delete_environment(sys.argv[2]))

    elif cmd == "activate-env":
        init()
        data = json.loads(sys.argv[2])
        _print_json(activate_environment(data["environment_id"], data["project_id"]))

    elif cmd == "get-vars":
        init()
        _print_json(get_env_variables(sys.argv[2]))

    elif cmd == "set-vars":
        init()
        data = json.loads(sys.argv[2])
        _print_json(set_env_variables(data["environment_id"], data["variables"]))

    # ── Data Models ──────────────────────────────────────────
    elif cmd == "get-model":
        init()
        _print_json(get_model(sys.argv[2]))

    elif cmd == "update-model":
        init()
        _print_json(update_model(**json.loads(sys.argv[2])))

    elif cmd == "delete-model":
        init()
        _print_json(delete_model(sys.argv[2]))

    elif cmd == "validate":
        init()
        data = json.loads(sys.argv[2])
        _print_json(validate_response(data["model_id"], data["json_body"]))

    elif cmd == "model-graph":
        init()
        _print_json(get_model_graph(sys.argv[2]))

    elif cmd == "model-hierarchy":
        init()
        _print_json(get_model_hierarchy(sys.argv[2]))

    elif cmd == "model-mermaid":
        init()
        result = get_model_mermaid(sys.argv[2])
        if isinstance(result, str):
            print(result)
        else:
            _print_json(result)

    # ── Execution & Verification ─────────────────────────────
    elif cmd == "execute":
        init()
        _print_json(execute_request(sys.argv[2]))

    elif cmd == "verify":
        result = verify_project(sys.argv[2])
        if result.get("error"):
            _print_json(result)
        else:
            print(f"Verified {result['total_get_requests']} GET requests:")
            print(f"  Passed: {result['passed']}")
            print(f"  Failed: {result['failed']}")
            for r in result["results"]:
                icon = "OK" if r["ok"] else "FAIL"
                print(f"  {icon:4s}  {r['status']:>4s}  {r['collection']:15s}  {r['name']}")

    # ── Sync & Changelog ─────────────────────────────────────
    elif cmd == "sync-status":
        print_sync_status(sys.argv[2])

    elif cmd == "changelog":
        init()
        data = json.loads(sys.argv[2]) if len(sys.argv) > 2 else {}
        _print_json(get_changelog(**data))

    elif cmd == "diff-sync":
        pid = sys.argv[2]
        repo = sys.argv[3]
        result = diff_sync(pid, repo)
        if result.get("status") == "up_to_date":
            print(f"Up to date at commit {result['commit'][:12]}")
        elif result.get("error"):
            print(f"Error: {result['error']}", file=sys.stderr)
        else:
            print(f"Changes detected:")
            print(f"  Old commit: {result['old_commit'][:12] if result['old_commit'] else '(none)'}")
            print(f"  New commit: {result['new_commit'][:12]}")
            print(f"  Framework:  {result['framework']}")
            print(f"  Changed files: {result['total_changed_files']}")
            rc = result["route_changes"]
            if rc["added"]:
                print(f"  Route files added:    {', '.join(rc['added'])}")
            if rc["modified"]:
                print(f"  Route files modified: {', '.join(rc['modified'])}")
            if rc["deleted"]:
                print(f"  Route files deleted:  {', '.join(rc['deleted'])}")
            if result["stale_entities"]:
                print(f"  Stale entities: {len(result['stale_entities'])}")

    # ── Passthrough ──────────────────────────────────────────
    elif cmd == "tool":
        init()
        name = sys.argv[2]
        args = json.loads(sys.argv[3]) if len(sys.argv) > 3 else {}
        _print_json(call_tool(name, args))

    else:
        print(f"Unknown command: {cmd}", file=sys.stderr)
        print("Run with --help for usage.", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
