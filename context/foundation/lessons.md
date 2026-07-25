# Lessons Learned

> Append-only register of recurring rules and patterns. Re-read at start by /10x-frame, /10x-research, /10x-plan, /10x-plan-review, /10x-implement, /10x-impl-review.

## React context + hook pairs split across two files

- **Context**: frontend/src/auth/AuthContext.tsx, frontend/src/auth/useAuth.ts
- **Problem**: A single file exporting both a component (e.g. a context Provider) and a non-component value (a consumer hook, the raw context object) trips oxlint's react/only-export-components warning, since it breaks React Fast Refresh's file-boundary assumption.
- **Rule**: When a React file needs to export both a component (e.g. a context Provider) and a hook/non-component value (the consumer hook, the raw context object), split them into two files — the Provider in `<Name>Context.tsx`, and the context object + hook in `use<Name>.ts`.
- **Applies to**: Any new React context/provider added under `frontend/src/` (or wherever context providers live in future frontend work).

## Check for pre-existing duplicates before adding a uniqueness migration

- **Context**: backend/migrations/1784819058952_add-collections-name-uniqueness.ts
- **Problem**: A `CREATE UNIQUE INDEX` migration fails to apply if any environment already has rows violating the new constraint (e.g. case-insensitive duplicate names for the same user), blocking deploy until manually cleaned up.
- **Rule**: Before writing a migration that adds a uniqueness constraint (unique index/column) on an existing table, check whether any target environment could already have rows that would violate it (e.g. a quick `SELECT ... GROUP BY ... HAVING COUNT(*) > 1` against the columns being constrained) — if data could already exist, note the cleanup/reconciliation step in the migration's plan or notes.
- **Applies to**: Any future migration under `backend/migrations/` that adds a `UNIQUE` constraint or unique index to a table that may already hold data in any deployed environment.
