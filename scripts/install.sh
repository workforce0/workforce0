#!/usr/bin/env bash
# =============================================================================
# Workforce0 one-line installer
# =============================================================================
#
# curl -fsSL https://raw.githubusercontent.com/workforce0/workforce0/main/scripts/install.sh | bash
#
# Detects the platform (macOS / Linux / WSL2), verifies Docker is installed,
# clones (or updates) the repo to $WORKFORCE0_HOME, prompts interactively
# for the minimum required secrets, writes them to .env, and boots the
# full stack with docker compose.
#
# Platform structure + /dev/tty prompt pattern borrowed (algorithm only)
# from NousResearch/hermes-agent scripts/install.sh. No Python assumptions.
# =============================================================================

set -euo pipefail

# Colors (no-op when stdout is not a TTY, e.g. via curl | bash > file)
if [ -t 1 ]; then
  RED='\033[0;31m'
  GREEN='\033[0;32m'
  YELLOW='\033[0;33m'
  BLUE='\033[0;34m'
  BOLD='\033[1m'
  NC='\033[0m'
else
  RED=''; GREEN=''; YELLOW=''; BLUE=''; BOLD=''; NC=''
fi

log_info()    { printf '%s\n' "${BLUE}${BOLD}→${NC} $*"; }
log_success() { printf '%s\n' "${GREEN}${BOLD}✓${NC} $*"; }
log_warn()    { printf '%s\n' "${YELLOW}${BOLD}!${NC} $*"; }
log_error()   { printf '%s\n' "${RED}${BOLD}✗${NC} $*" >&2; }

# -----------------------------------------------------------------------------
# Config
# -----------------------------------------------------------------------------
WORKFORCE0_HOME="${WORKFORCE0_HOME:-$HOME/.workforce0}"
REPO_URL="${WORKFORCE0_REPO_URL:-https://github.com/workforce0/workforce0.git}"
REPO_BRANCH="${WORKFORCE0_BRANCH:-main}"
REPO_DIR="$WORKFORCE0_HOME/src"

# When invoked via `curl | bash`, stdin is not a TTY. We read prompts from
# /dev/tty so the user can still answer. (Borrowed from Hermes install.sh.)
if [ -e /dev/tty ]; then
  IS_INTERACTIVE=true
  exec 3</dev/tty
else
  IS_INTERACTIVE=false
fi

# -----------------------------------------------------------------------------
# Helpers
# -----------------------------------------------------------------------------
prompt() {
  # $1 = prompt, $2 = default value (optional), echoes the answer
  local msg="$1"
  local default="${2:-}"
  local reply
  if [ "$IS_INTERACTIVE" = false ]; then
    printf '%s' "$default"
    return 0
  fi
  if [ -n "$default" ]; then
    printf '%s [%s]: ' "$msg" "$default" >/dev/tty
  else
    printf '%s: ' "$msg" >/dev/tty
  fi
  IFS= read -r reply <&3 || reply=""
  if [ -z "$reply" ] && [ -n "$default" ]; then
    reply="$default"
  fi
  printf '%s' "$reply"
}

prompt_secret() {
  # $1 = prompt. Prints nothing by default; value is echoed on stdout.
  local msg="$1"
  local reply
  if [ "$IS_INTERACTIVE" = false ]; then
    return 0
  fi
  printf '%s (hidden): ' "$msg" >/dev/tty
  # shellcheck disable=SC2162
  stty -echo < /dev/tty || true
  IFS= read -r reply <&3 || reply=""
  stty echo < /dev/tty || true
  printf '\n' >/dev/tty
  printf '%s' "$reply"
}

generate_secret() {
  # 32-byte base64 secret. OpenSSL is present on every macOS + Linux.
  openssl rand -base64 32 2>/dev/null | tr -d '\n='
}

# -----------------------------------------------------------------------------
# 1. Platform detection
# -----------------------------------------------------------------------------
detect_os() {
  case "$(uname -s)" in
    Darwin*)  OS="macos" ;;
    Linux*)
      if grep -qi microsoft /proc/version 2>/dev/null; then
        OS="wsl2"
      else
        OS="linux"
      fi
      ;;
    CYGWIN*|MINGW*|MSYS*)
      log_error "Native Windows is not supported. Use WSL2 and re-run this installer inside it."
      exit 1
      ;;
    *)
      log_error "Unknown operating system: $(uname -s)"
      exit 1
      ;;
  esac
  log_info "Detected platform: $OS"
}

