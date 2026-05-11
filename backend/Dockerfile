FROM astral/uv:python3.14-trixie

RUN useradd -m app -u 1000

COPY pyproject.toml /app/pyproject.toml
COPY .python-version /app/.python-version
COPY uv.lock /app/uv.lock

WORKDIR /app

RUN apt update
RUN apt install -y \
    ffmpeg \
    pkg-config \
    python3-dev \
    build-essential \
    cython3 \
    libavformat-dev \
    libavcodec-dev \
    libavdevice-dev \
    libavutil-dev \
    libavfilter-dev \
    libswscale-dev \
    libswresample-dev

RUN chown -R app:app /app
USER app

RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --locked --no-install-project

COPY . /app

RUN uv sync --locked
