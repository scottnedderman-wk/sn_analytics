FROM oven/bun:1.2.21

WORKDIR /opt/sn-analytics

COPY package.json bun.lock bunfig.toml tsconfig.json ./
RUN bun install --frozen-lockfile --production

COPY build.ts ./build.ts
COPY src ./src
COPY data/seed.json ./data/seed.json

# The wk ingress serves the app under this prefix and strips it before requests reach the container.
# It is baked into the frontend bundle (router basename, fetch URLs, asset URLs) at build time.
ARG BASE_PATH=/s/sn-analytics
RUN BUN_PUBLIC_BASE_PATH=${BASE_PATH} bun run build.ts --outdir=dist --env='BUN_PUBLIC_*' --public-path=${BASE_PATH}/

# The wk helm chart runs pods as uid/gid 65534 (nobody), so that user must own the app and SQLite dir.
USER root
RUN mkdir -p /data && chown -R 65534:65534 /opt/sn-analytics /data
USER 65534:65534

ENV NODE_ENV=production \
    PORT=3000 \
    SQLITE_PATH=/data/app.sqlite

EXPOSE 3000
VOLUME /data

CMD ["bun", "src/index.tsx"]
