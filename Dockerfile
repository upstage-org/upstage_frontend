FROM node:22-bookworm

# Build context runs as root so corepack/pnpm land in /usr/local with
# world-readable+writable trees. At runtime the container is launched as
# ${HOST_UID}:${HOST_GID} (see the compose files), so the actual `pnpm install`
# / `pnpm build` invocations are unprivileged.

ENV PNPM_HOME=/usr/local/pnpm \
    COREPACK_HOME=/usr/local/corepack \
    PATH=/usr/local/pnpm:/usr/local/corepack/shims:$PATH

RUN mkdir -p "$PNPM_HOME" "$COREPACK_HOME/shims" \
 && corepack enable --install-directory "$COREPACK_HOME/shims" \
 && corepack prepare pnpm@10.7.1 --activate \
 && chmod -R a+rwX "$PNPM_HOME" "$COREPACK_HOME"

WORKDIR /app
