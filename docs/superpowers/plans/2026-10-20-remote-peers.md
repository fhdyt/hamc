# Remote Peers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `peer` edge kind and external nodes in the agents graph, from Bot Chat, `hermes peer` tool calls and the A2A audit.

**Architecture:** `InteractionState` adds peer edges read-only; the zod schemas and the graph model learn the kind; the SVG draws remote nodes.

**Tech Stack:** Python stdlib collector, zod, React SVG, Vitest, pytest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-20-remote-peers-design.md`

## Global Constraints

- Read-only; the A2A `summary` is read only by the on-click query, never in the snapshot.
- Caps: 7-day window, 300 edges, 40 external nodes, 256 KiB of audit tail, 500 tool-call rows per profile.
- Collector ASCII-only, stdlib-only.

---

### Task 1: Collector

- [ ] Fixture `add_remote_peers` (Bot Chat line from `@dixie`, a `hermes peer dm spark/researcher` tool call, an A2A audit with an inbound/outbound pair and a lone outbound).
- [ ] Failing pytest; implement peer edges, sources, caps and `q_interaction` kind `peer`; update the existing unresolved expectations.
- [ ] Commit `feat(graph): remote peers in the interactions snapshot`.

### Task 2: Shared, main, renderer

- [ ] zod (`InteractionKind`, sources, `InteractionArgs`), settings kinds max 5.
- [ ] Vitest for `buildGraph` peers; implement graph model, SVG node, card text.
- [ ] Commit `feat(graph): remote peer nodes in the agents graph`.

### Task 3: E2E + docs

- [ ] `agentGraph.spec.ts`: remote node and its edge detail.
- [ ] PRD F-AGRAPH-7, checklist, CLAUDE.md. Commit.
