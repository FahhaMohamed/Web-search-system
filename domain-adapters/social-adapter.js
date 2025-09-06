// ===== DOMAIN INTEGRATION EXAMPLE (domain-integration/social-adapter.js) =====
class SocialMediaAdapter {
    constructor(searchEngineUrl) {
        this.searchEngineUrl = searchEngineUrl;
        this.domain = 'social';
    }

    transformPost(post) {
        return {
            id: post.postId || post.id,
            title: post.title || post.content.substring(0, 50),
            content: post.content || post.text,
            description: post.caption || post.description,
            author: post.username || post.author,
            hashtags: post.hashtags || [],
            mentions: post.mentions || [],
            tags: [
                ...(post.hashtags || []),
                ...(post.mentions || []),
                post.platform,
                `likes_${Math.floor((post.likes || 0) / 100) * 100}`
            ].filter(Boolean),
            url: post.url || post.permalink,
            imageUrl: post.image || post.media?.[0]?.url,
            timestamp: post.createdAt || post.timestamp,
            likes: post.likes || 0,
            shares: post.shares || 0,
            comments: post.comments || 0,
            platform: post.platform,
            type: 'social_post'
        };
    }

    async indexPosts(posts) {
        const transformedPosts = posts.map(post => this.transformPost(post));
        
        try {
            const response = await axios.post(`${this.searchEngineUrl}/api/index`, {
                documents: transformedPosts,
                domain: this.domain
            });
            return response.data;
        } catch (error) {
            throw new Error(`Failed to index posts: ${error.message}`);
        }
    }

    async searchPosts(query, filters = {}) {
        const socialFilters = {
            ...filters,
            type: 'social_post'
        };

        try {
            const response = await axios.post(`${this.searchEngineUrl}/api/search`, {
                query: query,
                domain: this.domain,
                filters: socialFilters,
                limit: filters.limit || 20
            });

            return response.data.results;
        } catch (error) {
            throw new Error(`Search failed: ${error.message}`);
        }
    }
}