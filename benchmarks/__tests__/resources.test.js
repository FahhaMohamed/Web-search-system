const { parseDockerStats } = require('../harness/resources');

describe('parseDockerStats', () => {
    test('parses CPU% and MiB memory from standard docker stats JSON', () => {
        const line = JSON.stringify({
            Name: 'gateway',
            CPUPerc: '0.05%',
            MemUsage: '50MiB / 1GiB',
        });
        const r = parseDockerStats(line);
        expect(r.container).toBe('gateway');
        expect(r.cpuPercent).toBeCloseTo(0.05, 5);
        expect(r.memMb).toBeCloseTo(50, 1);
    });

    test('parses GiB memory units', () => {
        const line = JSON.stringify({
            Name: 'shard-cluster',
            CPUPerc: '1.0%',
            MemUsage: '2.5GiB / 8GiB',
        });
        const r = parseDockerStats(line);
        expect(r.memMb).toBeCloseTo(2560, 1);
    });

    test('parses MB (decimal) units', () => {
        const line = JSON.stringify({
            Name: 'text-node',
            CPUPerc: '1.0%',
            MemUsage: '100MB / 1GB',
        });
        const r = parseDockerStats(line);
        expect(r.memMb).toBeCloseTo(100, 1);
    });

    test('parses KiB memory units (small process)', () => {
        const line = JSON.stringify({
            Name: 'tiny',
            CPUPerc: '0.01%',
            MemUsage: '512KiB / 1GiB',
        });
        const r = parseDockerStats(line);
        expect(r.memMb).toBeCloseTo(0.5, 2);
    });

    test('parses larger CPU percentages correctly', () => {
        const line = JSON.stringify({
            Name: 'busy',
            CPUPerc: '145.3%',
            MemUsage: '200MiB / 1GiB',
        });
        const r = parseDockerStats(line);
        expect(r.cpuPercent).toBeCloseTo(145.3, 1);
    });

    test('returns null for non-JSON input', () => {
        expect(parseDockerStats('not json at all')).toBeNull();
    });

    test('returns null for empty input', () => {
        expect(parseDockerStats('')).toBeNull();
    });

    test('returns null when required fields are missing', () => {
        expect(parseDockerStats('{}')).toBeNull();
    });
});
