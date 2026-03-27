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
COPY package.json package-lock.json* ./
RUN npm install --omit=dev && npm cache clean --force
COPY --from=builder /app/dist ./dist
COPY web ./web
EXPOSE 3000
ENV NODE_ENV=production
CMD ["node", "dist/server.js"]
