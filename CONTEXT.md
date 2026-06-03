# CONTEXT — global-page-nexus domain glossary

Vocabulary for the deployment-orchestration workflow. Use these terms exactly in code, prompts, and docs.

## Core concepts

- **Agent** — one of three LLM-driven roles the user talks to in sequence: `reviewer`, `coordinator`, `deployer`. Identified by `AgentId`.
- **Workflow** — the fixed sequence `reviewer → coordinator → deployer`. A user cannot skip ahead.
- **Stage** — one position in the Workflow. Each Agent owns exactly one Stage.
- **WorkflowGate** — module that decides whether a Stage is open for a given chat. Derived (not stored) from `reviews.ready` and `coordinators.collected` rows. Read-only. Tools advance the underlying rows; the Gate re-derives.
  - `state(chatId)` → full view across all stages, including derived detail (nameGuess, appName, masked envVars, buildPack, targetUrl).
  - `isOpen(chatId, agentId)` → boolean derived from `state`.
- **Gate signal** — a save-tool execution whose persisted row flips a stage from closed → open. Today: `save_review_result` opens Coordinator; `save_coordinator_requirements` opens Deployer.
- **Build pack** — Coolify deployment kind detected from a cloned repo: `dockercompose | dockerfile | nixpacks | static`.
- **Coolify** — external PaaS driven via MCP subprocess. The Deployer's tools are Coolify operations.
- **Tool result** — the JSON string a tool returns. Persisted as a `messages` row with `role='tool'`. Should NOT be parsed by the UI for state — read `WorkflowGate.state` instead.

## Terms intentionally avoided

- "Component", "service", "boundary" — use **module**, **module**, **seam** (see `.claude/skills/improve-codebase-architecture/LANGUAGE.md`).
- "Workflow status" / "review status" / "coordinator status" — collapsed into `WorkflowGate.state`.
