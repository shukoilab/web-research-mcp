---
name: shukoi-create-action
description: Creates or modifies protocol-agnostic business actions using defineAction(), TypeBox schemas, DomainError, and AbortSignal cancellation.
compatibility: TypeScript 5.5+, @sinclair/typebox, @shukoi/core
---

# Authoring Actions in Shukoi

1. Create action in `src/actions/<name>.ts` using `defineAction()`.
2. Define TypeBox schemas with `{ additionalProperties: false }`.
3. Never import `node:*` or use `console.log`.
4. Throw `DomainError` for domain failures.
5. Export action and register route in entrypoint.
