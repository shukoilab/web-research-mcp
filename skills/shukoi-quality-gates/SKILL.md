---
name: shukoi-quality-gates
description: Guides authoring and verifying tri-transport parity tests (QG-01) and boundary tests.
compatibility: TypeScript 5.5+, Vitest 3.x, @shukoi/core
---

# Authoring Tests in Shukoi

1. Use `createActionTestHarness` from `@shukoi/core/testing`.
2. Assert both successful result transformations and `DomainError` failure modes.
3. Test `AbortSignal` cancellation and `ctx.onFinally` resource teardown.
