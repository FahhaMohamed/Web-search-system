// ===== SEARCH NODE SERVICE (search-node/app.js) =====
const express = require('express');
const fs = require("fs").promises;
const path = require("path");

class SearchNode {
    constructor(nodeId, specialty) {
        this.nodeId = nodeId;
        this.specialty = specialty;
        this.index = new Map(); // In-memory search index
        this.domainIndices = new Map(); // Separate indices per domain
        this.initialize();
    }

    async initialize() {
        console.log(`Initializing Search Node ${this.nodeId} with specialty: ${this.specialty}`);
        await this.loadExistingIndex();
    }

    async loadExistingIndex() {
        try {
            const indexPath = `/data/index_${this.nodeId}.json`;
            const data = await fs.readFile(indexPath, 'utf8');
            const indexData = JSON.parse(data);
            
            Object.entries(indexData).forEach(([domain, documents]) => {
                this.domainIndices.set(domain, new Map(documents));
            });
            
            console.log(`Loaded existing index for node ${this.nodeId}`);
        } catch (error) {
            console.log(`No existing index found for node ${this.nodeId}, starting fresh`);
        }
    }

    async saveIndex() {
        try {
            const indexData = {};
            this.domainIndices.forEach((documents, domain) => {
                indexData[domain] = Array.from(documents.entries());
            });

            const indexPath = `/data/index_${this.nodeId}.json`;
            await fs.writeFile(indexPath, JSON.stringify(indexData, null, 2));
            console.log(`Index saved for node ${this.nodeId}`);
        } catch (error) {
            console.error(`Failed to save index for node ${this.nodeId}:`, error);
        }
    }

    indexDocument(document, domain) {
        if (!this.domainIndices.has(domain)) {
            this.domainIndices.set(domain, new Map());
        }

        const domainIndex = this.domainIndices.get(domain);
        const docId = document.id || document.url || `doc_${Date.now()}_${Math.random()}`;

        // Create searchable content based on node specialty
        let searchableContent = '';
        switch (this.specialty) {
            case 'text':
                searchableContent = [document.title, document.content, document.description].filter(Boolean).join(' ');
                break;
            case 'metadata':
                searchableContent = [document.author, document.category, document.type].filter(Boolean).join(' ');
                break;
            case 'tags':
                searchableContent = (document.tags || []).join(' ') + ' ' + (document.keywords || []).join(' ');
                break;
            default:
                searchableContent = JSON.stringify(document);
        }

        const indexEntry = {
            ...document,
            id: docId,
            searchableContent: searchableContent.toLowerCase(),
            indexed: new Date().toISOString(),
            nodeSpecialty: this.specialty
        };

        domainIndex.set(docId, indexEntry);
        console.log(`Indexed document ${docId} in domain ${domain} on node ${this.nodeId}`);
    }

    search(queryParts, domain, filters = {}) {
        const domainIndex = this.domainIndices.get(domain);
        if (!domainIndex) {
            return [];
        }

        const results = [];
        const searchTerms = [...queryParts.textTerms, ...queryParts.numericTerms];

        domainIndex.forEach((document, docId) => {
            let score = 0;
            const matchedTerms = [];
            const content = document.searchableContent;

            // Calculate relevance score
            searchTerms.forEach(term => {
                const termCount = (content.match(new RegExp(term, 'gi')) || []).length;
                if (termCount > 0) {
                    score += termCount * this.getSpecialtyWeight();
                    matchedTerms.push(term);
                }
            });

            // Apply filters
            if (this.matchesFilters(document, filters) && score > 0) {
                results.push({
                    ...document,
                    score: score,
                    matchedTerms: matchedTerms,
                    relevance: this.calculateRelevance(matchedTerms, searchTerms),
                    nodeSpecialty: this.specialty
                });
            }
        });

        return results.sort((a, b) => b.score - a.score);
    }

    getSpecialtyWeight() {
        const weights = { 'text': 1.5, 'metadata': 1.2, 'tags': 1.0 };
        return weights[this.specialty] || 1.0;
    }

    matchesFilters(document, filters) {
        for (const [key, value] of Object.entries(filters)) {
            if (document[key] && document[key] !== value) {
                return false;
            }
        }
        return true;
    }

    calculateRelevance(matchedTerms, totalTerms) {
        return totalTerms.length > 0 ? matchedTerms.length / totalTerms.length : 0;
    }
}

// Initialize search node
const NODE_ID = process.env.NODE_ID || 'node1';
const NODE_SPECIALTY = process.env.NODE_SPECIALTY || 'text';
const searchNode = new SearchNode(NODE_ID, NODE_SPECIALTY);

const app2 = express();
app2.use(express.json());

// Search endpoint
app2.post('/search', async (req, res) => {
    try {
        const { query, domain = 'general', filters = {} } = req.body;
        
        console.log(`Node ${NODE_ID} searching for:`, query);
        
        const results = searchNode.search(query, domain, filters);
        
        res.json({
            nodeId: NODE_ID,
            specialty: NODE_SPECIALTY,
            results: results,
            metadata: {
                searchTime: Date.now(),
                totalDocuments: searchNode.domainIndices.get(domain)?.size || 0,
                matchedDocuments: results.length
            }
        });
    } catch (error) {
        console.error(`Search error on node ${NODE_ID}:`, error);
        res.status(500).json({ error: 'Search failed', nodeId: NODE_ID });
    }
});

// Health check
app2.get('/health', (req, res) => {
    res.json({
        nodeId: NODE_ID,
        specialty: NODE_SPECIALTY,
        status: 'healthy',
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        domains: Array.from(searchNode.domainIndices.keys()),
        totalDocuments: Array.from(searchNode.domainIndices.values())
            .reduce((sum, index) => sum + index.size, 0)
    });
});

const SEARCH_PORT = process.env.PORT || 3001;
app2.listen(SEARCH_PORT, () => {
    console.log(`Search Node ${NODE_ID} (${NODE_SPECIALTY}) running on port ${SEARCH_PORT}`);
});