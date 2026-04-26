# Kokoro-FastAPI build wrapper.
#
# Why this exists: ghcr.io/remsky/kokoro-fastapi:* is anonymous-fetch
# unauthorized (401), so a vanilla `image:` reference cannot be pulled by an
# operator who hasn't logged into GHCR with credentials they don't have.
# We clone the upstream public repo at a pinned commit and run their CPU
# Dockerfile build, producing a local image tag the compose stack uses.
#
# Bump KOKORO_REF when we deliberately upgrade. After a bump, run:
#   docker compose -p wf0 --profile local-voice build kokoro-tts
# and re-verify with `bin/diagnose-voice.sh`.
#
# First build is ~10–15 min on CPU and produces a ~5 GB image (PyTorch CPU
# wheel + Kokoro v1_0 weights baked in).

ARG KOKORO_REPO=https://github.com/remsky/Kokoro-FastAPI.git
ARG KOKORO_REF=3af45719940c915b53ad2a63f9cdb6f22680d276

FROM alpine/git:latest AS source
ARG KOKORO_REPO
ARG KOKORO_REF
WORKDIR /src
RUN git clone "$KOKORO_REPO" . \
 && git checkout "$KOKORO_REF" \
 && rm -rf .git

# Use the upstream CPU Dockerfile verbatim against the cloned tree.
# Trick: re-export the source stage as the build context for a nested build
# is awkward in pure Dockerfile, so instead we replicate upstream's CPU
# stages here and COPY --from=source. This keeps the build reproducible
# without depending on a `docker build` from a different cwd.

FROM python:3.10-slim AS runtime

# Match upstream apt list (CPU Dockerfile).
RUN apt-get update -y \
 && apt-get install -y --no-install-recommends \
        espeak-ng espeak-ng-data git libsndfile1 curl ffmpeg g++ cmake ca-certificates \
 && apt-get clean && rm -rf /var/lib/apt/lists/* \
 && mkdir -p /usr/share/espeak-ng-data \
 && ln -s /usr/lib/*/espeak-ng-data/* /usr/share/espeak-ng-data/ \
 && curl -LsSf https://astral.sh/uv/install.sh | sh \
 && mv /root/.local/bin/uv /usr/local/bin/ \
 && mv /root/.local/bin/uvx /usr/local/bin/ \
 && useradd -m -u 1000 appuser \
 && mkdir -p /app/api/src/models/v1_0 \
 && chown -R appuser:appuser /app

USER appuser
WORKDIR /app

# Rust is required to build sudachipy / pyopenjtalk-plus on first sync.
RUN curl https://sh.rustup.rs -sSf | sh -s -- -y
ENV PATH="/home/appuser/.cargo/bin:/app/.venv/bin:$PATH" \
    UV_HTTP_TIMEOUT=120 \
    UV_HTTP_RETRIES=3

COPY --from=source --chown=appuser:appuser /src/pyproject.toml ./pyproject.toml
RUN uv venv --python 3.10 \
 && uv sync --extra cpu --no-cache

COPY --from=source --chown=appuser:appuser /src/api ./api
COPY --from=source --chown=appuser:appuser /src/web ./web
COPY --from=source --chown=appuser:appuser /src/docker/scripts/ ./
RUN chmod +x ./entrypoint.sh

ENV PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app:/app/api \
    UV_LINK_MODE=copy \
    USE_GPU=false \
    PHONEMIZER_ESPEAK_PATH=/usr/bin \
    PHONEMIZER_ESPEAK_DATA=/usr/share/espeak-ng-data \
    ESPEAK_DATA_PATH=/usr/share/espeak-ng-data \
    DEVICE="cpu" \
    DOWNLOAD_MODEL=true

# Bake the model weights into the image so first-call latency isn't
# dominated by a fresh download. Uses upstream download_model helper.
RUN python download_model.py --output api/src/models/v1_0

EXPOSE 8880
CMD ["./entrypoint.sh"]
