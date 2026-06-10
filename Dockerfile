# Cloud Run container for gpt-stt.
# It serves the Next.js app and lets /api/chat call Hermes OpenAI Codex OAuth.

FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile

FROM node:22-bookworm-slim AS builder
WORKDIR /app
ARG NEXT_PUBLIC_ENABLE_OPENAI_STT_FALLBACK=true
ENV NEXT_TELEMETRY_DISABLED=1 \
    NEXT_PUBLIC_ENABLE_OPENAI_STT_FALLBACK=${NEXT_PUBLIC_ENABLE_OPENAI_STT_FALLBACK}
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN yarn build

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=8080 \
    HOSTNAME=0.0.0.0 \
    HERMES_HOME=/root/.hermes \
    PATH=/root/.local/bin:/root/.hermes/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

RUN apt-get update \
  && apt-get install -y --no-install-recommends bash ca-certificates curl git python3 python3-venv python3-pip \
  && rm -rf /var/lib/apt/lists/* \
  && curl -fsSL https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh | bash

COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY scripts/cloud-run-start.sh ./scripts/cloud-run-start.sh
RUN sed -i 's/\r$//' ./scripts/cloud-run-start.sh && chmod +x ./scripts/cloud-run-start.sh

EXPOSE 8080
CMD ["./scripts/cloud-run-start.sh"]
