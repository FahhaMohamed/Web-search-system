// ===== CLIENT EXAMPLE (client/example-usage.js) =====
const axios = require('axios');

class DistributedSearchClient {
    constructor(gatewayUrl = 'http://localhost:3000') {
        this.gatewayUrl = gatewayUrl;
    }

    async search(query, domain = 'general', options = {}) {
        try {
            const response = await axios.post(`${this.gatewayUrl}/api/search`, {
                query: query,
                domain: domain,
                filters: options.filters || {},
                limit: options.limit || 20
            });

            return response.data;
        } catch (error) {
            throw new Error(`Search request failed: ${error.message}`);
        }
    }

    async indexDocuments(documents, domain = 'general') {
        try {
            const response = await axios.post(`${this.gatewayUrl}/api/index`, {
                documents: documents,
                domain: domain
            });

            return response.data;
        } catch (error) {
            throw new Error(`Index request failed: ${error.message}`);
        }
    }

    async getClusterHealth() {
        try {
            const response = await axios.get(`${this.gatewayUrl}/api/health`);
            return response.data;
        } catch (error) {
            throw new Error(`Health check failed: ${error.message}`);
        }
    }
}

// Example usage for different domains
async function demonstrateUsage() {
    const client = new DistributedSearchClient();

    // Example 1: E-commerce search
    console.log('=== E-commerce Search Example ===');
    try {
        // Index some sample products
        const products = [
            {
                id: 'prod1',
                name: 'Wireless Headphones',
                description: 'High-quality bluetooth headphones with noise cancellation',
                price: 199.99,
                category: 'Electronics',
                brand: 'TechBrand',
                tags: ['wireless', 'bluetooth', 'headphones', 'audio']
            },
            {
                id: 'prod2',
                name: 'Running Shoes',
                description: 'Comfortable running shoes for daily exercise',
                price: 89.99,
                category: 'Sports',
                brand: 'SportsBrand',
                tags: ['shoes', 'running', 'sports', 'fitness']
            }
        ];

        await client.indexDocuments(products, 'ecommerce');
        
        const searchResults = await client.search('wireless headphones', 'ecommerce', {
            filters: { category: 'Electronics' },
            limit: 10
        });
        
        console.log('E-commerce search results:', searchResults);
    } catch (error) {
        console.error('E-commerce search failed:', error.message);
    }

    // Example 2: Social media search
    console.log('\n=== Social Media Search Example ===');
    try {
        const posts = [
            {
                id: 'post1',
                content: 'Amazing sunset at the beach today! #nature #photography',
                author: 'photographer123',
                hashtags: ['nature', 'photography', 'sunset'],
                platform: 'instagram',
                likes: 150,
                createdAt: '2024-09-01T10:00:00Z'
            },
            {
                id: 'post2',
                content: 'New tech gadget review - wireless earbuds comparison',
                author: 'techreviewer',
                hashtags: ['tech', 'review', 'gadgets'],
                platform: 'youtube',
                likes: 200,
                createdAt: '2024-09-01T11:00:00Z'
            }
        ];

        await client.indexDocuments(posts, 'social');
        
        const socialResults = await client.search('tech review', 'social', {
            filters: { platform: 'youtube' },
            limit: 10
        });
        
        console.log('Social media search results:', socialResults);
    } catch (error) {
        console.error('Social media search failed:', error.message);
    }

    // Example 3: Check cluster health
    console.log('\n=== Cluster Health Check ===');
    try {
        const health = await client.getClusterHealth();
        console.log('Cluster health:', health);
    } catch (error) {
        console.error('Health check failed:', error.message);
    }
}

// Run demonstration
if (require.main === module) {
    demonstrateUsage();
}

module.exports = { DistributedSearchClient, EcommerceAdapter, SocialMediaAdapter };
