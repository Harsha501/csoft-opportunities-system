// Runs the given browser-dependent scrapers once, in sequence (not parallel,
// to avoid competing for local resources), and logs a summary. All 3 drive a
// real headless browser (click-paths, JS-rendered tables), which a Cloudflare
// Worker can't do — so they still need a real machine to run on.
//
// nse_announcements and google_news used to run from here too, but both are
// plain HTTP/no-browser sources, so they were moved into the Worker itself
// (cf-worker/src/sources/, on a daily cron trigger) — no machine dependency
// at all for those two now. See cf-worker/src/index.js's scheduled() handler.
//
// Confirmed via a raw curl diagnostic from a GitHub Actions runner: AP's
// state government servers (tender.apeprocurement.gov.in, rera.ap.gov.in)
// silently drop the TCP connection from GitHub's IP ranges — a network-level
// block, not a slow response, and not something to route around with a
// proxy (same "don't circumvent a deliberate access control" line as the
// CAPTCHA sources). Telangana's server has no such block. So the 3 sources
// are split by where they can actually run:
//   - ap_eprocurement, aprera        -> local PC only (run-daily.bat / Windows Task Scheduler)
//   - telangana_eprocurement         -> GitHub Actions only (.github/workflows/daily-scan.yml)
// Pass source names as CLI args to run a subset; no args runs all 3 (useful
// for local ad-hoc testing).

const ALL_SOURCES = [
  { name: 'ap_eprocurement', run: require('./sources/ap-eprocurement').run },
  { name: 'telangana_eprocurement', run: require('./sources/telangana-eprocurement').run },
  { name: 'aprera', run: require('./sources/aprera').run },
];

async function runAll(names) {
  const sources = names && names.length ? ALL_SOURCES.filter((s) => names.includes(s.name)) : ALL_SOURCES;
  const started = new Date().toISOString();
  console.log(`[run-all] Starting scan at ${started} (${sources.map((s) => s.name).join(', ')})`);

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
  runAll(process.argv.slice(2)).then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
}

module.exports = { runAll };
