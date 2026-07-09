const si = require('systeminformation');
const { bus, EVENT_TYPES } = require('./events/bus');

let cached = { cpu: 0, ram: 0, temp: null, battery: null };
let lastFetch = 0;
const TTL_MS = 4_000;

async function readStats() {
  const now = Date.now();
  if (now - lastFetch < TTL_MS) return cached;
  lastFetch = now;

  try {
    const [load, mem, temp, batt] = await Promise.all([
      si.currentLoad(),
      si.mem(),
      si.cpuTemperature().catch(() => ({ main: null })),
      si.battery().catch(() => ({ percent: null, hasBattery: false })),
    ]);
    cached = {
      cpu: load.currentLoad,
      ram: (mem.active / mem.total) * 100,
      temp: typeof temp.main === 'number' ? temp.main : null,
      battery: batt.hasBattery && typeof batt.percent === 'number' ? batt.percent : null,
    };
  } catch (err) {
    console.error('[stats] read failed:', err.message);
  }
  return cached;
}

function startBroadcast(intervalMs = 5000) {
  setInterval(async () => {
    const s = await readStats();
    bus.emit(EVENT_TYPES.SYSTEM_STATS_UPDATE, s, 'system');
  }, intervalMs);
}

async function handleHttp(req, res) {
  res.writeHead(200, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(JSON.stringify(await readStats()));
}

module.exports = { handleHttp, startBroadcast };
