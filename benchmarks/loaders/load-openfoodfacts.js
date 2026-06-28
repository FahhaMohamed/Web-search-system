/**
 * External dataset loader: Open Food Facts products.
 *
 * Source: static.openfoodfacts.org/data/openfoodfacts-products.jsonl.gz
 * (the public, free bulk dump). ~2 GB compressed, ~10 GB uncompressed.
 *
 * Why the bulk dump and not the API:
 *   Earlier attempts to paginate the v2 search API tripped OFF's rate limit
 *   (HTTP 503/401 after ~10 pages). The bulk JSONL is the supported way to
 *   obtain large samples and avoids per-IP throttling entirely.
 *
 * The cache lives at benchmarks/datasets/.cache/openfoodfacts.jsonl
 * (gitignored). Append-only, restartable: a partial cache is picked up on
 * resume and dedupe-by-id continues.
 *
 * Strategy:
 *   1. Stream the .jsonl.gz from OFF (axios stream + zlib.createGunzip)
 *   2. Process line-by-line via readline
 *   3. Map each product → our schema (mapOffProduct)
 *   4. Flush in batches of FLUSH_EVERY
 *   5. Stop when targetCount valid docs are kept
 *
 * Resume model: on restart we always re-stream from the top of the dump,
 * but the existing cache's pageids are in `seenIds`, so already-cached
 * products are skipped quickly without re-writing.
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const readline = require('readline');

const SUPPORTED_SIZES = [100, 1000, 10000, 100000];
const TOTAL_RECORDS = SUPPORTED_SIZES.reduce((a, b) => a + b, 0); // 111100

const BULK_URL = 'https://static.openfoodfacts.org/data/openfoodfacts-products.jsonl.gz';
const FLUSH_EVERY = 500;

const DEFAULT_CACHE_DIR = path.join(__dirname, '..', 'datasets', '.cache');
const DEFAULT_CACHE_FILE = path.join(DEFAULT_CACHE_DIR, 'openfoodfacts.jsonl');

function sliceRanges() {
    const ranges = {};
    let cursor = 0;
    for (const size of SUPPORTED_SIZES) {
        ranges[size] = [cursor, cursor + size];
        cursor += size;
    }
    return ranges;
}

function sliceForSize(cache, size) {
    const ranges = sliceRanges();
    if (!ranges[size]) {
        throw new Error(`unsupported size ${size} — supported: ${SUPPORTED_SIZES.join(', ')}`);
    }
    const [lo, hi] = ranges[size];
    if (cache.length < hi) {
        throw new Error(
            `not enough records in cache for size ${size}: need ${hi}, have ${cache.length}`,
        );
    }
    return cache.slice(lo, hi);
}

function cleanText(s) {
    if (typeof s !== 'string') return '';
    return s.replace(/\s+/g, ' ').trim();
}

function stripLangPrefix(tag) {
    if (typeof tag !== 'string') return '';
    return tag.replace(/^[a-z]{2}:/, '').trim().toLowerCase();
}

function pickFirstNonEmpty(...vals) {
    for (const v of vals) {
        if (typeof v === 'string' && v.trim()) return v;
    }
    return '';
}

function mapOffProduct(p) {
    if (!p || typeof p !== 'object') return null;
    if (!p.code) return null;

    const productName = cleanText(pickFirstNonEmpty(p.product_name, p.product_name_en));
    if (!productName) return null;

    const ingredients = cleanText(pickFirstNonEmpty(p.ingredients_text, p.ingredients_text_en));
    if (!ingredients) return null;

    const nutriscore = typeof p.nutriscore_score === 'number' ? p.nutriscore_score : 0;
    const nutriments = p.nutriments || {};
    const energyRaw =
        nutriments['energy-kcal_100g'] !== undefined
            ? nutriments['energy-kcal_100g']
            : nutriments['energy_100g'];
    const energy = typeof energyRaw === 'number' ? energyRaw : Number(energyRaw) || 0;

    const categories = Array.isArray(p.categories_tags)
        ? p.categories_tags.map(stripLangPrefix).filter(Boolean).slice(0, 5)
        : [];
    const brands = Array.isArray(p.brands_tags)
        ? p.brands_tags.map(stripLangPrefix).filter(Boolean).slice(0, 3)
        : [];

    return {
        id: `off-${p.code}`,
        product_name: productName.toLowerCase(),
        ingredients_text: ingredients.toLowerCase(),
        nutriscore_numeric: nutriscore,
        energy_100g: energy,
        categories,
        brands,
    };
}

function readCacheFile(cachePath) {
    if (!fs.existsSync(cachePath)) return [];
    const text = fs.readFileSync(cachePath, 'utf-8');
    const out = [];
    for (const line of text.split('\n')) {
        if (!line.trim()) continue;
        try {
            out.push(JSON.parse(line));
        } catch (_e) {
            // skip malformed
        }
    }
    return out;
}

function appendToCacheSync(cachePath, docs) {
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    const text = docs.map((d) => JSON.stringify(d)).join('\n') + (docs.length ? '\n' : '');
    fs.appendFileSync(cachePath, text);
}

async function fetchAndCache({
    targetCount = TOTAL_RECORDS,
    cachePath = DEFAULT_CACHE_FILE,
    bulkUrl = BULK_URL,
    onProgress = null,
} = {}) {
    let cache = readCacheFile(cachePath);
    if (cache.length >= targetCount) {
        if (onProgress) onProgress({ phase: 'cache-hit', cached: cache.length });
        return cache;
    }

    const seenIds = new Set(cache.map((d) => d.id));
    const buffer = [];
    let processed = 0;
    let kept = cache.length;
    let dupes = 0;
    let lastReportedKept = kept;

    const axios = require('axios');
    const response = await axios.get(bulkUrl, {
        responseType: 'stream',
        timeout: 600000, // 10 min for connection
        headers: {
            'User-Agent': 'distributed-search-engine-research/1.0 (academic benchmark)',
            'Accept-Encoding': 'gzip',
        },
        maxRedirects: 5,
    });

    if (onProgress) onProgress({ phase: 'download-started', url: bulkUrl });

    return new Promise((resolve, reject) => {
        const gunzip = zlib.createGunzip();
        const rl = readline.createInterface({
            input: response.data.pipe(gunzip),
            crlfDelay: Infinity,
        });

        function flushBuffer() {
            if (buffer.length === 0) return;
            appendToCacheSync(cachePath, buffer);
            cache = cache.concat(buffer);
            buffer.length = 0;
        }

        rl.on('line', (line) => {
            if (kept >= targetCount) {
                rl.close();
                return;
            }
            processed++;
            if (!line || line.length < 2) return;
            try {
                const product = JSON.parse(line);
                const doc = mapOffProduct(product);
                if (!doc) return;
                if (seenIds.has(doc.id)) {
                    dupes++;
                    return;
                }
                seenIds.add(doc.id);
                buffer.push(doc);
                kept++;

                if (buffer.length >= FLUSH_EVERY) {
                    flushBuffer();
                    if (onProgress && kept - lastReportedKept >= 500) {
                        onProgress({
                            phase: 'progress',
                            processed,
                            kept,
                            dupes,
                            target: targetCount,
                        });
                        lastReportedKept = kept;
                    }
                }
            } catch (_e) {
                // skip malformed JSON lines
            }
        });

        rl.on('close', () => {
            flushBuffer();
            if (onProgress) {
                onProgress({ phase: 'done', processed, kept, dupes });
            }
            resolve(cache);
        });

        rl.on('error', (err) => {
            flushBuffer();
            reject(err);
        });
        response.data.on('error', (err) => {
            flushBuffer();
            reject(err);
        });
        gunzip.on('error', (err) => {
            flushBuffer();
            reject(err);
        });
    });
}

async function loadOpenFoodFacts({
    size,
    cachePath = DEFAULT_CACHE_FILE,
    bulkUrl = BULK_URL,
    onProgress = null,
} = {}) {
    const ranges = sliceRanges();
    if (!ranges[size]) {
        throw new Error(`unsupported size ${size} — supported: ${SUPPORTED_SIZES.join(', ')}`);
    }
    const [, hi] = ranges[size];
    const cache = await fetchAndCache({
        targetCount: hi,
        cachePath,
        bulkUrl,
        onProgress,
    });
    return sliceForSize(cache, size);
}

module.exports = {
    SUPPORTED_SIZES,
    TOTAL_RECORDS,
    sliceRanges,
    sliceForSize,
    mapOffProduct,
    fetchAndCache,
    loadOpenFoodFacts,
    DEFAULT_CACHE_FILE,
};
