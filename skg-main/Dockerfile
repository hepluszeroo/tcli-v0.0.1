# Build Stage
FROM node:20-alpine AS build

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY pnpm-lock.yaml ./

# Install dependencies
RUN npm install -g pnpm && \
    pnpm install

# Copy source code
COPY . .

# Generate schemas and build the app
RUN pnpm run build

# Runtime Stage - using slimmer base image
FROM node:20-slim

WORKDIR /app

# Install curl for healthcheck and basic utilities
RUN apt-get update && \
    apt-get install -y --no-install-recommends curl ca-certificates && \
    rm -rf /var/lib/apt/lists/*

# Copy package files
COPY package*.json ./
COPY pnpm-lock.yaml ./

# Install production dependencies only
RUN npm install -g pnpm && \
    pnpm install --prod && \
    npm cache clean --force && \
    pnpm store prune

# Copy built app from build stage
COPY --from=build /app/dist ./dist

# Copy JSON schemas
# These are needed at runtime for schema validation
COPY --from=build /app/src/schemas ./src/schemas
COPY --from=build /app/dist/schemas ./dist/schemas

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3000/healthz || exit 1

# Set environment variables
ENV NODE_ENV=production

# Expose health check port
EXPOSE 3000

# Run the service
CMD ["node", "dist/index.js"]