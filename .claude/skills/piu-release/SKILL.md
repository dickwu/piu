---
name: piu-release
description: >
  Publish a new release of the PIU desktop API client and monitor CI.
  Use when the user asks to "publish a release", "cut a release", "bump the version",
  "release a new version", or "check ci" after changes are committed.
  Handles pre-flight checks, version bumping, git tagging, pushing, and CI monitoring
  using the project's publish.sh script and the gh CLI.
---

# PIU Release Workflow

The project has a `./publish.sh` script that handles the full release pipeline:
1. `cargo fmt` + `cargo clippy` quality gates
2. Auto-increments patch version (or accepts explicit version)
3. Updates `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`, `package.json`
4. Commits, creates annotated tag, pushes → triggers GitHub Actions

## Pre-flight: Ensure Clean Working Tree

`publish.sh` only auto-commits Rust source changes from `cargo fmt`. Any other
uncommitted changes must be committed **before** running the script, otherwise
the version-bump commit will silently include unrelated changes.

```bash
git status --short
```

If there are uncommitted changes, commit them first with an appropriate conventional
commit message, then proceed.

## Running the Release

```bash
# Auto-increment patch (e.g. 0.1.4 → 0.1.5)
./publish.sh

# Explicit version
./publish.sh 0.2.0
```

The script exits non-zero on clippy failures — surface the error to the user before
retrying.

## Checking CI After Push

After the script exits successfully, immediately check CI:

```bash
gh run list --limit 5
```

Two workflows trigger per release:
- **CI** (branch push on `main`) — cross-platform build validation
- **Release** (tag push `v*`) — builds + signs artifacts + publishes GitHub release

### Monitoring

```bash
# Watch a specific run to completion (blocks until done)
gh run watch <run-id> --exit-status

# Quick status poll (useful for long builds — poll every ~2 min)
gh run list --limit 4
```

Tauri cross-platform builds typically take **7–15 minutes**.

### Reporting Status

When both runs reach `completed success`, report:
- CI run: status + duration
- Release run: status + duration
- Release URL: `https://github.com/dickwu/piu/releases/tag/v<version>`
