# Multi-stage build: build Vite app then serve via nginx

# 1) Build stage
FROM node:18-alpine AS build
WORKDIR /app

# Install deps
COPY package.json package-lock.json ./
RUN npm ci

# Copy source
COPY . .

# Allow build-time mode override
ARG MODE=wasm
ENV MODE=${MODE}

# Build Vite
RUN npm run build

# 2) Runtime stage (nginx)
FROM nginx:1.25-alpine

# Copy nginx config
COPY nginx.conf /etc/nginx/nginx.conf

# Copy built assets to nginx html root
COPY --from=build /app/dist /usr/share/nginx/html

# Healthcheck: ensure index is present
HEALTHCHECK CMD test -f /usr/share/nginx/html/index.html || exit 1

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]