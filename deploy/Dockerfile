# ECS/Fargate Docker build. Requires `output: "standalone"` in next.config.mjs.
#
# Build:  docker build -f deploy/Dockerfile -t blackout-web .
# Run:    docker run --rm -p 3000:3000 -e PORT=3000 blackout-web
# Health: GET /api/ready

FROM node:20-bookworm-slim AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Build does not need live Postgres/Redis — schema is created at runtime on first dbQuery().
# NEXT_PUBLIC_* must be present at build time (inlined into client bundles).
ARG AUTH_PROVIDER="clerk"
ARG NEXT_PUBLIC_AUTH_PROVIDER="clerk"
ARG NEXT_PUBLIC_COGNITO_USER_POOL_ID=""
ARG NEXT_PUBLIC_COGNITO_CLIENT_ID=""
ARG NEXT_PUBLIC_COGNITO_DOMAIN=""
ARG NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=""
ARG NEXT_PUBLIC_SITE_URL="https://staging.blackouttrades.com"
ARG NEXT_PUBLIC_CLERK_ALLOWED_REDIRECT_ORIGINS="https://staging.blackouttrades.com"
ARG NEXT_PUBLIC_CLERK_IS_SATELLITE="true"
ARG NEXT_PUBLIC_CLERK_PROXY_URL="https://staging.blackouttrades.com/__clerk"
ARG NEXT_PUBLIC_CLERK_SIGN_IN_URL="https://blackouttrades.com/sign-in"
ARG NEXT_PUBLIC_CLERK_SIGN_UP_URL="https://blackouttrades.com/sign-up"
ARG NEXT_PUBLIC_WHOP_CHECKOUT_MONTHLY=""
ARG NEXT_PUBLIC_WHOP_CHECKOUT_YEARLY=""
ARG NEXT_PUBLIC_WHOP_CHECKOUT_COMMUNITY=""
ARG NEXT_PUBLIC_WHOP_STORE_URL=""
ARG GITHUB_SHA=""
ENV NODE_ENV=production
ENV AUTH_PROVIDER=$AUTH_PROVIDER
ENV NEXT_PUBLIC_AUTH_PROVIDER=$NEXT_PUBLIC_AUTH_PROVIDER
ENV NEXT_PUBLIC_COGNITO_USER_POOL_ID=$NEXT_PUBLIC_COGNITO_USER_POOL_ID
ENV NEXT_PUBLIC_COGNITO_CLIENT_ID=$NEXT_PUBLIC_COGNITO_CLIENT_ID
ENV NEXT_PUBLIC_COGNITO_DOMAIN=$NEXT_PUBLIC_COGNITO_DOMAIN
ENV NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=$NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
ENV NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL
ENV NEXT_PUBLIC_CLERK_ALLOWED_REDIRECT_ORIGINS=$NEXT_PUBLIC_CLERK_ALLOWED_REDIRECT_ORIGINS
ENV NEXT_PUBLIC_CLERK_IS_SATELLITE=$NEXT_PUBLIC_CLERK_IS_SATELLITE
ENV NEXT_PUBLIC_CLERK_PROXY_URL=$NEXT_PUBLIC_CLERK_PROXY_URL
ENV NEXT_PUBLIC_CLERK_SIGN_IN_URL=$NEXT_PUBLIC_CLERK_SIGN_IN_URL
ENV NEXT_PUBLIC_CLERK_SIGN_UP_URL=$NEXT_PUBLIC_CLERK_SIGN_UP_URL
ENV NEXT_PUBLIC_WHOP_CHECKOUT_MONTHLY=$NEXT_PUBLIC_WHOP_CHECKOUT_MONTHLY
ENV NEXT_PUBLIC_WHOP_CHECKOUT_YEARLY=$NEXT_PUBLIC_WHOP_CHECKOUT_YEARLY
ENV NEXT_PUBLIC_WHOP_CHECKOUT_COMMUNITY=$NEXT_PUBLIC_WHOP_CHECKOUT_COMMUNITY
ENV NEXT_PUBLIC_WHOP_STORE_URL=$NEXT_PUBLIC_WHOP_STORE_URL
ENV GITHUB_SHA=$GITHUB_SHA
ENV CF_PURGE_DEPLOY_ID=$GITHUB_SHA
# Cognito staging: swap middleware entry so @clerk/nextjs never enters the edge bundle.
RUN if [ "$AUTH_PROVIDER" = "cognito" ]; then cp src/middleware.entry.cognito.ts src/middleware.ts; fi
# ---------------------------------------------------------------------------------------------
# VERIFY GATE — runs BEFORE `npm run build`, inside the builder stage where node_modules and the
# full source tree already exist. Placed here on purpose: a failing gate aborts the image build,
# so no artifact is produced, so CodePipeline's Deploy stage has nothing to roll. That is what
# makes "no manual approval" safe — the gate is the approval.
#
# This replaced a human approval stage in the `blackout-web-production` pipeline (2026-08-06).
# Do NOT remove it without putting an equivalent gate somewhere earlier in the pipeline; without
# it, a merge to main deploys straight to a live options-trading desk with nothing checked.
#
# These five are DETERMINISTIC — each verified clean against the 13-PR release batch on 2026-08-06.
#
# NOT INCLUDED, deliberately: the `src/**/*.test.ts` suite. Two measurements of it the same day
# disagreed (one run reported ~101 failures, a re-run reported zero through ~22k TAP lines), so its
# determinism is unresolved. A non-deterministic gate on the deploy path would block good deploys
# at random, get bypassed as a matter of habit, and then protect nothing. Add it here once the
# flakiness is settled — that is strictly better than gating on a coin flip.
ARG SKIP_VERIFY_GATES=""
RUN if [ -n "$SKIP_VERIFY_GATES" ]; then \
      echo "############################################################"; \
      echo "## VERIFY GATES SKIPPED via SKIP_VERIFY_GATES build-arg    ##"; \
      echo "## This image is UNVERIFIED. Break-glass use only.         ##"; \
      echo "############################################################"; \
    else \
      echo "--- verify gate: tsc --noEmit"            && npx tsc --noEmit && \
      echo "--- verify gate: api auth guards"         && node scripts/verify-api-auth-guards.mjs && \
      echo "--- verify gate: tailwind @apply opacity" && node scripts/check-tailwind-apply-opacity.mjs && \
      echo "--- verify gate: lint:brand"              && npm run lint:brand && \
      echo "--- verify gate: lint:vendor"             && npm run lint:vendor && \
      echo "--- verify gate: ALL PASSED"; \
    fi

