# Review follow-ups (word-collections)

## Pre-existing test-flakiness bug in `backend/test/helpers/jwks.ts` — fixed

- **Found**: during word-collections' impl-review triage, while investigating an unrelated failing test (`GET /api/me with a tampered signature returns 401`, in `backend/test/routes/api/me.test.ts`).
- **Root cause**: `tamperSignature()` flips only the last base64url character of the JWT signature. For a 256-byte RS256 signature, that last character sits in a "padding-only" bit position ignored by Node's base64url decoder — verified empirically at a **25.08% collision rate** across 100,000 simulated signatures (i.e. ~1-in-4 chance the "tampered" token decodes to the exact same signature bytes as the original, silently no-op'ing the tamper).
- **Confirmed pre-existing**: reproduced in an isolated `git worktree` checked out at `cb99ada` (the commit before word-collections started) — unrelated to any change in this session.
- **Verified fix** (0/100,000 collisions in the same simulation):
  ```ts
  export function tamperSignature (token: string): string {
    const [header, payload, signature] = token.split('.')
    const bytes = Buffer.from(signature, 'base64url')
    bytes[0] ^= 0xFF
    return `${header}.${payload}.${bytes.toString('base64url')}`
  }
  ```
- **Status**: Applied. `tamperSignature()` in `backend/test/helpers/jwks.ts` now flips the first byte of the decoded signature buffer instead of the last base64url character. Re-verified: 0/500 collisions in a fresh simulation, full backend suite passes (32/32), and `me.test.ts` run in isolation 5 times consecutively with no failures.
