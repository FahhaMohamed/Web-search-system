const axios = require('axios');

// ===== GENERAL ADAPTER (domain-adapters/general-adapter.js) =====
class GeneralAdapter {
    constructor(searchEngineUrl) {
        this.searchEngineUrl = searchEngineUrl;
        this.domain = 'general';
    }

    // Transform generic document to search engine format
    transformDocument(document) {
        return {
            id: document.id || `doc_${Date.now()}_${Math.random()}`,
            title: document.title || document.name || 'Untitled',
            description: document.description || document.summary,
            content: document.content || document.text || document.body,
            author: document.author || document.creator,
            category: document.category || document.type || 'general',
            tags: [
                ...(document.tags || []),
                ...(document.keywords || []),
                document.category,
                document.type,
                document.language
            ].filter(Boolean),
            url: document.url || document.link,
            language: document.language || 'en',
            publishDate: document.publishDate || document.createdAt || new Date().toISOString(),
            lastModified: document.lastModified || document.updatedAt,
            source: document.source || document.domain,
            contentType: document.contentType || this.detectContentType(document),
            wordCount: this.getWordCount(document.content || document.text),
            readingTime: this.calculateReadingTime(document.content || document.text),
            priority: document.priority || 0,
            visibility: document.visibility || 'public',
            type: 'general_document'
        };
    }

    // Detect content type based on document properties
    detectContentType(document) {
        if (document.html || document.htmlContent) return 'html';
        if (document.markdown || document.md) return 'markdown';
        if (document.code || document.source) return 'code';
        if (document.url && document.url.includes('pdf')) return 'pdf';
        if (document.url && /\.(jpg|jpeg|png|gif|webp)$/i.test(document.url)) return 'image';
        if (document.url && /\.(mp4|avi|mov|wmv)$/i.test(document.url)) return 'video';
        return 'text';
    }

    // Calculate word count
    getWordCount(text) {
        if (!text) return 0;
        return text.trim().split(/\s+/).filter(word => word.length > 0).length;
    }

    // Calculate estimated reading time (assuming 200 words per minute)
    calculateReadingTime(text) {
        const wordCount = this.getWordCount(text);
        const readingTimeMinutes = Math.ceil(wordCount / 200);
        return `${readingTimeMinutes} min read`;
    }

    // Index documents in bulk
    async indexDocuments(documents) {
        const transformedDocuments = documents.map(doc => this.transformDocument(doc));
        
        try {
            const response = await axios.post(`${this.searchEngineUrl}/api/index`, {
                documents: transformedDocuments,
                domain: this.domain
            });
            return response.data;
        } catch (error) {
            throw new Error(`Failed to index documents: ${error.message}`);
        }
    }

    // Basic search with general filters
    async searchDocuments(query, filters = {}) {
        const generalFilters = {
            ...filters,
            type: 'general_document'
        };

        try {
            const response = await axios.post(`${this.searchEngineUrl}/api/search`, {
                query: query,
                domain: this.domain,
                filters: generalFilters,
                limit: filters.limit || 20
            });

            return this.transformSearchResults(response.data.results);
        } catch (error) {
            throw new Error(`General search failed: ${error.message}`);
        }
    }

    // Search by content type
    async searchByType(query, contentType, filters = {}) {
        return await this.searchDocuments(query, {
            ...filters,
            contentType: contentType
        });
    }

    // Search by author
    async searchByAuthor(query, author, filters = {}) {
        return await this.searchDocuments(query, {
            ...filters,
            author: author
        });
    }

    // Search by category
    async searchByCategory(query, category, filters = {}) {
        return await this.searchDocuments(query, {
            ...filters,
            category: category
        });
    }

    // Search by date range
    async searchByDateRange(query, startDate, endDate, filters = {}) {
        return await this.searchDocuments(query, {
            ...filters,
            dateRange: {
                start: startDate,
                end: endDate
            }
        });
    }

