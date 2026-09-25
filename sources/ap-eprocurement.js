// Scraper for the Andhra Pradesh eProcurement portal's public tender listing.
//
// The portal blocks direct deep-links to TenderDetailsHome.html (session/security
// check), so every run must navigate through the same click-path from login.html
// first. The listing itself is a jQuery DataTable backed by a JSON endpoint
// (TenderDetailsHomeJson.html) whose response body is Base64-encoded JSON in the
// classic DataTables "aaData" array-of-arrays format:
//   [Department, TenderID, NoticeNumber, Category, NameOfWork, Value, StartDate, ClosingDate, ActionHtml]
//
// Only tenders that match at least one C-Soft product (see classify.js) are
// ingested — this is a lead-generation feed, not a mirror of the whole portal.

const { chromium } = require('playwright');
const { classify } = require('../classify');
const { ingestOpportunities, reportSourceHealth } = require('../ingest');

const SOURCE = 'ap_eprocurement';
const BASE_URL = 'https://tender.apeprocurement.gov.in/login.html';
const PAGE_SIZE = 200; // how many most-recent tenders to check each run

function decodeAaData(base64Body) {
  const json = JSON.parse(Buffer.from(base64Body, 'base64').toString('utf8'));
  return json.aaData || [];
}

function parseDate(ddmmyyyyWithTime) {
  const m = String(ddmmyyyyWithTime || '').match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (!m) return '';
  return `${m[3]}-${m[2]}-${m[1]}`;
}

function buildJsonUrl() {
  return 'https://tender.apeprocurement.gov.in/TenderDetailsHomeJson.html?nTenderID=&nDepartmentID=&subDeptId=&ddlDistrict=&ddlMandal=&biddingType=&sProcurementType=&mECVValue1=&mECVValue2=&dtBidClosingselect=&dtBidClosing1=&dtBidClosing2=&dtTenderOpening1=&dtTenderOpening2=&hdnSearch4=&hdnSearch=&hdncorrigendumsDetails=&hdncorrigendumsDetails1=&hdnnoSearch=&hdncorrigendumsDetails2=&hdnadvsearch=&hdnPreviousPage=&hdnIndentID=&hdnTenderCategory=&hdnProcurementID=&hdnType=current&hdnPreviousPge=TenderDetailsHome.html&hdnFromStatus=&typeOfWorkFromConsolidation=&popUPRequestParameter=&selectedCircleDivison=&selectedDepartmentID=&selectedProcurementType=&selectedTypeofWork=&aid=&hdnEncryptNames=hdnEncryptNames&hdnEncryptValues=hdnEncryptValues'
    + `&sEcho=1&iColumns=9&sColumns=%2C%2C%2C%2C%2C%2C%2C%2C&iDisplayStart=0&iDisplayLength=${PAGE_SIZE}`
    + '&mDataProp_0=0&bSortable_0=true&mDataProp_1=1&bSortable_1=true&mDataProp_2=2&bSortable_2=true'
    + '&mDataProp_3=3&bSortable_3=true&mDataProp_4=4&bSortable_4=true&mDataProp_5=5&bSortable_5=true'
    + '&mDataProp_6=6&bSortable_6=true&mDataProp_7=7&bSortable_7=true&mDataProp_8=8&bSortable_8=false'
    + `&iSortCol_0=6&sSortDir_0=desc&iSortingCols=1&_=${Date.now()}`;
}

async function run() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 1100 } });
  page.setDefaultTimeout(60000); // GitHub Actions' runners see noticeably higher latency to this portal than a machine on an Indian ISP

  let itemCount = 0;
  const opportunities = [];

  try {
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(1500);
    await page.evaluate(() => { const s = document.getElementById('splash'); if (s) s.remove(); });
    await page.waitForTimeout(500);
    await page.click('#viewCurrentall', { force: true });
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2000);

    const result = await page.evaluate(async (u) => {
      const res = await fetch(u, { credentials: 'include' });
      return { status: res.status, text: await res.text() };
    }, buildJsonUrl());

    if (result.status !== 200) throw new Error('Unexpected HTTP status ' + result.status);

    const rows = decodeAaData(result.text);
    itemCount = rows.length;
    if (!rows.length) throw new Error('Zero rows returned — page structure may have changed.');

    for (const row of rows) {
      const [department, tenderId, noticeNumber, category, nameOfWork, value, startDate, closingDate] = row;
      const match = classify(`${nameOfWork} ${noticeNumber}`);
      if (!match.matchedProducts.length) continue;

      opportunities.push({
        id: `ap_eprocurement-${tenderId}`,
        source: SOURCE,
        sourceType: 'government_tender',
        isGovernment: true,
        title: nameOfWork,
        description: `${noticeNumber} — ${category}`,
        organization: department,
        state: 'Andhra Pradesh',
        location: '',
        category: match.category,
        matchedProducts: match.matchedProducts,
        matchConfidence: match.confidence,
        estimatedValue: value,
        publishedDate: parseDate(startDate),
        deadlineDate: parseDate(closingDate),
        sourceUrl: BASE_URL,
        raw: { tenderId, noticeNumber, category },
      });
    }

    await reportSourceHealth({ source: SOURCE, url: BASE_URL, ok: true, itemCount });
  } catch (err) {
    await reportSourceHealth({ source: SOURCE, url: BASE_URL, ok: false, error: err.message });
    console.error(`[${SOURCE}] Error:`, err.message);
    await browser.close();
    return { error: err.message };
  }

  await browser.close();

  console.log(`[${SOURCE}] Checked ${itemCount} recent tenders, ${opportunities.length} matched a C-Soft product.`);
  const ingestResult = await ingestOpportunities(opportunities);
  console.log(`[${SOURCE}] Ingest result:`, JSON.stringify(ingestResult));
  return { itemCount, matched: opportunities.length, ingestResult };
}

if (require.main === module) {
  run().then((r) => console.log('Done:', JSON.stringify(r))).catch((e) => { console.error(e); process.exit(1); });
}

module.exports = { run };
