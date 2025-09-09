// ===== GATEWAY SERVICE (gateway/app.js) =====
const express = require('express');
const axios = require("axios");
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());

// Configuration for search nodes
const SEARCH_NODES = [
    { id: 'node1', url: 'http://search-node-1:3001', specialty: 'text' },
    { id: 'node2', url: 'http://search-node-2:3002', specialty: 'metadata' },
    { id: 'node3', url: 'http://search-node-3:3003', specialty: 'tags' }
];

const INDEX_NODES = [
    { id: 'index1', url: 'http://index-node-1:4001' },
    { id: 'index2', url: 'http://index-node-2:4002' }
];

// Query splitter and parallel search coordinator
class QueryProcessor {
    constructor() {
        this.stopWords = new Set(['the', 'is', 'at', 'which', 'on', 'and', 'a', 'to', 'are', 'as', 'was', 'with', 'for']);
    }

    splitQuery(query) {
        const terms = query.toLowerCase()
            .replace(/[^\w\s]/g, ' ')
            .split(/\s+/)
            .filter(term => term.length > 1 && !this.stopWords.has(term));

        return {
            textTerms: terms.filter(term => isNaN(term)),
            numericTerms: terms.filter(term => !isNaN(term)),
            fullQuery: query,
            keywords: terms.slice(0, 5) 
        };
    }

    async searchParallel(queryParts, domain, filters = {}) {
        const searchPromises = SEARCH_NODES.map(async (node) => {
            try {
                const response = await axios.post(`${node.url}/search`, {
                    query: queryParts,
                    domain: domain,
                    filters: filters,
                }, { timeout: 5000 });

                return {
                    nodeId: node.id,
                    specialty: node.specialty,
                    results: response.data.results || [],
                    metadata: response.data.metadata || {}
                };
            } catch (error) {
                console.error(`Node ${node.id} failed:`, error.message);
                return {
                    nodeId: node.id,
                    specialty: node.specialty,
                    results: [],
                    error: error.message
                };
            }
        });

        return await Promise.all(searchPromises);
    }

    mergeResults(nodeResults, queryParts) {
        const mergedResults = new Map();
        const relevanceScores = new Map();

        nodeResults.forEach(nodeResult => {
            if (nodeResult.error) return;

            nodeResult.results.forEach(result => {
                const key = result.id || result.url || result.title;
                
                if (mergedResults.has(key)) {
                    const existing = mergedResults.get(key);
                    existing.score += result.score || 0;
                    existing.sources.push(nodeResult.nodeId);
                    existing.matchedTerms = [...new Set([...existing.matchedTerms, ...(result.matchedTerms || [])])];
                } else {
                    mergedResults.set(key, {
                        ...result,
                        score: result.score || 0,
                        sources: [nodeResult.nodeId],
                        matchedTerms: result.matchedTerms || []
                    });
                }
            });
        });

        // Sort by relevance score
        return Array.from(mergedResults.values())
            .sort((a, b) => b.score - a.score)
            .slice(0, 50); // Return top 50 results
    }
}

const queryProcessor = new QueryProcessor();

// API Routes
app.post('/api/search', async (req, res) => {
    try {
        const { query, domain = 'general', filters = {}, limit = 20 } = req.body;
        
        if (!query) {
            return res.status(400).json({ error: 'Query is required' });
        }

        console.log(`Search request: "${query}" for domain: ${domain}`);
        
        // Split query into components
        const queryParts = queryProcessor.splitQuery(query);
        
        // Search across all nodes in parallel
        const nodeResults = await queryProcessor.searchParallel(queryParts, domain, filters);
        
        // Merge and rank results
        const finalResults = queryProcessor.mergeResults(nodeResults, queryParts);
        
        const response = {
            query: query,
            domain: domain,
            totalResults: finalResults.length,
            results: finalResults.slice(0, limit),
            searchNodes: nodeResults.map(nr => ({
                nodeId: nr.nodeId,
                specialty: nr.specialty,
                resultCount: nr.results.length,
                error: nr.error
            })),
            queryProcessing: {
                originalQuery: query,
                processedTerms: queryParts.keywords,
                textTerms: queryParts.textTerms,
                numericTerms: queryParts.numericTerms
            },
            timestamp: new Date().toISOString()
        };

        res.json(response);
    } catch (error) {
        console.error('Search error:', error);
        res.status(500).json({ error: 'Internal server error', details: error.message });
    }
});

// Index management endpoints
app.post('/api/index', async (req, res) => {
    try {
        const { documents, domain } = req.body;
        
        if (!documents || !Array.isArray(documents)) {
            return res.status(400).json({ error: 'Documents array is required' });
        }

        // Distribute indexing across index nodes
        const chunkSize = Math.ceil(documents.length / INDEX_NODES.length);
        const indexPromises = INDEX_NODES.map(async (node, index) => {
            const chunk = documents.slice(index * chunkSize, (index + 1) * chunkSize);
            
            if (chunk.length === 0) return { nodeId: node.id, indexed: 0 };

            try {
                const response = await axios.post(`${node.url}/index`, {
                    documents: chunk,
                    domain: domain
                });
                return { nodeId: node.id, indexed: chunk.length, success: true };
            } catch (error) {
                console.error(`Index node ${node.id} failed:`, error.message);
                return { nodeId: node.id, indexed: 0, error: error.message };
            }
        });

        const indexResults = await Promise.all(indexPromises);
        const totalIndexed = indexResults.reduce((sum, result) => sum + (result.indexed || 0), 0);

        res.json({
            message: 'Indexing completed',
            domain: domain,
            totalDocuments: documents.length,
            totalIndexed: totalIndexed,
            indexNodes: indexResults
        });
    } catch (error) {
        console.error('Index error:', error);
        res.status(500).json({ error: 'Indexing failed', details: error.message });
    }
});

// Health check for all nodes
app.get('/api/health', async (req, res) => {
    try {
        const allNodes = [...SEARCH_NODES, ...INDEX_NODES];
        const healthChecks = allNodes.map(async (node) => {
            try {
                const response = await axios.get(`${node.url}/health`, { timeout: 3000 });
                return { nodeId: node.id, status: 'healthy', url: node.url };
            } catch (error) {
                return { nodeId: node.id, status: 'unhealthy', url: node.url, error: error.message };
            }
        });

        const healthResults = await Promise.all(healthChecks);
        const healthyNodes = healthResults.filter(result => result.status === 'healthy').length;

        res.json({
            cluster: 'distributed-search-engine',
            totalNodes: allNodes.length,
            healthyNodes: healthyNodes,
            nodes: healthResults,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({ error: 'Health check failed', details: error.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Gateway service running on port ${PORT}`);
    console.log(`Search nodes: ${SEARCH_NODES.length}, Index nodes: ${INDEX_NODES.length}`);
});