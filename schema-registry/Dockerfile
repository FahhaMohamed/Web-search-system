FROM node:18-alpine

WORKDIR /app

RUN npm install express msgpackr

COPY . .

RUN addgroup -g 1001 -S nodejs
RUN adduser -S search -u 1001

RUN chown -R search:nodejs /app
RUN mkdir -p /var/sockets && chown search:nodejs /var/sockets && chmod 777 /var/sockets
USER search

EXPOSE 5000

HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:5000/health || exit 1

CMD ["node", "app.js"]
