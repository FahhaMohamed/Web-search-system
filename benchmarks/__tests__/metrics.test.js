const { computeStats } = require('../harness/metrics');

describe('computeStats', () => {
    test('count, min, max, avg on simple array', () => {
        const stats = computeStats([10, 20, 30, 40, 50], 100);
        expect(stats.count).toBe(5);
        expect(stats.min).toBe(10);
        expect(stats.max).toBe(50);
        expect(stats.avg).toBe(30);
    });

    test('p50 is the median for odd-length array', () => {
        expect(computeStats([1, 2, 3, 4, 5], 100).p50).toBe(3);
    });

    test('p95 puts 95% of values at or below', () => {
        const arr = Array.from({ length: 100 }, (_, i) => i + 1); // 1..100
        expect(computeStats(arr, 1000).p95).toBe(95);
    });

    test('p99 puts 99% of values at or below', () => {
        const arr = Array.from({ length: 100 }, (_, i) => i + 1);
        expect(computeStats(arr, 1000).p99).toBe(99);
    });

    test('throughput = count / (totalElapsedMs / 1000)', () => {
        const stats = computeStats([10, 20, 30], 1500); // 1.5 seconds
        expect(stats.throughput).toBeCloseTo(2, 5);
    });

    test('handles empty array gracefully (all zeros)', () => {
        const stats = computeStats([], 100);
        expect(stats.count).toBe(0);
        expect(stats.min).toBe(0);
        expect(stats.max).toBe(0);
        expect(stats.avg).toBe(0);
        expect(stats.p50).toBe(0);
        expect(stats.p95).toBe(0);
        expect(stats.p99).toBe(0);
        expect(stats.throughput).toBe(0);
    });

    test('handles single element (all stats equal)', () => {
        const stats = computeStats([42], 100);
        expect(stats.min).toBe(42);
        expect(stats.max).toBe(42);
        expect(stats.avg).toBe(42);
        expect(stats.p50).toBe(42);
        expect(stats.p95).toBe(42);
        expect(stats.p99).toBe(42);
    });

    test('unsorted input still produces correct percentiles (internal sort)', () => {
        const stats = computeStats([5, 1, 3, 2, 4], 100);
        expect(stats.min).toBe(1);
        expect(stats.max).toBe(5);
        expect(stats.p50).toBe(3);
    });

    test('zero elapsed time yields zero throughput (no division by zero)', () => {
        expect(computeStats([10, 20], 0).throughput).toBe(0);
    });
});
