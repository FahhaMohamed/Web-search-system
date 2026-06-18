/**
 * External dataset loader for benchmark experiments.
 *
 * Source: Open Library (https://openlibrary.org/) — a real, public catalog
 * of ~30 million book records. We chose Open Library over Open Food Facts
 * because OFF's REST API silently throttles to a few thousand records per
 * session (503s and empty pages); Open Library serves >1 M records of
 * `q=fiction` deep-paginated with no rate-limit issues in practice.
 *
 * The four supported benchmark sizes (100, 1k, 10k, 100k) read four
 * non-overlapping windows of the cache, so a doc that appears in the
 * 100-doc dataset never appears in the 1k, 10k, or 100k datasets.
 */

const fs = require('fs');
const path = require('path');

const SUPPORTED_SIZES = [100, 1000, 10000, 100000];
const TOTAL_RECORDS = SUPPORTED_SIZES.reduce((a, b) => a + b, 0);

const OL_FIELDS = [
    'key',
    'title',
    'author_name',
    'subject',
    'first_sentence',
    'first_publish_year',
    'language',
].join(',');

const OL_PAGE_SIZE = 100;
const OL_QUERY = 'fiction';
const OL_BASE_URL = 'https://openlibrary.org/search.json';

const DEFAULT_CACHE_DIR = path.join(__dirname, 'datasets', '.cache');
const DEFAULT_CACHE_FILE = path.join(DEFAULT_CACHE_DIR, 'openlibrary.jsonl');

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

function hashStringToFloat(s) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619) >>> 0;
    }
    return (h >>> 0) / 4294967296;
}

function priceFromKey(key) {
    const r = hashStringToFloat(`price:${key}`);
    return Math.round((r * 495 + 5) * 100) / 100;
}

function ratingFromKey(key) {
    const r = hashStringToFloat(`rating:${key}`);
    return Math.round((r * 4 + 1) * 10) / 10;
}

function cleanText(s) {
    if (typeof s !== 'string') return '';
    return s.replace(/\s+/g, ' ').trim().toLowerCase();
}

function normalizeAuthors(authors) {
    if (!Array.isArray(authors)) return [];
    return authors
        .map((a) => (typeof a === 'string' ? a.trim().toLowerCase() : ''))
        .filter(Boolean)
        .slice(0, 2);
}

function normalizeSubjects(subjects) {
    if (!Array.isArray(subjects)) return [];
    return subjects
        .map((s) => (typeof s === 'string' ? s.trim().toLowerCase() : ''))
        .filter(Boolean)
        .slice(0, 3);
}

function shortKey(key) {
    if (typeof key !== 'string') return '';
    const parts = key.split('/').filter(Boolean);
    return parts[parts.length - 1] || '';
}

function mapOlRecord(rec) {
    if (!rec || typeof rec !== 'object') return null;
    const title = cleanText(rec.title);
    if (!title) return null;
    const id = shortKey(rec.key);
    if (!id) return null;
    const firstSentence =
        typeof rec.first_sentence === 'string'
            ? rec.first_sentence
            : Array.isArray(rec.first_sentence) && typeof rec.first_sentence[0] === 'string'
              ? rec.first_sentence[0]
              : '';
    const subjectText = Array.isArray(rec.subject) ? rec.subject.slice(0, 8).join(' ') : '';
    const description = cleanText(`${firstSentence} ${subjectText}`);
    if (!description) return null;
    return {
        id: `ol-${id}`,
        title,
        description,
        price: priceFromKey(id),
        rating: ratingFromKey(id),
        category: normalizeSubjects(rec.subject),
        brand: normalizeAuthors(rec.author_name),
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

async function fetchPageDefault(page, pageSize) {
    const axios = require('axios');
    const url = `${OL_BASE_URL}?q=${OL_QUERY}&page=${page}&limit=${pageSize}&fields=${OL_FIELDS}`;
    const maxAttempts = 6;
    let lastErr;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            const res = await axios.get(url, {
                timeout: 60000,
                headers: {
                    'User-Agent': 'distributed-search-engine-research/1.0 (academic benchmark)',
                    Accept: 'application/json',
                },
            });
            return res.data && Array.isArray(res.data.docs) ? res.data.docs : [];
        } catch (err) {
            lastErr = err;
            const status = err.response && err.response.status;
            const transient =
                !status ||
                status >= 500 ||
                status === 429 ||
                err.code === 'ECONNRESET' ||
                err.code === 'ETIMEDOUT';
            if (!transient || attempt === maxAttempts) throw err;
            const backoff = Math.min(60000, 2000 * Math.pow(2, attempt - 1));
            await sleep(backoff);
        }
    }
    throw lastErr;
}

async function fetchAndCache({
    targetCount = TOTAL_RECORDS,
    cachePath = DEFAULT_CACHE_FILE,
    pageSize = OL_PAGE_SIZE,
    fetchPage = fetchPageDefault,
    onProgress = null,
} = {}) {
    let cache = readCacheFile(cachePath);
    if (cache.length >= targetCount) {
        if (onProgress) onProgress({ phase: 'cache-hit', cached: cache.length });
        return cache;
    }
    let page = Math.floor(cache.length / pageSize) + 1;
    let consecutiveEmpty = 0;
    const maxConsecutiveEmpty = 5;
    while (cache.length < targetCount) {
        const records = await fetchPage(page, pageSize);
        if (!records.length) {
            consecutiveEmpty++;
            if (onProgress) onProgress({ phase: 'empty-page', page, consecutiveEmpty });
            if (consecutiveEmpty >= maxConsecutiveEmpty) break;
            await sleep(3000);
            page++;
            continue;
        }
        consecutiveEmpty = 0;
        const mapped = [];
        for (const r of records) {
            const doc = mapOlRecord(r);
            if (doc) mapped.push(doc);
        }
        appendToCacheSync(cachePath, mapped);
        cache = cache.concat(mapped);
        if (onProgress)
            onProgress({ phase: 'page', page, cached: cache.length, target: targetCount });
        page++;
        if (fetchPage === fetchPageDefault) {
            await sleep(150);
        }
    }
    return cache;
}

async function loadExternalDataset({
    size,
    cachePath = DEFAULT_CACHE_FILE,
    fetchPage = fetchPageDefault,
    onProgress = null,
} = {}) {
    const cache = await fetchAndCache({
        targetCount: TOTAL_RECORDS,
        cachePath,
        fetchPage,
        onProgress,
    });
    return sliceForSize(cache, size);
}

function dedupeById(docs) {
    const seen = new Set();
    const out = [];
    for (const d of docs) {
        if (seen.has(d.id)) continue;
        seen.add(d.id);
        out.push(d);
    }
    return out;
}

module.exports = {
    SUPPORTED_SIZES,
    TOTAL_RECORDS,
    sliceRanges,
    sliceForSize,
    mapOlRecord,
    fetchAndCache,
    loadExternalDataset,
    dedupeById,
    DEFAULT_CACHE_FILE,
};
