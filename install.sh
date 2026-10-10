#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

readonly REPOSITORY_URL="https://github.com/Tanveer9830/Discord-music-bot.git"
readonly DEFAULT_INSTALL_REF="arena/9fd50881-discord-music-bot"
INSTALL_REF="${TANVEER_INSTALL_REF:-$DEFAULT_INSTALL_REF}"
NO_PROMPT="${TANVEER_NO_PROMPT:-false}"

on_error() {
  local status=$?
  printf '\n[TANVEER PRIME MUSIC] Installation stopped at line %s (exit %s). No existing .env or data directory was removed.\n' "${BASH_LINENO[0]:-unknown}" "$status" >&2
  exit "$status"
}
trap on_error ERR

fail() {
  printf '[TANVEER PRIME MUSIC] ERROR: %s\n' "$1" >&2
  exit 1
}

info() {
  printf '[TANVEER PRIME MUSIC] %s\n' "$1"
}

show_help() {
  cat <<'HELP'
TANVEER PRIME MUSIC safe installer

Usage:
  bash install.sh

Optional environment variables:
  TANVEER_INSTALL_DIR   Empty destination, or a clean trusted checkout on the expected branch.
  TANVEER_INSTALL_REF   Repository branch to install (defaults to this delivery branch).
  TANVEER_NO_PROMPT     Set to true to disable all interactive/privileged prompts.

The installer preserves .env and data, does not install Lavalink, and requires
Node.js 22.13+ and npm 10+. Review README.md before approving privileged steps.
HELP
}

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  show_help
  exit 0
fi
if [[ $# -gt 0 ]]; then
  fail "Unknown argument '$1'. Use --help to see supported options."
fi

prompt_yes_no() {
  local question="$1"
  local answer=""
  if [[ "$NO_PROMPT" == "true" ]] || ! { [[ -r /dev/tty ]] && ( : </dev/tty ) 2>/dev/null; }; then
    return 1
  fi
  printf '%s [y/N] ' "$question" >/dev/tty
  IFS= read -r answer </dev/tty || return 1
  [[ "$answer" =~ ^[Yy]([Ee][Ss])?$ ]]
}

check_platform() {
  [[ "$(uname -s)" == "Linux" ]] || fail "Only Ubuntu/Debian VPS hosts and Linux Pterodactyl containers are supported."
  local architecture
  architecture="$(uname -m)"
  case "$architecture" in
    x86_64|amd64|aarch64|arm64) ;;
    *) fail "Unsupported architecture '$architecture'. Supported architectures are x86_64 and arm64/aarch64." ;;
  esac

  local os_id="unknown"
  if [[ -r /etc/os-release ]]; then
    # shellcheck disable=SC1091
    . /etc/os-release
    os_id="${ID:-unknown}"
  fi
  if [[ "$os_id" != "ubuntu" && "$os_id" != "debian" && -z "${P_SERVER_UUID:-}${PTERODACTYL:-}" && "$PWD" != "/home/container" ]]; then
    info "Detected Linux distribution '$os_id'; continuing only if Node.js/npm and required system libraries are already available."
  else
    info "Platform: $os_id / $architecture."
  fi
}

install_git_if_permitted() {
  command -v git >/dev/null 2>&1 && return 0
  if ! command -v apt-get >/dev/null 2>&1; then
    fail "Git is missing. Install git using your platform package manager, then rerun this installer."
  fi
  info "Git is required to verify and download the trusted repository. Installing the Ubuntu/Debian git package requires administrator permissions."
  if [[ "$(id -u)" -eq 0 ]] && prompt_yes_no "May the installer use root privileges to install Git and CA certificates with apt?"; then
    apt-get update
    DEBIAN_FRONTEND=noninteractive apt-get install -y git ca-certificates
  elif [[ "$(id -u)" -ne 0 ]] && command -v sudo >/dev/null 2>&1 && prompt_yes_no "May the installer use sudo to install git and CA certificates?"; then
    sudo apt-get update
    sudo env DEBIAN_FRONTEND=noninteractive apt-get install -y git ca-certificates
  else
    fail "Git installation was not approved or sudo is unavailable. Install git yourself and rerun the installer."
  fi
}

