#!/usr/bin/env bash
# Forced command for the GitHub Actions deploy key, installed by hand as
#   /usr/local/sbin/issuematcher-deploy-gate  (root:root, 755)
# and referenced from /root/.ssh/authorized_keys:
#   restrict,command="/usr/local/sbin/issuematcher-deploy-gate" ssh-ed25519 AAAA... github-actions-deploy
#
# The key can do exactly one thing: `ssh root@host deploy <40-hex commit sha>`.
# Deploy files are fetched from the public repo at that commit (not uploaded by the
# client), then deploy.sh runs. Anything else is refused. CI never overwrites this file.
set -euo pipefail

REPO="yeonjaekim-039/Github-issue-matcher"
DIR=/opt/issuematcher
FILES=(docker-compose.prod.yml deploy.sh .env.production.example issuematcher-ingest.service issuematcher-ingest.timer)

cmd="${SSH_ORIGINAL_COMMAND:-}"
if [[ ! "$cmd" =~ ^deploy\ ([0-9a-f]{40})$ ]]; then
  logger -t issuematcher-deploy "refused command: ${cmd:0:120}"
  echo "refused: only 'deploy <40-char commit sha>' is allowed" >&2
  exit 1
fi
sha="${BASH_REMATCH[1]}"
logger -t issuematcher-deploy "deploy $sha requested"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
for f in "${FILES[@]}"; do
  curl -fsSL --retry 3 --max-time 30 \
    "https://raw.githubusercontent.com/$REPO/$sha/deploy/$f" -o "$tmp/$f"
done

for f in "${FILES[@]}"; do
  mode=644; [[ "$f" == deploy.sh ]] && mode=755
  install -m "$mode" -o root -g root "$tmp/$f" "$DIR/$f"
done

exec "$DIR/deploy.sh" "$sha"
