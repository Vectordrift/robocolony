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
RUN npm install && npm cache clean --force
COPY --from=builder /app/dist ./dist
COPY drizzle.config.ts ./
COPY src/db ./src/db
EXPOSE 3000
ENV NODE_ENV=production
CMD ["sh", "-c", "npx drizzle-kit push --force && node dist/server.js"]
