# Local Model Bench

A Windows desktop app for testing downloaded LM Studio models at multiple concurrency levels, keeping the full responses, and grading them transparently.

> **This is an unofficial community project.** It is not affiliated with,
> endorsed by, or supported by LM Studio. It talks to LM Studio's local API on
> loopback, and to nothing else.

## What this is, in plain words

You already run AI models on your own computer using a free program called
**LM Studio**. This app asks those models a set of questions, times how fast they
answer, checks whether the answers are right, and shows you the results side by
side. Everything happens on your machine. Nothing is uploaded.

It is useful for answering questions like *"is the bigger model actually better
for what I do, or just slower?"*

It only measures models you have already downloaded. It never downloads a model,
never runs code a model writes, never browses the web, and never contacts a cloud
AI provider.

---

## Contents

- [Before you start](#before-you-start) — the two things you need
- [Step 1: Install and open the app](#step-1-install-and-open-the-app)
- [Step 2: Run your first benchmark](#step-2-run-your-first-benchmark)
- [Step 3: Read the results](#step-3-read-the-results)
- [If something looks wrong](#if-something-looks-wrong)
- [Build from source](#build-from-source) — only if you want to compile it yourself
- [Choose the engine, and compare engines](#choose-the-engine-and-compare-engines-1100) — which llama.cpp build, and setting two side by side
- [Quantize the context](#quantize-the-context-1100) — the memory that grows with concurrency

Everything after that is reference material. You do not need it to get going.

---

## Before you start

You need two things. Both are free.

**1. LM Studio, with at least one model downloaded.**

- Get it from <https://lmstudio.ai> and install it like any other program.
- Open it. Go to the **Discover** tab (the magnifying glass), pick any model, and
  press **Download**. A small one is fine to start — look for something around
  4 GB. This takes a while; it is a large file.
- Go to the **Developer** tab and turn the local server **on**. You should see it
  say it is running on port `1234`.

> **Why the server?** Local Model Bench talks to LM Studio the same way a web page
> talks to a website — except it never leaves your computer. If the server is off,
> there is nothing for it to talk to.

**2. Windows 10 or 11, 64-bit.** That is all. You do not need an administrator
account, and nothing here needs Python or a terminal.

---

## Step 1: Install and open the app

1. Go to the
   [Releases page](https://github.com/M007-Net/local-model-bench/releases) and
   download the file named `Local-Model-Bench-Setup-1.9.0.exe`.

   > If that page is empty or you cannot open it, no release has been published
   > yet. Until one is, the only way to get the app is
   > [Build from source](#build-from-source), which needs a little comfort with a
   > terminal. It is fine to wait for a release instead.

2. **Check the file is genuine before you run it.** This installer is not
   code-signed, so this check is the only way to be sure you got the real file.
   Right-click the Start button, choose **Terminal**, and paste this in:

   ```powershell
   Get-FileHash -Algorithm SHA256 "$HOME\Downloads\Local-Model-Bench-Setup-1.9.0.exe"
   ```

   It prints a long string of letters and numbers. It must match the one listed on
   the release page. **If it does not match, delete the file and do not run it.**

3. Run the installer. Windows will show a blue box saying **"Windows protected
   your PC"**. This is expected — it appears for any program without a paid
   signing certificate, not because anything is wrong. Click **More info**, then
   **Run anyway**.

4. Choose where to install it, then finish. You get a desktop shortcut.

5. Open **Local Model Bench**. It opens on the **Models** screen.

---

## Step 2: Run your first benchmark

1. Look at the top-right corner. It should say **LM Studio connected**. If it says
   something else, see [If something looks wrong](#if-something-looks-wrong).

2. Your downloaded models appear as cards. **Click one** to select it. A tick
   appears in its corner. You can pick more than one to compare them.

3. Click **Configure benchmark**.

4. Click **Quick**. That is a short run, good for a first go.

5. Click **Start benchmark**.

The app now sends the questions to the model and waits. A first run on a small
model takes a few minutes. You can watch the responses arrive as they come in.
Leave it alone until it finishes.

---

## Step 3: Read the results

When it finishes you land on **Results**.

- **Generation tok/s** — how fast the model writes, in words-ish per second.
  Bigger is faster.
- **Objective** — out of 100, how often the answer was actually correct, checked
  automatically. Bigger is better.
- **Median latency** — the typical wait before an answer. Smaller is better.

Every response the model gave is saved, and you can read any of them. Nothing is
summarised away.

The **Benchmark meaning** panel explains, in plain English, what a score does and
does not tell you. It is worth reading once — a score of 90 on a maths test does
not mean the model is good at everything.

To keep a copy, press **Export** and choose:

- **HTML** if you want something to look at or print.
- **CSV** if you want to open it in Excel.

---

## If something looks wrong

**It says the server is not reachable, or "LM Studio is not answering".**
LM Studio is closed, or its server is off. Open LM Studio, go to **Developer**,
and switch the server on. Then press **Refresh** in Local Model Bench.

**No models appear.**
You have not downloaded one yet, or LM Studio is pointed at a different folder.
Download a model in LM Studio's **Discover** tab, then press **Refresh**.

**It says it cannot find the LM Studio command-line tool.**
LM Studio normally installs this alongside itself. If the app cannot find it, open
**Settings** and point it at `lms.exe` directly — it usually lives in
`.lmstudio\bin` inside your user folder.

**A run stops with an error about context length or memory.**
The model is too big for your graphics card at the settings chosen. Lower the
concurrency to 1, or pick a smaller model.

**The app will not start at all.**
It shows a message box saying why. The most common cause is that its saved data
file was damaged — in that case it moves the old file aside and starts fresh on
the next launch.

---

## Model compatibility

There is no built-in model list or model-family allowlist. The app discovers every language model returned by the local LM Studio `/api/v1/models` endpoint each time you refresh. Install or remove models in LM Studio; no application code changes are needed for new model names, publishers, architectures, or quantizations.

The current backend is **LM Studio native v1**, with its CLI used to load models and verify context and parallel settings. This is a Windows desktop app, not a universal API client: Ollama, cloud providers, embeddings, image generation, and standalone Hugging Face checkpoints are not implemented backends. Vision-capable language models can take the text tests; these benchmarks do not send images.

- **Reasoning:** the menu shows the intersection of settings reported by the selected models. Model default sends no explicit reasoning setting and works with models that expose no reasoning control. Unsupported selections are blocked, not silently changed.
- **Native MTP:** optional and never inferred from a model name, and covering both prediction heads built into a model file and heads shipped as a separate file with it. Several prediction depths can be measured in one run; see [Find the best MTP setting](#find-the-best-mtp-setting-190). On requires confirmed metadata for the exact model file and verified loaded settings. It currently uses LM Studio's local GGUF metadata cache; missing or stale metadata leaves support unknown. MTP requires an LM Studio/CLI runtime exposing the MTP flags and effective settings. Older runtimes may need an update even for a controlled MTP-off run.
- **Vision mode:** `Auto` leaves LM Studio's defaults alone, `Off / text-only` sends no image, and `On` runs a deterministic local image smoke test alongside your text tests. `On` is offered only for models LM Studio positively reports as vision-capable; an unknown capability is never treated as support, and a run stops before measuring anything if the loaded model does not confirm it. LM Studio has **no** load-time option to attach or detach a vision projector — the projector belongs to the model entry itself (an `mmproj` file stored beside the GGUF), so text-only means no image is sent and never claims vision weights were unloaded. A vision-capable model stays fully usable for ordinary text benchmarks. When you want to measure the same weights with the projector left out entirely, see [Benchmark a vision model without its projector](#benchmark-a-vision-model-without-its-projector). Benchmark images are generated locally and sent as base64 data URLs. This app refuses any image that is not a local `data:image/` URL, so no image request ever leaves the machine.
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

## Organize the model library

Search by model name, key, quantization, publisher, architecture, or format. Combine **Vision support**, **Quantization**, **Publisher**, and **Load status** filters. Models with missing vision metadata appear under **Unknown support**, rather than being treated as text-only.

**Sort by** supports name A–Z or Z–A, vision first, quantization A–Z, smallest or largest file size, largest context, and loaded first. Unknown numeric values sort last. The library remembers your view between app launches; **Reset view** clears its filters and restores name sorting.

**Select shown** and **Deselect shown** apply only to visible cards. Hidden selections are preserved and counted above the library. **Clear selection** removes all selections. Cards identify vision support directly.

## Benchmark a vision model without its projector

Some models keep a vision projector (an `mmproj-*.gguf`) in the same folder as
their weights. Gemma 4 does. LM Studio attaches that projector whenever it loads
the model, and there is no way to ask it not to: its whole projector handling is
two lines that read the path off the model entry LM Studio indexed, with no flag,
no API field and no setting in front of them. **Vision off** in a run therefore
means "no image was sent", never "the projector was left out" — the weights are
still loaded and still taking VRAM.

The only thing that changes it is giving LM Studio a *second entry* to index, with
the same weights and no projector. That is what the **Vision projectors** panel on
the Models screen does. **Make text-only copy** creates a folder beside the
model's own named `… - Text only`, containing:

- a hard link to the model's weights — not a copy. It is the same bytes on disk
  and uses no extra space;
- a hard link to any MTP head stored with the model, at the same relative place,
  so the text-only copy keeps native MTP;
- no projector.

LM Studio picks the folder up on its own and lists it as a separate model whose
vision capability is `false`. Refresh the library and it appears beside the
original, so you can select either.

**Remove copy** deletes the folder. Because every file in it is a link, that frees
no space and destroys nothing: the weights stay where they were. Removal refuses
outright if the folder holds any file that exists nowhere else, and it will only
delete folders this app made, identified by a marker file rather than by name.

Hard links need the model folder to be on a single NTFS volume, which a sibling
folder inside the same models directory always is. On anything else the copy is
refused with a reason rather than silently duplicating many gigabytes.

## Find the best MTP setting (1.9.0)

Native MTP lets a model draft several tokens ahead with its own prediction heads,
and the main model then checks that draft. Drafting further ahead can be faster —
or slower, once too many drafted tokens get thrown away. The right number is a
property of the model and your hardware, so the only way to know it is to measure.

The quickest way in is the **MTP speed sweep** button on the **Run** screen. It
switches the run to speed only, turns MTP on, and sets the depths to
`0, 1, 2, 3, 4, 5` — every draft depth from 1 to 5, measured against MTP off.

To set it up by hand instead, turn on **Enable native MTP** and tick **Sweep
maximum predictions**. **Depth 0 means MTP off**, so the sweep includes the
baseline that any speed-up has to beat.

Depth is fixed when a model is loaded, so **each depth is a separate load and a
separate pass over your whole workload**. Six depths is six times the run. The
run preview says so, and shows the total before you start. Start small: one test,
concurrency 1, two waves, three depths.

Concurrency and depth are swept together. Give the run more than one
**Concurrent requests** level and every level is measured at every depth and
reported on its own: five depths at five concurrency levels is 25 combinations per
model. A depth is only ever compared with another depth under the same load,
because the depth that is fastest at one request at a time need not be the fastest
with five in flight.

Results gain a **Maximum predictions sweep** panel, one block per model and one
table per concurrency level:

- a row per depth with generation speed, total throughput, latency, time to first
  token and objective score;
- **draft accepted**, the share of drafted tokens the main model kept, and **mean
  accepted run**, how many it kept per drafting step. Both are LM Studio's own
  figures, printed by its engine as each request finishes and pooled over the wave
  by drafted tokens. MTP off reports neither, because nothing was drafted — which
  is not the same as drafting that was always rejected;
- the spread of the measurements behind each speed;
- a plain sentence naming the fastest depth and what it gained over the baseline.

When the gap between two depths is no bigger than the spread of the measurements
themselves, the panel says so instead of declaring a winner. Add waves and run it
again rather than acting on that. The spread assumes requests are independent,
which requests sharing a concurrent wave are not, so treat it as a floor on the
real uncertainty.

Every response records the depth it was measured at. Graphs draw one line per
model **and** depth, the comparison table and CSV keep `mtpDepth`, `draftAcceptance` and `draftMeanLen` columns, and
the run history overview will not pool two depths into one row.

Sweeping needs confirmed MTP support for every selected model — the same
requirement as turning MTP on at all, checked before anything is loaded. If LM
Studio does not apply a depth it was asked for, that depth is abandoned without
measuring anything, and the rest of the sweep continues.

**Check the MTP head loads first** (optional) goes one step further. Confirmed
support means LM Studio's metadata says the heads exist and match; it does not
mean its runtime can actually load them against that exact model file. Tick this
and every selected model is loaded once with MTP on — at the same parallel slots
and context the run itself will use — before anything is measured. A model whose
head will not load is named in the run log and its MTP depths are skipped; the
rest of that model's sweep, including the MTP-off baseline, still runs.

It is off by default because it costs one extra load per model whose head does
load. **What it buys is when you find out, not a shorter run.** Measured on a
two-model, two-depth sweep where the second model's head will not load: the run
said so at 25 seconds with the check on and at 82 seconds without it, and the
measurements were identical either way. The whole run was 93 seconds with the
check and 82 seconds without — the check made it slightly *longer*, because the
model whose head did load paid for an extra load and there was only one depth to
skip. On a real workload that gap inverts: the depth that cannot load is found
before the baseline is measured rather than after, so you can stop instead of
waiting out a comparison that has nothing to compare against. Sweeps with several
drafting depths also fail once here instead of once per depth.

### Models whose prediction heads are a separate file

Some models keep their MTP heads inside the model file; others ship them as their
own file stored with the model, which LM Studio indexes separately. Gemma 4 does
the second, Qwen3.8 the first. Both count as native MTP here, and a model card
says which one it has.

The difference matters because LM Studio offers no command-line switch for the
separate kind and no field for it in its HTTP API — its own window is the only
place the setting exists. So for those models this app writes the setting into
LM Studio's own per-model configuration immediately before a load and restores
that file, byte for byte, immediately after, whether the load worked or not. A
file it had to create is deleted again. Nothing is left behind for LM Studio to
apply to a load this app did not make.

Because LM Studio never reports that head back through its API, the load is
confirmed against its engine log instead: the log has to name that exact head
file, or nothing is measured at that depth. The MTP-off baseline is checked the
same way in reverse — if a head was loaded for it, the depth is abandoned rather
than used as a baseline it is not.

If two heads in a model's folder both fit it, support is reported as unknown and
the card names both. Removing the duplicate in LM Studio is the fix; this app
will not pick one for you.

## Choose the engine, and compare engines (1.10.0)

LM Studio ships several llama.cpp builds — a Vulkan one, a ROCm one on AMD, a CUDA
one on NVIDIA — and uses whichever is selected when a model loads. There is no
per-load switch, so until now which build produced a set of numbers was not recorded
anywhere and could not be recovered afterwards.

**Inference engine** on the Run screen names one. It is selected before the first
load and your previous choice is put back when the run ends, whatever happens to the
run. Leave it on *Whatever LM Studio has selected* and nothing changes.

The difference can be large and is worth measuring rather than assuming. On an
RX 9070 with Gemma 4 12B Q4_K_XL:

| | Vulkan 2.40.0 | ROCm 2.40.0 |
| --- | --- | --- |
| Prompt processing | 1027 tok/s | 148 tok/s |
| Fixed cost before the first token | none measurable | about 16 s |
| Generation | 61 tok/s | 51 tok/s |

Once two engines have measured the same model, **Results** offers *Show ROCm*,
*Show Vulkan* or *Show all engines* above the tables, and the comparison table gains
an engine column. The graphs gain a **Compare with** menu in the corner listing other
engines and other models; each becomes its own line. Nothing is recalculated — every
overlaid point is a saved row from a finished run, newest run per measurement — and
the other conditions of those runs are whatever they were, so read the engine column
together with the rest of the row. The engine is also a filter and a grouping on the
all-runs overview.

## Quantize the context (1.10.0)

The key/value cache is the part of a run's memory that grows with concurrency rather
than with the weights: an instance is loaded holding context × parallel slots of it.
On a card where the weights already nearly fill VRAM, that is usually what decides
whether a run measures the GPU or measures a spill into system RAM.

**Quantize the context (KV cache)** sets the K and V caches independently to q8_0,
q5_0, q4_0, iq4_nl or f16. K tolerates quantization less well than V, so q8_0 for K
with something smaller for V is the usual choice. It needs flash attention, which
LM Studio turns on by default.

LM Studio exposes no command-line flag for this, so the setting is written into its
own per-model configuration for the length of one load and the file is put back byte
for byte immediately afterwards — the same discipline the separate MTP head uses.
Nothing is left behind to change a load you make from LM Studio's own window later.

It is not free: measured on Gemma 4 12B Q4_K_XL, q8_0 for both cost about 9% of
prompt processing (569 tok/s to 519 tok/s). Quantizing the cache also changes what
the model attends to, so treat quality scores from a quantized-cache run as measured
under that setting rather than as comparable to an f16 run.

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

As of 1.9.0 the suite is 199 tests, covering streaming fragments, timing math,
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
Get-FileHash -Algorithm SHA256 '.\Local-Model-Bench-Setup-1.9.0.exe'
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
empty means the app makes no outbound request at all. The app then asks `api.github.com` for that repository's latest published release, and, if the release publishes a `SHA256SUMS.txt` asset, reads that file from GitHub's release storage so the checksum is known before anything is downloaded. The only hosts it will talk to are `api.github.com` and GitHub's release storage —
`github.com`, `objects.githubusercontent.com` and `release-assets.githubusercontent.com`.
A release file offered from anywhere else is refused rather than downloaded. Drafts and prereleases are ignored, and a release whose tag is not a higher `MAJOR.MINOR.PATCH` than the installed version is not an update.

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

One UI script needs neither LM Studio nor a model, because it drives the window against saved data:

```powershell
node scripts/qa-mtp-sweep.mjs
```

It checks the sweep controls and the sweep panel, graphs and export. Its results half labels a saved run's real measurements with MTP depths so the depth-aware screens have something to draw; those labels are the script's invention, so nothing it prints is a statement about MTP speed. It writes only to `work/`.

No live script automatically chooses a large model or downloads weights. Timing and resource use depend on your selected model and hardware. Some historical UI QA scripts require saved fixture runs; `npm test` is the reproducible core check.

Commit source, bundled benchmark data, assets, vendor files, dependency manifests, and documentation. Do not commit `work/`, `outputs/`, model weights, API tokens, `.env` files, SQLite databases, or exported personal conversations. `.gitignore` excludes these; it does not remove files already tracked by Git. Exported benchmark histories may contain prompts, responses, local paths, and machine metadata and should be reviewed before sharing.

The included Windows GitHub Actions workflow runs `npm ci`, all automated tests, and the production build on pushes and pull requests.

Version history is in [CHANGELOG.md](CHANGELOG.md).

**Project license:** the application's own source is MIT licensed; see [LICENSE](LICENSE). Bundled third-party files are not covered by it and retain their own licenses; see [THIRD_PARTY.md](THIRD_PARTY.md). No GitHub repository is created or published by the app.
