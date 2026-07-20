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

## Database migrations

Schema migrations are managed by [`node-pg-migrate`](https://salsita.github.io/node-pg-migrate/), reusing the same `NEON_DATABASE_URL` env var the app already requires (no separate migration-only variable).

- `npm run migrate:create <name>` — scaffold a new TypeScript migration file under `migrations/`
- `npm run migrate:up` — apply all pending migrations
- `npm run migrate:down` — roll back the most recently applied migration

`migrate:up`/`migrate:down` read `NEON_DATABASE_URL` from a local `backend/.env` file (`NEON_DATABASE_URL=postgresql://...`, gitignored via `*.env`) rather than requiring it to be exported in your shell. `NEON_DATABASE_URL` can be either Neon's pooled or direct connection string — both were verified to work with `node-pg-migrate`'s locking mechanism, so no separate direct-connection variable is needed.

## Learn More

To learn Fastify, check out the [Fastify documentation](https://fastify.dev/docs/latest/).