check_node() {
  command -v node >/dev/null 2>&1 || fail "Node.js is missing. Install Node.js 22.13 LTS or newer from a trusted package source, then rerun."
  command -v npm >/dev/null 2>&1 || fail "npm is missing. Install npm 10 or newer with Node.js, then rerun."
  local node_version npm_version
  node_version="$(node -p 'process.versions.node')"
  npm_version="$(npm --version)"
  node -e 'const [major,minor]=process.versions.node.split(".").map(Number); if (major < 22 || (major === 22 && minor < 13)) process.exit(1)' \
    || fail "Node.js $node_version is too old. Node.js 22.13 or newer is required."
  npm_version="$npm_version" node -e 'const major=Number(process.env.npm_version.split(".")[0]); if (!Number.isFinite(major) || major < 10) process.exit(1)' \
    || fail "npm $npm_version is too old. npm 10 or newer is required."
  info "Runtime verified: Node.js $node_version and npm $npm_version."
}

verify_ref() {
  [[ "$INSTALL_REF" =~ ^[A-Za-z0-9._/-]+$ ]] || fail "Invalid TANVEER_INSTALL_REF."
  [[ "$INSTALL_REF" != -* && "$INSTALL_REF" != *..* ]] || fail "Invalid TANVEER_INSTALL_REF."
}

choose_install_dir() {
  if [[ -n "${TANVEER_INSTALL_DIR:-}" ]]; then
    printf '%s' "$TANVEER_INSTALL_DIR"
  elif [[ -n "${P_SERVER_UUID:-}${PTERODACTYL:-}" || "$PWD" == "/home/container" ]]; then
    printf '%s' "$PWD"
  else
    printf '%s' "${HOME:?HOME must be set}/tanveer-prime-music"
  fi
}

ensure_repository() {
  local app_dir="$1"
  if [[ -d "$app_dir/.git" ]]; then
    local remote branch dirty
    remote="$(git -C "$app_dir" remote get-url origin 2>/dev/null || true)"
    remote="${remote%.git}"
    [[ "$remote" == "https://github.com/Tanveer9830/Discord-music-bot" ]] \
      || fail "The existing directory has a different Git origin. It was not modified. Set TANVEER_INSTALL_DIR to a new empty directory."
    branch="$(git -C "$app_dir" branch --show-current)"
    [[ "$branch" == "$INSTALL_REF" ]] || fail "Existing checkout is on '$branch', not '$INSTALL_REF'. No branch was switched. Set TANVEER_INSTALL_REF explicitly or use a new directory."
    dirty="$(git -C "$app_dir" status --porcelain --untracked-files=all)"
    [[ -z "$dirty" ]] || fail "Existing checkout has local source changes. No files were modified; back up/commit them or choose another install directory."
    info "Using the existing clean trusted checkout at $app_dir (updates are never pulled blindly by the installer)."
  else
    if [[ -e "$app_dir" ]] && [[ -n "$(find "$app_dir" -mindepth 1 -maxdepth 1 -print -quit 2>/dev/null)" ]]; then
      fail "Install directory '$app_dir' is non-empty and is not this Git repository. It was not modified. Set TANVEER_INSTALL_DIR to an empty directory."
    fi
    mkdir -p "$(dirname "$app_dir")"
    info "Downloading official repository branch '$INSTALL_REF' over HTTPS."
    git clone --depth 1 --branch "$INSTALL_REF" "$REPOSITORY_URL" "$app_dir"
  fi
  local actual_remote
  actual_remote="$(git -C "$app_dir" remote get-url origin)"
  actual_remote="${actual_remote%.git}"
  [[ "$actual_remote" == "https://github.com/Tanveer9830/Discord-music-bot" ]] || fail "Downloaded repository origin did not match the official project."
  git -C "$app_dir" rev-parse --verify HEAD >/dev/null || fail "Downloaded checkout has no verified commit."
}

