const { DistributedSearchClient } = require('./example-usage');
const EcommerceAdapter = require('../domain-adapters/ecommerce-adapter');
const SocialMediaAdapter = require('../domain-adapters/social-adapter');
const MediaAdapter = require('../domain-adapters/media-adapter');
const GeneralAdapter = require('../domain-adapters/general-adapter');

// ===== INTEGRATION EXAMPLES (client/integration-examples.js) =====

class IntegrationExamples {
    constructor(gatewayUrl = 'http://localhost:3000') {
        this.client = new DistributedSearchClient(gatewayUrl);
        this.ecommerce = new EcommerceAdapter(gatewayUrl);
        this.social = new SocialMediaAdapter(gatewayUrl);
        this.media = new MediaAdapter(gatewayUrl);
        this.general = new GeneralAdapter(gatewayUrl);
    }

    // Example 1: Canva-like Design Platform Integration
    async canvaIntegration() {
        console.log('\n=== Canva-like Platform Integration Example ===');
        
        // Index design templates
        const templates = [
            {
                id: 'tmpl_001',
                title: 'Professional Business Card',
                description: 'Clean and modern business card template',
                category: 'Business Cards',
                tags: ['business', 'professional', 'corporate', 'minimal'],
                creator: 'DesignStudio',
                fileType: 'template',
                isPremium: false,
                downloads: 15420,
                rating: 4.8,
                dimensions: '3.5 x 2 inches',
                colors: ['blue', 'white', 'gray']
            },
            {
                id: 'tmpl_002',
                title: 'Instagram Story Template',
                description: 'Eye-catching Instagram story design',
                category: 'Social Media',
                tags: ['instagram', 'social', 'story', 'modern'],
                creator: 'SocialDesigns',
                fileType: 'template',
                isPremium: true,
                downloads: 8532,
                rating: 4.9,
                dimensions: '1080 x 1920 px',
                colors: ['pink', 'purple', 'gradient']
            }
        ];

        try {
            await this.media.indexAssets(templates);
            
            const searchResults = await this.media.searchAssets('business card professional');
            console.log(`Found ${searchResults.length} templates`);
            
            const premiumResults = await this.media.advancedSearch({
                query: 'professional',
                isPremium: true,
                categories: ['Business Cards'],
                limit: 10
            });
            console.log(`Found ${premiumResults.length} premium templates`);
            
            return { templates: searchResults, premium: premiumResults };
        } catch (error) {
            console.error('Canva integration failed:', error.message);
        }
    }

    // Example 2: E-commerce Platform (Amazon/AliExpress-like)
    async ecommerceIntegration() {
        console.log('\n=== E-commerce Platform Integration Example ===');
        
        const products = [
            {
                productId: 'prod_001',
                name: 'Wireless Bluetooth Headphones',
                description: 'Premium wireless headphones with active noise cancellation and 30-hour battery life',
                price: 199.99,
                category: 'Electronics',
                brand: 'AudioTech',
                tags: ['wireless', 'bluetooth', 'noise-cancelling', 'headphones'],
                rating: 4.5,
                reviewCount: 2341,
                inStock: true,
                seller: 'AudioTech Official',
                shippingInfo: 'Free shipping worldwide'
            },
            {
                productId: 'prod_002',
                name: 'Smart Fitness Watch',
                description: 'Advanced fitness tracker with heart rate monitoring, GPS, and waterproof design',
                price: 299.99,
                category: 'Sports & Fitness',
                brand: 'FitTracker',
                tags: ['smartwatch', 'fitness', 'gps', 'waterproof', 'health'],
                rating: 4.7,
                reviewCount: 1876,
                inStock: true,
                seller: 'FitTracker Store',
                shippingInfo: '2-day delivery available'
            }
        ];

        try {
            await this.ecommerce.indexProducts(products);
            
            // Search with price filter
            const budgetResults = await this.ecommerce.searchProducts('wireless headphones', {
                priceRange: { min: 100, max: 250 }
            });
            
            // Search by category
            const electronicsResults = await this.ecommerce.searchProducts('smart', {
                category: 'Electronics'
            });
            
            console.log(`Budget headphones: ${budgetResults.length}`);
            console.log(`Smart electronics: ${electronicsResults.length}`);
            
            return { budget: budgetResults, electronics: electronicsResults };
        } catch (error) {
            console.error('E-commerce integration failed:', error.message);
        }
    }

