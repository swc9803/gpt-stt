#!/usr/bin/env bash
set -euo pipefail

export HERMES_HOME="${HERMES_HOME:-/root/.hermes}"
mkdir -p "$HERMES_HOME"
chmod 700 "$HERMES_HOME"

write_secret_file() {
  local value="$1"
  local target="$2"
  if [[ -n "$value" ]]; then
    printf '%s' "$value" > "$target"
    chmod 600 "$target"
  fi
}

write_secret_file_b64() {
  local value="$1"
  local target="$2"
  if [[ -n "$value" ]]; then
    printf '%s' "$value" | base64 -d > "$target"
    chmod 600 "$target"
  fi
}

# Prefer base64 secrets because auth.json/config.yaml are multi-line JSON/YAML.
# Configure these in Cloud Run from Secret Manager.
write_secret_file_b64 "${HERMES_AUTH_JSON_B64:-}" "$HERMES_HOME/auth.json"
write_secret_file_b64 "${HERMES_CONFIG_YAML_B64:-}" "$HERMES_HOME/config.yaml"

# Plain JSON/YAML env vars also work for local testing.
if [[ ! -f "$HERMES_HOME/auth.json" ]]; then
  write_secret_file "${HERMES_AUTH_JSON:-}" "$HERMES_HOME/auth.json"
fi
if [[ ! -f "$HERMES_HOME/config.yaml" ]]; then
  write_secret_file "${HERMES_CONFIG_YAML:-}" "$HERMES_HOME/config.yaml"
fi

if [[ "${CHAT_PROVIDER:-}" == "hermes-codex" || "${CHAT_PROVIDER:-}" == "codex" ]]; then
  if ! command -v hermes >/dev/null 2>&1; then
    echo "hermes CLI가 컨테이너에 설치되어 있지 않아." >&2
    exit 1
  fi
  if [[ ! -f "$HERMES_HOME/auth.json" ]]; then
    echo "CHAT_PROVIDER=hermes-codex에는 HERMES_AUTH_JSON_B64 또는 HERMES_AUTH_JSON secret이 필요해." >&2
    exit 1
  fi
fi

exec node server.js