make_private_dirs() {
  local directory
  for directory in data logs backups; do
    [[ ! -L "$directory" ]] || fail "Refusing to use the symlinked '$directory' path; point it to a real directory explicitly."
    [[ ! -e "$directory" || -d "$directory" ]] || fail "'$directory' exists but is not a directory; it was not modified."
    mkdir -p "$directory"
    chmod 700 "$directory" 2>/dev/null || true
  done
  [[ ! -L .env ]] || fail "Refusing to read or overwrite a symlinked .env file. Store credentials in a regular private .env file."
  [[ ! -e .env || -f .env ]] || fail ".env exists but is not a regular file; it was not modified."
  if [[ ! -e .env ]]; then
    [[ -f .env.example ]] || fail ".env.example is missing from the repository."
    cp -n .env.example .env
    chmod 600 .env 2>/dev/null || true
    info "Created a private .env from .env.example; existing credentials were not overwritten."
  else
    chmod 600 .env 2>/dev/null || true
    info "Existing .env preserved and restricted to the current account where supported."
  fi
}

run_first_setup() {
  if [[ "$NO_PROMPT" == "true" ]]; then
    node scripts/setup.js --non-interactive
    return
  fi
  if [[ -r /dev/tty ]] && ( : </dev/tty ) 2>/dev/null; then
    node scripts/setup.js </dev/tty >/dev/tty
  else
    node scripts/setup.js --non-interactive
  fi
}

read_config_flag() {
  local expression="$1"
  node --input-type=module -e "import {loadConfig} from './src/config/env.js'; const c=loadConfig(); console.log($expression)"
}

configure_docker_identity() {
  local docker_uid docker_gid
  if [[ "$(id -u)" -eq 0 ]]; then
    docker_uid=10001
    docker_gid=10001
    info "Docker's non-root service account may need ownership of files in data/, logs/, and backups/."
    if prompt_yes_no "May the installer recursively change ownership of those three persistent directories to 10001:10001?"; then
      chown -R 10001:10001 data logs backups
    elif find data logs backups -xdev \( ! -user 10001 -o ! -group 10001 \) -print -quit 2>/dev/null | grep -q .; then
      fail "Docker ownership was not approved and existing files are not all owned by 10001:10001. No recursive ownership change was made; set a matching non-root Docker UID/GID or review the data ownership manually."
    fi
  else
    docker_uid="$(id -u)"
    docker_gid="$(id -g)"
  fi
  for key in DOCKER_UID DOCKER_GID; do
    local value="$docker_uid"
    [[ "$key" == "DOCKER_GID" ]] && value="$docker_gid"
    if grep -qE "^[[:space:]]*${key}=" .env; then
      sed -i -E "s|^[[:space:]]*${key}=.*$|${key}=${value}|" .env
    else
      printf '%s=%s\n' "$key" "$value" >>.env
    fi
  done
  chmod 600 .env 2>/dev/null || true
  info "Docker will run as UID:GID ${docker_uid}:${docker_gid} so persistent bind-mounted data remains writable."
}

install_pm2_if_needed() {
  command -v pm2 >/dev/null 2>&1 && return 0
  info "PM2 was selected but is not installed. Installing PM2 globally changes the Node global package directory and may require administrator access."
  if [[ "$(id -u)" -eq 0 ]] && prompt_yes_no "May the installer use root privileges to install PM2 globally?"; then
    npm install --global --no-audit --no-fund pm2@7.0.4
  elif [[ "$(id -u)" -ne 0 ]] && command -v sudo >/dev/null 2>&1 && prompt_yes_no "May the installer use sudo to install PM2 globally?"; then
    sudo npm install --global --no-audit --no-fund pm2@7.0.4
  else
    info "PM2 was not installed. Project files are ready; install PM2 with 'npm install -g pm2' or choose DEPLOYMENT_MODE=node."
    return 1
  fi
}

