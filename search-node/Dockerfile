FROM node:18-alpine

WORKDIR /app

# Install dependencies

RUN npm install express fs axios

# Copy application code
COPY . .

# Create data directory
RUN mkdir -p /data

# Create non-root user
RUN addgroup -g 1001 -S nodejs
RUN adduser -S searchnode -u 1001

# Set ownership
RUN chown -R searchnode:nodejs /app /data
RUN mkdir -p /var/sockets && chown searchnode:nodejs /var/sockets && chmod 777 /var/sockets
USER searchnode

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD curl -f http://localhost:${PORT:-3001}/health || exit 1

CMD ["node", "app.js"]