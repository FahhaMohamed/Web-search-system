// ===== INDEX NODE SERVICE (index-node/app.js) =====
const express = require('express');
const fs = require('fs').promises;

class IndexNode {
    constructor(nodeId) {
        this.nodeId = nodeId;
        this.documents = new Map();
        this.domainMappings = new Map();
        this.initialize();
    }

    async initialize() {
        console.log(`Initializing Index Node ${this.nodeId}`);
        await this.loadExistingDocuments();
    }

    async loadExistingDocuments() {
        try {
            const dataPath = `/data/documents_${this.nodeId}.json`;
            const data = await fs.readFile(dataPath, 'utf8');
            const documentsData = JSON.parse(data);
            
            Object.entries(documentsData).forEach(([domain, docs]) => {
                this.domainMappings.set(domain, new Map(docs));
            });
            
            console.log(`Loaded existing documents for index node ${this.nodeId}`);
        } catch (error) {
            console.log(`No existing documents found for index node ${this.nodeId}`);
        }
    }

    async saveDocuments() {
        try {
            const documentsData = {};
            this.domainMappings.forEach((docs, domain) => {
                documentsData[domain] = Array.from(docs.entries());
            });

            const dataPath = `/data/documents_${this.nodeId}.json`;
            await fs.writeFile(dataPath, JSON.stringify(documentsData, null, 2));
            console.log(`Documents saved for index node ${this.nodeId}`);
        } catch (error) {
            console.error(`Failed to save documents for index node ${this.nodeId}:`, error);
        }
    }

    async indexDocuments(documents, domain) {
        if (!this.domainMappings.has(domain)) {
            this.domainMappings.set(domain, new Map());
        }

        const domainDocs = this.domainMappings.get(domain);
        let indexed = 0;

        for (const doc of documents) {
            const docId = doc.id || `${domain}_${Date.now()}_${Math.random()}`;
            const processedDoc = this.processDocument(doc, domain);
            
            domainDocs.set(docId, processedDoc);
            indexed++;
        }

        await this.saveDocuments();
        await this.distributeToSearchNodes(documents, domain);
        
        return indexed;
    }

    processDocument(document, domain) {
        return {
            ...document,
            domain: domain,
            indexed: new Date().toISOString(),
            indexNode: this.nodeId,
            // Add domain-specific processing
            processedContent: this.extractContent(document, domain)
        };
    }

    extractContent(document, domain) {
        // Domain-specific content extraction
        switch (domain) {
            case 'ecommerce':
                return {
                    title: document.title || document.name,
                    description: document.description,
                    price: document.price,
                    category: document.category,
                    tags: document.tags || [],
                    brand: document.brand
                };
            case 'social':
                return {
                    content: document.content || document.text,
                    author: document.author || document.username,
                    hashtags: document.hashtags || [],
                    mentions: document.mentions || [],
                    timestamp: document.timestamp
                };
            case 'media':
                return {
                    title: document.title,
                    description: document.description,
                    tags: document.tags || [],
                    fileType: document.fileType,
                    resolution: document.resolution,
                    creator: document.creator
                };
            default:
                return {
                    title: document.title,
                    content: document.content,
                    description: document.description,
                    tags: document.tags || []
                };
        }
    }

    async distributeToSearchNodes(documents, domain) {
        const searchNodes = [
            'http://search-node-1:3001',
            'http://search-node-2:3002',
            'http://search-node-3:3003'
        ];

        const promises = searchNodes.map(async (nodeUrl) => {
            try {
                await axios.post(`${nodeUrl}/index`, {
                    documents: documents,
                    domain: domain
                });
                console.log(`Distributed to search node: ${nodeUrl}`);
            } catch (error) {
                console.error(`Failed to distribute to ${nodeUrl}:`, error.message);
            }
        });

        await Promise.all(promises);
    }
}

const INDEX_NODE_ID = process.env.NODE_ID || 'index1';
const indexNode = new IndexNode(INDEX_NODE_ID);

const app3 = express();
app3.use(express.json());

// Index documents endpoint
app3.post('/index', async (req, res) => {
    try {
        const { documents, domain = 'general' } = req.body;
        
        if (!documents || !Array.isArray(documents)) {
            return res.status(400).json({ error: 'Documents array is required' });
        }

        const indexed = await indexNode.indexDocuments(documents, domain);
        
        res.json({
            message: 'Documents indexed successfully',
            nodeId: INDEX_NODE_ID,
            domain: domain,
            indexed: indexed,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error(`Index error on node ${INDEX_NODE_ID}:`, error);
        res.status(500).json({ error: 'Indexing failed', nodeId: INDEX_NODE_ID });
    }
});

// Health check
app3.get('/health', (req, res) => {
    res.json({
        nodeId: INDEX_NODE_ID,
        type: 'index',
        status: 'healthy',
        uptime: process.uptime(),
        domains: Array.from(indexNode.domainMappings.keys()),
        totalDocuments: Array.from(indexNode.domainMappings.values())
            .reduce((sum, docs) => sum + docs.size, 0)
    });
});

const INDEX_PORT = process.env.PORT || 4001;
app3.listen(INDEX_PORT, () => {
    console.log(`Index Node ${INDEX_NODE_ID} running on port ${INDEX_PORT}`);
});