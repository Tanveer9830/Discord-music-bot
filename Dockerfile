FROM node:22-bookworm-slim

ENV NODE_ENV=production \
    DEPLOYMENT_MODE=docker \
    APP_HOME=/app
WORKDIR /app

RUN groupadd --system --gid 10001 musicbot \
    && useradd --system --uid 10001 --gid musicbot --home-dir /app --shell /usr/sbin/nologin musicbot \
    && mkdir -p /app/data /app/logs /app/backups \
    && chown -R musicbot:musicbot /app

COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --omit=dev --no-audit --no-fund \
    && npm cache clean --force

COPY --chown=musicbot:musicbot src ./src
COPY --chown=musicbot:musicbot scripts ./scripts
COPY --chown=musicbot:musicbot .env.example ./
COPY --chown=musicbot:musicbot README.md PTERODACTYL.md LICENSE ./

USER musicbot:musicbot
STOPSIGNAL SIGTERM
CMD ["node", "src/index.js"]
