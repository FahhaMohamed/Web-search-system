/**
 * Synthetic dataset generator for benchmark experiments.
 *
 * Produces a domain-agnostic "product catalog" with text, metadata, and tag
 * fields, using a seeded PRNG so the same seed always produces the same data.
 * The same dataset can be emitted in two shapes:
 *   - JSON docs   -- for the 3rd-Architecture (POST /api/index)
 *   - text splits -- for the namenode branch (split1.txt, split2.txt, ...)
 */

function mulberry32(seed) {
    let s = seed >>> 0;
    return function () {
        s = (s + 0x6D2B79F5) >>> 0;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const ADJECTIVES = [
    'wireless', 'premium', 'compact', 'rugged', 'smart',
    'classic', 'modern', 'eco', 'lightweight', 'durable',
    'portable', 'silent', 'fast', 'quiet', 'bold',
];

const NOUNS = [
    'headphones', 'speaker', 'lamp', 'camera', 'watch',
    'backpack', 'bottle', 'keyboard', 'mouse', 'monitor',
    'charger', 'stand', 'cable', 'desk', 'chair',
];

const DESC_PHRASES = [
    'high quality', 'budget friendly', 'professional grade',
    'limited edition', 'family pack', 'travel ready',
    'outdoor use', 'indoor use', 'office ready', 'home essential',
];

const CATEGORIES = [
    'electronics', 'home', 'kitchen', 'sports',
    'books', 'fashion', 'toys', 'beauty',
];

const BRANDS = [
    'acme', 'globex', 'soylent', 'initech',
    'umbrella', 'tyrell', 'wayne', 'stark',
];

function pick(rng, arr) {
    return arr[Math.floor(rng() * arr.length)];
}

function generateDataset({ size, seed }) {
    const rng = mulberry32(seed);
    const docs = [];
    for (let i = 0; i < size; i++) {
        const adj = pick(rng, ADJECTIVES);
        const noun = pick(rng, NOUNS);
        const phrase = pick(rng, DESC_PHRASES);
        const noun2 = pick(rng, NOUNS);
        docs.push({
            id: `p-${String(i).padStart(7, '0')}`,
            title: `${adj} ${noun}`,
            description: `${phrase} ${noun2}`,
            price: Math.round((rng() * 495 + 5) * 100) / 100,
            rating: Math.round((rng() * 4 + 1) * 10) / 10,
            category: [pick(rng, CATEGORIES)],
            brand: [pick(rng, BRANDS)],
        });
    }
    return {
        docs,
        schema: {
            text: ['title', 'description'],
            metadata: ['price', 'rating'],
            tags: ['category', 'brand'],
        },
    };
}

function toOldArchTextSplits(dataset, splitCount = 3) {
    const splits = {};
    for (let i = 1; i <= splitCount; i++) {
        splits[`split${i}.txt`] = '';
    }
    dataset.docs.forEach((d, i) => {
        const name = `split${(i % splitCount) + 1}.txt`;
        splits[name] += `${d.title} ${d.description}\n`;
    });
    return splits;
}

module.exports = { generateDataset, toOldArchTextSplits };
