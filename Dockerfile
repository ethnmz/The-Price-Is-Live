# Backup deployment image for The Price Is Live (SPEC 8.2, task Z9).
# Build:  docker build -t price-is-live .
# Run:    docker run --rm --env-file <your private env file> price-is-live
# No secrets are baked in: the env comes from docker's env-file option at run time.
FROM node:22-bookworm-slim

WORKDIR /app

# Install dependencies first so this layer is cached between code changes.
COPY package.json package-lock.json ./
RUN npm ci

# Copy the repo (see .dockerignore for what is left out).
COPY . .

# Run as the unprivileged "node" user that ships with the base image.
RUN chown -R node:node /app
USER node

ENV NODE_ENV=production
CMD ["npm", "start"]
