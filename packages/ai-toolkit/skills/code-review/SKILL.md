---
name: code-review
description: Review code changes against team engineering conventions, testing standards and security expectations.
allowed-tools:
  - Read
  - Grep
  - Glob
  - Bash
---

# Code Review

Review a set of code changes (a diff, a PR, or a set of files) against this team's engineering conventions. Do not invent a new review standard — every finding must trace back to one of the six categories below.

Trigger phrases: "review code", "check this PR", "review my changes", "code review".

## Procedure

1. Determine the scope of the review: a git diff (`git diff`, `git diff main...`), a PR (via `Bash`'s `gh` CLI if available), or an explicit file list the user names. If nothing is specified, default to the working tree's uncommitted changes (`git status` / `git diff`).
2. Read every changed file in full (`Read`) — not just the diff hunks — so surrounding context (existing error handling, existing naming, existing tests) informs each finding.
3. Check the changes against each of the six categories below.
4. Produce the report in the exact "Output format" below.

## Review categories

### Naming
- Variables and functions: descriptive camelCase (no abbreviations except `url`, `id`, `api`, `config`)
- Booleans: prefix with `is`, `has`, `should`, `can`
- Functions: verb-first (`getUserById`, not `user`)
- Files: match primary export (`UserService.ts` exports `UserService`)
- Constants: UPPER_SNAKE_CASE

### Error Handling
- All async operations: try/catch or `.catch()`
- Error messages include what operation failed and the relevant inputs
- No empty catch blocks; at minimum, log or rethrow the error
- HTTP errors include status code and actionable message
- Cleanup belongs in `finally` blocks when resources are opened

### TypeScript
- Zero `any` without explicit justification comment
- Prefer `interface` over `type` for object shapes
- Use `unknown` for external data, narrow with type guards
- Model states with discriminated unions, not optional fields
- Generic params: descriptive names (`TUser`, not `T`)

### Function Design
- Single responsibility; if you need "and" to describe it, split it
- Max 3 parameters; use an options object beyond that
- Early returns over nested conditionals
- Query functions (`get*`, `find*`, `is*`) must be pure

### Security
- No secrets in code; environment variables only
- Validate user input at system boundaries
- SQL: parameterized statements only
- API responses never leak stack traces or internal paths

### Testing
- Test names describe behavior: "returns empty array when no results found"
- Each test owns its setup and teardown
- Specific assertions: `toEqual(expected)` instead of `toBeTruthy()`
- Cover edge cases: empty, null, boundary values and error paths

## Output format

Print exactly this, in this order.

```
# Code Review

**Verdict:** APPROVE | REQUEST CHANGES | NEEDS DISCUSSION

## Critical
- `file:line` — <what's wrong> (<category>) → <what to do instead>
- ... (omit this section entirely if there are no Critical findings)

## Warning
- `file:line` — <what's wrong> (<category>) → <what to do instead>
- ... (omit this section entirely if there are no Warning findings)

## Suggestion
- `file:line` — <what's wrong> (<category>) → <what to do instead>
- ... (omit this section entirely if there are no Suggestion findings)

## Summary
<one or two sentences on the overall state of the change>
```

- Every finding names one of the six categories (Naming, Error Handling, TypeScript, Function Design, Security, Testing).
- Include a `file:line` reference whenever the tool used to gather the change (diff, `Read`, `Grep`) makes the line determinable; otherwise reference the file alone.
- Order findings within each section by file, then by line number.
- The final line must be exactly one of `APPROVE`, `REQUEST CHANGES`, or `NEEDS DISCUSSION` — never more than one, never a hedge between two.
- `REQUEST CHANGES` whenever any Critical finding exists. `NEEDS DISCUSSION` when a finding's correct fix depends on a project decision this skill cannot make (e.g. a security tradeoff, a schema choice). `APPROVE` otherwise, including when only Suggestions are present.
