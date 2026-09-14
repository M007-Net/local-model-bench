# Contributing

Local Model Bench currently targets Windows and LM Studio's native v1 API. Keep model handling capability-based: do not add allowlists for publishers, model families, architecture names, or quantizations. A new model returned as `type: "llm"` should appear without source changes. Optional controls must use capabilities reported by LM Studio or verified metadata for the exact local file.

Before opening a change:

```powershell
npm ci
npm test
npm run build
```

`npm run build` type-checks first, so a type error fails the build rather than
showing up later. `npm run qa` is an additional pass that launches the packaged
window; it needs the Electron binary and is not part of CI.

## The token boundary

The LM Studio API token is encrypted at rest and **must not reach the renderer
process**. `snapshot` returns `publicSettings()`, which reports only
`tokenConfigured: true|false`; `settings()`, which decrypts, is for the main
process request path only. A save that omits `token` leaves the stored one
alone — the window cannot echo back a value it never received.

There are tests over this in `tests/core.test.ts`, including ones that read
`electron/main.ts` directly. If you are changing that area and those tests start
failing, please work out why before adjusting them.

Likewise, every permission request from the window is denied. If you find you
need one, that is worth discussing in an issue first.

## Wording and accessibility

Headings should say what a page is for rather than sell it. Interactive controls
that toggle — model cards, mode buttons — need `aria-pressed`; the progress bar
needs its `role="progressbar"` values; dialogs get their focus handling from
`useModalDialog` in `src/dialog.ts` rather than each rolling their own.

Tests must not download weights, select a developer's installed model, contact a cloud AI service, or write into the user's application-data directory. Use mock model identifiers and an isolated `LMB_DATA_DIR` for desktop checks. Live tests require an explicit `LMB_MODEL_KEY` and belong outside automated CI.

Do not commit benchmark histories, model outputs, local paths, credentials, model files, databases, `work/`, or `outputs/`. Preserve third-party notices and dataset provenance. If a benchmark protocol changes, change its protocol identifier so the app will not present unlike runs as controlled comparisons.

Keep scores narrowly described. A published dataset adapted to this app is not an official leaderboard result unless its complete official protocol is reproduced and documented.
