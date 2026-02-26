---
name: piu-release
description: >
  Publish a new release of the PIU desktop API client and monitor CI.
  Use when the user asks to "publish a release", "cut a release", "bump the version",
  "release a new version", "check ci" after changes are committed, or
  "write release notes" / "publish release notes".
  Handles pre-flight checks, version bumping, git tagging, pushing, CI monitoring,
  and generating release notes from git diff using the project's publish.sh script
  and the gh CLI. Also updates README.md when release includes user-facing changes
  (new features, platform changes, design overhauls).
---

# PIU Release Workflow

The project has a `./publish.sh` script that handles the full release pipeline:
1. `cargo fmt` + `cargo clippy` quality gates
2. Auto-increments patch version (or accepts explicit version)
3. Updates `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`, `package.json`
4. Commits, creates annotated tag, pushes → triggers GitHub Actions

## Post-Release: Update README if Needed

After a release that includes user-facing changes (new features, platform additions,
design overhauls), check if `README.md` needs updating:

- **Installation table** — must list all platforms built by CI (macOS arm64, macOS x64,
  Linux deb/rpm, Windows msi/exe). Cross-check against `.github/workflows/release.yml`.
- **Tech stack table** — verify framework versions match `package.json` and `Cargo.toml`.
- **Features list** — add entries for new user-facing features.
- **Project structure** — update if new directories or key files were added.

Commit README changes separately: `docs: update README for v<version>`.

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

## Release Notes

After CI succeeds, generate release notes and publish them to the GitHub release.
The Release workflow creates a **draft** release with artifacts — this step adds
notes and marks it as published.

### Generating Notes from Git Diff

```bash
# Find the previous release tag
git tag --sort=-v:refname | head -2

# Commits since last release (use for the changelog summary)
git log --oneline <prev-tag>..<new-tag> --no-merges

# File-level change stats (exclude version-bump-only files)
git diff --stat <prev-tag>..<new-tag> -- ':!src-tauri/Cargo.lock' ':!src-tauri/Cargo.toml' ':!src-tauri/tauri.conf.json' ':!package.json'
```

### Writing Notes

Categorize commits using conventional-commit types:
- **feat:** → "New Features"
- **fix:** → "Bug Fixes"
- **refactor/perf:** → "Improvements"
- **chore/ci/docs:** → "Maintenance"

Template:

```markdown
## What's Changed

### New Features
- <description from feat commits>

### Bug Fixes
- <description from fix commits>

### Improvements / Maintenance
- <description from chore/refactor commits>

**Full Changelog**: https://github.com/dickwu/piu/compare/v<prev>...v<new>
```

Omit empty sections. Keep bullet points concise (one line each).

### Publishing

```bash
gh release edit v<version> --draft=false --notes "<notes>"
```

Use a HEREDOC for multi-line notes:

```bash
gh release edit v<version> --draft=false --notes "$(cat <<'EOF'
## What's Changed
...
**Full Changelog**: https://github.com/dickwu/piu/compare/v<prev>...v<new>
EOF
)"
```
