# syntax=docker/dockerfile:1
ARG NODE_VERSION=24.22.1
FROM --platform=$BUILDPLATFORM node:${NODE_VERSION}-slim AS build
WORKDIR /app
ARG PNPM_VERSION=9.11.0
RUN npm install -g pnpm@${PNPM_VERSION}
COPY .npmrc package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
# The maintainer's Fly deployment uses web/ as its build context too.
COPY . .
RUN pnpm run build
# Cross-platform copying is safe only while Nitro has no native modules.
RUN test -z "$(find .output -name '*.node' -print -quit)"

FROM node:${NODE_VERSION}-slim AS runtime
LABEL org.opencontainers.image.title="Servomon" \
      org.opencontainers.image.description="Self-hosted Linux monitoring dashboard" \
      org.opencontainers.image.source="https://github.com/nirjan-dev/servomon" \
      org.opencontainers.image.licenses="MIT" \
      fly_launch_runtime="Node.js"
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000
COPY --from=build /app/.output ./.output
COPY --from=build /app/scripts ./scripts
RUN printf '#!/bin/sh\nexec node /app/scripts/generate-vapid-keys.mjs "$@"\n' > /usr/local/bin/generate-vapid-keys \
    && chmod +x /usr/local/bin/generate-vapid-keys
# Run as root: Fly volumes and Render disks are root-owned on first mount.
VOLUME /app/data
EXPOSE 3000
CMD ["node", ".output/server/index.mjs"]
