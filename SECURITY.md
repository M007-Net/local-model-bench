# Security

## Reporting a problem

Report suspected security problems privately through this repository's
**Security** tab → **Report a vulnerability**. That opens a private advisory
visible only to the maintainers. Please use it instead of a public issue, a pull
request, or a discussion thread.

Include the version you were running, the steps that trigger the problem, and
what you expected instead. Expect an acknowledgement within about a week; this is
a small project with no paid on-call rotation.

**Do not include any of the following in a report:** an LM Studio API token,
saved benchmark databases, model responses, exported run histories, or local
filesystem paths. If something from those is genuinely necessary to explain the
problem, redact it first. If you think a token was exposed, rotate it in LM
Studio before reporting.

## How the application handles credentials

- An optional LM Studio API token is encrypted with Windows credential
  encryption (`safeStorage`) and stored in the application's own data folder.
- **The token is never sent to the renderer process.** The window is told only
  whether a token is configured (`tokenConfigured: true|false`). Decryption
  happens in the main process, on the request path, and nowhere else.
- Saving settings without a token leaves the stored one untouched; clearing it
  requires an explicit action in the interface.
- Tokens containing control characters, or longer than 4096 characters, are
  rejected rather than escaped.
- Tokens are never written into exports, reports, or run records.

## Other boundaries worth knowing

- Only loopback LM Studio server addresses are accepted.
- The window runs with `contextIsolation: true`, `sandbox: true`, and
  `nodeIntegration: false`, behind a Content-Security-Policy. New windows and
  navigation are blocked, and every permission request — camera, microphone,
  location, USB, serial, HID, display capture — is denied outright.
- IPC handlers reject any sender that is not the application's own main frame.
- Model output is treated as untrusted text throughout. It is never executed,
  and the judge prompt tells the grading model the same thing.
- There are no automatic cloud requests and no analytics.
- Update checking is off by default and makes no request until you name a GitHub
  repository in Settings. When enabled it contacts only `api.github.com` and
  GitHub's release storage. A downloaded installer must match the exact expected
  file name and size, is hashed while it downloads, and is deleted if it does not
  match a checksum published with the release. Nothing downloads or runs without
  a button press, and installing is refused while a benchmark is running.

## Scope

In scope: anything that lets model output, a crafted run file, or a compromised
renderer read the stored token, escape the sandbox, write outside the
application's data folder, or reach a non-loopback address.

Out of scope: LM Studio itself, the models you run, Electron itself, and the
absence of an Authenticode signature on the Windows installer — a known
limitation, documented in the README.

## Known limitations

The Windows installer is **not** code-signed. SmartScreen will warn about it.
Verify the SHA-256 checksum published with a release before running it.

Benchmark results are measurements of your machine at one moment. They are not
an official leaderboard result and should not be presented as one.
