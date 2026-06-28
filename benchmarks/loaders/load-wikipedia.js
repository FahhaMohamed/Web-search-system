/**
 * External dataset loader: Wikipedia articles.
 *
 * Source: en.wikipedia.org/w/api.php (CC-BY-SA). Free, no auth, unlimited scale.
 *
 * The cache lives at benchmarks/datasets/.cache/wikipedia.jsonl (gitignored).
 * It is append-only JSONL — restartable on network drops / laptop sleep.
 *
 * Four supported sizes (100, 1k, 10k, 100k) read non-overlapping windows of
 * the cache so docs never repeat across sizes (same fairness rule as Task 2).
 *
 * Strategy: `generator=random&grnnamespace=0&grnfilterredir=nonredirects`
 * — Wikipedia's recommended path for bulk sampling. Each call returns up to
 * 20 random non-redirect articles. Yield is high (~80%+) because random
 * samples skew to real, populated articles rather than alphabetical stubs.
 * Duplicates by pageid are deduped against the existing cache.
 *
 * Two requests per batch:
 *  1. random pages + extracts + info
 *  2. categories for those pageids  (separate request avoids Wikipedia's
 *     multi-step continuation pattern when combining extracts and categories)
 */

const fs = require('fs');
const path = require('path');

const SUPPORTED_SIZES = [100, 1000, 10000, 100000];
const TOTAL_RECORDS = SUPPORTED_SIZES.reduce((a, b) => a + b, 0); // 111100

const WP_API = 'https://en.wikipedia.org/w/api.php';
const PAGE_SIZE = 20; // grnlimit max for non-bot users

const DEFAULT_CACHE_DIR = path.join(__dirname, '..', 'datasets', '.cache');
const DEFAULT_CACHE_FILE = path.join(DEFAULT_CACHE_DIR, 'wikipedia.jsonl');

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

function normalizeCategory(cat) {
    if (typeof cat !== 'string') return '';
    return cat.replace(/^Category:/, '').trim().toLowerCase();
}

function mapWpPage(page) {
    if (!page || typeof page !== 'object') return null;
    const title = cleanText(page.title);
    if (!title) return null;
    if (page.pageid == null) return null;
    const extract = cleanText(page.extract || '');
    if (!extract) return null;
    const categories = Array.isArray(page.categories)
        ? page.categories.map((c) => normalizeCategory(c.title)).filter(Boolean).slice(0, 8)
        : [];
    return {
        id: `wp-${page.pageid}`,
        title: title.toLowerCase(),
        extract: extract.toLowerCase(),
        length: typeof page.length === 'number' ? page.length : 0,
        last_modified: typeof page.touched === 'string' ? page.touched : '',
        categories,
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
            // skip malformed lines
        }
    }
    return out;
}

function appendToCacheSync(cachePath, docs) {
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    const text = docs.map((d) => JSON.stringify(d)).join('\n') + (docs.length ? '\n' : '');
    fs.appendFileSync(cachePath, text);
}

function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

async function callWithRetry(url, headers) {
    const axios = require('axios');
    const maxAttempts = 6;
    let lastErr;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            const res = await axios.get(url, { timeout: 60000, headers });
            return res.data || {};
        } catch (err) {
            lastErr = err;
            const status = err.response && err.response.status;
            const transient =
                !status ||
                status >= 500 ||
                status === 429 ||
                err.code === 'ECONNRESET' ||
                err.code === 'ETIMEDOUT' ||
                err.code === 'ENOTFOUND' ||
                err.code === 'EAI_AGAIN' ||
                err.code === 'ENETUNREACH';
            if (!transient || attempt === maxAttempts) throw err;
            const backoff = Math.min(60000, 2000 * Math.pow(2, attempt - 1));
            await sleep(backoff);
        }
    }
    throw lastErr;
}

async function fetchPageDefault() {
    const headers = {
        'User-Agent': 'distributed-search-engine-research/1.0 (academic benchmark)',
        Accept: 'application/json',
    };

    // Single combined request: random doesn't paginate, so multi-step
    // continuation (which is why we previously split) is not a problem.
    // cllimit=500 covers ~25 cats/page × 20 pages — far more than typical.
    const params = new URLSearchParams({
        action: 'query',
        format: 'json',
        formatversion: '2',
        generator: 'random',
        grnnamespace: '0',
        grnlimit: String(PAGE_SIZE),
        grnfilterredir: 'nonredirects',
        prop: 'extracts|info|categories',
        exintro: 'true',
        explaintext: 'true',
        exlimit: 'max',
        cllimit: '500',
        clshow: '!hidden',
    });

    const data = await callWithRetry(`${WP_API}?${params.toString()}`, headers);
    const pages = (data.query && data.query.pages) || [];
    return { pages };
}

async function fetchAndCache({
    targetCount = TOTAL_RECORDS,
    cachePath = DEFAULT_CACHE_FILE,
    fetchPage = fetchPageDefault,
    onProgress = null,
} = {}) {
    let cache = readCacheFile(cachePath);
    if (cache.length >= targetCount) {
        if (onProgress) onProgress({ phase: 'cache-hit', cached: cache.length });
        return cache;
    }

    // Seen-set for de-duplication across the lifetime of this fetch
    const seenIds = new Set(cache.map((d) => d.id));

    let batchNum = 0;
    let consecutiveZero = 0; // batches where 0 NEW docs landed (all dupes/empties)
    const maxConsecutiveZero = 8;

    while (cache.length < targetCount) {
        const { pages } = await fetchPage();
        batchNum++;

        if (!pages.length) {
            consecutiveZero++;
            if (onProgress) onProgress({ phase: 'empty-batch', batch: batchNum, consecutiveZero });
            if (consecutiveZero >= maxConsecutiveZero) break;
            await sleep(2000);
            continue;
        }

        const mapped = [];
        let dupes = 0;
        for (const p of pages) {
            const doc = mapWpPage(p);
            if (!doc) continue;
            if (seenIds.has(doc.id)) {
                dupes++;
                continue;
            }
            seenIds.add(doc.id);
            mapped.push(doc);
        }

        if (mapped.length === 0) {
            consecutiveZero++;
            if (onProgress) onProgress({ phase: 'all-dupes', batch: batchNum, dupes, consecutiveZero });
            if (consecutiveZero >= maxConsecutiveZero) break;
            await sleep(500);
            continue;
        }
        consecutiveZero = 0;

        appendToCacheSync(cachePath, mapped);
        cache = cache.concat(mapped);

        if (onProgress) {
            onProgress({
                phase: 'batch',
                batch: batchNum,
                added: mapped.length,
                dupes,
                cached: cache.length,
                target: targetCount,
            });
        }

        if (fetchPage === fetchPageDefault) {
            await sleep(150); // polite delay
        }
    }
    return cache;
}

async function loadWikipedia({
    size,
    cachePath = DEFAULT_CACHE_FILE,
    fetchPage = fetchPageDefault,
    onProgress = null,
} = {}) {
    const ranges = sliceRanges();
    if (!ranges[size]) {
        throw new Error(`unsupported size ${size} — supported: ${SUPPORTED_SIZES.join(', ')}`);
    }
    const [, hi] = ranges[size];
    const cache = await fetchAndCache({
        targetCount: hi, // only fetch as much as this size's window needs
        cachePath,
        fetchPage,
        onProgress,
    });
    return sliceForSize(cache, size);
}

module.exports = {
    SUPPORTED_SIZES,
    TOTAL_RECORDS,
    sliceRanges,
    sliceForSize,
    mapWpPage,
    fetchAndCache,
    loadWikipedia,
    DEFAULT_CACHE_FILE,
};
