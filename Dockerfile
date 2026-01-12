FROM node:20-alpine AS builder

WORKDIR /app

# Install build dependencies for native modules (sharp, etc)
RUN apk add --no-cache python3 make g++

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# Production image
FROM node:20-alpine

WORKDIR /app

# Install runtime dependencies if needed
# ffmpeg-static brings its own binary, but sometimes shared libs are needed
RUN apk add --no-cache \
    vips-dev \
    ffprobe \
    ffmpeg

COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/scripts ./scripts

EXPOSE 4000

CMD ["npm", "start"]
