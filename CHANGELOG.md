# Changelog

All notable changes to Local Model Bench are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project uses
[semantic versioning](https://semver.org/spec/v2.0.0.html).

Dates are the date the version was prepared.

## 1.15.0 — 2026-09-17

### Changed

- **Flash attention is on by default, and a run states it rather than inheriting it.**
  It was only ever turned on as a side effect of quantizing the cache, so every other
  run took whatever LM Studio happened to have set — which is not a neutral choice.
  Measured on Gemma 4 26B A4B at f16 cache, changing nothing else:

  | Engine | Flash | Prompt processing | Fixed cost per request |
  | --- | --- | --- | --- |
  | ROCm | off | 260 tok/s | 7.1 s |
  | ROCm | on | 1281 tok/s | 0.06 s |
  | Vulkan | off | 277 tok/s | 9.2 s |
  | Vulkan | on | 1822 tok/s | 0.10 s |

  That is about five times the prompt processing and the difference between seconds and
  milliseconds before a first token, on both engines. It also explains an earlier
  reading of these runs: ROCm looked slower than Vulkan only because every fast ROCm run
  happened to have quantized its cache, which forced flash attention on.

  **Use flash attention** on the Run screen is on unless turned off, written to LM
  Studio's per-model configuration for each load and restored afterwards, and checked
  against what LM Studio reports before anything is measured. Turning it off is a
  supported choice — it is the only way to measure the cost — and the run warns what it
  will do. A quantized cache with flash attention off is refused up front, because
  llama.cpp cannot do it and LM Studio's refusal names neither setting.

  Runs saved before this leave the field unset and were measured under whatever LM
  Studio had at the time, so they are not evidence either way.

## 1.14.0 — 2026-09-17

### Added

- **The server does not have to be this machine.** The endpoint was restricted to
  loopback, so LM Studio on another PC, a box on the LAN, or anything else speaking the
  same API could not be benchmarked from here. Any http:// or https:// address is now
  accepted. What is still refused is anything that is not an origin: credentials in the
  URL, which belong in the API token field where they are encrypted at rest and never
  reach the window, and a path, query or fragment, which would change what the address
  means.

  Pointing somewhere else changes what this app can honestly claim, so it says so rather
  than leaving the old promise on screen. The sidebar reads **Remote endpoint** with the
  host instead of *Your prompts stay on this PC*, and the settings field warns that
  prompts, responses and any token will leave the machine — noting when a plain http
  address means they travel unencrypted. The badge follows the saved setting, not what is
  being typed, so it describes where runs actually go.

## 1.13.0 — 2026-09-17

### Changed

- **The three starter JSON tests now accept a fenced answer.** subnet, facts and
  json-extract ask for "only JSON" and say nothing about code fences, so a model that
  wraps correct JSON in ```json was being scored zero for a markdown habit the prompt
  never mentioned. Measured on Gemma 4 26B A4B: every subnet value correct, scored 0;
  every extraction value correct, scored 20. Those three tests set `allowCodeFence`,
  and already-saved copies are migrated once on startup, so existing installs pick the
  change up rather than only new ones. A test you have edited yourself keeps whatever
  rules it has.

  The accounting pack is deliberately excluded: its prompt says "no prose or code
  fences", which makes the fence part of what it tests, and it still fails one. So does
  any test that has not opted in, along with a fence that never closes, several fenced
  blocks, and prose around the JSON.

  This changes what those three tests score. Runs saved before it keep the numbers they
  were given, so a quality comparison that spans the change is comparing two scoring
  rules as well as two models.

## 1.12.1 — 2026-09-17

### Fixed

- **A correct JSON answer inside a code fence scored zero.** Models asked for "only
  JSON" very often return it wrapped in a ```json fence. That is markup around the
  answer rather than prose instead of it, and this app already unwrapped exactly the
  same wrapper when reading a judge's reply — but not when scoring the model being
  tested. Measured on Gemma 4 26B A4B: all five subnet values correct, fenced, every
  check failing with "Unexpected token '`'", for a score of 0; and the extraction test
  scored 20 with all four values right. The JSON-shaped checks now read the answer with
  a single complete surrounding fence removed, and say so in the check detail rather
  than unwrapping silently. A fence that never closes, a reply holding several fenced
  blocks, and prose around the JSON are all still failures, because those are different
  things to get wrong. Every other check still sees exactly what the model wrote.

## 1.12.0 — 2026-09-17

### Added

- **Off / text-only can now actually load without the projector.** The toggle only
  ever controlled whether an image was *sent*; the projector loaded regardless, because
  LM Studio attaches one from the model's index entry and from nowhere else. Rechecked
  against LM Studio 2.40.0: none of the 24 `llm.load.*` keys in its bundle mentions
  vision, and its llama-server carries no `--mmproj` flag at all, since it drives the
  engine through its own bindings rather than a command line. So the toggle now drives
  the one thing that does work — the text-only copy this app already builds. With
  **Off / text-only** selected, any chosen model that would still load a projector is
  named, with one button to select the text-only copies that exist and another to make
  the ones that do not. Copies are hard links and cost no disk. A model with no
  projector is left alone, and a run that cannot be made fully text-only says so
  rather than implying otherwise.

### Fixed

- **Calibrated prompt processing was blank on every sweep.** The engine stored each
  calibration under one key shape and the results screen looked it up under another,
  so the column existed and never resolved — on exactly the runs it was built for. Both
  sides now use one `calibrationKey()`, which also drops a doubled prefix that spelled
  depth 0 as "MTP MTP off". Calibrations saved under the old shape are still read, so
  finished runs keep their measurements.

## 1.11.1 — 2026-09-17

### Fixed

- **The depth axis existed but nothing opened on it.** 1.11.0 added *Read across* and
  then defaulted it to concurrent requests, so a prediction-depth sweep still opened
  showing every depth stacked at one horizontal position — the control was there, but
  the graphs looked exactly as they had before and the feature was invisible unless
  you went looking for it. The graphs now open on whichever dimension the run actually
  varied: a run that swept depths at a single concurrency level opens on maximum
  predictions, and anything that varied concurrency still opens on concurrency.
  Choosing an axis by hand continues to override it.

## 1.11.0 — 2026-09-17

### Added

- **The graphs can read across MTP depth.** They always plotted against concurrent
  requests, which is the right axis for a concurrency sweep and the wrong one for a
  prediction-depth sweep: a sweep run at a single concurrency level put every depth at
  the same horizontal position, so six depths drew six dots stacked on one vertical
  line and the only trace of the depth was a legend entry. **Read across** on the
  Automatic graphs now switches the horizontal axis to maximum predictions, turning
  each model into one curve over its depths. It appears only when a run measured more
  than one depth, and depth stops being folded into the series name while it is the
  axis, so a model is one line rather than one flat point per depth. The concurrency
  axis is unchanged for every other run.

## 1.10.1 — 2026-09-17

### Fixed

- **Quantizing the context made every load fail.** llama.cpp cannot use a quantized
  key/value cache without flash attention, and LM Studio refuses the load outright
  rather than falling back: *"V Cache Quantization requires flash attention to be
  enabled."* 1.10.0 wrote the cache fields and assumed flash attention was already on,
  which is not dependable — it varies by engine and by whatever the model was last
  loaded with. A run that asks for a quantized cache now writes the flag that makes it
  possible, into the same per-model configuration, for the same single load, and
  restores it with the rest. A run that leaves the cache alone does not touch the
  setting at all. A load that comes back reporting no flash attention is refused
  before anything is measured, rather than reporting a cache that was not in use.

## 1.10.0 — 2026-09-17

### Added

- **Choose which llama.cpp build a run uses.** LM Studio keeps one selected engine
  at a time and has no per-load switch, so which build produced a set of numbers was
  not recorded anywhere and could not be recovered afterwards. A run can now name an
  engine; it is selected before the first load and the previous choice is put back
  when the run ends, whatever happens to the run. On an RX 9070 the difference is not
  subtle: measured on Gemma 4 12B Q4_K_XL, Vulkan 2.40.0 reached 1027 tok/s of prompt
  processing against ROCm 2.40.0's 148 tok/s, and ROCm carried roughly 16 s of fixed
  cost before its first token at every prompt size tested.
- **Quantize the context.** The key/value cache is the part of a run's memory that
  grows with concurrency rather than with the weights: an instance holds context ×
  parallel slots of it. K and V can now be set independently to q8_0, q5_0, q4_0,
  iq4_nl or f16. LM Studio exposes no flag for this, so the setting is written to its
  own per-model configuration for the length of one load and the file is put back
  byte for byte afterwards, the same discipline the MTP head already used. Measured
  cost on Gemma 4 12B Q4_K_XL: q8_0 for both cost about 9% of prompt processing
  (569 tok/s to 519 tok/s).
- **Results read one question at a time.** The comparison table is offered under
  three headings — all measurements, prompt processing, and token generation — each
  carrying the columns that bear on that question. Generation gains total throughput
  beside the per-request rate, the MTP depth, drafted-token acceptance, and what each
  extra concurrent user costs every other one.
- **Set another engine's numbers beside this run's.** Where saved runs measured the
  same models on a different engine, the results screen offers Show ROCm, Show Vulkan
  or Show all engines, and the table gains an engine column. The graphs gain a
  Compare with menu listing other engines and other models, drawn as their own lines.
  Nothing is recalculated: every overlaid point is a saved row, newest run per
  measurement. The engine is also a filter and a grouping in the history overview.

### Fixed

- **Prompt processing was reported at roughly a third of its real speed.** The figure
  came from LM Studio's prompt_processing interval, which in practice lands within a
  millisecond or two of time-to-first-token, so it carried the whole fixed cost of a
  request — HTTP, tokenization, scheduling, the first sampling step — on top of the
  prefill. At the prompt sizes the performance tests use, that fixed cost *was* the
  measurement. No single request can separate a fixed cost from a per-token one, so
  each loaded model is now measured twice, over a short prompt and a long one; the
  fixed cost is identical in both and cancels, leaving the real per-token rate and
  naming the overhead that was being charged to the GPU. The older per-request figure
  is kept beside it rather than silently replaced.
- **A load that ran out of room named none of the settings that caused it.** LM Studio
  reports it in its own words, which never mention context, concurrency or the cache.
  Failures that look like memory now carry the arithmetic the run already did — the
  tokens actually asked for, the weights, LM Studio's own estimate — and the three
  settings that change it.

## 1.9.0 — 2026-09-15

### Added

- **An optional preflight for the MTP head.** LM Studio's metadata confirming that
  a model's prediction heads exist and match does not mean its runtime can load
  them against that exact file. **Check the MTP head loads first** on the Run
  screen loads each selected model once with MTP on, at the run's own parallel
  slots and context, before anything is measured. A model whose head will not load
  is named and its MTP depths are skipped; its MTP-off baseline still runs. Off by
  default: it costs one extra load per model whose head does load, and what it buys
  is finding out early rather than a shorter run. Measured on a two-model, two-depth
  sweep against a head that will not load: reported at 25 s with the check and 82 s
  without, with identical measurements either way.

### Fixed

- **A failed `lms` command was unreadable.** The CLI draws an animated progress bar,
  and on failure the whole stream — cursor codes, colour codes and one repaint frame
  per percent — became the error message. Saved run logs held up to 11,195 characters
  for a single failure, with LM Studio's own one-line cause buried inside. The
  progress frames and escape codes are now stripped and the duplicated failure block
  collapsed, turning that example into 353 readable characters.
- **A run that lost one model said only how many things failed.** The summary now
  names each model and depth that went unmeasured, and states that everything else
  in the run was measured and saved.
- **Native MTP for models whose prediction heads are a separate file.** LM Studio
  ships MTP two ways: heads built into the model's own GGUF, and heads stored with
  it as their own file that LM Studio indexes separately. Only the first had a
  command-line switch, so Gemma 4 — which ships the second kind — was reported as
  having no native MTP at all and could not be benchmarked with it. A model is now
  paired with a head in its own folder by structure alone: prediction layers
  declared, output width equal to that model's hidden size, and that model's
  architecture under LM Studio's "-assistant" suffix. Two heads that both fit are
  reported as ambiguous rather than guessed between.
- **Loading a separate head.** LM Studio exposes the setting in neither its CLI nor
  its HTTP API, so it is written into LM Studio's own per-model configuration for
  the length of one load and that file is restored byte for byte immediately after,
  whether the load succeeded or failed; a file this app created is deleted again
  along with any folders it had to make.
- **Confirming a separate head.** LM Studio reports nothing about one through its
  API, so a load is confirmed against its engine log, which has to name that exact
  head file before anything is measured. A sweep's MTP-off baseline is checked the
  same way in reverse: a head loaded for the baseline abandons that depth rather
  than letting every other depth be compared against a speculative run.
- **Text-only copies of vision models.** A vision projector belongs to the model entry
  LM Studio indexed, not to the load: its whole projector handling reads `mmproj_path`
  straight off that entry, with no flag, no API field and no load-config key in front of
  it. So Vision off could only ever mean "no image was sent", never "the projector was
  left out" — and a model like Gemma 4, whose projector sits in its own folder, could not
  be measured without it. The Models screen gains a **Vision projectors** panel that makes
  a second, projector-free entry for LM Studio to index: a sibling folder of hard links to
  the same weights, with the projector left out and any MTP head linked in so the copy
  keeps native MTP. Nothing is duplicated — the copy shares the original's bytes and uses
  no extra disk space — and removing it deletes links only, refusing outright if the folder
  holds any file that exists nowhere else.
- **Accepted-draft rate.** Every wave run with MTP on now records how much of the drafting
  the main model actually kept: the share of drafted tokens accepted, and the mean accepted
  run per drafting step. LM Studio publishes neither through its API, so both are read from
  the per-request lines its engine prints, pooled over the wave by drafted tokens rather than
  averaged across requests. They appear in the sweep panel, the Markdown export, and as
  `draftAcceptance` and `draftMeanLen` columns in CSV. MTP off reports no rate at all, which
  is not the same as a rate of zero.
- **Concurrency is swept alongside depth.** A sweep could always be given several concurrency
  levels, but the results pooled them into one row per depth. Each level is now measured and
  reported on its own, and a depth is only ever compared with another depth under the same
  load — the depth that is fastest at one request at a time need not be the fastest with five
  in flight, and pooling hid exactly that.
- **MTP speed sweep button** on the Run screen: one click sets the run to speed
  only, turns MTP on, and sweeps depths 0 through 5 — every draft depth from 1 to 5
  against the MTP-off baseline.
- Model cards carry an MTP badge saying which of the two shapes a model has, or why
  its support is unknown.
- **Maximum predictions sweep.** With native MTP on, a run can measure several
  prediction depths instead of one. Depth is fixed when a model is loaded, so each
  depth is a separate load and a separate pass over the whole workload; the run
  preview says how much larger that makes the run before it is started. Depth 0
  means MTP off, so the sweep can include the baseline a speed-up has to beat.
- Results gain a **Maximum predictions sweep** panel: a row per depth with speed,
  throughput, latency, time to first token and objective score, the spread behind
  each average, and a sentence naming the fastest depth and what it gained. A gap
  no larger than the spread of the measurements is reported as exactly that rather
  than as a winner, including when the baseline is the one marginally ahead.
- Markdown exports gain a **Native MTP sweep** section, and CSV exports an
  `mtpDepth` column.
- The run history overview gains an **MTP depth** condition, so pooling across
  runs separates depth 2 from depth 4 instead of merging both under "on".

### Changed

- Every saved response and wave records the MTP depth it was measured at. Summary
  rows, the comparison table, the automatic graphs, benchmark pack scores and the
  history overview are all keyed on it, so two depths are never averaged together.
  Runs saved before this change carry no depth and are grouped exactly as before.
- A retry re-runs each failed request at the depth it was originally measured at,
  and does not load a depth that has nothing to retry.

### Fixed

- The version shown in the window was typed into the markup by hand and had stopped
  matching the installer: 1.9.0 was packaged and installed while its own sidebar
  still read "1.8.0". It now comes from `package.json` at build time, so the number
  in the window and the number in the installer's name cannot disagree again.
- A sweep announced its own baseline as "MTP MTP off" while loading and while running
  each wave: the progress line prefixed "MTP " to a label that already began with it.
- The Playwright QA scripts under `scripts/` waited for a window heading that was
  renamed in 1.8.0, so every one of them timed out on its first assertion. They
  now wait for the heading that exists.
- `electron/validation.ts` held two literal control bytes inside a character
  class, which made git treat the whole file as binary and its diffs unreadable.
  They are now written as escapes. The token check behaves identically.

## 1.8.0 — 2026-09-14

First version prepared for public release. Everything below is measured against
1.7.x, which was never published.

### Added

- **Import your own pack.** A JSON, JSON Lines, CSV, or TSV file of questions and
  answers becomes a benchmark pack with a scoring rule you choose. Capped at
  5,000 questions and 25 MB. Imported packs live beside the published ones and can
  never take over a published pack's id.
- **MIT license.** `LICENSE` is now present, `package.json` declares it, and
  `THIRD_PARTY.md` separates it from the bundled components, which keep their own
  terms.
- `LICENSE` and `THIRD_PARTY.md` ship inside the installer. The only pointer to
  LibreHardwareMonitor's source is in `THIRD_PARTY.md`, and MPL-2.0 requires
  recipients of a binary to be told where to get it.
- `.gitattributes`, so line endings are consistent and the 2.75 MB question file
  stays out of diffs and language statistics.
- `THIRD-PARTY-NOTICES.txt`, generated by the build and shipped in the installer.
  react, react-dom, scheduler and lucide-react are compiled into the bundle and the
  minifier strips their copyright banners, so without it the installer distributed
  MIT and ISC code without the notice those licences require. The build fails
  rather than emit an incomplete file, and CI fails if the committed copy drifts.
- `repository`, `homepage` and `bugs` metadata in `package.json`, pointing at
  `M007-Net/local-model-bench`. The in-app updater does not read these — it takes
  its repository from **Settings → Updates**, and stays off until you name one — so
  a fork inherits no update checking it did not ask for.

### Fixed

- **Exporting a run of imported questions crashed.** The HTML and Markdown reports
  looked the pack's description up in a three-entry table of published benchmarks,
  so any imported pack — and any run whose pack had since been deleted — threw
  `Cannot read properties of undefined`. Both formats now describe the benchmark
  from the metadata the saved run itself carries. CSV and JSON were unaffected.
- **A grader that could not run scored the model as wrong.** An instruction check
  this build does not implement threw, was caught alongside "the answer was not
  JSON", and counted as a failed check with its full weight in the denominator —
  silently lowering a benchmark score with nothing in the number to show it. Such
  a check is now marked unscorable and left out of both sides of the score, and an
  unsupported check is refused while the test is being written.
- **A failure before the window opened left an invisible process.** Anything thrown
  while opening the database — a corrupt file, a locked one, a folder that could
  not be created — was an unhandled rejection: no window, no message, and the
  single-instance lock still held, so relaunching did nothing. Startup now reports
  the failure and exits, a database that cannot be opened at all is moved aside and
  recreated, and one unreadable row no longer makes every saved run unreachable.
- **The path to the LM Studio CLI was only checked for being a string.** Any
  existing file, including one on a network share, could become the executable the
  app launched. It must now be an absolute local path to an `.exe`, checked both
  when saved and when used.
- **Settings persisted whatever the window sent.** The stored object is now built
  field by field rather than by spreading the incoming one.
- **A second instance could rewrite a running benchmark.** `app.quit()` is
  asynchronous, so the losing instance kept going and opened the same database,
  where recovery marked the in-flight run interrupted.
- **An update could be installed without a checksum, and was not re-checked before
  running.** A release that publishes no checksum is now refused, and the installer
  is hashed again at the moment it is launched, so a file swapped between
  verification and the click is deleted rather than run.
- **Every LM Studio connection failure read "fetch failed".** Connection refused,
  an IPv4/IPv6 mismatch on `localhost`, a wrong port answering with HTML, and a
  timeout now each say what happened and what to do. The model list also honours
  the configured load timeout instead of a hardcoded ten seconds.
- **An imported grade did not appear until the app restarted.** It replaced an
  existing row rather than adding one, so the history cache saw no change.
- **Exports were written in place with no error handling.** A full disk left a
  truncated report that looked complete. Reports are now written beside the target
  and renamed into place.
- **Instruction keywords were compiled as regular expressions.** A keyword such as
  `(a+)+$` could backtrack for an unbounded time on the worker thread, where cancel
  cannot interrupt it. Keywords are matched literally, which is what they always
  were.
- **A stray line on the GPU sampler's stderr disabled telemetry for the run** — in
  the report only. Readings kept arriving while the note claimed none were
  available. Only a real error or a non-zero exit counts now.
- PowerShell is launched from an absolute path rather than found on `PATH`.
- The history overview could show older data than it had already loaded, because two
  overlapping reads could finish out of order.
- Clearing the question seed silently selected seed 0, quietly changing which
  questions a run asked. Clearing any numeric field now keeps the previous value.
- `NaN` and `∞` could reach the run preview; concurrency levels outside 1–256 are
  now reported rather than silently accepted.
- Removing an imported pack left the Run screen pointing at it with Start enabled.
- Four grouped fields wrapped their checkboxes in a second `<label>`, so clicking
  the caption toggled the first checkbox and a screen reader read that checkbox by
  the group's name.
- Benchmark cards, the running indicator, and imported-pack ids are now announced
  correctly; an empty timestamp renders as `—` rather than `Invalid Date`.
- An imported pack's item id and rubric are now bounded, as prompts and answers
  already were.
- `npm run qa` explains that it needs LM Studio running instead of printing a
  Playwright stack trace.
- The benchmark HTML report carries the same Content-Security-Policy as the chart
  report.

### Changed

- **CI runs on a supported action runtime, and tests the Node floor it claims.**
  `actions/checkout` and `actions/setup-node` were pinned to v4, which targets the
  Node 20 action runtime; runners now force those onto Node 24 and warn on every
  run. They are pinned to v7.0.1 and v7.0.0 by commit SHA. The build job also ran
  on Node 24 alone, so it is now a matrix over 22 and 24 — `package.json` declares
  `>=22`, and `node:sqlite`, which the store and several tests depend on, only
  arrived in 22.5 as experimental. That it works on 22 is now checked rather than
  assumed. Verified in a scratch repository before being applied here.

### Documentation

- The README now opens with a plain-language guide: what the app is for, the two
  things you need, and numbered steps through installing it, running a first
  benchmark and reading the result, plus what to do when something looks wrong.
  It previously opened with model-compatibility detail — reasoning intersections,
  MTP metadata, quantization — before telling anyone what to do.

- The update check names both hosts it contacts, not one.
- The guarantee that no image leaves the machine is stated as what this app
  enforces, rather than attributed to LM Studio.
- The LM Studio requirement is stated as the endpoints the app actually needs,
  replacing a version number that no code checked and that the project's own issue
  template contradicted.
- Building from source now includes the clone step, says the commands run in order,
  and explains that `npm start` needs `npm run build` first.
- Node version is stated consistently with `engines` and CI.
