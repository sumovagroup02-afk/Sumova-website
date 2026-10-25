FROM node:22-slim
# Litestream streams the SQLite database to R2 when R2_* is set (Cloudflare Containers: disk is not persistent)
ARG LITESTREAM_VERSION=0.3.13
ADD https://github.com/benbjohnson/litestream/releases/download/v${LITESTREAM_VERSION}/litestream-v${LITESTREAM_VERSION}-linux-amd64.tar.gz /tmp/litestream.tar.gz
RUN mkdir -p /tmp/ls && tar -xzf /tmp/litestream.tar.gz -C /tmp/ls \
 && install -m 0755 "$(find /tmp/ls -type f -name litestream | head -n1)" /usr/local/bin/litestream \
 && rm -rf /tmp/ls /tmp/litestream.tar.gz && litestream version
WORKDIR /app
ENV NODE_ENV=production NODE_NO_WARNINGS=1 PORT=3000 DATA_DIR=/data
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
COPY ops/litestream.yml /etc/litestream.yml
RUN mkdir -p /data && chown node:node /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
USER node
CMD ["node","ops/start.mjs"]
