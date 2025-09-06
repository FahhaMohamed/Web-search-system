FROM node:18-alpine

WORKDIR /app

# Install dependencies

RUN npm install express axios

# Copy application code
COPY . .

# Create non-root user
RUN addgroup -g 1001 -S nodejs
RUN adduser -S monitor -u 1001

# Set ownership
RUN chown -R monitor:nodejs /app
USER monitor

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD curl -f http://localhost:8080/metrics || exit 1

CMD ["node", "app.js"]