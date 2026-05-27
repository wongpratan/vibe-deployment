# AGENTS.md

## Quick Reference

```bash
# Full stack (Docker)
docker-compose up

# Individual development
cd backend && npm run dev      # Fastify on :4000 (tsx watch)
cd frontend && npm run dev     # Next.js on :3000

# Database schema sync (NOT migrations)
cd backend && npm run db:push

# Build
cd backend && npm run build    # tsc → dist/
cd frontend && npm run build   # next build
```

**No test, lint, or typecheck scripts exist.** Verify changes manually.

## Architecture

**Monorepo**: `backend/` (Fastify API) + `frontend/` (Next.js 15 app)

**AI Workflow**: Three agents run sequentially—user cannot skip ahead:
1. **Reviewer** → Analyzes GitHub repo, detects build pack (dockercompose/dockerfile/nixpacks/static)
2. **Coordinator** → Collects app name and environment variables
3. **Deployer** → Executes Coolify deployment via MCP tools

**Key Files**:
- `backend/src/server.ts` - Fastify entrypoint
- `backend/src/env.ts` - Zod-validated env schema (crashes on missing vars)
- `backend/src/tools/index.ts` - Tool registry (each agent has allowed tools)
- `backend/src/chat/prompts.ts` - Agent system prompts and workflow rules
- `backend/src/db/schema.ts` - Drizzle ORM schema
- `frontend/src/components/ChatWindow.tsx` - Main UI with agent tabs

## Environment

Required vars (validated at startup via Zod in `backend/src/env.ts`):
- `OPENAI_API_KEY`, `OPENAI_BASE_URL` - AI model access (OpenRouter compatible)
- `DATABASE_URL` - PostgreSQL connection string
- `JWT_SECRET` - Min 16 characters

Optional:
- `BRAVE_API_KEY` - Web search fallback when repo clone fails
- `COOLIFY_BASE_URL`, `COOLIFY_ACCESS_TOKEN` - Coolify deployment integration
- `COOLIFY_APPS_DOMAIN` - Custom domain for deployed apps

Copy `.env.example` to `.env` and fill values before running.

## Database

**Schema management**: `drizzle-kit push` (direct sync, no migration files)

Schema defined in `backend/src/db/schema.ts`. After editing, run:
```bash
cd backend && npm run db:push
```

Tables: `users`, `chats`, `messages`, `reviewResults`, `coordinatorRequirements`, `deploymentRequirements`

## Gotchas

1. **Env validation**: Backend crashes immediately if required env vars are missing/invalid. Check `backend/src/env.ts` for schema.

2. **Host binding**: Backend binds to `[IP_ADDRESS]` (all interfaces), not localhost.

3. **SSE streaming**: Chat endpoint (`POST /chat`) uses Server-Sent Events. New chats return `X-Chat-Id` header.

4. **Coolify MCP**: Spawns `npx @masonator/coolify-mcp@latest` as subprocess. Requires `COOLIFY_BASE_URL` and `COOLIFY_ACCESS_TOKEN` or tools are silently skipped.

5. **Agent gating**: Frontend enforces sequential workflow. Reviewer must save `ready: true` before Coordinator becomes accessible. Coordinator must save `collected: true` before Deployer shows deploy button.

6. **Tool dispatch**: Each agent can only call its allowed tools (defined in `backend/src/tools/index.ts`). Calling unauthorized tools returns error.

7. **Schema push**: `db:push` applies changes directly—no rollback capability. Use caution in production.

8. **No tests**: No test framework configured. Verify all changes manually or by running the full workflow.
