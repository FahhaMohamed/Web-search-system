const { summarizeCsv, mergeSummaries, formatMarkdown } = require('../analyze');

const SAMPLE_CSV =
    'size,query,repetition,latency_ms,result_count,status\n' +
    '100,a,1,200,5,ok\n' +
    '100,a,2,10,5,ok\n' +
    '100,a,3,12,5,ok\n' +
    '100,a,4,14,5,ok\n' +
    '100,a,5,16,5,ok\n' +
    '100,a,6,18,5,ok\n' +
    '100,a,7,20,5,ok\n' +
    '100,a,8,22,5,ok\n' +
    '100,a,9,24,5,ok\n' +
    '100,a,10,26,5,ok\n' +
    '100,b,1,100,5,ok\n' +
    '100,b,2,5,5,ok\n' +
    '100,b,3,7,5,ok\n' +
    '100,b,4,9,5,ok\n' +
    '100,b,5,11,5,ok\n' +
    '100,b,6,13,5,ok\n' +
    '100,b,7,15,5,ok\n' +
    '100,b,8,17,5,ok\n' +
    '100,b,9,19,5,ok\n' +
    '100,b,10,21,5,ok\n';

describe('summarizeCsv', () => {
    test('excludes the cold rep=1 and returns size + warmed stats', () => {
        const s = summarizeCsv(SAMPLE_CSV);
        expect(s.size).toBe(100);
        // 18 warmed samples: 10,12,14,16,18,20,22,24,26 and 5,7,9,11,13,15,17,19,21
        expect(s.n).toBe(18);
        // sorted: 5,7,9,10,11,12,13,14,15,16,17,18,19,20,21,22,24,26
        // median (index 9): 16
        expect(s.medianMs).toBe(16);
        // mean = (162 + 117) / 18 = 15.5
        expect(s.meanMs).toBeCloseTo(15.5, 1);
        // p90 (index 16): 24
        expect(s.p90Ms).toBe(24);
    });

    test('reports error rate', () => {
        const csv =
            'size,query,repetition,latency_ms,result_count,status\n' +
            '100,a,1,10,5,ok\n' +
            '100,a,2,12,5,error\n' +
            '100,a,3,14,5,ok\n';
        const s = summarizeCsv(csv);
        expect(s.errorRate).toBeCloseTo(1 / 3, 3);
    });

    test('returns null when the csv is empty (header only)', () => {
        const empty = 'size,query,repetition,latency_ms,result_count,status\n';
        expect(summarizeCsv(empty)).toBeNull();
    });
});

describe('mergeSummaries', () => {
    test('groups summaries by size for new vs old side-by-side', () => {
        const rows = mergeSummaries([
            { arch: 'new', size: 100,  medianMs: 40, meanMs: 42, p90Ms: 55, n: 180, errorRate: 0 },
            { arch: 'old', size: 100,  medianMs: 1,  meanMs: 1,  p90Ms: 2,  n: 180, errorRate: 0 },
            { arch: 'new', size: 1000, medianMs: 10, meanMs: 11, p90Ms: 14, n: 180, errorRate: 0 },
            { arch: 'old', size: 1000, medianMs: 1,  meanMs: 1,  p90Ms: 1,  n: 180, errorRate: 0 },
        ]);
        expect(rows).toHaveLength(2);
        expect(rows[0].size).toBe(100);
        expect(rows[0].new.medianMs).toBe(40);
        expect(rows[0].old.medianMs).toBe(1);
        expect(rows[1].size).toBe(1000);
        expect(rows[1].new.medianMs).toBe(10);
    });

    test('size with only one architecture still appears (other side undefined)', () => {
        const rows = mergeSummaries([
            { arch: 'new', size: 100000, medianMs: 50, meanMs: 50, p90Ms: 60, n: 180, errorRate: 0 },
        ]);
        expect(rows).toHaveLength(1);
        expect(rows[0].new.medianMs).toBe(50);
        expect(rows[0].old).toBeUndefined();
    });
});

describe('formatMarkdown', () => {
    test('emits a table with size + new + old columns', () => {
        const md = formatMarkdown([
            { size: 100,  new: { medianMs: 40, p90Ms: 55, n: 180 }, old: { medianMs: 1, p90Ms: 2, n: 180 } },
            { size: 1000, new: { medianMs: 10, p90Ms: 14, n: 180 }, old: { medianMs: 1, p90Ms: 1, n: 180 } },
        ]);
        expect(md).toContain('| size');
        expect(md).toContain('100');
        expect(md).toContain('40');
        expect(md).toContain('1000');
        expect(md).toContain('10');
    });
});
