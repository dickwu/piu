# TODOS

## Test Pipeline Support
**What:** Run a sequence of requests with hooks firing between them (e.g., login -> extract token -> run protected endpoints).

**Why:** PIU has no way to run requests in sequence automatically. Each request must be triggered individually. This is needed for full API flow testing.

**Context:** PIU's hooks already handle data passing between requests (extract token -> update variable via env_hooks). The missing piece is orchestration: "run these N requests in order." Simplest version: a collection runner that executes all requests in sort_order. Needs its own design — pipeline definition format, execution engine, UI for results.

**Depends on:** MCP hook tools (F1) should ship first so skills can set up the auth flows that pipelines would test.

**Added:** 2026-03-29 via /plan-eng-review

---

## AI-Native LLM Provider (Design Doc Phase 1)
**What:** Integrate `async-openai` crate for OpenAI-compatible LLM provider, AI settings UI, config storage. First step toward AI-native PIU.

**Why:** Unblocks Smart Request Builder, Response Analyzer, and all AI features from the approved design doc. Differentiates PIU from Bruno/Yaak.

**Context:** Full design doc at `~/.gstack/projects/dickwu-piu/lifefarmer-main-design-20260328-120000.md`. Eng review recommended `async-openai` crate over rolling custom HTTP+SSE client. The `llm` crate is an alternative worth investigating (multi-provider out of the box). Reviewer concerns (schema migration, context assembler, Layer 2 execution environment) documented in design doc.

**Depends on:** MCP hook/variable tools + enhanced docs (current scope) should ship first. Test pipeline is an optional prerequisite.

**Added:** 2026-03-29 via /plan-eng-review
