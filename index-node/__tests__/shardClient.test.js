jest.mock('axios');
const axios = require('axios');
const { ShardClient } = require('../shardClient');

beforeEach(() => { axios.put.mockReset(); });

describe('ShardClient', () => {
    test('PUT /docs with domain and documents', async () => {
        axios.put.mockResolvedValueOnce({ data: { domain: 'bookstore', stored: 2, ids: ['b1', 'b2'] } });
        const client = new ShardClient('http://shard:7000');

        const res = await client.putDocs('bookstore', [{ id: 'b1' }, { id: 'b2' }]);

        expect(axios.put).toHaveBeenCalledWith(
            'http://shard:7000/docs',
            { domain: 'bookstore', documents: [{ id: 'b1' }, { id: 'b2' }] },
            expect.any(Object)
        );
        expect(res).toEqual({ ok: true, stored: 2, ids: ['b1', 'b2'] });
    });

    test('returns ok:false with error message on network failure', async () => {
        axios.put.mockRejectedValueOnce(new Error('connection refused'));
        const client = new ShardClient('http://shard:7000');

        const res = await client.putDocs('bookstore', [{ id: 'b1' }]);

        expect(res.ok).toBe(false);
        expect(res.error).toMatch(/connection refused/);
    });
});
