FROM node:18-alpine

WORKDIR /app

RUN npm install express axios

COPY . .

RUN mkdir -p /data

RUN addgroup -g 1001 -S nodejs
RUN adduser -S shardcluster -u 1001

RUN chown -R shardcluster:nodejs /app /data
RUN mkdir -p /var/sockets && chown shardcluster:nodejs /var/sockets && chmod 777 /var/sockets
USER shardcluster

EXPOSE 7000

HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD wget -qO- http://localhost:${PORT:-7000}/health || exit 1

CMD ["node", "app.js"]
