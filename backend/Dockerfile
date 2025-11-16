FROM astral/uv:python3.14-trixie

COPY . /app
WORKDIR /app

RUN uv sync --locked
