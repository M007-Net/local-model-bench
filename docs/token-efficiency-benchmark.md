# Token efficiency benchmark

Version 1.20.0 includes 60 original deterministic tasks in six families: arithmetic,
data filtering, state tracking, rule decisions, time calculation and structured
extraction. Ten variants per family share a template. Seeded balanced sampling
gives nested question sets. Use all 60 for full coverage.

Choose **Benchmarks → Token efficiency**, then select models and reasoning settings.
Run the same question count and seed again with a different maximum output budget
or reasoning setting. In Results, compare the saved run to see accuracy alongside
average output tokens and correct answers per 1,000 output and total tokens.
The same efficiency metrics also appear for existing benchmark packs.

Version 1.20.1 uses your selected token budget directly for this suite, including
budgets above its 2,048-token default. Truncation is also reflected in individual
response scores. Selecting a benchmark starts with waves; if you later choose
arrival-rate or sustained load, planned counts follow that scheduling mode.
Context-length sweeps in combined runs retain the selected quality questions.

Accuracy is complete correct responses divided by measured attempts, times 100.
Every JSON field must match; failures and truncated answers miss. No model judge,
candidate code execution or partial credit is used. Warm-ups are excluded.

Output efficiency is correct responses × 1,000 / summed endpoint output tokens.
Total efficiency uses input + output tokens. All attempts contribute usage,
including wrong answers and failures with reported counts. If any attempt lacks
required usage, the corresponding ratio is unavailable. Zero token denominators
are unavailable. Counts are never estimated from characters. Reasoning tokens
are not added again to completion totals: providers generally report them as a
subset, but accounting varies. Cached input is included in total usage.

Compare accuracy and token use together. Different tokenizers, accounting,
reasoning settings, output limits and repeated attempts affect the comparison.
This original synthetic suite is not an official leaderboard or a measure of
general ability. Incomplete runs are provisional. Markdown and HTML reports keep
the metrics and settings; JSON retains per-request usage and original answers.

Regenerate using `npm run benchmark:efficiency:prepare`. This runs entirely offline.
The SHA-256 fingerprint covers the original tasks and is saved with each question.
