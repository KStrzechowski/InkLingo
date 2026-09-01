# code-reviewer

AI code-review agent for InkLingo pull requests — the Module 5 team agent. Built on the Vercel AI SDK's `ToolLoopAgent`, OpenRouter as the model provider, and Zod for the structured review output.

## Setup

```bash
npm install
cp .env.example .env   # add your OpenRouter key: https://openrouter.ai/keys
```

## Usage

```bash
git diff main... > /tmp/pr.diff
npm run dev -- /tmp/pr.diff "PR title" "PR description"
```

Prints the structured review (six scored criteria, a summary, and a `pass`/`fail` recommendation) as JSON.

## Exports

`createCodeReviewAgent(modelId?)` returns a `{ review(input) }` agent, importable by the CI workflow (Module 5, lesson 3) without going through the CLI.
