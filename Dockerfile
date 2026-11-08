# Mandoob in one container: the API serves the built web app on $PORT (8080 by default).
# Used by container hosts that build from the repository (for example Back4app Containers).
# Database: set DATABASE_URL (+ DB_SSL_CA for Aiven). Without it MariaDB runs inside the container and its data is
# lost on every restart (staging only). See deploy/huggingface/start.sh.
FROM node:24-bookworm-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates mariadb-server mariadb-client \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
# Dependencies first, so a code change does not reinstall them.
COPY server/package.json server/pnpm-lock.yaml server/pnpm-workspace.yaml server/
COPY web/package.json web/pnpm-lock.yaml web/
RUN npx --yes pnpm@12.18.0 -C server install --frozen-lockfile --prod=false \
 && npx --yes pnpm@12.18.0 -C web install --frozen-lockfile --prod=false

COPY . .
RUN npx --yes pnpm@12.18.0 -C web build \
 && mkdir -p server/data \
 && chown -R node:node server/data

USER node
ENV HOME=/home/node PORT=8080 HOST=0.0.0.0 TRUST_PROXY=1
EXPOSE 8080
CMD ["sh", "/app/deploy/huggingface/start.sh"]
