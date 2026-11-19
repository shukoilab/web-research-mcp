FROM node:22-alpine AS builder
WORKDIR /app
RUN npm install -g pnpm
COPY package.json pnpm-lock.yaml* ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN npm install -g pnpm
COPY --from=builder /app/package.json /app/pnpm-lock.yaml* ./
COPY --from=builder /app/dist ./dist
RUN pnpm install --prod --frozen-lockfile
USER node
EXPOSE 3000
CMD ["node", "dist/entries/selfhost.js"]
