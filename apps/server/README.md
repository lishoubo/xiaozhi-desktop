# sv

Everything you need to build a Svelte project, powered by [`sv`](https://github.com/sveltejs/cli).

## Creating a project

If you're seeing this, you've probably already done this step. Congrats!

```sh
# create a new project
npx sv create my-app
```

To recreate this project with the same configuration:

```sh
# recreate this project
npx sv@0.17.0 create --template minimal --types ts --add prettier eslint vitest="usages:unit,component" playwright tailwindcss="plugins:forms,typography" sveltekit-adapter="adapter:node" drizzle="database:postgresql+postgresql:postgres.js+docker:yes" better-auth="demo:password" ai-tools="ide:vscode+tools:mcp,svelte-code-writer,svelte-core-bestpractices,svelte-file-editor+mcpSetup:remote" --install npm .
```

## Developing

Once you've created a project and installed dependencies with `npm install` (or `pnpm install` or `yarn`), start a development server:

```sh
npm run dev

# or start the server and open the app in a new browser tab
npm run dev -- --open
```

## Building

To create a production version of your app:

```sh
npm run build
```

You can preview the production build with `npm run preview`.

> To deploy your app, you may need to install an [adapter](https://svelte.dev/docs/kit/adapters) for your target environment.

## Docker Compose

Local development uses `compose.local.yaml`, official upstream database images, named
volumes, and the host-trusted certificate prepared by `npm run https:setup`. From the
repository root, this command stops the previous local stack, rebuilds server, and starts
the complete local environment:

```sh
npm run compose:dev:up
```

Use `npm run compose:dev:config` to validate configuration, `npm run compose:dev:logs`
to follow server logs, and `npm run compose:dev:down` to stop the stack. The historical
`npm run compose:local` alias remains available.

The database initializer runs migrations and creates the first administrator only when
that username does not already exist. Local defaults are `admin` / `admin123`; override
them with `INITIAL_ADMIN_USERNAME`, `INITIAL_ADMIN_PASSWORD`, and `INITIAL_ADMIN_NAME`.
Restarting the stack does not reset the password or remove the named database volumes.
When the RMS MySQL data volume is created for the first time, the official MySQL image imports
`rms-schema.sql` from its initialization directory. Existing RMS volumes are left unchanged and
do not re-import the dump.

Administrators sign in at `/login` with username and password. Administrator authentication
uses dedicated `admin_*` tables; every identity in `admin_user` is an administrator, so there is
no administrator role or ban-management model. Desktop employee identity is resolved read-only
from the RMS `employee` table after phone OTP; it is not copied into PostgreSQL. Phone OTP delivery
and the desktop integration will be connected when an SMS provider and session flow are selected.

Production uses `compose.production.yaml`. Copy `.env.production.example` to the ignored
`.env.production`, fill in the deployment values, and mount a private-CA server certificate whose
DNS/IP SAN matches `ORIGIN`, then validate it without starting or deploying services:

```sh
npm run compose:prod:config
```

After validation, start the production stack from the repository root. It uses a public Docker Hub
database image and builds the server's production image locally:

```sh
npm run compose:prod:up
```

Use `npm run compose:prod:logs` to follow server logs, and
`npm run compose:prod:down` to stop the stack. The historical `npm run compose:production`
alias remains available.

Production requires an explicit administrator name, an unpredictable username of at least
8 characters, and a password of at least 16 characters containing lowercase, uppercase,
number, and symbol characters. These values are initialization secrets and should be
supplied through the deployment environment, not committed.

The production stack contains PostgreSQL and the HTTPS server. PostgreSQL data is bind-mounted
from `POSTGRES_DATA_DIR`; the server is stateless and logs to stdout. RMS MySQL remains an external
read-only dependency. The server reads `cert.pem`, `key.pem` and public `ca.pem` from the read-only
`SERVER_TLS_CERT_DIR` mount and serves HTTPS directly. Package only `ca.pem` in Electron; never
package the CA private key, server private key or disable certificate validation.

The bundled DMS Agent integration requires `AI_DMS_DATABASE_NAME`. At tool initialization the server
calls the MCP `searchDatabase` tool, requires one exact schema-name match, and pins all table listing,
SQL generation and SQL execution to the discovered numeric ID. `AI_DMS_DATABASE_ID` is an optional
second check: when set, startup fails if it differs from the discovered ID. No database discovery tool
is exposed to the answer model.
