// ===== DOMAIN INTEGRATION EXAMPLE (domain-integration/ecommerce-adapter.js) =====
class EcommerceAdapter {
    constructor(searchEngineUrl) {
        this.searchEngineUrl = searchEngineUrl;
        this.domain = 'ecommerce';
    }

    // Transform ecommerce product to search engine format
    transformProduct(product) {
        return {
            id: product.productId || product.id,
            title: product.name || product.title,
            description: product.description,
            content: `${product.name} ${product.description} ${product.category}`,
            price: product.price,
            category: product.category,
            brand: product.brand,
            tags: [
                ...(product.tags || []),
                product.category,
                product.brand,
                `price_${Math.floor(product.price / 10) * 10}` // Price range tag
            ].filter(Boolean),
            url: product.url || product.link,
            imageUrl: product.image,
            rating: product.rating,
            reviews: product.reviewCount,
            inStock: product.inStock,
            type: 'product'
        };
    }

    // Index products in bulk
    async indexProducts(products) {
        const transformedProducts = products.map(product => this.transformProduct(product));
        
        try {
            const response = await axios.post(`${this.searchEngineUrl}/api/index`, {
                documents: transformedProducts,
                domain: this.domain
            });
            return response.data;
        } catch (error) {
            throw new Error(`Failed to index products: ${error.message}`);
        }
    }

    // Search products with ecommerce-specific filters
    async searchProducts(query, filters = {}) {
        const ecommerceFilters = {
            ...filters,
            type: 'product'
        };

        try {
            const response = await axios.post(`${this.searchEngineUrl}/api/search`, {
                query: query,
                domain: this.domain,
                filters: ecommerceFilters,
                limit: filters.limit || 20
            });

            return this.transformSearchResults(response.data.results);
        } catch (error) {
            throw new Error(`Search failed: ${error.message}`);
        }
    }

    transformSearchResults(results) {
        return results.map(result => ({
            productId: result.id,
            name: result.title,
            description: result.description,
            price: result.price,
            category: result.category,
            brand: result.brand,
            url: result.url,
            imageUrl: result.imageUrl,
            rating: result.rating,
            inStock: result.inStock,
            relevanceScore: result.score,
            matchedTerms: result.matchedTerms
        }));
    }
}