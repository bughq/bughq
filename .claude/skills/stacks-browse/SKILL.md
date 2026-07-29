---
name: stacks-browse
description: Use for headless browser QA on Stacks applications — navigation, screenshots, responsive testing, console/network monitoring, and accessibility snapshots. Dependency-free: drives a system browser over the Chrome DevTools Protocol using only Bun (no Playwright/Puppeteer). Invoke with /stacks-browse.
license: MIT
compatibility: Bun >= 1.3.0, TypeScript, a Chromium-family browser on the machine
allowed-tools: Read Edit Write Bash Grep Glob
---

# /stacks-browse — Headless Browser QA (zero dependencies)

You are a QA engineer testing Stacks applications with a **dependency-free** headless
browser driver. It uses **no Playwright, no Puppeteer, no npm packages** — it launches a
Chromium-family browser already on the machine and drives it over the Chrome DevTools
Protocol (CDP) using only Bun's native `Bun.spawn`, `fetch`, and `WebSocket`.

The driver lives at `.claude/skills/stacks-browse/scripts/browse.ts`. Run it with `bun`:

```bash
bun .claude/skills/stacks-browse/scripts/browse.ts <command> <url> [flags]
```

Every command prints a JSON result. Screenshots are written under `.stacks/shots/` by
default; **Read the PNG** to view it.

## Browser discovery (no install step)

The driver finds a browser at runtime in this order, and falls through to the next if one
won't launch:

1. `$BROWSE_BROWSER` (explicit override — set to an absolute browser path)
2. PATH: `chromium`, `google-chrome`, `brave-browser`, `microsoft-edge`, …
3. macOS app bundles (Google Chrome, Chromium, Brave, Edge)
4. A Chromium binary already cached on disk (e.g. under `~/Library/Caches/ms-playwright`) —
   the **binary only** is borrowed; Playwright is never imported.

A candidate is validated with `--version` before use, so a dead wrapper (e.g. a Homebrew
shim pointing at an uninstalled `.app`) is skipped automatically. If none launch, it tells
you to `brew install --cask chromium` or set `BROWSE_BROWSER`.

## Default Stacks dev URLs

- Frontend: `http://localhost:3000`
- Backend API: `http://localhost:3001`
- Admin dashboard: `http://localhost:3002`
- Docs: `http://localhost:3005`
- API: `http://localhost:3008`

> Pages with an open HMR/SSE connection never reach "network idle"; the driver waits for
> the load event (with a timeout) plus a short settle, so it won't hang on the dev server.

## Commands

### Navigate
```bash
bun .claude/skills/stacks-browse/scripts/browse.ts navigate <url>
```
Reports: `title`, HTTP `status` of the main document, `loadMs`, `consoleErrors`, request count, and which browser was used.

### Screenshot
```bash
bun .claude/skills/stacks-browse/scripts/browse.ts screenshot <url> [--viewport 1280x900] [--full] [--element "SELECTOR"] [--scale 2] [--out path.png]
```
- `--full` captures the entire scroll height (via `Page.getLayoutMetrics` + `captureBeyondViewport`).
- `--element` clips to a CSS selector's bounding box.
- `--scale 2` renders at 2× (retina).
- Default output: `.stacks/shots/<path>.png`.

### Responsive
```bash
bun .claude/skills/stacks-browse/scripts/browse.ts responsive <url> [--out-dir DIR]
```
Full-page screenshot at each breakpoint and a horizontal-overflow check:

| Device | Width | Height |
|--------|-------|--------|
| Mobile S | 320 | 568 |
| Mobile L | 428 | 926 |
| Tablet | 768 | 1024 |
| Desktop | 1280 | 720 |
| Wide | 1920 | 1080 |

Reports `horizontalOverflowPx` per breakpoint (0 = no overflow). Shots in `.stacks/shots/responsive/`.

### Monitor (console + network)
```bash
bun .claude/skills/stacks-browse/scripts/browse.ts monitor <url> [--ms 5000]
```
Watches for `--ms` after load. Reports console errors/messages, failed requests (≥400), slow requests (>3s), and total requests.

### Snapshot (accessibility / structure)
```bash
bun .claude/skills/stacks-browse/scripts/browse.ts snapshot <url>
```
Extracts headings, links (`text -> href`), buttons, forms (action + field count), and ARIA landmarks — useful for auditing structure and catching broken links.

## Stacks-Specific QA

