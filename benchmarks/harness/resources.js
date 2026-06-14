/**
 * Resource sampling via `docker stats`.
 *
 * parseDockerStats is the pure unit (tested). startSampler is a thin
 * wrapper that polls `docker stats --no-stream --format "{{json .}}"`
 * on a timer and feeds each parsed sample to an onSample callback.
 */

const { spawn } = require('child_process');

const MEM_UNIT_TO_MB = {
    B: 1 / 1024 / 1024,
    KB: 1 / 1024, KiB: 1 / 1024,
    MB: 1, MiB: 1,
    GB: 1024, GiB: 1024,
    TB: 1024 * 1024, TiB: 1024 * 1024,
};

function parseMemoryToMb(memUsage) {
    if (typeof memUsage !== 'string') return 0;
    const usage = memUsage.split('/')[0].trim();
    const m = usage.match(/^([\d.]+)\s*(B|KB|KiB|MB|MiB|GB|GiB|TB|TiB)$/);
    if (!m) return 0;
    return parseFloat(m[1]) * (MEM_UNIT_TO_MB[m[2]] || 0);
}

function parseDockerStats(line) {
    if (!line || typeof line !== 'string') return null;
    let obj;
    try {
        obj = JSON.parse(line);
    } catch (_) {
        return null;
    }
    if (!obj || !obj.Name || !obj.CPUPerc || !obj.MemUsage) return null;
    return {
        container: obj.Name,
        cpuPercent: parseFloat(String(obj.CPUPerc).replace('%', '')),
        memMb: parseMemoryToMb(obj.MemUsage),
    };
}

function takeOneSnapshot() {
    return new Promise((resolve) => {
        const chunks = [];
        const proc = spawn('docker', ['stats', '--no-stream', '--format', '{{json .}}']);
        proc.stdout.on('data', (d) => chunks.push(d.toString()));
        proc.on('close', () => {
            const lines = chunks.join('').split('\n').filter(Boolean);
            resolve(lines.map(parseDockerStats).filter(Boolean));
        });
        proc.on('error', () => resolve([]));
    });
}

function startSampler({ intervalMs = 1000, onSample = () => {} } = {}) {
    let stopped = false;
    (async () => {
        while (!stopped) {
            const samples = await takeOneSnapshot();
            if (samples.length > 0) onSample({ time: Date.now(), samples });
            await new Promise((r) => setTimeout(r, intervalMs));
        }
    })();
    return () => {
        stopped = true;
    };
}

module.exports = { parseDockerStats, parseMemoryToMb, takeOneSnapshot, startSampler };