start_selected_runtime() {
  local mode="discord_missing"
  mode="$(read_config_flag 'c.deployment')"
  local discord_ready lavalink_ready
  discord_ready="$(read_config_flag 'Boolean(c.token && c.clientId)')"
  lavalink_ready="$(read_config_flag 'c.nodes.length > 0')"
  if [[ "$discord_ready" != "true" || "$lavalink_ready" != "true" ]]; then
    info "Runtime not started because required Discord or Lavalink credentials are incomplete. Finish .env configuration, then use the startup command shown below."
    return 0
  fi

  case "$mode" in
    pm2)
      if install_pm2_if_needed; then
        pm2 startOrRestart ecosystem.config.cjs --update-env
        pm2 save
        info "PM2 started TANVEER PRIME MUSIC. Check status with 'pm2 status' and logs with 'pm2 logs tanveer-prime-music'."
      fi
      ;;
    docker)
      command -v docker >/dev/null 2>&1 || { info "Docker is not installed. Install Docker Engine and the Compose plugin, then run 'docker compose up -d --build'."; return 0; }
      docker compose version >/dev/null 2>&1 || { info "Docker Compose v2 is required. Install the Docker Compose plugin, then run 'docker compose up -d --build'."; return 0; }
      configure_docker_identity
      docker compose config --quiet
      docker compose up -d --build
      info "Docker Compose started the bot. No ports are published; Lavalink must be reachable from this container."
      ;;
    pterodactyl)
      info "Pterodactyl controls startup and restart. Configure the server startup command as 'npm start'; do not use systemd inside the container."
      ;;
    systemd)
      install -d -m 700 "$HOME/.config/systemd/user"
      if [[ -e "$HOME/.config/systemd/user/tanveer-prime-music.service" ]]; then
        info "Existing user systemd unit was preserved; inspect it and run 'systemctl --user restart tanveer-prime-music.service' manually if appropriate."
        return 0
      fi
      cat >"$HOME/.config/systemd/user/tanveer-prime-music.service" <<SERVICE
[Unit]
Description=TANVEER PRIME MUSIC Discord bot
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=$PWD
ExecStart=$(command -v node) src/index.js
Restart=on-failure
RestartSec=5
Environment=NODE_ENV=production
Environment=DEPLOYMENT_MODE=systemd
NoNewPrivileges=true

[Install]
WantedBy=default.target
SERVICE
      if systemctl --user daemon-reload && systemctl --user enable --now tanveer-prime-music.service; then
        info "User systemd service enabled. Check with 'systemctl --user status tanveer-prime-music.service'."
      else
        info "User systemd is unavailable in this shell. The unit is saved under ~/.config/systemd/user; run 'systemctl --user enable --now tanveer-prime-music.service' from a user session."
      fi
      ;;
    node|*)
      info "Foreground Node.js selected. Start with 'npm start' in this project directory."
      ;;
  esac
}

print_completion() {
  printf '\n╔══════════════════════════════════════════════════════════════════════╗\n'
  printf '║                    TANVEER PRIME MUSIC                              ║\n'
  printf '║                       Made by Tanveer                                ║\n'
  printf '║                     Discord: Tanveer5637                             ║\n'
  printf '╚══════════════════════════════════════════════════════════════════════╝\n\n'
  printf 'Project: %s\n' "$PWD"
  printf 'Configuration: %s/.env (private; never upload it)\n' "$PWD"
  printf 'Database: %s/data/music.sqlite (persistent; excluded from Git)\n' "$PWD"
  printf 'Startup: cd %q && npm start\n' "$PWD"
  printf 'Diagnostics: cd %q && npm run diagnostics\n' "$PWD"
  printf 'Commands: cd %q && npm run commands:deploy\n' "$PWD"
  printf '\nUse the repository README for Discord invite scopes, Lavalink networking, Docker, PM2, and Pterodactyl setup.\n'
}

main() {
  check_platform
  install_git_if_permitted
  check_node
  verify_ref
  local app_dir
  app_dir="$(choose_install_dir)"
  ensure_repository "$app_dir"
  cd "$app_dir"
  make_private_dirs

  info "Installing locked production dependencies."
  npm ci --ignore-scripts --omit=dev --no-audit --no-fund
  run_first_setup
  node scripts/db-init.js
  node scripts/check.js
  node scripts/diagnostics.js --config-only --allow-missing

  local discord_ready
  discord_ready="$(read_config_flag 'Boolean(c.token && c.clientId)')"
  if [[ "$discord_ready" == "true" ]]; then
    info "Registering Discord slash commands using the configured Discord credentials."
    npm run commands:deploy
  else
    info "Slash command registration skipped: set DISCORD_TOKEN and DISCORD_CLIENT_ID in the private .env, then run 'npm run commands:deploy'."
  fi

  start_selected_runtime
  print_completion
}

main "$@"
