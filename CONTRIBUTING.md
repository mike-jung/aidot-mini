# Contributing

Read AGENTS.md and docs/AI_API_RULES.md. Preserve the standard annotation and
Controller/Service/SQL contract. Add migrations without changing applied files.
Do not add runtime dependencies without explaining the target memory/size cost.
Run npm ci --ignore-scripts, npm run verify, and the relevant HTTP tests.
Use synthetic fixtures and keep private configuration and customer code out of PRs.
Public contributions are submitted under Apache-2.0 unless explicitly stated otherwise.
