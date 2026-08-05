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

FROM build AS runtime

ENV NODE_ENV=production
EXPOSE 4173

CMD ["npm", "run", "preview:container", "--workspace", "@hotel-butler/server"]
