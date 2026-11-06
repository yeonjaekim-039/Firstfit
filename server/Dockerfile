# API + ingest image. Build context: server/
#   docker build -t issuematcher-server server/

FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

FROM node:24-alpine AS runtime
LABEL app=issuematcher
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY migrations ./migrations
USER node
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3001/api/health || exit 1
# Apply pending migrations, then serve. Ingest runs in a one-off container from the same image:
#   node dist/ingest/run.js
CMD ["sh", "-c", "node dist/db/migrate.js && exec node dist/index.js"]