    // Example 3: Social Media Platform Integration
    async socialMediaIntegration() {
        console.log('\n=== Social Media Platform Integration Example ===');
        
        const posts = [
            {
                postId: 'post_001',
                content: 'Just finished an amazing sunset photoshoot at the beach! The colors were absolutely breathtaking. Check out my photography portfolio link in bio!',
                author: 'photographer_jane',
                hashtags: ['photography', 'sunset', 'beach', 'nature', 'portfolio'],
                mentions: ['@naturelover', '@beachvibes'],
                platform: 'instagram',
                likes: 1250,
                comments: 89,
                shares: 34,
                timestamp: '2024-09-01T18:30:00Z',
                location: 'Malibu Beach'
            },
            {
                postId: 'post_002',
                content: 'New tech review is live! I tested the latest wireless headphones for 2 weeks. Spoiler alert: they\'re incredible! Full review on my YouTube channel.',
                author: 'tech_reviewer_pro',
                hashtags: ['tech', 'review', 'headphones', 'youtube', 'gadgets'],
                mentions: ['@AudioTech'],
                platform: 'twitter',
                likes: 892,
                comments: 156,
                shares: 234,
                timestamp: '2024-09-01T14:15:00Z',
                videoUrl: 'https://youtube.com/watch?v=tech_review_123'
            }
        ];

        try {
            await this.social.indexPosts(posts);
            
            // Search by hashtag
            const techPosts = await this.social.searchPosts('#tech OR #review');
            
            // Search by platform
            const instagramPosts = await this.social.searchPosts('photography', {
                platform: 'instagram'
            });
            
            console.log(`Tech posts: ${techPosts.length}`);
            console.log(`Instagram photography: ${instagramPosts.length}`);
            
            return { tech: techPosts, photography: instagramPosts };
        } catch (error) {
            console.error('Social media integration failed:', error.message);
        }
    }

    // Example 4: Freepik-like Media Platform Integration
    async freepikIntegration() {
        console.log('\n=== Freepik-like Media Platform Integration Example ===');
        
        const assets = [
            {
                assetId: 'img_001',
                title: 'Modern Business Team Vector',
                description: 'Diverse team of professionals working together in modern office environment',
                fileType: 'vector',
                format: 'svg',
                category: 'Business',
                tags: ['business', 'team', 'office', 'professional', 'diverse', 'modern'],
                creator: 'VectorArt Studio',
                resolution: 'scalable',
                colorScheme: ['blue', 'orange', 'white'],
                orientation: 'landscape',
                downloads: 45230,
                isPremium: false,
                license: 'free'
            },
            {
                assetId: 'img_002',
                title: 'Minimalist Logo Collection',
                description: 'Set of 20 minimalist logo designs perfect for startups',
                fileType: 'image',
                format: 'png',
                category: 'Logos',
                tags: ['logo', 'minimalist', 'startup', 'branding', 'clean', 'modern'],
                creator: 'LogoDesigner Pro',
                resolution: '4K',
                dimensions: '4000x4000',
                colorScheme: ['black', 'white', 'monochrome'],
                orientation: 'square',
                downloads: 12890,
                isPremium: true,
                license: 'premium'
            }
        ];

        try {
            await this.media.indexAssets(assets);
            
            // Search for free vectors
            const freeVectors = await this.media.advancedSearch({
                query: 'business team',
                fileTypes: ['vector'],
                isPremium: false
            });
            
            // Search by color scheme
            const blueAssets = await this.media.searchAssets('modern', {
                colorScheme: ['blue']
            });
            
            console.log(`Free vectors: ${freeVectors.length}`);
            console.log(`Blue-themed assets: ${blueAssets.length}`);
            
            return { vectors: freeVectors, blue: blueAssets };
        } catch (error) {
            console.error('Freepik integration failed:', error.message);
        }
    }

