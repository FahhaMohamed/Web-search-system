FROM node:18-alpine

WORKDIR /app

# Install dependencies

RUN npm install express axios cors

# Copy application code
COPY . .

# Create non-root user
RUN addgroup -g 1001 -S nodejs
RUN adduser -S search -u 1001

# Set ownership
RUN chown -R search:nodejs /app
USER search

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD curl -f http://localhost:3000/api/health || exit 1

CMD ["node", "app.js"]