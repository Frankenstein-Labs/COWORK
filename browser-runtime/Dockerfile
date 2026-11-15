FROM mcr.microsoft.com/playwright:v1.65.0-noble

WORKDIR /app

COPY browser-runtime/package.json browser-runtime/package-lock.json ./
RUN npm ci --omit=dev

COPY browser-runtime/server.mjs ./server.mjs

ENV NODE_ENV=production
ENV PORT=10000
EXPOSE 10000

USER pwuser
CMD ["node", "server.mjs"]
