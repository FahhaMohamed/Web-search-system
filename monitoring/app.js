const express = require('express');
const axios = require('axios');

class ClusterMonitor {
    constructor(gatewayUrl) {
        this.gatewayUrl = gatewayUrl;
        this.metrics = {
            searches: 0,
            indexOperations: 0,
            errors: 0,
            responseTime: [],
            nodeHealth: new Map()
        };
    }

    async collectMetrics() {
        try {
            const health = await axios.get(`${this.gatewayUrl}/api/health`);
            
            health.data.nodes.forEach(node => {
                this.metrics.nodeHealth.set(node.nodeId, {
                    status: node.status,
                    lastCheck: new Date().toISOString()
                });
            });

            return this.metrics;
        } catch (error) {
            console.error('Failed to collect metrics:', error.message);
            this.metrics.errors++;
        }
    }

    getHealthSummary() {
        const healthyNodes = Array.from(this.metrics.nodeHealth.values())
            .filter(node => node.status === 'healthy').length;
        
        const totalNodes = this.metrics.nodeHealth.size;
        
        return {
            cluster: 'distributed-search-engine',
            healthyNodes: healthyNodes,
            totalNodes: totalNodes,
            healthPercentage: totalNodes > 0 ? (healthyNodes / totalNodes) * 100 : 0,
            totalSearches: this.metrics.searches,
            totalIndexOperations: this.metrics.indexOperations,
            totalErrors: this.metrics.errors,
            avgResponseTime: this.metrics.responseTime.length > 0 
                ? this.metrics.responseTime.reduce((a, b) => a + b, 0) / this.metrics.responseTime.length 
                : 0
        };
    }
}

const monitor = new ClusterMonitor(process.env.GATEWAY_URL || 'http://gateway:3000');

const app4 = express();
app4.use(express.json());

// Monitoring dashboard endpoint
app4.get('/dashboard', async (req, res) => {
    try {
        await monitor.collectMetrics();
        const summary = monitor.getHealthSummary();
        
        res.json({
            timestamp: new Date().toISOString(),
            ...summary,
            nodeDetails: Object.fromEntries(monitor.metrics.nodeHealth)
        });
    } catch (error) {
        res.status(500).json({ error: 'Failed to get cluster status' });
    }
});

// Real-time metrics endpoint
app4.get('/metrics', (req, res) => {
    res.json(monitor.getHealthSummary());
});

app4.listen(8080, () => {
    console.log('Monitoring service running on port 8080');
    
    // Collect metrics every 30 seconds
    setInterval(() => {
        monitor.collectMetrics();
    }, 30000);
});