# Agent Note: dsh-attachment joins the sdk's consumer-supplied peers

Status: implemented

English | [中文](2026-09-10-sdk-attachment-consumer-peer.zh.md)

## Problem

Upstream `a3207a758b` (inside the 2026-08-29 sync window) moved `@deepseek-ai/dsh-attachment` in `packages/llm/llm/package.json` from peerDependencies to devDependencies. The release pipeline stages the `--prod` closure with `--config.auto-install-peers=false`, so attachment stopped being staged, while the bundled dsh-llm declarations still import its types (`AttachmentStore`, `FileAttachmentRef`, `ImageAttachmentRef`, `ImageMediaType`, `RequestImageAttachment` — all type-only). The packed `@daypaw/sdk` neither bundled attachment nor declared it as a consumer peer, so a registry consumer's `tsc` hit TS2307 on three declaration files; the Release (daypaw) lane went red on every main push from 2026-09-01 (issue [#110](https://github.com/0xnicholas/daypaw-pro/issues/110)). The CLI tarball was unaffected — file-upload and friends restage attachment into its closure — and the manual-dispatch publish gate was never reached.

## Decision

- `@daypaw/sdk` declares `@deepseek-ai/dsh-attachment` `~0.1.3-alpha.2` as a consumer-supplied peer, joining cordis and zod (ADR 0011 §2 addendum, 2026-09-10). The dependency is type-only: there is no runtime singleton to unify, only declarations to resolve.
- The range's lower bound is the smallest published version whose type surface carries the imports the bundled dsh-llm declarations use. `FileAttachmentRef` and `RequestImageAttachment` exist only from `0.1.3-alpha.2` up — the `0.0.1-rc` line and the `0.1.0`/`0.1.1`/`0.1.2` lines lack them — and `0.1.3-alpha.2`'s export set is item-for-item the vendored `0.1.3-alpha.1`'s. The prerelease tuple rule keeps the range inside the `0.1.3` prerelease line plus later `0.1.x` finals.
- `SDK_EXTERNAL_PEERS` includes attachment, so the closure completeness check allows the deploy root's peer absent, and `rewriteManifests` derives the unbundled set from the same list (minus the bundled cordis singleton), keeping attachment out of `bundleDependencies` alongside zod — a future sync that restages attachment into the prod graph cannot silently flip the tarball back to the bundled shape, and a peer added to the list follows automatically.
- `smokeSdk` derives the consumer's peer installs from the SDK source manifest (zod pinned through `externalPeerPins`) instead of hardcoding the cordis/zod ranges, so every published peer is exercised in the customer shape and range drift fails the smoke rather than a customer.

## Alternatives considered

**Bundle attachment as a real SDK dependency** (the shape before upstream's peer→dev move). Rejected: a bundled copy beside the consumer's peer-installed copy is a second identity of the same name; for a type-only import it merely shadows the consumer's resolution and breaks the peer contract for consumers that also use upstream dsh packages directly.

**Peer range `^0.0.1-rc.1`** as the ticket sketched (mirroring older upstream llm releases). Rejected empirically: the range resolves inside the `0.0.1-rc` line, whose surface lacks `FileAttachmentRef`/`RequestImageAttachment`; the smoke consumer fails TS2614/TS2724. Upstream's current published `dsh-llm@0.1.5-rc.1` no longer peers attachment at all (devDependency `^0.1.5-rc.1`), so there is no upstream peer declaration left to mirror — the vendored surface is the anchor.

**Pin attachment through `externalPeerPins`** like zod. Rejected: the zod pin exists because zod changes generic shapes inside semver-compatible ranges; attachment's range already resolves deterministically (only `0.1.3-alpha.2` matches today) and the smoke typecheck guards drift — which is exactly how the `0.0.1-rc` gap surfaced during this fix.

**A post-pack "every declared types import resolves" assertion over the bundle set** (the issue's optional defense line, adjudicated separately). Not taken here: the smoke typecheck already fails this failure class at the same lane step.

## Consequences

- `pnpm run release:daypaw` exits 0 end to end locally: the CLI smoke is unchanged (boots to the URL line, serves the dist, seeds the profile, mounts the engine ledger), and the SDK smoke installs `@deepseek-ai/dsh-attachment@0.1.3-alpha.2` from the registry, typechecks under NodeNext, and runs `RESULT {"total":50}`. The tarball declares the peer and ships zero attachment paths (`bundleDependencies` 22).
- pnpm's auto-install-peers provisions the registry `0.1.3-alpha.2` as a hidden peer dependency of the SDK importer in `pnpm-lock.yaml` (dev context only; the deploy passes `--config.auto-install-peers=false`, so it never reaches the tarball).
- Sync ritual: when a sync moves the vendored attachment's type surface, the peer range follows the smallest published version carrying that surface; the SDK smoke typecheck is the gate that fails first (recorded in ADR 0011 §2).
- Residual risk: a consumer resolving an attachment newer than the vendored surface within the range (a later `0.1.3` prerelease or `0.1.x` final) relies on upstream keeping the surface additive; the smoke proves the resolved version, not the whole range — the same residual shape the zod pin carries (see [the completeness note](2026-08-30-release-tarball-completeness.md)).

Related: [the self-contained delivery note](../process/2026-08-22-daypaw-npm-self-contained-delivery.md) owns the pipeline decision this extends.
