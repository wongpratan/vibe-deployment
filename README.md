# Vibe Deployment

[![Backend Tests](https://github.com/wongpratan/vibe-deployment/actions/workflows/backend-tests.yml/badge.svg)](https://github.com/wongpratan/vibe-deployment/actions/workflows/backend-tests.yml)
[![codecov](https://codecov.io/gh/wongpratan/vibe-deployment/branch/refactor/graph/badge.svg?flag=backend)](https://codecov.io/gh/wongpratan/vibe-deployment)

Deployment-orchestration workflow driven by three sequential LLM agents — `reviewer → coordinator → deployer` — that prepare a repo and ship it to Coolify.

See [`CONTEXT.md`](./CONTEXT.md) for the domain glossary.

## Layout

- `backend/` — Fastify + Drizzle API, Vitest tests
- `frontend/` — Next.js app, Vitest + Testing Library

## Tests

```bash
# Backend
npm --prefix backend test
npm --prefix backend run test:coverage

# Frontend
npm --prefix frontend test
```
