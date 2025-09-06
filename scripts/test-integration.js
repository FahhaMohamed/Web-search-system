const { DistributedSearchClient, EcommerceAdapter, SocialMediaAdapter } = require('../client/example-usage');

async function testIntegration() {
    const client = new DistributedSearchClient('http://localhost:3000');
    
    console.log('Testing distributed search engine integration...');
    
    // Test 1: Basic health check
    console.log('\n1. Health Check:');
    const health = await client.getClusterHealth();
    console.log(`Healthy nodes: ${health.healthyNodes}/${health.totalNodes}`);
    
    // Test 2: E-commerce integration
    console.log('\n2. E-commerce Integration:');
    const ecommerce = new EcommerceAdapter('http://localhost:3000');
    
    const products = [
        {
            productId: 'p1',
            name: 'Smart Watch',
            description: 'Advanced fitness tracking smartwatch',
            price: 299.99,
            category: 'Electronics',
            brand: 'TechCorp'
        },
        {
            productId: 'p2', 
            name: 'Coffee Maker',
            description: 'Automatic drip coffee maker with timer',
            price: 79.99,
            category: 'Kitchen',
            brand: 'HomeBrand'
        }
    ];
    
    await ecommerce.indexProducts(products);
    const productResults = await ecommerce.searchProducts('smart watch');
    console.log(`Found ${productResults.length} products`);
    
    // Test 3: Social media integration
    console.log('\n3. Social Media Integration:');
    const social = new SocialMediaAdapter('http://localhost:3000');
    
    const posts = [
        {
            postId: 'post1',
            content: 'Just got the new smart watch! Amazing battery life 🔋',
            username: 'techfan',
            hashtags: ['tech', 'smartwatch', 'gadgets'],
            platform: 'twitter',
            likes: 25
        }
    ];
    
    await social.indexPosts(posts);
    const socialResults = await social.searchPosts('smart watch');
    console.log(`Found ${socialResults.length} social posts`);
    
    console.log('\nIntegration test completed successfully!');
}

if (require.main === module) {
    testIntegration().catch(console.error);
}