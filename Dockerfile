FROM node:24-bookworm-slim AS build
WORKDIR /app
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build:web

FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production LMB_HOST=0.0.0.0 LMB_PORT=8080 LMB_DATA_DIR=/data
COPY --from=build /app/dist ./dist
COPY --from=build /app/dist-web ./dist-web
COPY --from=build /app/package.json /app/LICENSE /app/THIRD_PARTY.md /app/THIRD-PARTY-NOTICES.txt ./
COPY scripts/healthcheck.cjs ./
RUN mkdir /data && chown node:node /data
USER node
EXPOSE 8080
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD ["node", "healthcheck.cjs"]
CMD ["node", "dist-web/server.cjs"]
