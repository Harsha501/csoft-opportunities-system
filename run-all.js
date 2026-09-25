// Runs every browser-dependent scraper once, in sequence (not parallel, to
// avoid competing for local resources), and logs a summary. These 3 sources
// drive a real headless browser (click-paths, JS-rendered tables), which a
// Cloudflare Worker can't do — so they still need a real machine to run on
// (GitHub Actions, see .github/workflows/daily-scan.yml).
//
// nse_announcements and google_news used to run from here too, but both are
// plain HTTP/no-browser sources, so they were moved into the Worker itself
// (cf-worker/src/sources/, on a daily cron trigger) — no machine dependency
// at all for those two now. See cf-worker/src/index.js's scheduled() handler.

const sources = [
  { name: 'ap_eprocurement', run: require('./sources/ap-eprocurement').run },
  { name: 'telangana_eprocurement', run: require('./sources/telangana-eprocurement').run },
  { name: 'aprera', run: require('./sources/aprera').run },
];

async function runAll() {
  const started = new Date().toISOString();
  console.log(`[run-all] Starting daily opportunities scan at ${started}`);

  const results = [];
  for (const source of sources) {
    console.log(`\n[run-all] --- ${source.name} ---`);
    try {
      const result = await source.run();
      results.push({ source: source.name, ...result });
    } catch (err) {
      console.error(`[run-all] ${source.name} threw unexpectedly:`, err.message);
      results.push({ source: source.name, error: err.message });
    }
  }

  console.log('\n[run-all] Summary:');
  results.forEach((r) => {
    if (r.error) {
      console.log(`  - ${r.source}: FAILED (${r.error})`);
    } else {
      console.log(`  - ${r.source}: checked ${r.itemCount}, matched ${r.matched}`);
    }
  });

  return results;
}

if (require.main === module) {
  runAll().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
}

module.exports = { runAll };
