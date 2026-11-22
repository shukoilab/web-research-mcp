FROM node:22-bookworm-slim AS builder
WORKDIR /app
RUN npm install -g pnpm@10
COPY package.json pnpm-lock.yaml* ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm run build

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
LABEL io.modelcontextprotocol.server.name="io.github.shukoilab/web-research-mcp"

# Install system dependencies: Xvfb, fonts, ca-certificates, curl, gnupg, procps, and tini
RUN apt-get update && apt-get install -y --no-install-recommends \
    tini \
    xvfb \
    fonts-liberation \
    fonts-noto-color-emoji \
    ca-certificates \
    curl \
    gnupg \
    procps \
    && rm -rf /var/lib/apt/lists/*

# Install official Google Chrome Stable from Google's Linux repository
RUN curl -fSsL https://dl.google.com/linux/linux_signing_key.pub | gpg --dearmor -o /usr/share/keyrings/google-chrome.gpg \
    && echo "deb [arch=amd64 signed-by=/usr/share/keyrings/google-chrome.gpg] http://dl.google.com/linux/chrome/deb/ stable main" > /etc/apt/sources.list.d/google-chrome.list \
    && apt-get update && apt-get install -y --no-install-recommends google-chrome-stable \
    && rm -rf /var/lib/apt/lists/*

# Install pnpm and production dependencies
RUN npm install -g pnpm@10
COPY --from=builder /app/package.json /app/pnpm-lock.yaml* ./
COPY --from=builder /app/dist ./dist
COPY docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh \
    && pnpm install --prod --frozen-lockfile

# Prepare persistent chrome profile directory
RUN mkdir -p /root/.cache/mcp-web-research/chrome-profile

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -f "http://127.0.0.1:${PORT:-3000}/health" || exit 1

EXPOSE 3000

ENTRYPOINT ["/usr/bin/tini", "--", "/app/docker-entrypoint.sh"]
CMD ["node", "dist/entries/mcp-http.js"]