RUN npm run build

FROM base AS runner
ARG GITHUB_SHA=""
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV GITHUB_SHA=$GITHUB_SHA
ENV CF_PURGE_DEPLOY_ID=$GITHUB_SHA
# ECS task def can set PORT to match ALB target group.
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Sharp (librsvg/pango) needs real TTF files to paint SVG <text>. bookworm-slim
# ships with zero fonts — Discord Thermal cards rendered as solid yellow/purple
# "boxes" with no strike/GEX labels. DejaVu Sans Mono matches the desk card.
RUN apt-get update \
  && apt-get install -y --no-install-recommends fonts-dejavu-core fontconfig \
  && fc-cache -f \
  && rm -rf /var/lib/apt/lists/*

RUN groupadd --system --gid 1001 nodejs \
  && useradd --system --uid 1001 --gid nodejs nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/src/lib/migrations ./src/lib/migrations
COPY --from=builder --chown=nextjs:nodejs /app/deploy/market-worker.mjs ./deploy/market-worker.mjs
# Self-contained desk fonts — embedded into Thermal Discord SVG at render time
# so Sharp never depends on fontconfig finding a system face.
COPY --from=builder --chown=nextjs:nodejs /app/deploy/fonts ./deploy/fonts

USER nextjs
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=90s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
