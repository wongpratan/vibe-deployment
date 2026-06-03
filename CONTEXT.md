# CONTEXT — global-page-nexus domain glossary

Vocabulary for the deployment-orchestration workflow. Use these terms exactly in code, prompts, and docs.

## Core concepts

- **Agent** — one of three LLM-driven roles the user talks to in sequence: `reviewer`, `coordinator`, `deployer`. Identified by `AgentId`.
- **Workflow** — the fixed sequence `reviewer → coordinator → deployer`. A user cannot skip ahead.
- **Stage** — one position in the Workflow. Each Agent owns exactly one Stage.
- **WorkflowGate** — module that decides whether a Stage is open for a given chat. Derived (not stored) from `reviews.ready` and `coordinators.collected` rows. Read-only. Tools advance the underlying rows; the Gate re-derives. Also the single source for both UI state and LLM system-context prompts (no parallel derivation elsewhere).
  - `state(chatId, userId)` → rich `WorkflowState` (server-only): every derived field including raw envVars, reviewSummary, repoUrl, gitBranch, buildPack, locations, targetUrl.
  - `toWireState(state)` → `WireWorkflowState` projection used at HTTP boundary. Masks envVars, drops server-only fields. This is the shape the frontend reads.
  - `isOpen(chatId, userId, stage)` → boolean derived from `state`.
  - `systemContextPrompt(chatId, userId, agentId)` → `ChatCompletionMessageParam[]` seeding an agent's history (the agent's system prompt plus, for Coordinator/Deployer, a stage-specific context block).
- **Gate signal** — a save-tool execution whose persisted row flips a stage from closed → open. Today: `save_review_result` opens Coordinator; `save_coordinator_requirements` opens Deployer.
- **Build pack** — Coolify deployment kind detected from a cloned repo: `dockercompose | dockerfile | nixpacks | static`.
- **Coolify** — external PaaS driven via MCP subprocess. The Deployer's tools are Coolify operations.
- **Tool result** — the JSON string a tool returns. Persisted as a `messages` row with `role='tool'`. Should NOT be parsed by the UI for state — read `WorkflowGate.state` instead.

## Terms intentionally avoided

- "Component", "service", "boundary" — use **module**, **module**, **seam** (see `.claude/skills/improve-codebase-architecture/LANGUAGE.md`).
- "Workflow status" / "review status" / "coordinator status" — collapsed into `WorkflowGate.state`.
