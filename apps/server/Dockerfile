# syntax=docker/dockerfile:1

FROM node:24.18.1-bookworm-slim AS dependencies

WORKDIR /workspace

COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/package.json
COPY packages/api/package.json packages/api/package.json

RUN npm ci --workspace @hotel-butler/server --workspace @hotel-butler/api

FROM dependencies AS build

COPY apps/server apps/server
COPY packages/api packages/api

RUN DATABASE_URL=postgres://build:build@localhost/build \
    RMS_DATABASE_URL=mysql://build:build@localhost/build \
    ORIGIN=https://localhost:4173 \
    BETTER_AUTH_SECRET=build-only-placeholder-not-a-secret \
    npm run build --workspace @hotel-butler/server

FROM build AS local-runtime

ENV NODE_ENV=production
EXPOSE 4173

CMD ["npm", "run", "preview:container", "--workspace", "@hotel-butler/server"]

FROM node:24.18.1-bookworm-slim AS production

WORKDIR /workspace

COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/package.json
COPY packages/api/package.json packages/api/package.json

RUN npm ci --omit=dev --workspace @hotel-butler/server --workspace @hotel-butler/api

COPY --from=build --chown=node:node /workspace/apps/server/build apps/server/build
COPY --from=build --chown=node:node /workspace/apps/server/drizzle apps/server/drizzle
COPY --from=build --chown=node:node /workspace/apps/server/scripts/initialize-database.ts apps/server/scripts/initialize-database.ts
COPY --chown=node:node apps/server/scripts/start-production-https.mjs apps/server/scripts/start-production-https.mjs
COPY --from=build --chown=node:node /workspace/apps/server/src/lib/server/db/auth.schema.ts apps/server/src/lib/server/db/auth.schema.ts
COPY --from=build --chown=node:node /workspace/packages/api packages/api
COPY --chown=node:node apps/server/tests/compose/server-healthcheck.mjs apps/server/tests/compose/server-healthcheck.mjs

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3443
EXPOSE 3443

USER node

CMD ["node", "apps/server/scripts/start-production-https.mjs"]
