# Vibe Deployment

[![Backend Tests](https://github.com/wongpratan/vibe-deployment/actions/workflows/backend-tests.yml/badge.svg)](https://github.com/wongpratan/vibe-deployment/actions/workflows/backend-tests.yml)
[![Frontend Tests](https://github.com/wongpratan/vibe-deployment/actions/workflows/frontend-tests.yml/badge.svg)](https://github.com/wongpratan/vibe-deployment/actions/workflows/frontend-tests.yml)
[![codecov backend](https://codecov.io/gh/wongpratan/vibe-deployment/branch/main/graph/badge.svg?flag=backend)](https://codecov.io/gh/wongpratan/vibe-deployment)
[![codecov frontend](https://codecov.io/gh/wongpratan/vibe-deployment/branch/main/graph/badge.svg?flag=frontend)](https://codecov.io/gh/wongpratan/vibe-deployment)

Deployment-orchestration workflow driven by three sequential LLM agents — `reviewer → coordinator → deployer` — that prepare a repo and ship it to Coolify.

See [`CONTEXT.md`](./CONTEXT.md) for the domain glossary.

## Layout

- `backend/` — Fastify + Drizzle API, Vitest tests
- `frontend/` — Next.js app, Vitest + Testing Library

## Tests

Backend uses Vitest against a real Postgres via Drizzle. Frontend uses Vitest + Testing Library with jsdom.

```bash
# Backend — unit + integration
npm --prefix backend test

# Backend — with coverage report
npm --prefix backend run test:coverage

# Frontend — unit + component
npm --prefix frontend test

# Frontend — with coverage report
npm --prefix frontend run test:coverage

# Watch mode (either workspace)
npm --prefix backend test -- --watch
npm --prefix frontend test -- --watch
```

Coverage reports upload to Codecov per workspace (see badges above). CI runs both suites on push via the workflows in `.github/workflows/`.
