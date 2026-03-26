#!/usr/bin/env bun
/**
 * Parse Hyperf `describe:routes` ASCII table output → JSON.
 *
 * Usage:
 *   php bin/hyperf.php describe:routes | bun parse-routes.ts
 *   bun parse-routes.ts < routes.txt
 *
 * Output: JSON array of route objects:
 *   [{"server":"http","method":"POST","uri":"/user/task/create",
 *     "action":"App\\Controller\\User\\UserTaskController::create",
 *     "middleware":["CorsMiddleware","AuthToken"]}]
 */

interface Route {
  server: string
  method: string
  uri: string
  action: string
  middleware: string[]
}

const input = await Bun.stdin.text()
const lines = input.split("\n")

// Detect column boundaries from the first separator line.
// The separator looks like: +--------+----------+------...+
// We parse by fixed positions because the Method column can
// contain literal "|" characters (e.g. "GET|POST").
function parseColumnBoundaries(separator: string): number[] {
  const positions: number[] = []
  for (let i = 0; i < separator.length; i++) {
    if (separator[i] === "+") positions.push(i)
  }
  return positions
}

function extractCells(line: string, boundaries: number[]): string[] {
  const cells: string[] = []
  for (let i = 0; i < boundaries.length - 1; i++) {
    // Content sits between boundary[i]+1 and boundary[i+1]-1 (the | chars)
    const raw = line.slice(boundaries[i] + 1, boundaries[i + 1])
    cells.push(raw.trim())
  }
  return cells
}

// Find the first separator line to derive column positions
const separatorLine = lines.find((l) => l.startsWith("+"))
if (!separatorLine) {
  console.log("[]")
  process.exit(0)
}
const boundaries = parseColumnBoundaries(separatorLine)

const routes: Route[] = []
let current: Route | null = null

for (const line of lines) {
  // Skip separator lines and empty lines
  if (line.startsWith("+") || line.trim() === "") continue

  // Must be a data row starting with |
  if (!line.startsWith("|")) continue

  const cells = extractCells(line, boundaries)
  if (cells.length < 5) continue

  const [server, method, uri, action, mw] = cells

  // Skip header row
  if (server === "Server") continue

  if (server !== "") {
    // New route row — server column is populated
    current = {
      server,
      method,
      uri,
      action,
      middleware: mw ? [mw.split("\\").pop() ?? mw] : [],
    }
    routes.push(current)
  } else if (current && mw) {
    // Continuation row — only middleware column has content
    current.middleware.push(mw.split("\\").pop() ?? mw)
  }
}

// Post-process: strip CorsMiddleware (global, not auth-relevant)
for (const route of routes) {
  route.middleware = route.middleware.filter((m) => m !== "CorsMiddleware")
}

// Post-process: split dual-method routes (GET|POST → two entries)
const expanded: Route[] = []
for (const route of routes) {
  if (route.method.includes("|")) {
    for (const m of route.method.split("|")) {
      expanded.push({ ...route, method: m, middleware: [...route.middleware] })
    }
  } else {
    expanded.push(route)
  }
}

console.log(JSON.stringify(expanded, null, 2))
