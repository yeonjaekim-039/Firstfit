# Caddy serving the built client and proxying /api to the server. Build context: repo root
#   docker build -f deploy/web.Dockerfile -t issuematcher-web .

FROM node:24-alpine AS build
WORKDIR /client
COPY client/package.json client/package-lock.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

FROM caddy:2-alpine
LABEL app=issuematcher
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /client/dist /srv
