FROM node:18-alpine

WORKDIR /app

# Install dependencies

RUN npm install express fs

# Copy application code
COPY . .

# Create data directory
RUN mkdir -p /data

# Create non-root user
RUN addgroup -g 1001 -S nodejs
RUN adduser -S indexnode -u 1001

# Set ownership
RUN chown -R indexnode:nodejs /app /data
USER indexnode

EXPOSE 4001

HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD curl -f http://localhost:${PORT:-4001}/health || exit 1

CMD ["node", "app.js"]