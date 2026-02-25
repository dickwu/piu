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
# Prerequisites:
#   1. gh CLI authenticated: gh auth login
#   2. Tauri signing keys generated (first time only):
#      bunx @tauri-apps/cli signer generate -w ~/.tauri/piu.key
#   3. Set environment variables (or add to ~/.zshrc):
#      export TAURI_SIGNING_PRIVATE_KEY=$(cat ~/.tauri/piu.key)
#      export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="your-password"
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
command -v bun >/dev/null 2>&1 || err "bun not found. Install: curl -fsSL https://bun.sh/install | bash"

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

# Push commit and tag
git push origin main
git push origin "$TAG"

log "Pushed to remote"

# Build the Tauri app
log "Building Tauri app..."
if [ -n "${TAURI_SIGNING_PRIVATE_KEY:-}" ]; then
  bun run tauri build 2>&1
else
  warn "TAURI_SIGNING_PRIVATE_KEY not set. Building without updater signing."
  bun run tauri build 2>&1
fi

# Find build artifacts
BUNDLE_DIR="src-tauri/target/release/bundle"
ARTIFACTS=()

# macOS .dmg
if [ -f "${BUNDLE_DIR}/dmg/piu_${NEW_VERSION}_aarch64.dmg" ]; then
  ARTIFACTS+=("${BUNDLE_DIR}/dmg/piu_${NEW_VERSION}_aarch64.dmg")
elif [ -f "${BUNDLE_DIR}/dmg/piu_${NEW_VERSION}_x64.dmg" ]; then
  ARTIFACTS+=("${BUNDLE_DIR}/dmg/piu_${NEW_VERSION}_x64.dmg")
fi

# macOS .app.tar.gz (for updater)
for f in "${BUNDLE_DIR}/macos/"*.tar.gz; do
  [ -f "$f" ] && ARTIFACTS+=("$f")
done

# macOS .app.tar.gz.sig (updater signature)
for f in "${BUNDLE_DIR}/macos/"*.tar.gz.sig; do
  [ -f "$f" ] && ARTIFACTS+=("$f")
done

if [ ${#ARTIFACTS[@]} -eq 0 ]; then
  warn "No build artifacts found. Creating release without assets."
fi

# Create GitHub release
log "Creating GitHub release ${TAG}..."

RELEASE_NOTES="## What's Changed

Release ${TAG} of piu - API Management Application.

### Installation
- **macOS**: Download the .dmg file and drag to Applications

### Checksums
"

# Add checksums for artifacts
for artifact in "${ARTIFACTS[@]}"; do
  FILENAME=$(basename "$artifact")
  CHECKSUM=$(shasum -a 256 "$artifact" | cut -d' ' -f1)
  RELEASE_NOTES="${RELEASE_NOTES}
- \`${FILENAME}\`: \`${CHECKSUM}\`"
done

if [ ${#ARTIFACTS[@]} -gt 0 ]; then
  gh release create "$TAG" \
    --title "Release ${TAG}" \
    --notes "$RELEASE_NOTES" \
    "${ARTIFACTS[@]}"
else
  gh release create "$TAG" \
    --title "Release ${TAG}" \
    --notes "$RELEASE_NOTES"
fi

log "Release ${TAG} created successfully!"
log "View at: https://github.com/dickwu/piu/releases/tag/${TAG}"
