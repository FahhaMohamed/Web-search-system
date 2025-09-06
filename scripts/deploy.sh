#!/bin/bash

echo "Building and deploying Distributed Search Engine..."

# Create necessary directories
mkdir -p data
mkdir -p gateway search-node index-node monitoring

# Build all services
docker-compose build

# Start the cluster
docker-compose up -d

echo "Waiting for services to start..."
sleep 10

# Check cluster health
curl -s http://localhost:3000/api/health | jq '.'

echo "Deployment complete!"
echo "Gateway: http://localhost:3000"
echo "Monitoring: http://localhost:8080/dashboard"