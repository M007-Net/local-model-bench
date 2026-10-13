# Native MTP tuning

Enable native MTP in Run, then enable the prediction-depth sweep. Add the minimum-draft-probability sweep to test each threshold at every enabled depth. Depth 0 measures MTP off once; its probability is not applicable. Probability is verified against the loaded LM Studio instance, and temporary per-model load overrides are restored.

Auto find screens coarse depth and probability combinations, then refines promising intervals at their midpoints. Choose the number of refinement rounds. This is a bounded empirical search: throughput is not monotonic, so it cannot guarantee a global optimum. Repeat promising candidates with more waves and quality tests under the same workload, context, output cap, sampler, reasoning, concurrency, cache settings, and runtime.

Results → All runs overview → Compare MTP settings pools matching settings across saved runs. Different workloads and load conditions remain separate. Gold outlines and starred table rows identify the highest measured generation mean in each matching cohort; check repeat spread and quality. Choose depth or draft probability as the horizontal axis. Saved-run overlays retain separate run labels. Exported graphs use an axis that the sweep actually varied.

The previous experimental sampling-profile matrix has been removed. Fixed sampling controls remain available. Requested settings must not be interpreted as independently verified effective sampling unless the endpoint confirms them.
