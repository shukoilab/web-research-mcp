# mcp-web-research Application Constitution (AGENTS.md)

## 1. Project Overview & Verification Commands
- **Build:** `pnpm run build`
- **Test:** `pnpm test`
- **Typecheck:** `pnpm run typecheck`
- **Dev (Self-Host):** `pnpm run dev`
- **Start:** `pnpm run start`
- **Docker Build:** `docker build -t mcp-web-research .`
- **Lint:** `pnpm run lint`
- **Format:** `pnpm run format`

## 2. Core Architectural Laws for Coding Agents
1. **Zero-Hardcoding:** Read all environment variables through `src/config.ts`.
2. **Pure Web-Standard Actions:** Never import `node:*` modules inside `src/actions/*.ts`.
3. **Strict stdout Sterility:** Never invoke `console.log`; use `ctx.logger.info()` or `ctx.logger.error()`.
4. **Strict Schema Contracts:** Set `{ additionalProperties: false }` on all TypeBox objects in `input` and `output`.
5. **Cancellation & Deadlines:** Always pass `ctx.signal` to downstream fetch calls and database queries.

## 3. Skills & Procedural Guidance
- Authoring Actions: read `skills/shukoi-create-action/SKILL.md`
- Authoring Quality Gates: read `skills/shukoi-quality-gates/SKILL.md`
