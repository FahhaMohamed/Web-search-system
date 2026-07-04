/**
 * Bounded min-heap of {id, score} tuples for top-K search.
 *
 * "Top-K" means: keep only the K items with the highest score.
 * A min-heap (smallest at the root) is the right structure — when the
 * heap is full and a new candidate arrives, we compare against the root:
 *   - if new.score > root.score  → root drops off, new becomes the new root
 *   - if new.score <= root.score → skip (can't beat any of our current K)
 *
 * At the end, drainSorted() returns all K in descending-score order.
 *
 * Complexity vs a full sort:
 *   old: O(N log N) sort of all N matching docs
 *   new: O(N log K) — for K << N, this is much cheaper
 *   e.g. N=30_000, K=20 → old ~450k ops, new ~130k ops (~3.5× faster).
 *
 * More importantly, we stop keeping the middle-of-the-pack scores in
 * memory, which cuts allocation churn.
 */

class TopKMinHeap {
    constructor(k) {
        if (!Number.isInteger(k) || k <= 0) {
            throw new Error('TopKMinHeap: k must be a positive integer');
        }
        this.k = k;
        this.heap = []; // array of { id, score }
    }

    get size() {
        return this.heap.length;
    }

    /** Root score (worst kept score) or -Infinity when empty. */
    minScore() {
        return this.heap.length > 0 ? this.heap[0].score : -Infinity;
    }

    /**
     * Offer a candidate. If heap has room, add it. Otherwise, replace root
     * if candidate has a strictly better score. Returns true if kept.
     */
    offer(id, score) {
        if (this.heap.length < this.k) {
            this.heap.push({ id, score });
            this._bubbleUp(this.heap.length - 1);
            return true;
        }
        if (score > this.heap[0].score) {
            this.heap[0] = { id, score };
            this._sinkDown(0);
            return true;
        }
        return false;
    }

    /** Return heap contents sorted by score DESC. */
    drainSorted() {
        const out = this.heap.slice();
        out.sort((a, b) => b.score - a.score);
        return out;
    }

    _bubbleUp(i) {
        const h = this.heap;
        while (i > 0) {
            const parent = (i - 1) >> 1;
            if (h[i].score < h[parent].score) {
                [h[i], h[parent]] = [h[parent], h[i]];
                i = parent;
            } else break;
        }
    }

    _sinkDown(i) {
        const h = this.heap;
        const n = h.length;
        while (true) {
            const left = 2 * i + 1;
            const right = 2 * i + 2;
            let smallest = i;
            if (left < n && h[left].score < h[smallest].score) smallest = left;
            if (right < n && h[right].score < h[smallest].score) smallest = right;
            if (smallest === i) break;
            [h[i], h[smallest]] = [h[smallest], h[i]];
            i = smallest;
        }
    }
}

module.exports = { TopKMinHeap };
