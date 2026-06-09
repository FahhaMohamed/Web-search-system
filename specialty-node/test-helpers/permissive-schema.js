const { setSchemaClient } = require('../app');

function usePermissiveSchema() {
    setSchemaClient({
        fetch: async () => ({
            text: ['title', 'description', 'message', 'post', 'body'],
            metadata: [
                'price', 'brand', 'level', 'rating', 'timestamp', 'service',
                'likes', 'date', 'size', 'year', 'age', 'count', 'views',
            ],
            tags: ['color', 'category', 'hashtag', 'cuisine'],
        }),
    });
}

module.exports = { usePermissiveSchema };
