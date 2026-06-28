/**
 * External dataset loader: arXiv academic papers.
 *
 * Source: export.arxiv.org/api/query (HTTPS). Free, no auth.
 *
 * The cache lives at benchmarks/datasets/.cache/arxiv.jsonl (gitignored).
 * Append-only JSONL — restartable on network drops / laptop sleep.
 *
 * Four supported sizes (100, 1k, 10k, 100k) read non-overlapping windows
 * of the cache so docs never repeat across sizes.
 *
 * Strategy: arXiv enforces a hard offset ceiling of ~9999 — start=10000+
 * returns HTTP 500. So we walk backwards in time using **date windows**.
 * Each window is small enough (~14 days × 5 categories ~ < 2000 papers)
 * to fit in a single request without crossing the offset wall. We keep
 * walking older windows until cache.length >= target.
 *
 * Polite 3-second delay between requests per arXiv's TOS.
 */

const fs = require('fs');
const path = require('path');

const SUPPORTED_SIZES = [100, 1000, 10000, 100000];
const TOTAL_RECORDS = SUPPORTED_SIZES.reduce((a, b) => a + b, 0); // 111100

const ARXIV_API = 'https://export.arxiv.org/api/query';
const PAGE_SIZE = 2000; // arXiv max per request
const WINDOW_DAYS = 14;
const SEARCH_CATS = '(cat:cs.LG OR cat:cs.AI OR cat:cs.CL OR cat:cs.CV OR cat:stat.ML)';

const DEFAULT_CACHE_DIR = path.join(__dirname, '..', 'datasets', '.cache');
const DEFAULT_CACHE_FILE = path.join(DEFAULT_CACHE_DIR, 'arxiv.jsonl');

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

function decodeXmlEntities(s) {
    if (typeof s !== 'string') return '';
    return s
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'");
}

function extractTag(xml, tag) {
    const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i');
    const m = xml.match(re);
    return m ? decodeXmlEntities(m[1].trim()) : '';
}

function extractCategoryTerms(xml) {
    const re = /<category[^>]*\sterm="([^"]+)"/gi;
    const out = [];
    let m;
    while ((m = re.exec(xml)) !== null) {
        out.push(decodeXmlEntities(m[1]));
    }
    return out;
}

function extractAuthorNames(xml) {
    // Two-step parse: find each <author>...</author> block, then extract the
    // <name>...</name> from it. Robust against optional <arxiv:affiliation>
    // tags between </name> and </author>, which broke the original
    // single-regex approach on big-collaboration papers.
    const authorBlocks = xml.match(/<author>[\s\S]*?<\/author>/gi) || [];
    const out = [];
    for (const block of authorBlocks) {
        const m = block.match(/<name>([\s\S]*?)<\/name>/i);
        if (!m) continue;
        const name = decodeXmlEntities(m[1].trim()).toLowerCase();
        // Drop pathological entries — real author names are well under 200 chars
        if (name && name.length <= 200) out.push(name);
    }
    return out;
}

function parseEntries(xmlText) {
    if (typeof xmlText !== 'string') return [];
    const entries = [];
    const entryRe = /<entry>([\s\S]*?)<\/entry>/gi;
    let m;
    while ((m = entryRe.exec(xmlText)) !== null) {
        entries.push(m[1]);
    }
    return entries;
}