# -----------------------------------------------------------------------------
# 2. Dependency checks
# -----------------------------------------------------------------------------
check_dependencies() {
  local missing=()
  for cmd in git docker openssl; do
    if ! command -v "$cmd" >/dev/null 2>&1; then
      missing+=("$cmd")
    fi
  done

  if ! docker compose version >/dev/null 2>&1; then
    log_error "Docker Compose v2 not found. Install Docker Desktop or the compose plugin and re-run."
    exit 1
  fi

  if [ ${#missing[@]} -gt 0 ]; then
    log_error "Missing required tools: ${missing[*]}"
    log_info "macOS:  brew install ${missing[*]}"
    log_info "Linux:  apt-get install ${missing[*]} (or your distro's equivalent)"
    log_info "Docker: https://docs.docker.com/get-docker/"
    exit 1
  fi

  log_success "All dependencies present"
}

# -----------------------------------------------------------------------------
# 3. Clone or update repo
# -----------------------------------------------------------------------------
clone_repo() {
  mkdir -p "$WORKFORCE0_HOME"
  if [ -d "$REPO_DIR/.git" ]; then
    log_info "Repo already present at $REPO_DIR — pulling latest"
    git -C "$REPO_DIR" fetch --quiet origin "$REPO_BRANCH"
    git -C "$REPO_DIR" checkout --quiet "$REPO_BRANCH"
    git -C "$REPO_DIR" pull --quiet --ff-only origin "$REPO_BRANCH"
  else
    log_info "Cloning $REPO_URL@$REPO_BRANCH → $REPO_DIR"
    git clone --quiet --branch "$REPO_BRANCH" --depth 1 "$REPO_URL" "$REPO_DIR"
  fi
  log_success "Repo ready"
}

# -----------------------------------------------------------------------------
# 4. Configure .env — interactive wizard when stdin supports it
# -----------------------------------------------------------------------------
configure_env() {
  local env_file="$REPO_DIR/.env"
  if [ -f "$env_file" ]; then
    log_info ".env already exists — skipping interactive setup"
    return 0
  fi

  cp "$REPO_DIR/.env.example" "$env_file"

  if [ "$IS_INTERACTIVE" = false ]; then
    # Auto-fill required secrets; user can edit later.
    local jwt
    jwt="$(generate_secret)"
    local pg
    pg="$(generate_secret)"
    sed -i.bak "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$pg|" "$env_file"
    sed -i.bak "s|^JWT_SECRET=.*|JWT_SECRET=$jwt|" "$env_file"
    rm -f "${env_file}.bak"
    log_warn "Non-interactive install — .env filled with defaults + generated secrets"
    log_warn "You still need to set GEMINI_API_KEY in $env_file before the app can serve briefs"
    return 0
  fi

  printf '\n' >/dev/tty
  printf '%s\n' "${BOLD}Setup wizard${NC} — three values to set, then we boot." >/dev/tty
  printf '\n' >/dev/tty

  local gemini
  gemini="$(prompt_secret 'Your Gemini API key (free: https://aistudio.google.com/app/apikey)')"

  local public_url
  public_url="$(prompt 'Public URL for the app' 'http://localhost:3001')"

  local jwt
  jwt="$(generate_secret)"
  local pg
  pg="$(generate_secret)"

  sed -i.bak "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$pg|" "$env_file"
  sed -i.bak "s|^JWT_SECRET=.*|JWT_SECRET=$jwt|" "$env_file"
  sed -i.bak "s|^GEMINI_API_KEY=.*|GEMINI_API_KEY=$gemini|" "$env_file"
  sed -i.bak "s|^PUBLIC_URL=.*|PUBLIC_URL=$public_url|" "$env_file"
  rm -f "${env_file}.bak"

  log_success ".env written to $env_file"
}

# -----------------------------------------------------------------------------
# 5. Boot
# -----------------------------------------------------------------------------
boot() {
  log_info "Starting Workforce0 stack with docker compose (this can take a few minutes on first run)…"
  (cd "$REPO_DIR" && docker compose -f docker-compose.prod.yml up -d)
}

# -----------------------------------------------------------------------------
# 6. Success banner
# -----------------------------------------------------------------------------
open_browser() {
  local url
  url="$(grep -E '^PUBLIC_URL=' "$REPO_DIR/.env" | cut -d= -f2-)"
  url="${url:-http://localhost:3001}"

  case "$OS" in
    macos) command -v open >/dev/null 2>&1 && open "$url" || true ;;
    linux|wsl2) command -v xdg-open >/dev/null 2>&1 && xdg-open "$url" >/dev/null 2>&1 || true ;;
  esac
}

print_success() {
  local url
  url="$(grep -E '^PUBLIC_URL=' "$REPO_DIR/.env" | cut -d= -f2-)"
  url="${url:-http://localhost:3001}"

  printf '\n' >/dev/tty 2>/dev/null || true
  log_success "Workforce0 is booting."
  printf '\n' >/dev/tty 2>/dev/null || true
  printf '  %s\n' "Open:   ${BOLD}$url${NC}"
  printf '  %s\n' "Logs:   docker compose -f $REPO_DIR/docker-compose.prod.yml logs -f"
  printf '  %s\n' "Stop:   docker compose -f $REPO_DIR/docker-compose.prod.yml down"
  printf '  %s\n' "Docs:   $REPO_DIR/docs/quickstart.md"
  printf '\n' >/dev/tty 2>/dev/null || true
  log_info "First-run wizard will walk you through workspace + integrations."
}

# -----------------------------------------------------------------------------
main() {
  printf '%s\n' "${BOLD}Workforce0 installer${NC}"
  printf '%s\n' "The open-source AI workforce. Self-hosted, BYOK."
  printf '\n'

  detect_os
  check_dependencies
  clone_repo
  configure_env
  boot
  open_browser
  print_success
}

main "$@"