    // Full-text search with highlighting
    async fullTextSearch(query, options = {}) {
        const {
            highlight = true,
            maxSnippets = 3,
            snippetLength = 150,
            ...otherFilters
        } = options;

        try {
            const response = await axios.post(`${this.searchEngineUrl}/api/search`, {
                query: query,
                domain: this.domain,
                filters: { ...otherFilters, type: 'general_document' },
                options: {
                    highlight,
                    maxSnippets,
                    snippetLength
                },
                limit: options.limit || 20
            });

            return this.transformSearchResults(response.data.results);
        } catch (error) {
            throw new Error(`Full-text search failed: ${error.message}`);
        }
    }

    // Fuzzy search for typo tolerance
    async fuzzySearch(query, fuzziness = 'AUTO', filters = {}) {
        try {
            const response = await axios.post(`${this.searchEngineUrl}/api/search`, {
                query: query,
                domain: this.domain,
                filters: { ...filters, type: 'general_document' },
                options: {
                    fuzzy: true,
                    fuzziness: fuzziness
                },
                limit: filters.limit || 20
            });

            return this.transformSearchResults(response.data.results);
        } catch (error) {
            throw new Error(`Fuzzy search failed: ${error.message}`);
        }
    }

    // Phrase search for exact matches
    async phraseSearch(phrase, filters = {}) {
        return await this.searchDocuments(`"${phrase}"`, filters);
    }

    // Boolean search (AND, OR, NOT operators)
    async booleanSearch(query, filters = {}) {
        // Query can contain operators like: "cats AND dogs", "cats OR dogs", "cats NOT dogs"
        return await this.searchDocuments(query, filters);
    }

    // Wildcard search
    async wildcardSearch(pattern, filters = {}) {
        // Pattern can contain * and ? wildcards
        return await this.searchDocuments(pattern, filters);
    }

    // Get similar documents
    async findSimilar(documentId, limit = 10) {
        try {
            const response = await axios.post(`${this.searchEngineUrl}/api/search`, {
                query: `similar:${documentId}`,
                domain: this.domain,
                filters: { type: 'general_document' },
                limit: limit
            });

            return this.transformSearchResults(response.data.results);
        } catch (error) {
            throw new Error(`Similar documents search failed: ${error.message}`);
        }
    }

    // Get popular/trending documents
    async getTrendingDocuments(timeframe = '7d', limit = 20) {
        try {
            const response = await axios.post(`${this.searchEngineUrl}/api/search`, {
                query: '*',
                domain: this.domain,
                filters: { 
                    type: 'general_document',
                    trending: timeframe 
                },
                limit: limit
            });

            return this.transformSearchResults(response.data.results);
        } catch (error) {
            throw new Error(`Failed to get trending documents: ${error.message}`);
        }
    }

    // Get documents by language
    async getDocumentsByLanguage(language, limit = 20) {
        return await this.searchDocuments('*', {
            language: language,
            limit: limit
        });
    }

    transformSearchResults(results) {
        return results.map(result => ({
            id: result.id,
            title: result.title,
            description: result.description,
            content: result.content,
            author: result.author,
            category: result.category,
            tags: result.tags,
            url: result.url,
            language: result.language,
            publishDate: result.publishDate,
            lastModified: result.lastModified,
            source: result.source,
            contentType: result.contentType,
            wordCount: result.wordCount,
            readingTime: result.readingTime,
            priority: result.priority,
            visibility: result.visibility,
            relevanceScore: result.score,
            matchedTerms: result.matchedTerms,
            snippets: result.snippets || []
        }));
    }

    // Bulk operations
    async bulkIndex(documents, batchSize = 100) {
        const batches = [];
        for (let i = 0; i < documents.length; i += batchSize) {
            batches.push(documents.slice(i, i + batchSize));
        }

        const results = [];
        for (const batch of batches) {
            try {
                const result = await this.indexDocuments(batch);
                results.push(result);
            } catch (error) {
                console.error(`Batch indexing failed:`, error.message);
                results.push({ error: error.message, batchSize: batch.length });
            }
        }

        return {
            totalBatches: batches.length,
            results: results,
            totalDocuments: documents.length
        };
    }

    // Document statistics
    async getDocumentStats() {
        try {
            const response = await axios.get(`${this.searchEngineUrl}/api/stats`, {
                params: { domain: this.domain }
            });

            return response.data;
        } catch (error) {
            throw new Error(`Failed to get document statistics: ${error.message}`);
        }
    }
}

module.exports = GeneralAdapter;