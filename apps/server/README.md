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
npm run compose:local
```

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
`.env.production`, fill in the Alibaba Cloud Container Registry locations and production
values, then validate it without starting or deploying services:

```sh
npm run server:compose:production:config
```

After validation, start the production stack from the repository root. This pulls the
configured Alibaba Cloud images and does not build server locally:

```sh
npm run compose:production
```

Production requires an explicit administrator name, an unpredictable username of at least
8 characters, and a password of at least 16 characters containing lowercase, uppercase,
number, and symbol characters. These values are initialization secrets and should be
supplied through the deployment environment, not committed.

The production stack contains PostgreSQL and server only. PostgreSQL data is bind-mounted
from `POSTGRES_DATA_DIR`; the server is stateless and logs to stdout. RMS MySQL remains an
external read-only dependency. Caddy terminates public HTTPS and proxies to the server's
loopback-bound HTTP port.
