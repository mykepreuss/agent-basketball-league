# syntax=docker/dockerfile:1.12
# Multi-architecture index digest for the exact Node 24.18.0 / Alpine 3.24 image.
FROM node:24.18.0-alpine3.24@sha256:a0b9bf06e4e6193cf7a0f58816cc935ff8c2a908f81e6f1a95432d679c54fbfd AS build

ENV PNPM_HOME=/pnpm
ENV PATH=/pnpm:$PATH
RUN corepack enable && corepack prepare pnpm@11.21.0 --activate
WORKDIR /src
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY packages/foundation/package.json packages/foundation/package.json
COPY packages/storage/package.json packages/storage/package.json
COPY apps/body-broker/package.json apps/body-broker/package.json
RUN pnpm install --frozen-lockfile --filter @abl/body-broker...
COPY packages/foundation packages/foundation
COPY packages/storage packages/storage
COPY apps/body-broker apps/body-broker
RUN pnpm --filter @abl/body-broker... build && pnpm --filter @abl/body-broker deploy --prod /opt/abl/body-broker

FROM node:24.18.0-alpine3.24@sha256:a0b9bf06e4e6193cf7a0f58816cc935ff8c2a908f81e6f1a95432d679c54fbfd AS runtime

# The base image is immutable. Exact APK package versions are frozen in
# infra/sandbox/apk-packages.lock and checked before an image may be released.
COPY infra/sandbox/apk-packages.lock /tmp/apk-packages.lock
RUN apk add --no-cache $(tr '\n' ' ' </tmp/apk-packages.lock) \
  && addgroup -S -g 10100 abl-broker \
  && adduser -S -D -H -s /sbin/nologin -u 10100 -G abl-broker abl-broker \
  && addgroup -S -g 10101 abl-agent \
  && adduser -S -D -h /home/abl-agent -s /sbin/nologin -u 10101 -G abl-agent abl-agent \
  && install -d -o abl-agent -g abl-agent -m 0700 /home/abl-agent /workspace \
  && install -d -o abl-broker -g abl-broker -m 0700 /run/abl-broker \
  && rm /tmp/apk-packages.lock

COPY --from=build --chown=root:root /opt/abl/body-broker /opt/abl/body-broker
COPY --from=ghcr.io/blaxel-ai/sandbox@sha256:17c2840e04b8e66bb07fd15e448c9e9de31b5123f33b848d6fbbe84b083f3e8 /sandbox-api /usr/local/bin/sandbox-api
COPY --chown=root:root infra/sandbox/abl-sandbox-init /usr/local/sbin/abl-sandbox-init
COPY --chown=root:root infra/sandbox/agent-runtime /usr/local/bin/agent-runtime
RUN chmod 0555 /usr/local/bin/sandbox-api /usr/local/sbin/abl-sandbox-init /usr/local/bin/agent-runtime \
  && find /opt/abl/body-broker -type d -exec chmod 0555 {} + \
  && find /opt/abl/body-broker -type f -exec chmod 0444 {} +

ENV NODE_ENV=production \
  HOME=/home/abl-agent \
  ABL_BROKER_PORT=7777 \
  BL_ENABLE_OPENTELEMETRY=false \
  DO_NOT_TRACK=1 \
  TELEMETRY_ENABLED=false \
  ABL_LOG_CONTENT=false \
  BL_SANDBOX_USER_ENABLED=true

WORKDIR /workspace
ENTRYPOINT ["/usr/local/sbin/abl-sandbox-init"]
CMD ["/usr/local/bin/agent-runtime"]
