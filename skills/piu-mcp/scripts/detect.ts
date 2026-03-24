#!/usr/bin/env bun
/**
 * Framework detector — identifies backend framework, port, and router files.
 * Usage: bun detect.ts /path/to/repo
 * Output: JSON {"framework":"express","port":3000,"router_files":["routes/api.js"]}
 */

import { existsSync } from "fs"
import { join, relative } from "path"

const repo = Bun.argv[2] ?? "."

interface DetectResult {
  framework: string
  port: number
  router_files: string[]
}

async function has(path: string, pattern: string): Promise<boolean> {
  try {
    return (await Bun.file(path).text()).includes(pattern)
  } catch {
    return false
  }
}

async function hasRegex(path: string, pattern: RegExp): Promise<boolean> {
  try {
    return pattern.test(await Bun.file(path).text())
  } catch {
    return false
  }
}

async function glob(pattern: string, cwd: string): Promise<string[]> {
  const g = new Bun.Glob(pattern)
  const results: string[] = []
  for await (const path of g.scan({ cwd, absolute: true })) results.push(path)
  return results.sort()
}

async function grepFiles(files: string[], pattern: RegExp): Promise<string[]> {
  const out: string[] = []
  for (const f of files) {
    try {
      if (pattern.test(await Bun.file(f).text())) out.push(f)
    } catch { /* skip unreadable */ }
  }
  return out
}

async function detect(): Promise<DetectResult> {
  // ── PHP ──
  const composer = join(repo, "composer.json")
  if (existsSync(composer)) {
    if (await has(composer, '"hyperf/framework"')) {
      const files = await glob("config/routers/*.php", repo)
      const routes = join(repo, "config/routes.php")
      if (existsSync(routes)) files.unshift(routes)
      return { framework: "hyperf", port: 9501, router_files: files }
    }
    if (await has(composer, '"laravel/framework"'))
      return { framework: "laravel", port: 8000, router_files: await glob("routes/*.php", repo) }
  }

  // ── Node.js ──
  const pkg = join(repo, "package.json")
  if (existsSync(pkg)) {
    const content = await Bun.file(pkg).text()
    if (content.includes('"@nestjs/core"'))
      return { framework: "nestjs", port: 3000, router_files: await glob("src/**/*.controller.{ts,js}", repo) }
    if (content.includes('"hono"')) {
      const all = await glob("src/**/*.{ts,js}", repo)
      return { framework: "hono", port: 3000, router_files: all.filter((f) => /route|api|app/i.test(f)) }
    }
    if (content.includes('"fastify"'))
      return { framework: "fastify", port: 3000, router_files: [...(await glob("src/**/*.{ts,js}", repo)), ...(await glob("routes/**/*.{ts,js}", repo))] }
    if (content.includes('"express"')) {
      const all = (await glob("**/*.{ts,js}", repo)).filter((f) => !f.includes("node_modules"))
      return { framework: "express", port: 3000, router_files: await grepFiles(all, /Router\(\)|app\.get|app\.post/) }
    }
  }

  // ── Python ──
  for (const dep of ["requirements.txt", "pyproject.toml", "setup.py"]) {
    const p = join(repo, dep)
    if (!existsSync(p)) continue
    if (await hasRegex(p, /fastapi/i)) {
      const py = (await glob("**/*.py", repo)).filter((f) => !f.includes("venv"))
      return { framework: "fastapi", port: 8000, router_files: await grepFiles(py, /@.*\.(get|post|put|delete|patch)/) }
    }
    if (await hasRegex(p, /django/i))
      return { framework: "django", port: 8000, router_files: await glob("**/urls.py", repo) }
    if (await hasRegex(p, /flask/i)) {
      const py = (await glob("**/*.py", repo)).filter((f) => !f.includes("venv"))
      return { framework: "flask", port: 5000, router_files: await grepFiles(py, /@.*\.route/) }
    }
  }

  // ── Go ──
  const goMod = join(repo, "go.mod")
  if (existsSync(goMod)) {
    const content = await Bun.file(goMod).text()
    let fw = ""
    if (content.includes("gin-gonic/gin")) fw = "gin"
    else if (content.includes("labstack/echo")) fw = "echo"
    else if (content.includes("gofiber/fiber")) fw = "fiber"
    if (fw) {
      const go = (await glob("**/*.go", repo)).filter((f) => !f.includes("vendor"))
      return { framework: fw, port: 8080, router_files: await grepFiles(go, /\.GET|\.POST|\.Group/) }
    }
  }

  // ── Rust ──
  const cargo = join(repo, "Cargo.toml")
  if (existsSync(cargo)) {
    const content = await Bun.file(cargo).text()
    let fw = ""
    if (content.includes("axum")) fw = "axum"
    else if (content.includes("actix-web")) fw = "actix"
    if (fw)
      return { framework: fw, port: 8080, router_files: await grepFiles(await glob("src/**/*.rs", repo), /route|Router/) }
  }

  // ── Ruby ──
  const gemfile = join(repo, "Gemfile")
  if (existsSync(gemfile)) {
    const content = await Bun.file(gemfile).text()
    if (content.includes("'rails'") || content.includes('"rails"')) {
      const routes = join(repo, "config/routes.rb")
      return { framework: "rails", port: 3000, router_files: existsSync(routes) ? [routes] : [] }
    }
  }

  // ── Java/Kotlin ──
  for (const bf of ["pom.xml", "build.gradle", "build.gradle.kts"]) {
    const p = join(repo, bf)
    if (existsSync(p) && (await has(p, "spring-boot-starter-web"))) {
      const src = await glob("src/**/*.{java,kt}", repo)
      return { framework: "spring", port: 8080, router_files: await grepFiles(src, /@RequestMapping|@RestController|@GetMapping/) }
    }
  }

  return { framework: "unknown", port: 8080, router_files: [] }
}

const result = await detect()
result.router_files = result.router_files.map((f) => {
  try {
    return relative(repo, f)
  } catch {
    return f
  }
})
console.log(JSON.stringify(result))
