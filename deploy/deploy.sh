#!/usr/bin/env bash
# Runs on the server (invoked by GitHub Actions over SSH):  deploy.sh <image-tag>
# Pulls the given image tag, restarts only the issuematcher project, and waits for health.
set -euo pipefail

TAG="${1:?usage: deploy.sh <image-tag>}"
DIR=/opt/issuematcher
cd "$DIR"

[[ -f .env ]] || { echo "Missing $DIR/.env (create it by hand from .env.production.example)" >&2; exit 1; }

compose() { docker compose --env-file .env --env-file image.env -f docker-compose.prod.yml "$@"; }

PREV="$(sed -n 's/^IMAGE_TAG=//p' image.env 2>/dev/null || true)"
echo "IMAGE_TAG=$TAG" > image.env.new

# Pull first, so a bad tag fails before anything is restarted.
docker compose --env-file .env --env-file image.env.new -f docker-compose.prod.yml pull server web
mv image.env.new image.env

compose up -d --remove-orphans

echo "Waiting for the API to become healthy..."
for _ in $(seq 1 30); do
  if compose exec -T server wget -qO- http://127.0.0.1:3001/api/health >/dev/null 2>&1; then
    echo "Deployed $TAG (previous: ${PREV:-none})."
    # Remove superseded images of THIS app only (label set in its Dockerfiles).
    docker image prune -f --filter label=app=issuematcher >/dev/null
    exit 0
  fi
  sleep 2
done

echo "API did not become healthy; recent server logs:" >&2
compose logs --tail=50 server >&2
if [[ -n "$PREV" && "$PREV" != "$TAG" ]]; then
  echo "Rolling back to $PREV" >&2
  echo "IMAGE_TAG=$PREV" > image.env
  compose up -d
fi
exit 1