When testing a Stacks app, check:
- **Dashboard routes** — admin pages rendering? (`localhost:3002`)
- **API health** — `GET localhost:3008/health` returns ok?
- **Auth flow** — `/login`, `/register`
- **CMS/blog** — `/blog`, post detail pages, `/blog/feed.xml`, `/blog/sitemap.xml`
- **STX components** — do custom components render server-side?
- **Crosswind CSS** — utility classes generating styles?
- **Links** — run `snapshot` and verify hrefs resolve (no `/blog/index`, no `/api/blog/*` 404s).

## Rules

- **No npm install.** Never add Playwright/Puppeteer. The driver is self-contained.
- **The browser is always killed** in a `finally` block; a fresh temp profile per run (no shared cookies/sessions).
- **Never submit forms with real data** unless explicitly asked.
- **Local URLs are fine** (`localhost`, `127.0.0.1`).
- **Report what you see, not what you expect.** Read the PNGs.

## SPA Verification (`spa-probe.ts`, `spa-shot.ts`)

`browse.ts` answers "does this page render?". These two answer the question that actually
breaks stx apps: **"does page B render the same when you *navigate* to it as when you load
it directly?"**

### Why this exists

The stx router swaps `<main>`'s *contents* and keeps the outer element and the rest of the
document. So a page can be perfect on a direct load and broken when arrived at. Real
examples caught in bughq:

- chrome appended to `document.body` survived the swap and painted stale, unstyled
  controls over the next page
- a `class` on `<main>` leaked into the next page, nesting a width constraint and making
  every page reached from `/` 48px narrower
- a page arrived completely unstyled after crossing a shell boundary

None were visible on a direct load, so normal browsing never revealed them.

### `spa-probe.ts` — did it actually SPA-navigate?

```bash
bun .claude/skills/stacks-browse/scripts/spa-probe.ts routes <base> <path...>
bun .claude/skills/stacks-browse/scripts/spa-probe.ts navs   <base> <from>::<to> ...
```

Per navigation it reports `SPA` / `FULL_RELOAD` / `DID_NOT_NAVIGATE` / `NO_LINK`, plus
`mains`, `nestedMains`, `mainClass`, and the layout group before and after.

Detection stamps `window.__spaProbe` before the click and checks whether it survives —
JS context preserved means a fragment swap, gone means a full navigation. This is
timing-independent, unlike waiting on CDP navigation events.

### `spa-shot.ts` — does it render the same?

```bash
bun .claude/skills/stacks-browse/scripts/spa-shot.ts fresh <path> <out.png>
bun .claude/skills/stacks-browse/scripts/spa-shot.ts via <from> <to> <out.png>
```

The oracle is **not a stored baseline** — it's the same URL loaded directly seconds
earlier, in the same browser with the same data and the same clock. The only variable is
the path taken, which is why the diffs are low-noise and there are no golden files to
churn. Capture both, then Read the two PNGs and compare.

### Auth-gated routes

Most app routes redirect to `/login` unauthenticated. **An unauthenticated run will
happily verify the login page N times and report all green** — always check the reported
`at` matches the path you asked for. Seed credentials via env:

```bash
export SPA_COOKIE="bughq_token=$TOKEN"
export SPA_LOCALSTORAGE="{\"token\":\"$TOKEN\"}"
```

### Gotchas that cost real debugging time

- **Settle time.** Default is 1400ms, right for localhost. Remote hosts need
  `SETTLE_MS=5000` — too short reads as a false `DID_NOT_NAVIGATE`.
- **Clicks use `element.click()`, never coordinates.** Coordinate clicks silently miss
  links below the fold or inside hover menus and report a false "did not navigate".
- **`grep -c '<main'` lies.** The injected router script mentions `<main` ~6× in comments.
  Count DOM elements, or strip `<script>` blocks first.
- **SSG artifacts differ from what production serves.** `dist/` may have structural
  defects that never ship if production is SSR. Verify against the running server.
- **A literal `<html>` anywhere in a fragment — even inside an HTML comment — kills
  SPA navigation.** The router treats a fetched fragment that looks like a full
  document as a non-stx page and does a native navigation rather than corrupt the
  shell, and it matches raw text. One comment mentioning `<html>` silently turned
  every app-to-app navigation into a full reload. Write it as "the root html element".
- **A newly created partial isn't picked up until it is modified while the dev server
  runs.** Clearing `.stx/cache` and restarting was not enough; touching the file was.
  A fresh render can therefore be stale in either direction — re-verify after edits.

## Extending

The CDP client (`Cdp` class in `browse.ts`) exposes `send(method, params)` and
`waitFor(event, predicate)`. New QA commands (click, fill, hover, PDF export, coverage)
are a few lines each on top of `Page.*`, `Input.*`, `Runtime.evaluate`, and `DOM.*` — no
new dependencies required.

## Downstream

> **QA complete.** Run `/stacks-retro` to review this development session.
