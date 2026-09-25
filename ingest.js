// Shared helper: submits classified opportunities and per-source health reports
// to the Worker's admin API. Gracefully no-ops (logs what it WOULD send) until
// config.json has a real adminToken — same pattern as deals-system's email config.

const fs = require('fs');
const path = require('path');
const https = require('https');

const CONFIG_PATH = path.join(__dirname, 'config.json');

function loadConfig() {
  // Env vars take priority so GitHub Actions can inject the token as a repo
  // secret instead of needing config.json (with a real credential) committed.
  if (process.env.CSOFT_ADMIN_TOKEN) {
    return { apiBase: process.env.CSOFT_API_BASE || '', adminToken: process.env.CSOFT_ADMIN_TOKEN };
  }
  try { return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); } catch (e) { return { apiBase: '', adminToken: '' }; }
}

function postJson(urlStr, body, headers) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const data = JSON.stringify(body);
    const req = https.request({
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), ...headers },
    }, (res) => {
      let chunks = '';
      res.on('data', (d) => { chunks += d; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(chunks) }); }
        catch (e) { resolve({ status: res.statusCode, body: chunks }); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function ingestOpportunities(opportunities) {
  const config = loadConfig();
  if (!config.adminToken) {
    console.log(`[ingest] ADMIN_TOKEN not configured — would ingest ${opportunities.length} opportunities. Skipping actual submit.`);
    opportunities.slice(0, 5).forEach((o) => console.log('  -', o.title, '->', o.matchedProducts.join(', ')));
    return { skipped: true, wouldIngest: opportunities.length };
  }
  if (!opportunities.length) return { ok: true, inserted: 0, updated: 0, total: 0 };
  const res = await postJson(config.apiBase + '/api/admin/opportunities/ingest', { opportunities }, { Authorization: 'Bearer ' + config.adminToken });
  return res.body;
}

async function reportSourceHealth(report) {
  const config = loadConfig();
  if (!config.adminToken) {
    console.log('[health] ADMIN_TOKEN not configured — would report:', JSON.stringify(report));
    return { skipped: true };
  }
  const res = await postJson(config.apiBase + '/api/admin/source-health/report', report, { Authorization: 'Bearer ' + config.adminToken });
  return res.body;
}

module.exports = { loadConfig, ingestOpportunities, reportSourceHealth };
