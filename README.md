# Local Model Bench

A Windows desktop app for testing downloaded LM Studio models at multiple concurrency levels, keeping the full responses, and grading them transparently.

> **This is an unofficial community project.** It is not affiliated with,
> endorsed by, or supported by LM Studio. It talks to LM Studio's local API on
> loopback, and to nothing else.

## Model compatibility

There is no built-in model list or model-family allowlist. The app discovers every language model returned by the local LM Studio `/api/v1/models` endpoint each time you refresh. Install or remove models in LM Studio; no application code changes are needed for new model names, publishers, architectures, or quantizations.

The current backend is **LM Studio native v1**, with its CLI used to load models and verify context and parallel settings. This is a Windows desktop app, not a universal API client: Ollama, cloud providers, embeddings, image generation, and standalone Hugging Face checkpoints are not implemented backends. Vision-capable language models can take the text tests; these benchmarks do not send images.

- **Reasoning:** the menu shows the intersection of settings reported by the selected models. Model default sends no explicit reasoning setting and works with models that expose no reasoning control. Unsupported selections are blocked, not silently changed.
- **Native MTP:** optional and never inferred from a model name. On requires confirmed metadata for the exact model file and verified loaded settings. It currently uses LM Studio's local GGUF metadata cache; missing or stale metadata leaves support unknown. MTP requires an LM Studio/CLI runtime exposing the MTP flags and effective settings. Older runtimes may need an update even for a controlled MTP-off run.
- **Vision mode:** `Auto` leaves LM Studio's defaults alone, `Off / text-only` sends no image, and `On` runs a deterministic local image smoke test alongside your text tests. `On` is offered only for models LM Studio positively reports as vision-capable; an unknown capability is never treated as support, and a run stops before measuring anything if the loaded model does not confirm it. LM Studio has **no** load-time option to attach or detach a vision projector — the projector belongs to the model entry itself (an `mmproj` file stored beside the GGUF), so text-only means no image is sent and never claims vision weights were unloaded. A vision-capable model stays fully usable for ordinary text benchmarks, so a separate non-vision copy of the same model is not needed. Benchmark images are generated locally and sent as base64 data URLs. This app refuses any image that is not a local `data:image/` URL, so no image request ever leaves the machine.
- **Context and concurrency:** the app checks advertised context limits when available, then verifies actual loaded settings. Hardware limits or unsupported load options produce an explicit error rather than silently changing the experiment.
- **Missing metadata:** models remain usable; unknown size, quantization, and capabilities are not invented. Display-only architecture/size hints can be corrected in Results and never determine whether a model may run.

