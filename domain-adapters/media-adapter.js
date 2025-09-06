const axios = require('axios');

// ===== MEDIA ADAPTER (domain-adapters/media-adapter.js) =====
class MediaAdapter {
    constructor(searchEngineUrl) {
        this.searchEngineUrl = searchEngineUrl;
        this.domain = 'media';
    }

    // Transform media asset to search engine format
    transformAsset(asset) {
        return {
            id: asset.assetId || asset.id,
            title: asset.title || asset.name,
            description: asset.description || asset.caption,
            content: `${asset.title} ${asset.description} ${asset.category} ${(asset.tags || []).join(' ')}`,
            fileType: asset.type || asset.fileType, // 'image', 'vector', 'video', 'audio'
            resolution: asset.resolution,
            dimensions: asset.dimensions,
            creator: asset.creator || asset.author,
            category: asset.category,
            tags: [
                ...(asset.tags || []),
                asset.category,
                asset.type,
                asset.creator,
                asset.resolution ? `resolution_${asset.resolution}` : null,
                asset.isPremium ? 'premium' : 'free',
                `downloads_${Math.floor((asset.downloads || 0) / 1000) * 1000}` // Download range
            ].filter(Boolean),
            url: asset.downloadUrl || asset.url,
            previewUrl: asset.previewUrl || asset.thumbnail,
            downloads: asset.downloads || 0,
            views: asset.views || 0,
            rating: asset.rating,
            fileSize: asset.fileSize,
            format: asset.format, // jpg, png, svg, mp4, etc.
            isPremium: asset.isPremium || false,
            license: asset.license || 'standard',
            colorScheme: asset.colorScheme || [],
            orientation: asset.orientation, // portrait, landscape, square
            type: 'media_asset',
            uploadDate: asset.uploadDate || new Date().toISOString()
        };
    }

    // Index media assets in bulk
    async indexAssets(assets) {
        const transformedAssets = assets.map(asset => this.transformAsset(asset));
        
        try {
            const response = await axios.post(`${this.searchEngineUrl}/api/index`, {
                documents: transformedAssets,
                domain: this.domain
            });
            return response.data;
        } catch (error) {
            throw new Error(`Failed to index media assets: ${error.message}`);
        }
    }

    // Search media assets with media-specific filters
    async searchAssets(query, filters = {}) {
        const mediaFilters = {
            ...filters,
            type: 'media_asset'
        };

        try {
            const response = await axios.post(`${this.searchEngineUrl}/api/search`, {
                query: query,
                domain: this.domain,
                filters: mediaFilters,
                limit: filters.limit || 20
            });

            return this.transformSearchResults(response.data.results);
        } catch (error) {
            throw new Error(`Media search failed: ${error.message}`);
        }
    }

    // Search by visual similarity (placeholder for future ML integration)
    async searchBySimilarity(assetId, filters = {}) {
        // This would integrate with image similarity ML models
        try {
            const response = await axios.post(`${this.searchEngineUrl}/api/search`, {
                query: `similar:${assetId}`,
                domain: this.domain,
                filters: { ...filters, type: 'media_asset' },
                limit: filters.limit || 10
            });

            return this.transformSearchResults(response.data.results);
        } catch (error) {
            throw new Error(`Similarity search failed: ${error.message}`);
        }
    }

    // Advanced search with multiple criteria
    async advancedSearch(criteria) {
        const {
            query = '',
            fileTypes = [],
            categories = [],
            orientations = [],
            isPremium = null,
            minDownloads = 0,
            colorSchemes = [],
            creators = [],
            limit = 20
        } = criteria;

        const filters = {};
        
        if (fileTypes.length > 0) filters.fileType = fileTypes;
        if (categories.length > 0) filters.category = categories;
        if (orientations.length > 0) filters.orientation = orientations;
        if (isPremium !== null) filters.isPremium = isPremium;
        if (creators.length > 0) filters.creator = creators;

        try {
            const response = await axios.post(`${this.searchEngineUrl}/api/search`, {
                query: query,
                domain: this.domain,
                filters: { ...filters, type: 'media_asset' },
                limit: limit
            });

            return this.transformSearchResults(response.data.results)
                .filter(asset => asset.downloads >= minDownloads)
                .filter(asset => {
                    if (colorSchemes.length === 0) return true;
                    return colorSchemes.some(color => 
                        (asset.colorScheme || []).includes(color)
                    );
                });
        } catch (error) {
            throw new Error(`Advanced search failed: ${error.message}`);
        }
    }

    transformSearchResults(results) {
        return results.map(result => ({
            assetId: result.id,
            title: result.title,
            description: result.description,
            fileType: result.fileType,
            resolution: result.resolution,
            dimensions: result.dimensions,
            creator: result.creator,
            category: result.category,
            tags: result.tags,
            url: result.url,
            previewUrl: result.previewUrl,
            downloads: result.downloads,
            views: result.views,
            rating: result.rating,
            fileSize: result.fileSize,
            format: result.format,
            isPremium: result.isPremium,
            license: result.license,
            colorScheme: result.colorScheme,
            orientation: result.orientation,
            uploadDate: result.uploadDate,
            relevanceScore: result.score,
            matchedTerms: result.matchedTerms
        }));
    }

    // Get trending assets
    async getTrendingAssets(timeframe = '7d', limit = 50) {
        try {
            const response = await axios.post(`${this.searchEngineUrl}/api/search`, {
                query: '*',
                domain: this.domain,
                filters: { 
                    type: 'media_asset',
                    trending: timeframe 
                },
                limit: limit
            });

            return this.transformSearchResults(response.data.results)
                .sort((a, b) => (b.downloads + b.views) - (a.downloads + a.views));
        } catch (error) {
            throw new Error(`Failed to get trending assets: ${error.message}`);
        }
    }

    // Get assets by creator
    async getAssetsByCreator(creatorId, limit = 20) {
        try {
            const response = await axios.post(`${this.searchEngineUrl}/api/search`, {
                query: `creator:${creatorId}`,
                domain: this.domain,
                filters: { type: 'media_asset' },
                limit: limit
            });

            return this.transformSearchResults(response.data.results);
        } catch (error) {
            throw new Error(`Failed to get assets by creator: ${error.message}`);
        }
    }
}

module.exports = MediaAdapter;