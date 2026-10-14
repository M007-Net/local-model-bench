# Docker, web panel and Linux

The web panel uses the same React interface, SQLite history, scoring, reports and
benchmark/agent workers as the desktop application. It runs on Windows and Linux
without Electron or a graphical session. Docker runs the panel, while inference
comes from a separately configured LM Studio, Ollama, llama.cpp or compatible API.

**Harness Evaluation execution is desktop-only in 1.21.3.** The web panel includes
the configuration and results interface, separate SQLite records and exports,
but displays an explicit dependency message and disables Start. A trusted host
sandbox controller is not bundled into the web deployment. Neither the web
container nor agent containers receive a Docker socket. Use the Windows desktop
app for the Mini-SWE-Agent/OpenCode/Hermes evaluation path described in
[Harness Evaluation](harness-evaluation.md). Agent Worker Sweep remains available
in Docker and does not execute model-generated commands.

## Docker

Install Docker with Compose. From the source directory:

```sh
cp .env.example .env
# Optionally set LMB_WEB_TOKEN to a strong password in .env.
docker compose up --build -d
docker compose logs local-model-bench
```

Open **http://localhost:8080**. The log prints a randomly generated password when
`LMB_WEB_TOKEN` is empty. A configured password stays stable across restarts. The
Compose file publishes only to loopback by default; set `LMB_BIND_ADDRESS` to your
LAN/Tailscale interface to access it from another computer, and set
`LMB_ALLOWED_HOSTS` if using a custom DNS name.

`LMB_PORT=8090` changes the host port to 8090. The internal Compose port remains
8080. Reports and imported questions use browser downloads/file selection. Runs,
settings and imported packs survive restarts in the `bench-data` volume. Back up
the complete volume, including `web-key`, to preserve encrypted endpoint tokens.
Desktop and web deployments should have separate data directories. An OS-backed
SQLite lease prevents a second web server from opening the same data directory
and releases automatically after a crash.

In Settings select **OpenAI-compatible** (or **llama.cpp**) and the inference API:

| Inference server | Example endpoint inside the container |
|---|---|
| LM Studio on the Docker host | `http://host.docker.internal:1234` |
| Ollama on the Docker host | `http://host.docker.internal:11434` |
| Another container on the same network | `http://ollama:11434` |
| Remote server | `http://SERVER_IP:PORT` |

The inference server must listen on an interface reachable from Docker; a Linux
host service bound only to `127.0.0.1` cannot be reached through the bridge gateway.
For that case Linux supports a host-network deployment:

```sh
docker build -t local-model-bench:web .
docker run -d --name local-model-bench --network host \
  -e LMB_HOST=127.0.0.1 -e LMB_PORT=8080 -e LMB_WEB_TOKEN=YOUR_PASSWORD \
  -v bench-data:/data --stop-timeout 120 local-model-bench:web
```

Then a loopback Ollama endpoint such as `http://127.0.0.1:11435` is reachable.
For access over Tailscale, bind `LMB_HOST` to that host's Tailscale address instead.
Container mode leaves model loading, context, cache, GPU allocation and model
lifetime to the inference server. Configure these there. Local LM Studio CLI
management is for native installations that have the CLI installed.

## Native web panel on Linux or Windows

Node 22.13+ or Node 24 is needed (`node:sqlite`); Node 24 is recommended.

```sh
ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm ci
npm run build:web
LMB_WEB_TOKEN=YOUR_PASSWORD npm run start:web
```

On PowerShell set environment variables with `$env:LMB_WEB_TOKEN='YOUR_PASSWORD'`
before running the npm commands. The server defaults to `127.0.0.1:8080` and stores
data under `~/.local/share/local-model-bench-web`. `LMB_HOST`, `LMB_PORT`,
`LMB_DATA_DIR` and `LMB_ENDPOINT_URL` override these defaults. The endpoint default
is `http://host.docker.internal:1234`; choose a reachable URL in Settings for native
use. A data-directory lock prevents two native servers using the same database.

## Linux desktop application

```sh
npm ci
# Debian builds need binutils and xz-utils installed on the build host.
npm run package:linux
```

AppImage and Debian `.deb` packages are written to `outputs/`. The Linux CLI default
is `~/.lmstudio/bin/lms`; a custom path must be an absolute local path ending in
`lms`. Desktop package updates are installed manually. Windows installers are not
downloaded or executed by Linux. Linux/container GPU sensors are reported as
unavailable; benchmark request timing, CPU agent workloads and endpoint-reported
token statistics remain available.

## Verification

```sh
npm test
npm run build:web
npm run qa:web
```

`qa:web` uses a deterministic streaming fixture by default and checks login,
cross-origin refusal, concurrent requests, progress events, history, browser
upload/download transport, agent workers and persistence across a restart. Set
`LMB_QA_ENDPOINT` and `LMB_QA_MODEL` for real inference, and `LMB_QA_PANEL` to test
an already-running container. `LMB_QA_PASSWORD` supplies that panel's password.
The smoke test's answer scores remain the actual model scores; successful
transport does not imply the tiny model answers correctly.
