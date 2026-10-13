# Infrastructure reasoning, version 1

180 original synthetic cases, 18 domains, 10 parameter variants per domain. This is an objective, text-only reasoning suite built into Local Model Bench. It is not NetConfEval, NetLLMeval, a published leaderboard, or a certification exam. No model judge, emulator, SSH session, shell command, or candidate code is used to grade it.

## Existing work and why this suite is separate

- [NetConfEval](https://github.com/RedHatResearch/conext24-NetConfEval) evaluates requirements-to-formal-policy translation, function calls, routing code generation, and low-level configuration. Its low-level evaluation needs Docker/network emulation. Its full protocol cannot be reproduced by importing questions alone.
- [NetLLMeval / Toward Agentic SysAdmin](https://arxiv.org/abs/2606.26960) evaluates administration using live emulated infrastructure to derive ground truth. This measures operational outcomes beyond text answers.
- [NetArena](https://www.netarena.ai/) provides networking-agent evaluation and a leaderboard.

The existing benchmarks answer the original question: yes, networking and administration benchmarks exist. This complementary local suite covers infrastructure reasoning without their external execution environments. No public benchmark questions were copied and no official benchmark scores should be claimed from it.

## Coverage

Every question requires a complete structured answer with multiple interdependent facts. Each family states its assumptions explicitly; simplified policy choices are part of the problem rather than claims about all products.

| Domain | Required reasoning | Errors exposed |
|---|---|---|
| IPv4 subnetting | Network, broadcast, usable range, host count, membership | Off-by-one, mask boundary, including broadcast as host |
| VLSM planning | Smallest fitting aligned subnets, non-overlap, remaining pool | Wrong host reservation, address waste, pool overflow |
| Route selection | Longest prefix, administrative distance, withdrawal fallback | Preferring lower distance over a more specific route |
| Firewall policy | First-match rule evaluation and implicit deny | Treating ordered rules as unordered, accepting unintended access |
| VLAN and trunks | Tagged membership, allowed list, isolation, native mismatch | Assuming every native mismatch drops tagged traffic |
| Link-state paths | Before/after failure paths and exact aggregate cost | Using down edges, ignoring alternate paths |
| BGP policy | Local preference, AS length, tie-break, withdrawal | Choosing shorter AS path ahead of local policy |
| DNS cache | Positive and negative expiration, stale cache vs authoritative data | Assuming authoritative updates instantly replace cache |
| MTU and transport | Encapsulation, IPv4/TCP overhead, MSS, blackhole evidence | Confusing segment size with IP MTU, diagnosing DNS from transfer stalls |
| Linux access control | Umask, requested permissions, owner/group/other access | Treating umask as subtraction, granting group write |
| Storage and RAID | Capacity and correlated failures, backup fault domains | Claiming RAID10 survives any two disks, same-array backup independence |
| Quorum and fencing | Majority membership, partition commits, promotion prerequisites | Promoting without fencing, split-brain assumptions |
| Backup and recovery | Recoverable coverage, RPO, serial recovery time, RTO | Using completion time as data coverage or overlooking replay time |
| Virtualization capacity | CPU and RAM placement, reservations, whole VMs, N+1 | Ignoring binding resource, overcommit or host-loss headroom |
| Kubernetes availability | Ready matching endpoints, selectors, disruption budget | Confusing readiness with liveness, overlooking label mismatch |
| Proxy and TLS diagnosis | First failing layer, hostname validation, backend failure, HTTP status | Reporting 502 when TLS failed before HTTP |
| SLO and observability | Request budget, remaining budget, burn rate, time budget | Confusing request and time availability, percentage arithmetic |
| Incident evidence and safe change | Supported cause, minimal change, uncertainty, hostile runbook evidence | Inventing a cause, making broad destructive changes |

## Running in the app

Open Benchmarks, select **Infrastructure reasoning** (Original badge), choose count and seed, and click **Use Infrastructure reasoning**. The default 36-question selection has two cases per domain. All 180 gives the complete fixed suite. Then choose a model and press Run when you intend to run inference. Merely selecting the suite does not run inference.

Questions default to temperature 0, one concurrent request, one wave, no judge, 8,192 output tokens, at least 16,384 context, and at least 600 seconds timeout. The output budget accommodates reasoning-capable models. Record any changes when comparing runs. Output limit must remain below context size.

Selection shuffles within domains and domain order using the fixed seeded PRNG, then takes round-robin prefixes. Counts above 18 cover every domain; a larger run with the same seed contains the smaller run in the same order. Smaller selections cover only part of the suite and are not broad capability estimates. Identical questions, protocol, hash, and settings are needed for a fair comparison. Model loading remains under the app's existing Run behavior.

## Objective grading

Return exactly the stated JSON schema, with no prose or fences. Object key order is ignored; array order is specified in the prompt. Every field, type and value must match, and no extra keys or duplicate keys are accepted. Floating burn rates are explicitly rounded to four decimal places; other numbers are exact. DNS fresh response TTL and lookup delay assumptions are stated. Candidate output is parsed, never executed.

Primary score is fully correct completed, nontruncated responses / attempted responses x 100. A case passes only if every answer is right. Wrong, malformed, failed and truncated responses count as misses. Warmups are excluded. An absent attempt is not a recorded failure: it makes the run provisional, and planned vs attempted counts remain visible. Repeated waves and concurrent copies are attempts, not additional independent questions.

Results show per-domain accuracy, distinct attempted vs selected questions, domain coverage out of 18, and macro accuracy over **selected** domains. Selected but unattempted domains contribute zero to that macro value. Unselected domains are absent from the macro denominator; coverage is shown explicitly, so partial results must not be described as an all-domain score. Full 180-item single-wave runs have equal domain weighting. Latency and throughput remain separate from correctness.

Saved runs retain the exact questions, reference answers, checks, fingerprint and protocol. Text reports include the same domain breakdown. No new results are fabricated into normal user history by the offline verification or UI smoke test.

## Reproducibility and offline verification

`npm run benchmark:infrastructure:prepare` regenerates the committed dataset without downloading anything. SHA-256 hashes the ordered complete test content excluding the benchmark metadata to avoid hashing the hash itself. A changed prompt, key or rule changes the hash. Version the protocol whenever grading semantics change.

`npm run benchmark:infrastructure:verify` runs the dedicated offline checks and writes no user benchmark history. It exercises every reference answer, every individual incorrect field, missing/extra/duplicate fields, reordered objects, malformed JSON, prose, fences, nested balanced sampling, validation, failure/truncation accounting and report generation. Independent subnet and VLSM invariants, exhaustive graph path enumeration, and manually derived reference anchors check the oracle beyond self-consistency. Full repository tests and build validate integration.

`npm run qa:infrastructure` opens an isolated app profile configured to use a local discovery-only HTTP fixture, selects the suite, checks the 36-question default, changes to all 180 and verifies transferred settings. It then displays an explicitly labeled synthetic saved fixture to check coverage and the 18-domain results table. It never presses Run or starts/loads a model. This is software integration validation, not a model score.

## Interpretation and limitations

This suite measures constrained reasoning from stated evidence. It does not demonstrate live operational ability, tool selection, real configuration parsing, production change success, command syntax, Windows/Active Directory administration, IPv6, advanced vendor-specific protocols, disaster restoration, or long-running incident response. Parameter variants share 18 template families and are statistically dependent; 180 items are not 180 independent task types. Do not apply an independent-trial confidence interval to claim a certified ability level.

The benchmark is public and fixed; contamination and template memorization are possible. The same generator is available to models and operators. A different seed changes selection/order, not the underlying item pool; it is not a private holdout. For stronger evidence, use new independently reviewed templates, concealed test data and a separately scored emulated execution benchmark. Domain coverage can guide review, but high scores do not authorize unsupervised infrastructure changes.

There is no human calibration study or measured model baseline in this release. Offline perfect-key and wrong-answer checks validate the software, not AI ability. No AI model was started for the integration task.