    // Example 5: Knowledge Base/Documentation Integration
    async knowledgeBaseIntegration() {
        console.log('\n=== Knowledge Base Integration Example ===');
        
        const documents = [
            {
                id: 'doc_001',
                title: 'Getting Started with Distributed Search',
                content: 'This comprehensive guide covers the basics of implementing a distributed search engine. Topics include node setup, query processing, index management, and performance optimization.',
                category: 'Documentation',
                author: 'Engineering Team',
                tags: ['search', 'distributed', 'setup', 'guide'],
                contentType: 'documentation',
                language: 'en',
                publishDate: '2024-08-15T10:00:00Z',
                source: 'internal_docs'
            },
            {
                id: 'doc_002',
                title: 'API Reference Manual',
                content: 'Complete API reference for the distributed search engine. Includes endpoint descriptions, parameters, response formats, and code examples in multiple programming languages.',
                category: 'API Documentation',
                author: 'API Team',
                tags: ['api', 'reference', 'endpoints', 'examples'],
                contentType: 'technical',
                language: 'en',
                publishDate: '2024-08-20T15:30:00Z',
                source: 'api_docs'
            }
        ];

        try {
            await this.general.indexDocuments(documents);
            
            // Full-text search with highlighting
            const searchResults = await this.general.fullTextSearch('distributed search setup', {
                highlight: true,
                maxSnippets: 2
            });
            
            // Search by content type
            const apiDocs = await this.general.searchByType('api', 'technical');
            
            console.log(`Search results: ${searchResults.length}`);
            console.log(`API documentation: ${apiDocs.length}`);
            
            return { results: searchResults, api: apiDocs };
        } catch (error) {
            console.error('Knowledge base integration failed:', error.message);
        }
    }

    // Example 6: Multi-Domain Search (Cross-platform search)
    async multiDomainSearch() {
        console.log('\n=== Multi-Domain Search Example ===');
        
        try {
            // Search across all domains for a common term
            const allResults = await Promise.all([
                this.ecommerce.searchProducts('wireless technology'),
                this.social.searchPosts('wireless technology'),
                this.media.searchAssets('wireless technology'),
                this.general.searchDocuments('wireless technology')
            ]);

            const [products, posts, assets, documents] = allResults;
            
            console.log(`Products found: ${products.length}`);
            console.log(`Social posts found: ${posts.length}`);
            console.log(`Media assets found: ${assets.length}`);
            console.log(`Documents found: ${documents.length}`);
            
            // Combine and rank results across domains
            const combinedResults = [
                ...products.map(p => ({ ...p, domain: 'ecommerce', type: 'product' })),
                ...posts.map(p => ({ ...p, domain: 'social', type: 'post' })),
                ...assets.map(a => ({ ...a, domain: 'media', type: 'asset' })),
                ...documents.map(d => ({ ...d, domain: 'general', type: 'document' }))
            ].sort((a, b) => (b.relevanceScore || 0) - (a.relevanceScore || 0));
            
            return combinedResults.slice(0, 20); // Top 20 across all domains
        } catch (error) {
            console.error('Multi-domain search failed:', error.message);
        }
    }

    // Example 7: Real-time Analytics Integration
    async analyticsIntegration() {
        console.log('\n=== Real-time Analytics Integration Example ===');
        
        try {
            const healthStatus = await this.client.getClusterHealth();
            
            // Simulate search analytics
            const analytics = {
                timestamp: new Date().toISOString(),
                clusterHealth: healthStatus,
                searchMetrics: {
                    totalSearches: Math.floor(Math.random() * 10000) + 50000,
                    avgResponseTime: Math.floor(Math.random() * 100) + 50,
                    popularQueries: [
                        { query: 'business templates', count: 1250 },
                        { query: 'wireless headphones', count: 980 },
                        { query: 'social media design', count: 756 }
                    ],
                    domainDistribution: {
                        ecommerce: 35,
                        social: 25,
                        media: 30,
                        general: 10
                    }
                }
            };
            
            console.log('Analytics collected successfully');
            console.log(`Healthy nodes: ${healthStatus.healthyNodes}/${healthStatus.totalNodes}`);
            
            return analytics;
        } catch (error) {
            console.error('Analytics integration failed:', error.message);
        }
    }

