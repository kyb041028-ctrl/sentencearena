#!/usr/bin/env bash
# SentenceArena — NAVER Cloud host: set open-beta ops flags then restart the app.
# Run ON THE PRODUCTION HOST (not Railway). Do not invent IPs in docs; use your known host.
# After restart: curl -s https://sentencearena.com/ready | check the four flags = true
set -euo pipefail

ENV_FILE="${1:-}"
if [[ -z "${ENV_FILE}" ]]; then
  echo "usage: $0 /path/to/app/.env"
  exit 2
fi
if [[ ! -f "${ENV_FILE}" ]]; then
  echo "missing env file: ${ENV_FILE}"
  exit 1
fi

upsert() {
  local key="$1"
  local val="$2"
  if grep -qE "^${key}=" "${ENV_FILE}"; then
    # portable-ish in-place replace
    tmp="$(mktemp)"
    awk -v k="${key}" -v v="${val}" 'BEGIN{FS=OFS="="} $1==k{$0=k"="v} {print}' "${ENV_FILE}" > "${tmp}"
    mv "${tmp}" "${ENV_FILE}"
  else
    printf '\n%s=%s\n' "${key}" "${val}" >> "${ENV_FILE}"
  fi
}

upsert POLITICAL_ALIGNMENT_SCHEDULER_ENABLED true
upsert ALIEN_MODERATION_V1 true
upsert DAILY_ISSUE_MORNING_SCHEDULER_ENABLED 1
upsert DAILY_ISSUE_MORNING_AUTO_PUBLISH 1

echo "updated: ${ENV_FILE}"
echo "next: restart sentencearena node process (systemd/pm2/docker) then verify /ready"
