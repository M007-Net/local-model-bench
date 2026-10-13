# Reasoning comparison

Reasoning comparison runs the same objectively scored questions at several thinking settings. Open **Run**, choose **Quality only**, select **Reasoning comparison**, then choose a built-in or imported benchmark pack and your models. The pack's existing automatic answer checks determine correctness; no model judge is used.

The default settings are **No reasoning, 512, 1,024, 2,048, 4,096, and Unlimited**, with three repeats per question and setting. Edit the preset or enter your own positive token budgets. Select a baseline to compare accuracy differences in percentage points. When a model cannot use the requested baseline, its lowest supported selected setting becomes the baseline and the preview identifies it.

Default limits for capped settings are 32,768 total output tokens, 65,536 context tokens, and 1,200 seconds per request. **Unlimited** in new runs removes the thinking cap, total output cap, and client timeout. LM Studio uses `reasoningBudget:false`, `maxTokens:false`, and `contextOverflowPolicy:truncateMiddle`: the context is finite, but older generated text shifts out while the system prompt and initial question remain. External servers receive `max_tokens:-1` and no client timeout; their own limits may still apply. Older saved comparisons without the new policy retain their original shared limits. A numeric thinking budget is a cap, not a promise that the model will spend that many tokens.

Enable **Stop after consecutive mistakes** (default two) to stop each model and setting independently. Checking this option selects one pass through the available pack; you can adjust the pool size before starting. Correct answers reset the streak. Wrong, malformed, truncated, failed or timed-out answers count as misses; user cancellation does not count. A setting also ends when its question pool is exhausted. Results record the actual stop reason. Settings may cover different subsets, so inspect shared paired questions and stop points alongside accuracy. The stop rule checks completed answers: an Unlimited generation can keep running until it finishes or you press Cancel.

## Supported controls

Support is resolved separately for each model. The preview lists the selected controls, supported settings, baseline, repeats, and measured request count. Unsupported settings are skipped visibly rather than counted as benchmark failures. No output-token cap or prompt instruction is silently substituted for a reasoning control.

- Managed LM Studio uses its SDK structured-chat `reasoningBudget` control where the installed SDK, runtime, and model template support it. Numeric budgets and unrestricted reasoning are distinct from the total output-token cap.
- llama.cpp sends `reasoning_budget_tokens` to compatible upstream servers. When the server reports thinking delimiters but omits budget metadata, numeric settings are labeled requested and unverified. Older servers may ignore the field; inspect provenance before attributing a score change to enforcement. `-1` uses the server's configured default, so Unlimited is offered only when that default is explicitly reported as unrestricted. A zero-token thinking budget and a model's true thinking-disable switch are different controls. External servers are never restarted or reconfigured for a comparison.
- When a provider exposes only effort levels or on/off controls, those settings are available with explicit labels. They are not equivalent to numeric token budgets.

Every response retains the requested setting and control provenance. An accepted request proves that the endpoint accepted it; confirmation of actual enforcement requires separate evidence. Read the recorded confirmation and notes alongside the measurements.

## Reading results

Each model has its own accuracy comparison, baseline deltas, repeat scores, and reasoning/output token and duration measurements. Use the answer comparison to inspect the same question and repeat side by side. **Improved**, **Worsened**, **Unchanged score**, and **Changed answer** filters help find differences; reasoning text can be expanded separately from the final answer.

Accuracy is correct responses divided by measured attempts. Wrong or malformed answers, request failures, timeouts, and truncated responses count as misses. Unattempted work after cancellation stays incomplete. Retry replacements are counted once, while the original response remains in the saved run for inspection. Results from incomplete runs are provisional.

The question count and selection seed choose the questions once. Every model, setting, and repeat receives the identical question text and scoring checks. Models run sequentially at concurrency one with temperature zero and fixed context, sampling, and engine settings. Setting order rotates reproducibly between repeats. MTP, context, and concurrency sweeps are unavailable during this comparison.

Token usage is reported by the endpoint. LM Studio SDK statistics may omit a separate reasoning-token count; that chart remains unavailable while total output and elapsed time are still reported. Missing counts remain unavailable, and reasoning tokens are never added twice to output totals that already include them. Tokenizers and provider accounting can differ between models. The comparison describes effects observed on the selected questions and conditions; larger thinking budgets need not improve accuracy.

## Saved runs and exports

Setting identity, repeat number, baseline, and control provenance are saved with the run. History and reports keep settings separate. Removing an imported pack does not remove questions or reasoning metadata from an existing run. JSON retains the full run; CSV, Markdown, and HTML reports identify each setting and retain its comparison measurements. Existing standard quality and historical runs continue to use their original behavior.

Provider references: [LM Studio SDK prediction configuration](https://github.com/lmstudio-ai/lmstudio-js/blob/main/packages/lms-shared-types/src/llm/LLMPredictionConfig.ts) and [llama.cpp server documentation](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md).