function mapArxivEntry(entryXml) {
    if (!entryXml) return null;

    const idUrl = extractTag(entryXml, 'id');
    const idMatch = idUrl.match(/arxiv\.org\/abs\/(.+?)(?:v\d+)?$/);
    if (!idMatch) return null;
    const arxivId = idMatch[1];

    // Filter out arxiv error entries
    if (arxivId === 'errors' || idUrl.includes('/api/errors')) return null;

    const title = cleanText(extractTag(entryXml, 'title')).toLowerCase();
    if (!title) return null;

    const summary = cleanText(extractTag(entryXml, 'summary')).toLowerCase();
    if (!summary) return null;

    const published = extractTag(entryXml, 'published');
    const yearMatch = published.match(/^(\d{4})/);
    const published_year = yearMatch ? parseInt(yearMatch[1], 10) : 0;

    const categories = extractCategoryTerms(entryXml).slice(0, 5);
    const authors = extractAuthorNames(entryXml).slice(0, 5);

    return {
        id: `ax-${arxivId}`,
        title,
        summary,
        categories,
        authors,
        published_year,
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

function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

function formatYmd(d) {
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    return `${y}${m}${day}`;
}

function readCursor(cachePath) {
    const p = cachePath + '.cursor';
    if (!fs.existsSync(p)) return null;
    try {
        return JSON.parse(fs.readFileSync(p, 'utf-8'));
    } catch (_e) {
        return null;
    }
}

function writeCursor(cachePath, obj) {
    fs.writeFileSync(cachePath + '.cursor', JSON.stringify(obj));
}

async function fetchPageDefault({ fromYmd, toYmd, start }) {
    const params = new URLSearchParams({
        search_query: `${SEARCH_CATS} AND submittedDate:[${fromYmd}0000 TO ${toYmd}2359]`,
        start: String(start),
        max_results: String(PAGE_SIZE),
        sortBy: 'submittedDate',
        sortOrder: 'descending',
    });

    const headers = {
        'User-Agent': 'distributed-search-engine-research/1.0 (academic benchmark)',
        Accept: 'application/atom+xml',
    };

    const axios = require('axios');
    const maxAttempts = 10;
    let lastErr;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            const res = await axios.get(`${ARXIV_API}?${params.toString()}`, {
                timeout: 60000,
                headers,
                responseType: 'text',
            });
            return res.data || '';
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
            const backoff = Math.min(300000, 5000 * Math.pow(2, attempt - 1));
            await sleep(backoff);
        }
    }
    throw lastErr;
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

    const seenIds = new Set(cache.map((d) => d.id));

    // Resume from cursor if we have one, else start at today
    const cursor = readCursor(cachePath);
    let toDate = cursor && cursor.toDate ? new Date(cursor.toDate) : new Date();

    let windowNum = 0;
    let consecutiveZero = 0;
    // Existing cache (if any) will likely produce ~10 windows of all-dupes
    // before we walk past it. 30 gives headroom and still detects genuine
    // exhaustion (we'd never hit 30 in a row across normal arXiv history).
    const maxConsecutiveZero = 30;

    while (cache.length < targetCount) {
        const fromDate = new Date(toDate);
        fromDate.setUTCDate(fromDate.getUTCDate() - (WINDOW_DAYS - 1));
        const fromYmd = formatYmd(fromDate);
        const toYmd = formatYmd(toDate);
        windowNum++;

        // paginate within window
        let windowStart = 0;
        let windowKept = 0;
        let windowEmpty = false;

        while (!windowEmpty && cache.length < targetCount) {
            const xml = await fetchPage({ fromYmd, toYmd, start: windowStart });
            const entries = parseEntries(xml);

            if (entries.length === 0) {
                windowEmpty = true;
                break;
            }

            const mapped = [];
            let dupes = 0;
            for (const e of entries) {
                const doc = mapArxivEntry(e);
                if (!doc) continue;
                if (seenIds.has(doc.id)) {
                    dupes++;
                    continue;
                }
                seenIds.add(doc.id);
                mapped.push(doc);
            }

            if (mapped.length > 0) {
                appendToCacheSync(cachePath, mapped);
                cache = cache.concat(mapped);
                windowKept += mapped.length;
            }

            if (onProgress) {
                onProgress({
                    phase: 'window-page',
                    window: windowNum,
                    fromYmd,
                    toYmd,
                    start: windowStart,
                    added: mapped.length,
                    dupes,
                    cached: cache.length,
                    target: targetCount,
                });
            }

            // if we got fewer than a full page, window is done
            if (entries.length < PAGE_SIZE) {
                windowEmpty = true;
                break;
            }

            windowStart += entries.length;
            if (fetchPage === fetchPageDefault) {
                await sleep(3000);
            }
        }

        // Persist cursor — next time resume at this date
        writeCursor(cachePath, { toDate: toDate.toISOString() });

        if (windowKept === 0) {
            consecutiveZero++;
            if (onProgress) onProgress({ phase: 'empty-window', window: windowNum, fromYmd, toYmd, consecutiveZero });
            if (consecutiveZero >= maxConsecutiveZero) break;
        } else {
            consecutiveZero = 0;
        }

        // step toDate back: tomorrow of fromDate
        toDate = new Date(fromDate);
        toDate.setUTCDate(toDate.getUTCDate() - 1);

        if (fetchPage === fetchPageDefault) {
            await sleep(3000);
        }
    }
    return cache;
}

async function loadArxiv({
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
        targetCount: hi,
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
    parseEntries,
    mapArxivEntry,
    fetchAndCache,
    loadArxiv,
    DEFAULT_CACHE_FILE,
};
