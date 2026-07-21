# Getting Started with [Fastify-CLI](https://www.npmjs.com/package/fastify-cli)
This project was bootstrapped with Fastify-CLI.

## Available Scripts

In the project directory, you can run:

### `npm run dev`

To start the app in dev mode.\
Open [http://localhost:3000](http://localhost:3000) to view it in the browser.

### `npm start`

For production mode

### `npm run test`

Run the test cases.

## Local environment variables

`npm run dev`, `npm test`, and `npm run migrate:up`/`migrate:down` all read `NEON_DATABASE_URL` (and, for `dev`/`test`, `ANTHROPIC_API_KEY`) from a local `backend/.env` file (gitignored via `*.env`):

```
NEON_DATABASE_URL=postgresql://...
ANTHROPIC_API_KEY=...
```

`src/app.ts` loads this file via `dotenv/config` on startup, so no shell export is required. In Lambda, these are instead resolved from SSM (see `src/plugins/config.ts`) — `.env` is local-dev only and is never deployed.

## Database migrations

Schema migrations are managed by [`node-pg-migrate`](https://salsita.github.io/node-pg-migrate/), reusing the same `NEON_DATABASE_URL` env var the app already requires (no separate migration-only variable).

- `npm run migrate:create <name>` — scaffold a new TypeScript migration file under `migrations/`
- `npm run migrate:up` — apply all pending migrations
- `npm run migrate:down` — roll back the most recently applied migration

`NEON_DATABASE_URL` must be Neon's **direct (unpooled)** connection string, not the pooled/PgBouncer one — `node-pg-migrate` takes a session-level advisory lock to prevent concurrent migration runs, and Neon's pooled endpoint (transaction-mode PgBouncer) doesn't reliably preserve session state across statements, which can make that lock fail or hang. `@neondatabase/serverless`'s HTTP driver (used everywhere else in the app) works fine with either string, so a single direct `NEON_DATABASE_URL` covers both the app and migrations — no separate migration-only variable is needed. In the Neon dashboard, the direct string is the connection string *without* `-pooler` in the endpoint hostname.

`migrate:down` drops all 5 tables unconditionally and has no environment check — it always runs against whatever `NEON_DATABASE_URL` is currently in `.env`. A `premigrate:down` npm hook prints a warning before every `migrate:down` run as a reminder, but it does not block execution: never point local `.env` at the same database the deployed Lambda's SSM parameter uses.

## Learn More

To learn Fastify, check out the [Fastify documentation](https://fastify.dev/docs/latest/).
