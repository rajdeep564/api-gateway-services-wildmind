
# 1. Base Image
FROM node:20-alpine AS builder

WORKDIR /app

# 2. Dependencies
COPY package*.json ./
# Use ci if package-lock exists, otherwise install.
RUN npm ci || npm install

# 3. Source Code
COPY . .

# 4. Build
RUN npm run build

# --- Production Stage ---
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

# Copy built artifacts and dependencies
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
# Copy scripts folder if needed for migrations
COPY --from=builder /app/scripts ./scripts 

EXPOSE 4000

CMD ["npm", "run", "start"]
