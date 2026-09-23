import type { RunConfig, TestCase } from './types';

/**
 * Expand selected performance workloads into deterministic approximate input lengths.
 * The estimate targets prompt tokens; tokenizers differ, and this does not alter the
 * serving endpoint's configured context window.
 */
export function contextWorkloads(tests: TestCase[], config: RunConfig): TestCase[] {
  const targets = config.contextSweep;
  if (!targets?.length) return tests;
  const base = tests.find(test => test.kind === 'performance');
  if (!base) return tests;

  // Four characters per token is a deliberately rough text estimate. Use a fixed
  // compact prompt so switching the selected short/medium/long test does not change
  // the sweep's workload, then pad to the estimated target size.
  const charsPerToken = 4;
  const prompt = 'Read these operational notes and write a concise numbered review with recommendations.\n';
  const filler = 'Service availability, access, monitoring, backups, and recovery procedures should be reviewed regularly. ';
  return targets.map(target => {
    const wantedChars = Math.max(0, target * charsPerToken - prompt.length);
    const padding = filler.repeat(Math.ceil(wantedChars / filler.length)).slice(0, wantedChars);
    return {
      ...base,
      id: `perf-context-${target}`,
      name: `Context sweep · ≈${target} input tokens`,
      prompt: prompt + padding,
      contextTokens: target,
      benchmark: undefined,
      image: undefined,
      imageDigest: undefined,
    };
  });
}
