#!/bin/bash
set -euo pipefail

# =============================================================================
# piu - Release Publisher
# =============================================================================
#
# Usage:
#   ./publish.sh              # Auto-increment patch version and release
#   ./publish.sh 0.2.0        # Release specific version
#
# The build and GitHub release are handled entirely by GitHub Actions.
# Pushing the version tag triggers .github/workflows/release.yml which:
#   - Builds cross-platform (macOS arm64/x64, Linux, Windows)
#   - Signs artifacts with TAURI_SIGNING_PRIVATE_KEY secret
#   - Creates the GitHub release with all artifacts + latest.json for updater
#
# Prerequisites:
#   1. gh CLI authenticated: gh auth login
#
# =============================================================================

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log() { echo -e "${GREEN}[publish]${NC} $1"; }
warn() { echo -e "${YELLOW}[warn]${NC} $1"; }
err() { echo -e "${RED}[error]${NC} $1" >&2; exit 1; }

# Verify prerequisites
command -v gh >/dev/null 2>&1 || err "gh CLI not found. Install: brew install gh"
command -v cargo >/dev/null 2>&1 || err "cargo not found. Install: https://rustup.rs"

# =============================================================================
# Quality checks (run before anything is committed or bumped)
# =============================================================================

log "Running cargo fmt..."
(cd src-tauri && cargo fmt)
log "cargo fmt applied"

log "Running cargo clippy --all-targets --all-features..."
(cd src-tauri && cargo clippy --all-targets --all-features -- -D warnings) \
  || err "cargo clippy failed. Fix warnings before publishing."
log "clippy passed"

# =============================================================================

# Ensure clean working directory (fmt may have dirtied files — auto-stage them)
if [ -n "$(git status --porcelain)" ]; then
  warn "cargo fmt produced changes — staging and committing them now."
  git add src-tauri/src
  git commit -m "chore: apply cargo fmt"
fi

# Get current version from Cargo.toml
CURRENT_VERSION=$(grep '^version' src-tauri/Cargo.toml | head -1 | sed 's/.*"\(.*\)".*/\1/')
log "Current version: ${CURRENT_VERSION}"

# Determine new version
if [ -n "${1:-}" ]; then
  NEW_VERSION="$1"
else
  # Auto-increment patch version
  IFS='.' read -r MAJOR MINOR PATCH <<< "$CURRENT_VERSION"
  PATCH=$((PATCH + 1))
  NEW_VERSION="${MAJOR}.${MINOR}.${PATCH}"
fi

log "New version: ${NEW_VERSION}"

# Update version in all config files
log "Updating version numbers..."

# Cargo.toml
sed -i '' "s/^version = \"${CURRENT_VERSION}\"/version = \"${NEW_VERSION}\"/" src-tauri/Cargo.toml

# tauri.conf.json
sed -i '' "s/\"version\": \"${CURRENT_VERSION}\"/\"version\": \"${NEW_VERSION}\"/" src-tauri/tauri.conf.json

# package.json
sed -i '' "s/\"version\": \"${CURRENT_VERSION}\"/\"version\": \"${NEW_VERSION}\"/" package.json

# Update Cargo.lock
(cd src-tauri && cargo update -p piu 2>/dev/null || true)

# Commit version bump
git add -A
git commit -m "chore: bump version to ${NEW_VERSION}"

# Create git tag
TAG="v${NEW_VERSION}"
git tag -a "$TAG" -m "Release ${TAG}"

log "Tagged ${TAG}"

# Push commit and tag — this triggers GitHub Actions release workflow
git push origin main
git push origin "$TAG"

log "Pushed to remote"
log "GitHub Actions will build and publish the release."
log "Track progress: https://github.com/dickwu/piu/actions"
log "Release will appear at: https://github.com/dickwu/piu/releases/tag/${TAG}"
