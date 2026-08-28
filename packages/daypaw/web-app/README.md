---
description: "The daypaw browser-surface bundle: the fork carrier of , differing from the upstream glue in the points §4 rules — the dist package it r"
kind: "package-bundle"
---

# `@daypaw/web-app`

English | [中文](README.zh.md)

## Summary

## Table of Contents



The daypaw browser-surface bundle: the fork carrier of [`@deepseek-ai/dsh-web-app`](../../bundle/web-app/README.md), differing from the upstream glue in the points [docs/spec/05-product-shell.md](../../../docs/spec/05-product-shell.md) §4 rules — the dist package it resolves (`@daypaw/web-frontend`), the web-surface prompt text, and the `daypaw web:` URL-line prefix (the `DAYPAW_WEB_URL` rename is deferred; see Known Limitations). [`cordis.patch.yml`](cordis.patch.yml) rides over [`dsh-base`](../../bundle/base/README.md): it sets the coding persona, inserts the Web host rows (webserver, API gateway, workspace, projection cache, storage) and the browser plugin roster, the always-on client-plugin reload chain ([`dsh-client-hmr`](../../client/hmr/README.md), idle until a rebuild watcher rewrites client bundles), and mounts this package's `web-runtime` glue plugin (config `{printUrl, surfaceContext, trustedHosts}`). That plugin resolves the built frontend dist through `@daypaw/web-frontend`'s exports, samples bind-dependent LAN trust once, provides it as `webRuntime` to the browser-trust fence and client roster, mounts the [`frontend-static`](../../host/frontend-static/README.md) fallback owner, registers the harness-source and web-surface prompt sections plus the bash-visible `DSH_WEB_URL` runtime variable when `surfaceContext` is true, and prints the `daypaw web:` URL line when `printUrl` is true, after its Loader tree settles so a sibling failure cannot announce a dead app. This bundle also owns the app command line: the ordinary `web-startup` provider ([`src/startup.ts`](src/startup.ts)) injects `ctx.cmdlineArgs` ([`dsh-cmdline`](../../boot/cmdline/README.md)), parses `--host`, `--port`, repeatable `--trusted-host`, and the app's `--help`, then provides `webStartup`. It rejects `--host 0.0.0.0` before publishing that service because the CLI intentionally does not support all-interfaces binding yet. Flag-configured rows inject the service and read it directly from lazy config, so nothing binds a port before argument resolution and a `--help` invocation starts no server.

## Model Experience

### Harness-source and Web-surface context

#### What the model sees

When `surfaceContext` is true, the `harness:source` section identifies the on-disk Harness implementation without claiming it is the working directory, and the `app:web-surface` global section (order −98) orients the model to the daypaw GUI: the canonical local URL, the "this page" referent, the update contract (the reload receiver is always on; this shell wires no rebuild watcher, so every change means rebuilding the affected Web artifacts and a page refresh), and the instruction not to start replacement servers. `DSH_WEB_URL` additionally appears in the managed bash environment with its description, resolved per invocation from the live server. When it is false, neither section nor the variable is registered.

#### Token effect

One source line and one prompt paragraph per session plus two managed-environment variable lines; constant per process.

#### KV Cache effect

The prompt section sits near the system prompt's head and is stable for the life of the process (the port is a boot fact), so it does not invalidate the cache across turns.

## Known Limitations and Deferred Work

- **The frontend dist must be built** — `require.resolve` of the dist fails loud at activation with a build hint; there is no source-serving fallback.
- **`lanAddresses` is a boot-time snapshot** — interface changes after boot are not re-advertised; the printed LAN URL always matches the configured trust fence.
- **The browser roster is upstream placeholders** — the roster still mounts the developer-facing upstream plugin rows; removing the rows the product shell does not ship and swapping in the rewritten ones is scoped to the later board issues (#56–#60), not this scaffold.
- **The managed URL variable keeps the `DSH_WEB_URL` name** — spec §4 rules a `DAYPAW_WEB_URL` rename, but managed shell variables live in the reserved `DSH_*` namespace ([`dsh-subprocess`](../../subprocess/subprocess/README.md) strips ambient `DSH_*` and [`dsh-shell-env`](../../shell/shell-env/README.md) rejects other prefixes at registration), so the rename requires widening that upstream contract first.

### Dev Note
