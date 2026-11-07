# Mandoob staging on a free Hugging Face Docker Space.
# The Space holds only this file and README.md. The code stays in the private GitHub repository: it is cloned at
# build time with the GITHUB_TOKEN secret (Space › Settings › Variables and secrets), and the token is not kept in
# the image. After a new push to GitHub use "Factory rebuild" so the clone is not taken from the build cache.
FROM node:24-bookworm-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates mariadb-server mariadb-client \
 && rm -rf /var/lib/apt/lists/*

ARG REPO=github.com/Fadysamy9/mandoob.git
ARG BRANCH=mina-diaa
RUN --mount=type=secret,id=GITHUB_TOKEN,mode=0444,required=true \
    git clone --depth 1 --branch "$BRANCH" "https://x-access-token:$(cat /run/secrets/GITHUB_TOKEN)@$REPO" /app \
 && rm -rf /app/.git

WORKDIR /app
RUN npx --yes pnpm@12.18.0 -C server install --frozen-lockfile --prod=false \
 && npx --yes pnpm@12.18.0 -C web install --frozen-lockfile --prod=false \
 && npx --yes pnpm@12.18.0 -C web build \
 && mkdir -p server/data \
 && chown -R 1000:1000 server/data

# Spaces run the container as user 1000 (the image's "node" user) and send traffic to port 7860.
USER 1000
ENV HOME=/home/node PORT=7860 HOST=0.0.0.0 TRUST_PROXY=1
EXPOSE 7860
CMD ["sh", "/app/deploy/huggingface/start.sh"]
