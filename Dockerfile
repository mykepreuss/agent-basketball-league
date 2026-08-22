# syntax=docker/dockerfile:1.12
# Multi-architecture index digest for the exact Node 24.18.0 / Alpine 3.24 image.
FROM node:24.18.0-alpine3.24@sha256:a0b9bf06e4e6193cf7a0f58816cc935ff8c2a908f81e6f1a95432d679c54fbfd

# The base image is immutable. Exact APK package versions are frozen in
# infra/sandbox/apk-packages.lock and checked before an image may be released.
COPY infra/sandbox/apk-packages.lock /tmp/apk-packages.lock
RUN apk add --no-cache $(tr '\n' ' ' </tmp/apk-packages.lock) \
  && addgroup -S -g 10101 abl-agent \
  && adduser -S -D -h /home/abl-agent -s /sbin/nologin -u 10101 -G abl-agent abl-agent \
  && install -d -o abl-agent -g abl-agent -m 0700 /home/abl-agent /workspace \
  && install -d -o abl-agent -g abl-agent -m 0700 /run/abl-body-capability \
  && rm /tmp/apk-packages.lock

COPY --from=ghcr.io/blaxel-ai/sandbox@sha256:3bbf1ce15194f5aff6557d5b48a5a7c32b17b84b9bd94000a952130e08000ccb /sandbox-api /usr/local/bin/sandbox-api
COPY --chown=root:root infra/sandbox/abl-reviewed-body-init /usr/local/sbin/abl-reviewed-body-init
COPY --chown=root:root infra/sandbox/reviewed-agent-runtime /usr/local/bin/agent-runtime
RUN chmod 0555 \
  /usr/local/bin/sandbox-api \
  /usr/local/sbin/abl-reviewed-body-init \
  /usr/local/bin/agent-runtime

ENV NODE_ENV=production \
  HOME=/home/abl-agent \
  BL_ENABLE_OPENTELEMETRY=false \
  DO_NOT_TRACK=1 \
  TELEMETRY_ENABLED=false \
  ABL_LOG_CONTENT=false \
  BL_SANDBOX_USER_ENABLED=true

WORKDIR /workspace
ENTRYPOINT ["/usr/local/sbin/abl-reviewed-body-init"]
