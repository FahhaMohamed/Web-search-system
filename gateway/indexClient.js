/**
 * In-process index orchestrator.
 *
 * Before Option 1, indexing was: Gateway → Index Node (HTTP) → orchestration.
 * The Index Node was a stateless coordinator, so we collapsed it into the
 * Gateway process — one fewer network hop per write, one fewer container
 * to deploy. Logical architecture is unchanged: the Index Coordinator
 * role still exists, it just lives in-process.
 *
 * Orchestration steps mirror what the old Index Node did:
 *   1. Fetch domain schema (used to project docs per specialty)
 *   2. Write full docs to Shard Cluster (source of truth for hydration)
 *   3. Fan out projected docs to Text/Metadata/Tags Search Nodes
 */

class IndexClient {
    constructor({ schemaClient, shardClient, searchIndexClient, nodeId = 'gateway-index' }) {
        this.schemaClient = schemaClient;
        this.shardClient = shardClient;
        this.searchIndexClient = searchIndexClient;
        this.nodeId = nodeId;
    }

    async index(domain, documents) {
        if (!Array.isArray(documents) || documents.length === 0) {
            const e = new Error('documents array is empty');
            e.status = 400;
            throw e;
        }

        const schema = await this.schemaClient.fetch(domain);
        if (!schema) {
            const e = new Error(`Domain not registered: ${domain}`);
            e.status = 404;
            throw e;
        }

        const shardAck = await this.shardClient.putDocs(domain, documents);
        if (!shardAck.ok) {
            const e = new Error(`Shard Cluster write failed: ${shardAck.error}`);
            e.status = 502;
            throw e;
        }

        const searchNodes = await this.searchIndexClient.fanOut(domain, documents, schema);

        return {
            domain,
            received: documents.length,
            nodeId: this.nodeId,
            shardCluster: shardAck,
            searchNodes,
        };
    }
}

module.exports = { IndexClient };
