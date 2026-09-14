## What this changes

<!-- One or two sentences. What was wrong, or what is new. -->

## Why

<!-- If it fixes an issue, link it: Fixes #123 -->

## Tests

- [ ] `npm test`
- [ ] `npm run build` (this type-checks first)

<!-- Paste the counts, e.g. "167 passing". -->

## Checks

- [ ] No allowlist of publishers, model families, architectures, or quantizations was added. Model handling stays capability-based.
- [ ] No test downloads weights, picks a developer's installed model, contacts a cloud service, or writes into the real application-data directory.
- [ ] No benchmark history, model output, local path, credential, database, `work/`, or `outputs/` content is committed.
- [ ] Third-party notices and dataset provenance are intact.
- [ ] If a benchmark protocol changed, its protocol identifier changed too, so unlike runs are not presented as a controlled comparison.

## If this touches settings, IPC, or the window

- [ ] The API token still never reaches the renderer; `snapshot` still returns `publicSettings()`
- [ ] Permission requests from the window are still denied
- [ ] `contextIsolation`, `sandbox`, and the CSP are unchanged, or the change is explained below

## If this touches the interface

- [ ] Headings say what the page is for rather than selling it
- [ ] Toggle controls report their state (`aria-pressed`), progress exposes its values, dialogs use `useModalDialog`

## Anything reviewers should look at closely

<!-- Trade-offs, things you were unsure about, things you deliberately left out. -->
