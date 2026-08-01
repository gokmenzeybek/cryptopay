# ==============================================================================
# CryptoPay Production Dockerfile - Multi-stage build for React + Express
# ==============================================================================
# This Dockerfile creates a production-ready container for the CryptoPay
# XRPL payment application with P2P TRY-XRP exchange functionality.
#
# Architecture:
# - Stage 1: Build React frontend
# - Stage 2: Install backend dependencies
# - Stage 3: Production runtime with both frontend and backend
# ==============================================================================

# ==============================================================================
# Stage 1: Build React Frontend
# ==============================================================================
FROM node:22-alpine AS frontend-builder

# Install build dependencies for native modules
RUN apk add --no-cache python3 make g++

# Set working directory
WORKDIR /app

# Copy package files for dependency installation
COPY package*.json ./

# Install all dependencies (including dev dependencies for build)
RUN npm ci --silent

# Copy source code
COPY src/ ./src/
COPY public/ ./public/

# Build React application
RUN npm run build

# ==============================================================================
# Stage 2: Backend Dependencies
# ==============================================================================
FROM node:22-alpine AS backend-deps

# Install build dependencies for native modules
RUN apk add --no-cache python3 make g++

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install only production dependencies
RUN npm ci --omit=dev --silent && npm cache clean --force

# ==============================================================================
# Stage 3: Production Runtime
# ==============================================================================
FROM node:22-alpine AS production

# Install runtime dependencies
RUN apk add --no-cache dumb-init postgresql-client

# Create app user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S cryptopay -u 1001

# Set production environment by default so the image is safe to run without
# an orchestrator-provided NODE_ENV.
ENV NODE_ENV=production

# Set working directory
WORKDIR /app

# Copy backend dependencies from previous stage
COPY --from=backend-deps /app/node_modules ./node_modules

# Copy application files
COPY server.production.js ./
COPY services/ ./services/
COPY middleware/ ./middleware/
COPY database/ ./database/
COPY utils/ ./utils/
COPY shared_dashboard.html ./
# NOTE: no .env is baked into the image — configuration is injected at runtime
# via environment variables (docker-compose / orchestrator secrets).

# Copy built React frontend from first stage
COPY --from=frontend-builder /app/build ./build

# Create necessary directories
RUN mkdir -p /app/logs && \
    chown -R cryptopay:nodejs /app

# Switch to non-root user
USER cryptopay

# Expose port
EXPOSE 5001

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD node -e "require('http').get('http://localhost:5001/api/health', (res) => { process.exit(res.statusCode === 200 ? 0 : 1) }).on('error', () => process.exit(1))"

# Use dumb-init to handle signals properly
ENTRYPOINT ["dumb-init", "--"]

# Start the application
CMD ["node", "server.production.js"]

# ==============================================================================
# Build Arguments & Labels
# ==============================================================================
ARG BUILD_DATE
ARG VERSION=3.0.0
ARG VCS_REF

LABEL maintainer="CryptoPay Team" \
      org.label-schema.name="cryptopay" \
      org.label-schema.description="XRPL Payment Application with P2P TRY-XRP Exchange" \
      org.label-schema.version=$VERSION \
      org.label-schema.build-date=$BUILD_DATE \
      org.label-schema.vcs-ref=$VCS_REF \
      org.label-schema.schema-version="1.0" \
      org.label-schema.url="https://github.com/your-org/cryptopay" \
      org.label-schema.vendor="CryptoPay" \
      org.label-schema.docker.cmd="docker run -p 5001:5001 cryptopay:latest"