See the [LM Studio model API](https://lmstudio.ai/docs/developer/rest/list) for the backend contract.

## Published benchmarks

The Benchmarks page bundles GSM8K (1,319 questions), an IFEval supported subset (205 prompts), and CRUXEval-O JSON-compatible output prediction (750 items). Choose a question count and seed; every selected model receives the same questions. The Results side panel explains scores in plain English and checks question/protocol identity for saved-run comparisons. These are local adapted protocols, not official leaderboard scores. Full questions and checks are saved with each run.

The custom test library includes 12 objective accounting tests with independently verified arithmetic. No candidate code is executed. Published source licenses are under `vendor/benchmark-licenses/`.

### Import your own pack (1.8.0)

**Import a pack** on the Benchmarks page turns a file of your own questions into a pack that behaves exactly like the published ones: same seeded question selection, same count and seed, same automatic scoring, same Results panel, and the same pooling in the run history overview.

Bring a **JSON array**, **one JSON question per line**, or a **CSV/TSV with a header row**. Each question needs a prompt and an answer. Call those fields `prompt` and `answer`, or use `question` / `input` / `task` and `expected` / `solution` / `target`; an optional `id` and `rubric` are kept, and questions are numbered if you leave ids out. The CSV reader handles quoted commas, doubled quotes, and line breaks inside a field, so a question containing punctuation is not silently cut in half.

Choose how an answer is checked:

| Scoring | Passes when |
| --- | --- |
| **Final number** | The last line of the response is the answer as a number. Offered only when every answer in the file is a number. |
| **Exact** | The whole trimmed response equals the answer. |
| **Contains** | The answer appears anywhere in the response, ignoring case. |

Because a response is checked against your answer with no interpretation, the model has to be told how to reply. An instruction is prefilled for the scoring you pick, appended to every question, and fully editable — clear it to send your questions exactly as written. The dialog shows the first questions as they were read and **what one request will actually contain** before anything is saved.

An imported pack is stored in your local database next to the runs that use it, gets a SHA-256 fingerprint over its questions so saved runs can be compared for question identity, and can be removed at any time. **Removing a pack never changes a result:** every run keeps its own copy of every question, answer, check, and response it recorded. Published packs are part of the app and cannot be removed. Limits: 5,000 questions, 25 MB, 20,000 characters per prompt.

Imported scores are your own test set, not a published benchmark and not a leaderboard result, and the Benchmark meaning panel says so.

## Get started

Install LM Studio first, download at least one model in it, and start its local
server from LM Studio's Developer tab. Local Model Bench measures models LM Studio
has already downloaded; it never downloads one itself.

There is no prebuilt installer committed to this repository. Either take
`Local-Model-Bench-Setup-<version>.exe` from the
[Releases page](https://github.com/M007-Net/local-model-bench/releases) — visible
only to accounts with access while the repository is private, and empty until a
release is published — or build it yourself with **Build from source** below,
which writes the installer to `outputs/`.

1. Run the installer and open **Local Model Bench** from your desktop.
2. On **Models**, refresh the library. If needed, use **Start LM Studio Server**. LM Studio is required, with its local server started and its `lms` command-line tool installed. Any LM Studio build that exposes the native `/api/v1/models` and `/api/v1/chat` endpoints will work; the app checks for those endpoints rather than for a version number.
3. Select one or more models, then choose **Configure benchmark**.
4. Select **Speed + quality**, **Speed only**, or **Quality only**. Choose tests and a Quick, Balanced, Stress, or Custom sweep.
5. Start the benchmark. Use **Results** to compare measurements and inspect responses.

Only existing downloaded models are used. The app does not download models, execute generated code, browse the web, or automatically contact cloud providers.

## Organize the model library

Search by model name, key, quantization, publisher, architecture, or format. Combine **Vision support**, **Quantization**, **Publisher**, and **Load status** filters. Models with missing vision metadata appear under **Unknown support**, rather than being treated as text-only.

**Sort by** supports name A–Z or Z–A, vision first, quantization A–Z, smallest or largest file size, largest context, and loaded first. Unknown numeric values sort last. The library remembers your view between app launches; **Reset view** clears its filters and restores name sorting.

**Select shown** and **Deselect shown** apply only to visible cards. Hidden selections are preserved and counted above the library. **Clear selection** removes all selections. Cards identify vision support directly.

## Understanding the measurements

- **Generation / request:** LM Studio's reported generation tokens per second for each request. Reasoning tokens are included where the server reports them.
- **Estimated prefill:** Input tokens divided by the client-observed interval between prompt-processing start and end events. Cache reuse, prompt formatting, stream buffering, and batching affect this estimate. Missing or very short timing intervals are shown as unavailable. This is not a direct measurement of uncached engine prefill speed.
- **Total throughput:** Completed output tokens divided by the entire concurrent wave's wall-clock duration. Failed responses do not contribute output tokens; their elapsed time still affects the wave.
- **Median and p95:** Response latency for successful requests. The p95 value is not stable with only a few samples.
- **Warm-up:** One excluded request per loaded benchmark model. Load duration is recorded separately.

Models run one at a time. Server parallel capacity stays fixed at the highest selected concurrency for the entire model sweep. LM Studio serves every parallel slot from one shared context budget, so **Context length** is the amount each concurrent request gets and the instance is loaded with that figure multiplied by the highest concurrency; the run preview shows both. Actual capacity and context length are verified after loading. Loading errors never trigger silently reduced settings. Other models already loaded in LM Studio are left alone, and may affect your benchmark.

Custom tests use fresh conversations and reproducible leading prompt identifiers to reduce cache reuse; published benchmark prompts remain fixed. These measures do not guarantee an empty cache. Short prompts are useful for response latency. Longer performance prompts provide more useful prefill measurements. The same text can tokenize differently across models.

Preset defaults are editable. The run-wide output cap and each test's cap both apply. Increase output allowance for reports and for models that spend tokens reasoning. **Model default** preserves the model's reasoning choice; **Off** is useful for comparisons without reasoning, when all selected models support it.

## GPU thermals (1.4.0)

Every run records GPU sensor readings alongside the speed measurements, so a slow result can be checked against heat rather than guessed at.

- **What is recorded:** core, hot spot, and memory temperature, board power, core load, core clock, fan speed, and memory in use.
- **How often:** once per second for the whole run, including model loading and the idle gaps between requests.
- **Where it appears:** a GPU thermals panel on the Results screen with a timeline chart, a hot spot column in the model comparison table, the peak hot spot on each saved response, and every figure in the CSV, Markdown, JSON, and graph-report exports.
- **Which GPU:** the card with the most memory is recorded, which is the discrete GPU on a machine that also has integrated graphics. Every detected device is listed, and run-level figures are kept for each of them.

Per-request figures use only the readings taken inside that request. A request shorter than the sampling interval contains no reading of its own; the nearest reading is used instead and marked as such, so it is never mistaken for a measured window. Values a card does not expose stay unavailable rather than being estimated. Run-level averages include loading and idle time, so compare peaks, or the per-request figures, when judging sustained load.

Readings come from LibreHardwareMonitor, run in a separate PowerShell process from files in `vendor/`. Sampling is best effort: if the sensor library cannot start, the run proceeds normally and the run log records why. Run `npm run gpu:check` to test GPU telemetry on a machine without starting a benchmark.

## Grading

**Objective scores** are weighted known-answer and requirement checks. Tests support exact answers, contained text, standalone headings, numeric tolerances, valid JSON, expected JSON fields, word counts, and line counts. Contains-text checks establish text presence, not semantic correctness. Report compliance scores do not establish factual accuracy.

**Local judge scores** are optional. The judge loads only after benchmark measurements finish and assesses correctness, completeness, clarity, and instruction following. Each criterion is 0–100; the displayed judge score is their mean. Model identity is omitted from the grading package. Judge output is validated; malformed or missing grades stay ungraded and are recorded in the log. Where supported, the judge's reasoning is turned off to favor a complete structured grade. A model may judge its own output; treat that as a potential bias.

**External grades** use **Copy grading package** in a response's detail window. Paste it into your chosen cloud provider yourself. Copy the returned JSON into **Paste an external grade**, name the provider/model, and save. These grades are labeled separately from local grades and objective scores.

The copy action verifies clipboard contents. If Windows clipboard access is unavailable, the full grading package opens in a selectable text box instead of claiming a successful copy. Click the text, press Ctrl+C, and paste it manually.

The global judge instructions are editable in **Settings**. Each test also has an editable rubric and optional answer key. Runs snapshot their tests and grading instructions so future edits do not change historical results.

## Saving and exporting

**Results → Automatic graphs** creates nine charts for every saved run: generation speed, estimated prefill, aggregate throughput, score, time to first token, median response time, p95 response time, failure rate, and speed versus quality. They refresh as requests and grades arrive. Choose a test to compare like-for-like workloads, and switch the score source between objective checks, local judging, and external review. Hover over points for exact values. Missing measurements stay unavailable instead of becoming zero; model colors stay consistent across graphs.

**Graph report** exports a self-contained HTML file with the graphs, underlying measurements, and run settings for every test. The report includes all three score sources separately, opens offline in a browser, and can be shared without installing this app. Existing saved runs get these graphs automatically; no rerun is required.

The app uses a local SQLite database in its Windows application-data folder. **Settings → Open data folder** shows the exact location. Completed requests are saved immediately. Interrupted runs remain visible after restarting.

- **CSV:** One summary row per model, test, and concurrency.
- **Graph report:** Offline HTML with embedded vector charts and comparison data.
- **JSON:** Complete run configuration, metadata, prompts, responses, measurements, checks, grades, and logs.
- **Markdown:** Readable results and responses.

Cancel stops scheduling new work, aborts in-flight requests, and attempts to unload the instance created by the app. A server that does not immediately honor cancellation may take time to finish cleanup. Failed requests can be retried in a new linked run with their exact original prompts. A partial retry wave uses the actual retry request count, so compare it separately. A model-load failure with no saved failed requests reruns the original configuration.

## Connection and limits

The default server address is `http://127.0.0.1:1234`; only loopback addresses are accepted. Optional API tokens are encrypted with Windows storage and excluded from exports. The API server and command-line tool must control the same LM Studio service.

If a model fails to load, reduce the requested context, parallel capacity, or GPU offload explicitly, then try again. Because the loaded context is the per-request context times the highest concurrency, adding a higher concurrency level multiplies the memory a load needs. If a prompt exceeds context, select a shorter prompt or increase context. Large stress sweeps can exhaust available memory or take considerable time. Model judging is an evaluation aid, not an objective factual oracle.

## Build from source

Requirements: Windows x64, Node.js 22 or newer (CI builds on 24), npm, and, for the live scripts only, LM Studio with a model downloaded.

Run these in order, from the root of a clone:

```text
git clone <this repository> local-model-bench
cd local-model-bench
npm ci          # installs the exact locked dependency set
npm test        # 167 offline checks; needs nothing running
npm run build   # typecheck, bundle the window, compile the main process
npm start       # launches the app from the build you just made
npm run package # optional: writes the NSIS installer and SHA256SUMS.txt to outputs/
```

`npm start` runs the compiled output in `dist-electron/`, which is not committed, so
`npm run build` has to come first. `npm test` and `npm run build` are the only two
commands that need neither LM Studio nor a network connection.

`npm run qa` checks desktop navigation, model discovery, and the test editor. It drives the real window against a running LM Studio, so it needs LM Studio started with at least one model downloaded, and it is deliberately not part of CI; without it the script stops with an explanation rather than a stack trace. Point it at another port with `LMB_QA_BASE_URL`. `npx tsx scripts/qa-gpu.ts` checks that the GPU thermals panel, timeline chart, and comparison column render from a seeded run. Live scripts use the exact model selected through `LMB_MODEL_KEY`; they contain no built-in model identifier. `node scripts/qa-results.mjs` exercises the desktop worker, clipboard grading, result charts, and exports. `node scripts/qa-custom-pack.mjs` imports a question file end to end and checks the preview, the scoring suggestion, CSV quoting, the question cap, and removal. `node scripts/qa-update.mjs` checks, entirely offline, that a default install requests nothing and that the update controls stay disarmed until a repository is saved. `node scripts/qa-history.mjs` seeds two saved runs of the same models at different concurrency and checks the run history overview: pooling, chip filters, regrouping, sorting, the mixed-condition warning, drill-through to a single run, and metadata corrections. Those validation scripts use separate data folders under `work/`.

The Electron renderer is isolated and has no Node.js access, runs sandboxed
behind a Content-Security-Policy, and is denied every permission request it could
make. A narrow preload API connects it to local storage and model controls. The
optional LM Studio API token is encrypted at rest and is never sent to the
renderer: the window is told only whether one is configured. Inference scheduling
runs in a worker thread.

As of 1.8.0 the suite is 164 tests, covering streaming fragments, timing math,
concurrency, scoring, cancellation, loading errors, retries, SQLite recovery, the
pooling and facet rules behind the run history overview, the update check's
version, asset, host and checksum rules, the question-file reader and the scoring rules an imported pack
generates, and the token boundary described in
[SECURITY.md](SECURITY.md).

**The installer is not code-signed.** SmartScreen will show a "Windows protected
your PC" warning, and you will have to choose *More info* then *Run anyway* to
proceed. There is no way around that short of an Authenticode certificate, which
this project does not have.

Because it is unsigned, check the installer's SHA-256 against the value published
with the release before running it:

```powershell
Get-FileHash -Algorithm SHA256 '.\Local-Model-Bench-Setup-1.8.0.exe'
```

If the hash does not match what the release page lists, do not run it.

No background updater is included, and nothing installs itself. See Updates below for the opt-in check.

## Results comparison (1.3.0)

Results, responses, waves, and grades save automatically in the local SQLite database. The database upgrade retains saved runs and adds model metadata corrections.

In Results, use Compare models to choose a broad parameter range (including 20–35B and 25–35B), enter custom bounds, filter Dense/MoE/unknown, or select individual models. Choose MoE to switch between total and active parameters. Filters update graphs, statistics, the comparison table, and response lists. Hover or keyboard-focus a graph point for its model and measurement; click or press Enter to inspect its saved responses.

Parameter counts use saved LM Studio metadata or explicitly labeled structural hints. An active-parameter label such as `35B-A3B`, an architecture containing `moe`, or an expert layout such as `8x7b` identifies a mixture-of-experts model. Any other architecture reported by LM Studio identifies a dense model. Models with no reported architecture stay unknown and are not assumed dense. These labels only organize result comparisons; they never allow or reject a model. Use Edit metadata to supply total parameters, architecture type, and active MoE parameters. Corrections persist for that exact model across saved runs. Existing measurements remain unchanged. Exports contain the full selected run, regardless of display filters; JSON includes saved comparison profile corrections. Local grading applies to the full run.

## Run history overview (1.7.0)

Results has two modes, and the one you are not in stays at the top of the screen so either is one click away.

**Specific run** is the screen described above: one saved run, its Compare models filters, graphs, comparison table, responses, and exports.

**All runs overview** answers the other question — the one you have when you are not running anything and cannot remember which run it was. It pools every saved run into one picture: *what generation speed do the dense models actually reach here? what does IQ3 cost me against Q3? what do the 12B models do?* Nothing is discarded, no measurement is recalculated, and no run is singled out.

Press a value to narrow and All to widen. The Conditions row also filters by benchmark pack, and Group by can roll every run up by pack, so an imported set accumulates across runs the same way a published one does. Model family, architecture, parameters, quantization tier, and exact quantization come from what LM Studio saved with each run, so runs recorded before this version are included without re-running anything. The family is read from the reported architecture (`gemma4` and `qwen35moe` are Gemma and Qwen); the publisher is the repackager and is never treated as the family. Quantization tiers group by bit count, so `IQ3_XXS` and `Q3_K_XL` are IQ3 and Q3; a format with no bit count, such as `F16`, keeps its own name. Dense, MoE, and parameter counts use the same saved metadata and the same user corrections as Compare models, so an Edit metadata correction moves a model here too. Choices inside one row are alternatives; choices across rows all have to match. A value that nothing currently matches stays on offer at zero rather than disappearing under your hand.

Group by model, family, Dense vs MoE, parameters, size range, quantization tier, or exact quantization; sort any column by clicking its heading. Each row expands to the runs behind it, and opening one switches to Specific run with that run selected.

Pooled figures are stated honestly. Generation, prefill, throughput, and time to first token are averaged across runs **weighted by how many requests stood behind each one**, and are reported with the spread they came from, so `43.6 (16.7–59.5)` says the runs disagreed and by how much. Median and p95 are recomputed from the pooled request durations rather than averaged from each run's own percentiles, which would be meaningless. Objective and judge scores count only responses that actually carried a score, so an ungraded run cannot dilute a graded one.

Different runs used different settings. A row that pools more than one concurrency level, prompt size, MTP setting, reasoning setting, or vision mode says so in its Conditions column and is counted in a warning above the table. The Conditions chips hold any of those constant when you want a controlled read instead of a general one. **This overview describes what your machine produced, not a controlled experiment**; exports remain attached to a single run.

## Updates (1.7.0)

**Off unless you turn it on.** With no repository named in Settings, this app makes no outbound request of any kind, which is the state it ships in.

Update checking is off until you name a repository. Enter one as `owner/name` under
**Settings → Updates** — `M007-Net/local-model-bench` for builds of this project, or
your own fork — and optionally tick **Check when the app starts**. Leaving the field
empty means the app makes no outbound request at all. The app then asks `api.github.com` for that repository's latest published release, and, if the release publishes a `SHA256SUMS.txt` asset, reads that file from GitHub's release storage so the checksum is known before anything is downloaded. Those two hosts are the only ones contacted. Drafts and prereleases are ignored, and a release whose tag is not a higher `MAJOR.MINOR.PATCH` than the installed version is not an update.

When there is one, an **Update available** button appears in the header next to the connection status, the way LM Studio does it. It opens a panel with the version, the release notes, the installer's name and size, and its checksum. No installer is downloaded until you press **Download**, and nothing runs until you press **Close and install**. The installer is verified against the published checksum as it arrives and read again immediately before it is launched, so a file that changed in between is deleted rather than run. A release that publishes no checksum is never downloaded for installation.

What the app will accept, in order:

- The release asset must be named exactly `Local-Model-Bench-Setup-<version>.exe`. Any other executable in the release is ignored.
- Its stated size must be plausible and is enforced while downloading; a file that grows past it is abandoned.
- The download must come from `github.com` or GitHub's own release storage, over HTTPS. Any other host is refused.
- The file is hashed while it downloads. If the release publishes a `SHA256SUMS.txt` asset, or names the checksum in its notes, a mismatch deletes the file and the install does not happen. If no checksum was published, the panel says so and shows what was downloaded, so you can compare it yourself before installing.
- Installing is refused while a benchmark is running. It closes the app and launches the NSIS installer, which still asks before replacing anything. Your saved runs, tests, and settings are untouched.

When you publish a release, `npm run package` now also writes `outputs/SHA256SUMS.txt`. Upload it with the installer so the check above can verify the download rather than only display it.

## Contributing and sharing source

Automated tests use mock models and do not require downloaded weights or a running LM Studio server. Desktop UI and live inference scripts need LM Studio. Choose your own exact model identifier for live verification:

```powershell
$env:LMB_MODEL_KEY = "publisher/model@quantization"
npx tsx scripts/live-test.ts
# These two scripts require a model with confirmed native MTP:
npx tsx scripts/verify-benchmarks.ts work/benchmark-live
npx tsx scripts/verify-accounting-mtp.ts work/accounting-live
# Vision end to end; LMB_VISION is auto, off or on (on needs a vision-capable model):
$env:LMB_VISION = "on"
npx tsx scripts/live-vision.ts
```

No live script automatically chooses a large model or downloads weights. Timing and resource use depend on your selected model and hardware. Some historical UI QA scripts require saved fixture runs; `npm test` is the reproducible core check.

Commit source, bundled benchmark data, assets, vendor files, dependency manifests, and documentation. Do not commit `work/`, `outputs/`, model weights, API tokens, `.env` files, SQLite databases, or exported personal conversations. `.gitignore` excludes these; it does not remove files already tracked by Git. Exported benchmark histories may contain prompts, responses, local paths, and machine metadata and should be reviewed before sharing.

The included Windows GitHub Actions workflow runs `npm ci`, all automated tests, and the production build on pushes and pull requests.

Version history is in [CHANGELOG.md](CHANGELOG.md).

**Project license:** the application's own source is MIT licensed; see [LICENSE](LICENSE). Bundled third-party files are not covered by it and retain their own licenses; see [THIRD_PARTY.md](THIRD_PARTY.md). No GitHub repository is created or published by the app.
