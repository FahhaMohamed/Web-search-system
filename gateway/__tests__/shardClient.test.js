jest.mock('axios');
const axios = require('axios');
const { ShardClient } = require('../shardClient');

beforeEach(() => { axios.post.mockReset(); });

describe('Gateway ShardClient', () => {
    test('POST /docs/batch-get with domain and ids returns documents', async () => {
        axios.post.mockResolvedValueOnce({
            data: {
                domain: 'bookstore',
                documents: [{ id: 'b1', title: 'Dune' }, { id: 'b2', title: 'Foundation' }],
            },
        });
        const client = new ShardClient('http://shard:7000');

        const docs = await client.batchGet('bookstore', ['b1', 'b2']);

        expect(axios.post).toHaveBeenCalledWith(
            'http://shard:7000/docs/batch-get',
            { domain: 'bookstore', ids: ['b1', 'b2'] },
            expect.any(Object)
        );
        expect(docs).toEqual([
            { id: 'b1', title: 'Dune' },
            { id: 'b2', title: 'Foundation' },
        ]);
    });

    test('returns empty array on network failure (graceful degrade)', async () => {
        axios.post.mockRejectedValueOnce(new Error('shard down'));
        const client = new ShardClient('http://shard:7000');

        const docs = await client.batchGet('bookstore', ['b1']);

        expect(docs).toEqual([]);
    });

    test('returns empty array if ids list is empty (no HTTP call)', async () => {
        const client = new ShardClient('http://shard:7000');

        const docs = await client.batchGet('bookstore', []);

        expect(axios.post).not.toHaveBeenCalled();
        expect(docs).toEqual([]);
    });
});
