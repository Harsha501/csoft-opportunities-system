// Scraper for APRERA's public "Approved Projects" registry — real estate
// project registrations in Andhra Pradesh. Unlike CPPP/TSRERA, this page has
// NO CAPTCHA and no login requirement at all.
//
// Known limitation: pagination is classic ASP.NET GridView postback (no JSON
// API found), and the default view is NOT sorted newest-first — attempts to
// find a working "sort by Date of Approval desc" control did not turn one up.
// For now this scrapes the first few pages of the default view. Because
// ingestOpportunities() upserts by id and never resets status, re-scraping
// the same records on every run is safe (harmless no-op after the first run)
// rather than actively finding new listings daily. Revisit if a sort/filter
// mechanism is found, or if APRERA adds a "recently approved" view.
//
// Real estate registrations don't carry scope-of-work language the way tender
// titles do, so classify.js's keyword matching mostly won't fire on a bare
// project name. Every registered project is still a plausible structural/CAD
// software prospect (any building needs structural design), so this source
// applies a baseline classification (STAAD.Pro + AutoCAD, low confidence)
// in addition to whatever classify() finds from the project name/type text.

const { chromium } = require('playwright');
const { classify } = require('../classify');
const { ingestOpportunities, reportSourceHealth } = require('../ingest');

const SOURCE = 'aprera';
const BASE_URL = 'https://rera.ap.gov.in/RERA/Views/Reports/ApprovedProjects.aspx';
const PAGES_TO_SCAN = 5; // 5 pages x 20 rows = 100 most-recently-loaded projects

function parseRow(cells) {
  // [S.No, Registration ID, Project Name, Place, Project Type, Status, Date of Approval, Expected Completion]
  return {
    regId: cells[1],
    projectName: cells[2],
    place: cells[3],
    projectType: cells[4],
    status: cells[5],
    approvalDate: cells[6],
    expectedCompletion: cells[7],
  };
}

function parseDate(ddmmyyyy) {
  const m = String(ddmmyyyy || '').match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (!m) return '';
  return `${m[3]}-${m[2]}-${m[1]}`;
}

async function run() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 1300 } });
  page.setDefaultTimeout(45000);

  let itemCount = 0;
  const opportunities = [];

  try {
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(2500);

    for (let p = 0; p < PAGES_TO_SCAN; p++) {
      const rows = await page.evaluate(() => {
        const table = document.getElementById('ContentPlaceHolder1_gvApprovedProject');
        if (!table) return null;
        return Array.from(table.querySelectorAll('tr')).slice(1).map((tr) =>
          Array.from(tr.querySelectorAll('td')).map((td) => td.textContent.trim())
        );
      });
      if (!rows) throw new Error('Approved-projects table not found — page structure may have changed.');

      for (const cells of rows) {
        if (cells.length < 8) continue;
        const row = parseRow(cells);
        itemCount++;

        const textMatch = classify(`${row.projectName} ${row.projectType} ${row.place}`);
        const matchedProducts = new Set(textMatch.matchedProducts);
        matchedProducts.add('STAAD.Pro');
        matchedProducts.add('AutoCAD');

        opportunities.push({
          id: `aprera-${row.regId}`,
          source: SOURCE,
          sourceType: 'real_estate_registration',
          isGovernment: false,
          title: row.projectName,
          description: `${row.projectType} project — status: ${row.status}`,
          organization: '',
          state: 'Andhra Pradesh',
          location: row.place,
          category: textMatch.category || 'Real Estate Development',
          matchedProducts: Array.from(matchedProducts),
          matchConfidence: textMatch.confidence !== 'none' ? textMatch.confidence : 'low',
          estimatedValue: '',
          publishedDate: parseDate(row.approvalDate),
          deadlineDate: parseDate(row.expectedCompletion),
          sourceUrl: BASE_URL,
          raw: { regId: row.regId, status: row.status },
        });
      }

      if (p < PAGES_TO_SCAN - 1) {
        const nextLink = await page.$('a:has-text("Next")');
        if (!nextLink) break;
        await nextLink.click();
        await page.waitForTimeout(2000);
      }
    }

    await reportSourceHealth({ source: SOURCE, url: BASE_URL, ok: true, itemCount });
  } catch (err) {
    await reportSourceHealth({ source: SOURCE, url: BASE_URL, ok: false, error: err.message });
    console.error(`[${SOURCE}] Error:`, err.message);
    await browser.close();
    return { error: err.message };
  }

  await browser.close();

  console.log(`[${SOURCE}] Checked ${itemCount} registered projects, ${opportunities.length} recorded.`);
  const ingestResult = await ingestOpportunities(opportunities);
  console.log(`[${SOURCE}] Ingest result:`, JSON.stringify(ingestResult));
  return { itemCount, matched: opportunities.length, ingestResult };
}

if (require.main === module) {
  run().then((r) => console.log('Done:', JSON.stringify(r))).catch((e) => { console.error(e); process.exit(1); });
}

module.exports = { run };
