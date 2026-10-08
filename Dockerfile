FROM python:3.13-slim
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv
WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
COPY kjit ./kjit
ENV KJIT_DATA_DIR=/data PORT=8080 KJIT_INGEST=1
EXPOSE 8080
CMD ["uv", "run", "--no-sync", "python", "-m", "kjit.service.app"]
