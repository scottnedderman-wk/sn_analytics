FROM oven/bun:1.2.21

WORKDIR /opt/sn-analytics

COPY package.json bun.lock bunfig.toml tsconfig.json ./
RUN bun install --frozen-lockfile --production

COPY src ./src
COPY data/seed.json ./data/seed.json

USER root
RUN mkdir -p /data && chown -R bun:bun /opt/sn-analytics /data
USER bun

ENV NODE_ENV=production \
    PORT=3000 \
    SQLITE_PATH=/data/app.sqlite

EXPOSE 3000
VOLUME /data

CMD ["bun", "src/index.tsx"]
