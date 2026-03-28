# Build stage
FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install
COPY tsconfig.json drizzle.config.ts ./
COPY src ./src
RUN npm run build

# Production stage
FROM node:22-alpine
WORKDIR /app
ARG VCS_REF=dev
ARG BUILD_TIMESTAMP=unknown
COPY package.json package-lock.json* ./
RUN npm install --omit=dev && npm cache clean --force
COPY --from=builder /app/dist ./dist
COPY web ./web
RUN SHORT_SHA="$(printf '%.7s' "$VCS_REF")" && \
    RELEASE_VERSION="v$(node -p "require('./package.json').version")" && \
    printf '{"sha":"%s","short":"%s","release":"%s","timestamp":"%s","message":""}\n' "$VCS_REF" "$SHORT_SHA" "$RELEASE_VERSION" "$BUILD_TIMESTAMP" > version.json && \
    cp version.json dist/version.json && \
    cp version.json web/version.json
EXPOSE 3000
ENV NODE_ENV=production
CMD ["node", "dist/server.js"]
