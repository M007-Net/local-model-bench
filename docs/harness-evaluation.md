# Multi-harness evaluation

Harness Evaluation measures whether an upstream agent can complete objectively verified tasks using a local model. **Agent Worker Sweep remains unchanged**: its deterministic host stages never execute model output. Harness Evaluation permits agent tool execution only in restricted Linux containers. There is no training, reinforcement learning, paid API requirement, or leaderboard.

## Architecture and research

The research reference is [Hugging Face's multi-harness guide](https://fineenvs-multi-harness-rl.hf.space/). Identical weights can behave differently under different prompts, tool protocols and control loops. This implementation records those differences rather than assigning an unexplained combined score.

Reviewed upstream interfaces:

| Infrastructure | Verified interface / capability | Decision |
| --- | --- | --- |
| [OpenEnv](https://huggingface.co/docs/openenv/getting-started) | Typed reset/step/tool clients; Docker-backed environments; Python client and environment server | Useful for environment standardization and training ecosystems, but would add a Python/server layer for eight small offline tasks. Not required here. |
| [Harbor](https://github.com/harbor-framework/harbor/tree/main/src/harbor/agents/installed) | Installed agents including OpenCode, Mini-SWE-Agent and Hermes; container orchestration and trajectory conversion; Python infrastructure | Practical for larger external datasets. Its orchestration is not used: direct interfaces allow the application to enforce its narrower network and filesystem policy. |
| [Mini-SWE-Agent](https://mini-swe-agent.com/latest/models/local_models/) | LiteLLM OpenAI-compatible custom `api_base`; upstream `DefaultAgent`, `LitellmTextbasedModel`, `LocalEnvironment` | Implemented adapter targets 2.4.6; all Python execution is **inside the container**. Text-based action parsing remains the upstream harness's responsibility. |
| [OpenCode](https://opencode.ai/docs/providers/) | Custom `@ai-sdk/openai-compatible` provider with `baseURL`; `opencode run --format json --model provider/model` | Implemented adapter targets 1.19.0. Native function calling is required and probed. JSON events expose tools and messages. |
| [Hermes Agent](https://hermes-agent.nousresearch.com/docs/user-guide/configuration/) | Custom OpenAI-compatible base URL and auxiliary endpoint configuration; Harbor also provides an installed adapter | Investigated, **not implemented or supported**. Configuration and auxiliary request restrictions require additional adapter work. Disabled in the UI. |
| [LM Studio](https://lmstudio.ai/docs/developer/openai-compat/tools) | `/v1/chat/completions` supports function tools; native model discovery and CLI load remain available | Native discovery/load is reused. Harness inference uses OpenAI chat, without changing existing native benchmarks. |

Both adapters have also been exercised with actual LM Studio inference, tool execution and objective verification using Gemma 4 12B IQ3_XXS on the mean-repair task. This is a smoke test of those pinned versions and that model/task combination, not evidence of compatibility with every model or task. A dependency self-check verifies imports and pinned versions, not task success.

The existing worker-thread architecture runs evaluation off the renderer thread. Separate SQLite `harness_runs` and `harness_trials` tables preserve configuration, task snapshots, trial metrics, verification and bounded events. Existing runs, agentic runs, samples and points are unchanged. Aggregates are derived from trials. No repository files are used as task workspaces.

## Windows setup

1. Install Docker Desktop yourself, enable its WSL2 backend and Linux containers, and start it. Docker Desktop setup can require administrator privileges and a restart; ordinary evaluation uses the running Docker service. WSL is not used to run a second host-side agent service.
2. Start LM Studio's local server. Existing Settings configure the server origin, token and `lms` CLI. Harness APIs are served by the same origin as native discovery. No paid cloud API is needed.
3. **Explicitly approve dependency installation** before running the following image build. The application never installs, pulls or builds harness dependencies automatically. This command downloads packages into a dedicated Linux image; host Python and host harness installations are unnecessary:

   ```powershell
   docker build --tag local-model-bench-harness:1 --file harness/Dockerfile harness
   ```

   The Dockerfile pins Mini-SWE-Agent 2.4.6 and OpenCode 1.19.0. Base image and transitive dependencies can change on rebuild; the actual image digest and runner hash are recorded, so comparisons across different builds should be reviewed. Keep that image to reproduce its environment.

4. Build/start the desktop application using the usual commands:

   ```powershell
   npm ci
   npm run build
   npm start
   ```

5. Open **Agents → Harness Evaluation → Check dependencies**. Missing Docker, Linux container support, image, incorrect package versions or imports disable execution. There is no host fallback.

## First real comparison

Choose one downloaded text model with native tool calling, enable Mini-SWE-Agent and OpenCode, select one task and one trial, use context 8192 and a modest output limit, and start. The seed deterministically selects and orders tasks; select more tasks/repeats for broader observations. The same loaded model instance is used across harnesses; fresh task containers reset every attempt. Exact existing context/parallel load settings are reused, otherwise a uniquely named instance is loaded and cleaned up. Other applications' model instances are not unloaded.

The engine checks model existence, context and reasoning capabilities and confirms effective native load settings. OpenCode's native tool calling is probed before task attempts for that model. A failed probe stops the run, preserving earlier results; models are handled sequentially, so later-model compatibility checks can fail after earlier-model results were recorded. There is no silent harness/model substitution.

Output tokens and temperature are controlled at the relay. Native reasoning `off`, where reported supported, is explicitly mapped to OpenAI `reasoning_effort: "none"` and that wire value is recorded. The live server rejected the native string `off` on its OpenAI API; this was corrected in the adapter, not retried with a silently dropped setting. Explicit `on` is disabled because its OpenAI mapping has not been verified; model default remains available. Server-applied generation settings are not independently echoed by chat responses, so recorded generation parameters are **sent settings**, not a claim of server attestation. Native load settings are read back and checked. An API rejection remains a failure.

Both task environments receive the same Git repository with fixed initial commit metadata, keeping OpenCode's project discovery inside the task. Its CLI gets EOF on stdin; transport input is reserved for the relay reader rather than inherited by tools. OpenCode's global config is read-only, project config is disabled, and built-in auth/external plugins are disabled using its supported runtime flags. The local provider SDK is bundled with the pinned binary, so task execution needs no package downloads.

## Security and inference networking

Agent and verifier containers have `--network=none`, `--read-only`, non-root UID/GID 10001, all Linux capabilities dropped, no-new-privileges, Docker's default seccomp, CPU/memory/swap/process/file-descriptor limits, bounded temporary workspaces, and no host mounts. There are no published ports, privileged containers, Docker sockets, credentials, home folders, documents or application data mounted into them.

Inside the container, a loopback-only HTTP shim accepts only OpenAI chat requests. It transports JSON through Docker stdin/stdout. The application relay validates model identity, overrides bounded inference settings, forwards only a whitelist of body fields to the configured `/v1/chat/completions`, and adds the host's credential. The container receives only a placeholder key. It cannot choose another upstream URL, use redirects, or reach the host/LAN. This also supports Windows-hosted inference with Linux task containers without exposing `host.docker.internal`.

The shim converts a nonstreaming upstream response to SSE for OpenCode. This preserves response content/tool calls but does not measure first-token latency. Response/request transport is bounded, and only fixed application-authored Docker argv are executed on the Windows host. Model commands execute inside the upstream harness in its container.

Verification runs in a second fresh, network-disabled container, with original host-held cases and only declared task artifacts. Candidate functions run in child Python processes; the verifier parent compares JSON outputs to expected values. Agent trajectories are untrusted observations, not verification evidence. Only declared files, each at most 64 KiB, enter the verifier or saved artifacts; symlinks and special/oversized files are refused by the collector. No tar archive is extracted on the host. New undeclared files can be used during an attempt but do not affect verification.

Cancellation aborts relay requests, kills/removes the relevant container and retains saved trials. Containers also have an internal wall-clock watchdog for host crashes. Startup marks running records interrupted and attempts to remove containers labelled with their run IDs. Cleanup failure is surfaced as an error. No unsafe execution path is offered when isolation is unavailable. Docker isolation is a practical security boundary, not a guarantee against kernel/runtime vulnerabilities; keep Docker updated.

## Tasks and scoring

`python-repairs-v1` includes arithmetic mean/empty input, order-preserving deduplication, JSON service configuration, capped exponential backoff, flattening, whitespace slugs, multi-file inventory totals and IPv4 host counts. Each task records ID/version, description, initial files, entrypoint and objective verification cases. The protocol and task snapshot/hash are exported. A successful trial requires a clean harness completion and all verification cases passing; a limit/error with passing files remains an error, with its passing verification visible.

Wall time includes sandbox startup, agent execution and verification. Per-attempt tool and wall-clock budgets plus per-request output and container resources are common across harnesses. Mini's upstream environment wrapper limits actions; OpenCode's returned native tool batches are checked before delivery, with stream-event checks as a second guard. Tool-call counts are top-level harness actions; one shell action may contain multiple commands. OpenCode subagent delegation and network tools are disabled.

The optional total-token control is a **measured stopping threshold**, not an exact hard cap: after the final response crosses it, the next request is denied. Missing usage prevents more requests when this control is enabled. No token counts are estimated. Tool or token limits never cause a different backend to be selected.

## Results and exports

Success rate is primary; duration, tool usage and measured token cost support interpretation. The dashboard shows descriptive Wilson intervals, duration variability in aggregates, category counts, grouped comparison charts and a task outcome matrix. Repeated trials sharing a task are correlated; Wilson intervals are descriptive and not a rigorous generalization claim. One run is not statistically conclusive. These eight authored tasks differ from SWE-bench in dataset, sandbox, budgets and verification; **do not compare these scores to official SWE-bench scores**.

Selecting a matrix outcome displays task objectives, effective configuration, original/final files, verifier output and the chronological model/tool timeline. Token totals become unavailable if any response lacks complete usage. Reasoning tokens are not added twice to completion totals. No universal combined score is computed. Failure labels distinguish verification, context, timeout, resource, inference and broader infrastructure/harness errors; distinguishing model reasoning from harness limitations can require inspecting the trace.

JSON preserves tasks, individual trials, metadata and aggregates. CSV has one row per trial, with `Unavailable` for missing metrics. Markdown is a reproducible summary report. Traces are capped at 1000 events / 1 MB per attempt; truncation is shown. Startup/inference/tool times are available when observed; external process wait is unavailable because its overlap cannot be reliably separated. No first-token/server-only inference timing is claimed. Failed attempts without complete artifacts cannot be verified. File changes show before/after content for declared assets, not a complete filesystem snapshot.

## Validation and known remaining work

Unit tests use explicit mock adapters and require no model, GPU or Docker. Run `npm test` and `npm run build`. Optional live validation requires separately approved/preinstalled image dependencies and a local model:

```powershell
$env:LMB_HARNESS_INTEGRATION = '1'
npx tsx --test tests/harness.test.ts
npx tsx scripts/harness-live.ts --model YOUR_NATIVE_MODEL_KEY
```

The live script never builds/downloads an image. It writes evidence JSON and SQLite history in `work/harness-live`, prints actual per-harness outcomes, and requires actual inference/tool events for both harnesses; it does not require agents to succeed at the repair. A failure is a valid observed evaluation result, but missing tool/inference activity fails the integration check. The measured settings used for the verified smoke test are:

```powershell
npx tsx scripts/harness-live.ts --model 'gemma-4-12b-it@iq3_xxs' --reasoning off --context 16384 --timeout 180
```

`scripts/harness-transport-check.ts` runs both actual upstream runtimes and cancels at their first relay request, without forwarding model inference. `scripts/qa-harness-live.ts` displays saved real results, exports JSON/CSV/Markdown, and checks persistence after desktop restart; `--execute` additionally selects a model/configuration and starts a fresh real comparison through the desktop UI. Only run the inference variant when model execution is authorized.

Initial implementation verification on 2026-10-13: production build and TypeScript passed; the original suite passed (299 tests, one optional image test skipped); existing Agent Worker Sweep desktop QA passed; new Harness Evaluation desktop QA passed with clearly labelled synthetic fixtures and no page errors. A preinstalled Python-capable image was used to confirm UID 10001, zero effective capabilities and no network routes, and objectively verify all eight original fixtures fail and all eight reference repairs pass. This used no model inference and no upstream harness runtime.

After explicit approval, the dedicated image was built and both real adapters were verified on the same model instance and initial Git commit. The first completed live run (`392ee6c4-1fc8-4f30-88f7-2b04375b27e9`) used context 16384, output limit 1024, temperature 0, reasoning off / OpenAI none, 2 CPU cores, 2048 MiB, 30 tool calls and 180 seconds per attempt:

| Harness | Verified outcome | Duration including startup and verification | Model requests | Tool calls | Measured total tokens |
| --- | --- | --- | --- | --- | --- |
| Mini-SWE-Agent 2.4.6 | Success | 52.324 s | 8 | 6 | 12,312 |
| OpenCode 1.19.0 | Verification failure | 20.448 s | 6 | 4 | 29,912 |

OpenCode's attempt produced a literal `\\n` in the Python source, so the independent verifier rejected it. That is an observed task failure, not an adapter startup failure. A second comparison started from the desktop UI produced the same success/failure outcomes and was saved in SQLite. Actual live results were displayed, all three export formats were written, and trial history survived desktop restart with no page errors. Earlier failed startup attempts are retained separately and are not presented as working integration results.

These observations satisfy the initial two-harness execution/verification path; they are not a broad success-rate ranking. Hermes remains unavailable. Remaining work includes a Hermes adapter, full-pack/multi-model live validation, package lock/base digest pinning for image rebuilds, stronger runtime setting attestation, more task categories, more detailed failure diagnosis, server-side inference timing and additional inference backends. Local CLI runtime selection/inventory is recorded with its provenance; it is not claimed as server-side runtime attestation. Native discovery/load currently require LM Studio; the narrow OpenAI relay is reusable for future backends.

Final approved validation: 304/304 tests passed with installed-image integration checks enabled, including actual Docker cancellation and timeout cleanup; TypeScript and production build passed. Both real upstream runtimes passed the isolated relay transport check. The corrected desktop QA script completed a real UI-started comparison, displayed both trials, exported JSON/CSV/Markdown and verified SQLite persistence after restart. Harness-specific CSS is scoped to its panels. OpenCode nonzero shell exit metadata is counted as failed tool execution; complete saved QA traces were used to correct earlier counts, with original values retained in correction metadata. Ephemeral model instance IDs do not make otherwise identical comparisons incompatible; effective load differences still do. Final cleanup found no evaluation containers and no loaded benchmark model.

The final existing Agent Worker Sweep desktop regression passed (1/2/4/8 workers). Its QA selector now targets the exact numeric input so previously saved timeline images cannot ambiguously match the field label; this changes test targeting, not sweep behavior. The Windows 1.21.2 installer was built and installed locally, and existing readable benchmark history was verified after installation. GitHub source includes Docker/web packaging; web harness execution is disabled until a trusted sandbox controller exists. See docker-linux.md for this deployment limitation.