    // Example 8: Batch Processing Integration
    async batchProcessingExample() {
        console.log('\n=== Batch Processing Integration Example ===');
        
        // Simulate large dataset processing
        const largeBatch = Array.from({ length: 1000 }, (_, i) => ({
            id: `batch_doc_${i}`,
            title: `Document ${i}`,
            content: `This is the content for document number ${i}. It contains various keywords related to search, indexing, and distributed systems.`,
            category: i % 2 === 0 ? 'Technical' : 'General',
            tags: ['batch', 'processing', 'search', `doc${i}`],
            author: `Author${i % 10}`,
            publishDate: new Date(Date.now() - Math.random() * 90 * 24 * 60 * 60 * 1000).toISOString()
        }));

        try {
            const result = await this.general.bulkIndex(largeBatch, 50); // Process in batches of 50
            
            console.log(`Processed ${result.totalBatches} batches`);
            console.log(`Total documents: ${result.totalDocuments}`);
            
            // Test search on batch-processed data
            const batchResults = await this.general.searchDocuments('distributed systems');
            console.log(`Found ${batchResults.length} results in batch-processed data`);
            
            return result;
        } catch (error) {
            console.error('Batch processing failed:', error.message);
        }
    }

    // Run all integration examples
    async runAllExamples() {
        console.log('🚀 Starting Distributed Search Engine Integration Examples');
        console.log('=' .repeat(60));
        
        const results = {};
        
        try {
            results.canva = await this.canvaIntegration();
            results.ecommerce = await this.ecommerceIntegration();
            results.social = await this.socialMediaIntegration();
            results.freepik = await this.freepikIntegration();
            results.knowledgeBase = await this.knowledgeBaseIntegration();
            results.multiDomain = await this.multiDomainSearch();
            results.analytics = await this.analyticsIntegration();
            results.batchProcessing = await this.batchProcessingExample();
            
            console.log('\n✅ All integration examples completed successfully!');
            console.log('=' .repeat(60));
            
            return results;
        } catch (error) {
            console.error('Integration examples failed:', error.message);
            throw error;
        }
    }
}

// Performance testing utilities
class PerformanceTestSuite {
    constructor(gatewayUrl = 'http://localhost:3000') {
        this.examples = new IntegrationExamples(gatewayUrl);
        this.metrics = {
            searches: [],
            indexes: [],
            errors: []
        };
    }

    async measureOperation(operation, name) {
        const start = Date.now();
        try {
            const result = await operation();
            const duration = Date.now() - start;
            
            this.metrics.searches.push({
                name,
                duration,
                success: true,
                timestamp: new Date().toISOString()
            });
            
            return result;
        } catch (error) {
            const duration = Date.now() - start;
            
            this.metrics.errors.push({
                name,
                error: error.message,
                duration,
                timestamp: new Date().toISOString()
            });
            
            throw error;
        }
    }

    async runPerformanceTests() {
        console.log('\n🚀 Running Performance Tests');
        console.log('=' .repeat(40));
        
        // Test concurrent searches
        const concurrentSearches = Array.from({ length: 10 }, (_, i) => 
            this.measureOperation(
                () => this.examples.client.search(`test query ${i}`, 'general'),
                `concurrent_search_${i}`
            )
        );
        
        await Promise.all(concurrentSearches);
        
        // Calculate statistics
        const searchTimes = this.metrics.searches.map(s => s.duration);
        const avgSearchTime = searchTimes.reduce((a, b) => a + b, 0) / searchTimes.length;
        const maxSearchTime = Math.max(...searchTimes);
        const minSearchTime = Math.min(...searchTimes);
        
        console.log(`Average search time: ${avgSearchTime.toFixed(2)}ms`);
        console.log(`Max search time: ${maxSearchTime}ms`);
        console.log(`Min search time: ${minSearchTime}ms`);
        console.log(`Total errors: ${this.metrics.errors.length}`);
        
        return this.metrics;
    }
}

// Export classes for use in other modules
module.exports = {
    IntegrationExamples,
    PerformanceTestSuite
};

// Run examples if this file is executed directly
if (require.main === module) {
    const examples = new IntegrationExamples();
    examples.runAllExamples()
        .then(() => console.log('All examples completed!'))
        .catch(error => console.error('Examples failed:', error));
}