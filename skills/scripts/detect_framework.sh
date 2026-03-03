#!/usr/bin/env bash
# Detect backend framework from a repository directory.
# Usage: detect_framework.sh /path/to/repo
# Output: JSON {"framework":"express","port":3000,"router_files":["routes/api.js"]}

set -euo pipefail

REPO="${1:-.}"

detect() {
  local framework="" port=8080 router_files=""

  # ── PHP ──────────────────────────────────────────────────────
  if [ -f "$REPO/composer.json" ]; then
    if grep -q '"hyperf/framework"' "$REPO/composer.json" 2>/dev/null; then
      framework="hyperf"; port=9501
      router_files=$(find "$REPO/config/routers" -name '*.php' 2>/dev/null | sort)
      [ -f "$REPO/config/routes.php" ] && router_files="$REPO/config/routes.php"$'\n'"$router_files"
    elif grep -q '"laravel/framework"' "$REPO/composer.json" 2>/dev/null; then
      framework="laravel"; port=8000
      router_files=$(find "$REPO/routes" -name '*.php' 2>/dev/null | sort)
    fi
  fi

  # ── Node.js ──────────────────────────────────────────────────
  if [ -z "$framework" ] && [ -f "$REPO/package.json" ]; then
    if grep -q '"@nestjs/core"' "$REPO/package.json" 2>/dev/null; then
      framework="nestjs"; port=3000
      router_files=$(find "$REPO/src" -name '*.controller.ts' -o -name '*.controller.js' 2>/dev/null | sort)
    elif grep -q '"hono"' "$REPO/package.json" 2>/dev/null; then
      framework="hono"; port=3000
      router_files=$(find "$REPO/src" -name '*.ts' -o -name '*.js' 2>/dev/null | grep -iE 'route|api|app' | sort)
    elif grep -q '"fastify"' "$REPO/package.json" 2>/dev/null; then
      framework="fastify"; port=3000
      router_files=$(find "$REPO/src" "$REPO/routes" -name '*.ts' -o -name '*.js' 2>/dev/null | sort)
    elif grep -q '"express"' "$REPO/package.json" 2>/dev/null; then
      framework="express"; port=3000
      router_files=$(find "$REPO" -maxdepth 3 \( -name '*.ts' -o -name '*.js' \) -not -path '*/node_modules/*' 2>/dev/null | xargs grep -l 'Router\(\)\|app\.get\|app\.post' 2>/dev/null | sort)
    fi
  fi

  # ── Python ───────────────────────────────────────────────────
  if [ -z "$framework" ]; then
    for depfile in "$REPO/requirements.txt" "$REPO/pyproject.toml" "$REPO/setup.py"; do
      [ -f "$depfile" ] || continue
      if grep -qi 'fastapi' "$depfile" 2>/dev/null; then
        framework="fastapi"; port=8000
        router_files=$(find "$REPO" -name '*.py' -not -path '*/venv/*' 2>/dev/null | xargs grep -l '@.*\.\(get\|post\|put\|delete\|patch\)' 2>/dev/null | sort)
        break
      elif grep -qi 'django' "$depfile" 2>/dev/null; then
        framework="django"; port=8000
        router_files=$(find "$REPO" -name 'urls.py' 2>/dev/null | sort)
        break
      elif grep -qi 'flask' "$depfile" 2>/dev/null; then
        framework="flask"; port=5000
        router_files=$(find "$REPO" -name '*.py' -not -path '*/venv/*' 2>/dev/null | xargs grep -l '@.*\.route' 2>/dev/null | sort)
        break
      fi
    done
  fi

  # ── Go ───────────────────────────────────────────────────────
  if [ -z "$framework" ] && [ -f "$REPO/go.mod" ]; then
    if grep -q 'gin-gonic/gin' "$REPO/go.mod" 2>/dev/null; then
      framework="gin"; port=8080
    elif grep -q 'labstack/echo' "$REPO/go.mod" 2>/dev/null; then
      framework="echo"; port=8080
    elif grep -q 'gofiber/fiber' "$REPO/go.mod" 2>/dev/null; then
      framework="fiber"; port=8080
    fi
    [ -n "$framework" ] && router_files=$(find "$REPO" -name '*.go' -not -path '*/vendor/*' 2>/dev/null | xargs grep -l '\.GET\|\.POST\|\.Group' 2>/dev/null | sort)
  fi

  # ── Rust ─────────────────────────────────────────────────────
  if [ -z "$framework" ] && [ -f "$REPO/Cargo.toml" ]; then
    if grep -q 'axum' "$REPO/Cargo.toml" 2>/dev/null; then
      framework="axum"; port=8080
    elif grep -q 'actix-web' "$REPO/Cargo.toml" 2>/dev/null; then
      framework="actix"; port=8080
    fi
    [ -n "$framework" ] && router_files=$(find "$REPO/src" -name '*.rs' 2>/dev/null | xargs grep -l 'route\|Router' 2>/dev/null | sort)
  fi

  # ── Ruby ─────────────────────────────────────────────────────
  if [ -z "$framework" ] && [ -f "$REPO/Gemfile" ]; then
    if grep -q "'rails'" "$REPO/Gemfile" 2>/dev/null || grep -q '"rails"' "$REPO/Gemfile" 2>/dev/null; then
      framework="rails"; port=3000
      router_files="$REPO/config/routes.rb"
    fi
  fi

  # ── Java/Kotlin ──────────────────────────────────────────────
  if [ -z "$framework" ]; then
    for buildfile in "$REPO/pom.xml" "$REPO/build.gradle" "$REPO/build.gradle.kts"; do
      [ -f "$buildfile" ] || continue
      if grep -q 'spring-boot-starter-web' "$buildfile" 2>/dev/null; then
        framework="spring"; port=8080
        router_files=$(find "$REPO/src" -name '*.java' -o -name '*.kt' 2>/dev/null | xargs grep -l '@RequestMapping\|@RestController\|@GetMapping' 2>/dev/null | sort)
        break
      fi
    done
  fi

  # ── Output ───────────────────────────────────────────────────
  if [ -z "$framework" ]; then
    echo '{"framework":"unknown","port":8080,"router_files":[]}'
    return 1
  fi

  # Convert router_files to JSON array
  local files_json="[]"
  if [ -n "$router_files" ]; then
    files_json=$(echo "$router_files" | grep -v '^$' | python3 -c "
import sys, json
files = [line.strip() for line in sys.stdin if line.strip()]
print(json.dumps(files))
" 2>/dev/null || echo '[]')
  fi

  echo "{\"framework\":\"$framework\",\"port\":$port,\"router_files\":$files_json}"
}

detect
