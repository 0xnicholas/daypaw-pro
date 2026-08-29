---
description: "The daypaw agent catalog page, a fork client UI plugin occupying the 'inbox.agents.page' child slot declares on its workspace registrati"
kind: "package-reference"
---

# @daypaw/ui-agents

English | [中文](README.zh.md)

## Summary

## Table of Contents



The daypaw agent catalog page, a fork client UI plugin occupying the `'inbox.agents.page'` child slot [`@daypaw/ui-inbox`](../ui-inbox/README.md) declares on its workspace registration. It implements the catalog half of [docs/spec/05-product-shell.md](../../../docs/spec/05-product-shell.md) §3/§5: the card grid shows each agent's business name and description, and a card's detail view carries the registry identity `name@version`. v1 offers no version operations — the identity line is information, not a control.

Facts come from the engine's definition registry read view (spec 05 §5): the plugin calls the Remote endpoint `durable/listDefinitions` through the connection's generic RPC channel, which the API gateway claims from `@daypaw/engine`'s `TypertRemoteService` binding (the GoalService precedent — no upstream apiproxy edit). The payload is validated at that wire boundary; a malformed answer fails loud into the page's inline error state, and raw host error wording never reaches the screen. The host stays the single fact source — the store keeps no cache of its own beyond the latest loaded snapshot.

Presentation rules live in the catalog store, not the component: only `kind: 'agent'` definitions list (the registry also holds workflows, which are not startable agents), the card title falls back to the technical `name` when the definition declares no display metadata (the #52 fallback), and a card without a description renders no empty row. The roster loads on first open; the detail selection lives in the same store, so a re-render never refetches and leaving the page keeps the loaded snapshot.

Copy rides the plugin-owned `daypaw-agents` locale namespace (zh product copy as the key-set source of truth, plus the mechanically required en dictionary; a locales spec keeps run/session/journal wording out of both). Styling is CSS Modules over `--dsw-alias-*` semantic tokens only.

## Model Experience

### Agent catalog UI

#### What the model sees

Nothing on this surface is model-visible chrome. `AgentsPage` renders the `durable/listDefinitions` payload for humans; the components contribute no prompt, tool, or schema.

#### Token effect

Zero live-request tokens.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **No version operations** — the detail view shows `name@version` as identity only; version selection or switching is deferred (spec 05 §2: no dead affordances in v1).
- **No registry-change invalidation** — the roster loads once per mount; definitions bound after the first load appear on the next page open, and there is no pushed invalidation channel for the registry.

### Dev Note
