FROM python:3.12-slim AS base
WORKDIR /app

# System deps for audio/PyAV builds inside Pipecat
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg curl \
 && rm -rf /var/lib/apt/lists/*

COPY pyproject.toml ./
RUN pip install --no-cache-dir uv && uv pip install --system .

COPY *.py ./
COPY tests/ ./tests/

EXPOSE 8400
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s \
  CMD curl -fsS http://127.0.0.1:8400/health || exit 1

CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8400"]
