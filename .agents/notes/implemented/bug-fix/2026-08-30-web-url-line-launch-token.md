# Agent Note: Web URL line carries the launch token

Status: implemented

English | [中文](2026-08-30-web-url-line-launch-token.zh.md)

## Problem

The daypaw web app printed `daypaw web: http://127.0.0.1:<port>` without credentials, but the 2026-08-28 sync ported the browser-auth fence into `dsh-client-connection`: a bare origin receives `401 dsh web authentication required; reopen the URL printed by dsh web.` A customer opening the printed line hit a dead end, and the release CLI smoke's plain fetch of `/` failed the same way.

## Decision

- The URL line (loopback and LAN variants) is composed through `connection.authenticatedUrl`, mirroring upstream `bundle/web-app`'s announce: the line carries the process launch token as its sole authentication input. Printing stays inside `ctx.inject(['connection'], …)` behind the existing Loader-settlement and teardown gating.
- The release CLI smoke walks the browser handshake instead of fetching a bare origin: capture the full tokened URL from the line, exchange the token (expect `303` plus a session cookie), then fetch `/` with the cookie and require a page mentioning daypaw. An untokened line or a broken fence fails the smoke by name.
- `DSH_WEB_URL` and the web-surface prompt keep resolving the bare origin, matching upstream: the model does not open browsers, and the variable is context, not a login route.

## Alternatives considered

**Disable browser auth for the daypaw profile.** Rejected: the fence is the product's local-web security stance; the fork composition should carry it, not strip it.

**Probe an auth-exempt health path in the smoke.** Rejected: the customer path is the handshake; an exempt probe would keep passing while the real path dead-ends.

## Consequences

- A freshly installed CLI's printed URL opens the shell directly; the smoke proves the seeded profile, closure, dist, and now the authentication path end to end.
- Web-app tests provide a fake `connection` whose `authenticatedUrl` appends `/?token=t` and assert the tokened lines for the loopback-only and LAN cases.
- The README pairs for `@daypaw/cli` and `@daypaw/web-app` state the tokened line and why the bare origin is rejected.
