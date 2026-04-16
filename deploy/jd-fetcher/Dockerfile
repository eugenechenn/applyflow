FROM mcr.microsoft.com/playwright:v1.59.1-noble

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8080
ENV HOST=0.0.0.0

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY scripts ./scripts
COPY src ./src

EXPOSE 8080

CMD ["node", "scripts/jd-fetcher-server.js"]
