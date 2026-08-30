# Native analysis engine for hosted RzWeb MCP.
# Build this next to a rizin-mcp checkout. The Cloudflare Worker in this
# folder never runs aaa. It only routes and stores blobs.

FROM rust:1-bookworm AS build
RUN apt-get update && apt-get install -y --no-install-recommends \
    pkg-config libclang-dev cmake meson ninja-build python3 git \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /src
COPY . /src/rizin-mcp
RUN cargo build --release --manifest-path /src/rizin-mcp/Cargo.toml

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY --from=build /src/rizin-mcp/target/release/rizin-mcp /usr/local/bin/rizin-mcp
# Install a native rizin next to this binary before you ship. The Worker talks
# to this process. Keep --no-raw. Do not enable write tools unless a context
# explicitly allows them.
ENTRYPOINT ["rizin-mcp", "--no-raw"]
