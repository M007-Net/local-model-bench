FROM node:22-bookworm-slim
ARG MINI_VERSION=2.4.6
ARG OPENCODE_VERSION=1.19.0
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-venv git ca-certificates ripgrep && rm -rf /var/lib/apt/lists/* \
 && python3 -m venv /opt/venv \
 && /opt/venv/bin/pip install --no-cache-dir mini-swe-agent==${MINI_VERSION} \
 && npm install -g opencode-ai@${OPENCODE_VERSION}
RUN mkdir -p /opt/lmb/config/opencode && touch /opt/lmb/config/opencode/.gitignore
ENV PATH="/opt/venv/bin:${PATH}" HOME=/work/home XDG_DATA_HOME=/work/home/data XDG_CONFIG_HOME=/work/home/config XDG_CACHE_HOME=/work/home/cache XDG_STATE_HOME=/work/home/state
ENV LITELLM_LOCAL_MODEL_COST_MAP=True LITELLM_LOG=ERROR DO_NOT_TRACK=1 OPENCODE_DISABLE_AUTOUPDATE=true OPENCODE_DISABLE_MODELS_FETCH=true OPENCODE_DISABLE_PROJECT_CONFIG=true OPENCODE_DISABLE_DEFAULT_PLUGINS=true OPENCODE_PURE=true
COPY runner.py verifier.py /opt/lmb/
LABEL local.model.bench.protocol="lmb-harness-v1"
USER 10001:10001
WORKDIR /work
ENTRYPOINT ["python", "-u", "/opt/lmb/runner.py"]
