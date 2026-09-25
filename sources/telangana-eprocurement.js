// Scraper for the Telangana eProcurement portal's public tender listing.
// Same underlying platform as AP eProcurement (same click-path, same
// TenderDetailsHomeJson.html DataTables endpoint) — see ap-eprocurement.js
// for the detailed platform notes. One real difference: Telangana's instance
// returns PLAIN JSON directly (Content-Type: application/json), not the
// Base64-wrapped body AP's instance uses — confirmed by inspecting the raw
// response bytes, which decode as ASCII '{"iTotalRecords":-1,"aaData":[...'.

const { chromium } = require('playwright');
const { classify } = require('../classify');
const { ingestOpportunities, reportSourceHealth } = require('../ingest');

const SOURCE = 'telangana_eprocurement';
const BASE_URL = 'https://tender.telangana.gov.in/login.html';
const PAGE_SIZE = 200;

function decodeAaData(rawBody) {
  const json = JSON.parse(rawBody);
  return json.aaData || [];
}

function parseDate(ddmmyyyyWithTime) {
  const m = String(ddmmyyyyWithTime || '').match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (!m) return '';
  return `${m[3]}-${m[2]}-${m[1]}`;
}

function buildJsonUrl() {
  return 'https://tender.telangana.gov.in/TenderDetailsHomeJson.html?nTenderID=&nDepartmentID=&subDeptId=&ddlDistrict=&ddlMandal=&biddingType=&sProcurementType=&mECVValue1=&mECVValue2=&dtBidClosingselect=&dtBidClosing1=&dtBidClosing2=&dtTenderOpening1=&dtTenderOpening2=&hdnSearch4=&hdnSearch=&hdncorrigendumsDetails=&hdncorrigendumsDetails1=&hdnnoSearch=&hdncorrigendumsDetails2=&hdnadvsearch=&hdnPreviousPage=&hdnIndentID=&hdnTenderCategory=&hdnProcurementID=&hdnType=current&hdnPreviousPge=TenderDetailsHome.html&hdnFromStatus=&typeOfWorkFromConsolidation=&popUPRequestParameter=&selectedCircleDivison=&selectedDepartmentID=&selectedProcurementType=&selectedTypeofWork=&aid=&hdnEncryptNames=hdnEncryptNames&hdnEncryptValues=hdnEncryptValues'
    + `&sEcho=1&iColumns=9&sColumns=%2C%2C%2C%2C%2C%2C%2C%2C&iDisplayStart=0&iDisplayLength=${PAGE_SIZE}`
    + '&mDataProp_0=0&bSortable_0=true&mDataProp_1=1&bSortable_1=true&mDataProp_2=2&bSortable_2=true'
    + '&mDataProp_3=3&bSortable_3=true&mDataProp_4=4&bSortable_4=true&mDataProp_5=5&bSortable_5=true'
    + '&mDataProp_6=6&bSortable_6=true&mDataProp_7=7&bSortable_7=true&mDataProp_8=8&bSortable_8=false'
    + `&iSortCol_0=6&sSortDir_0=desc&iSortingCols=1&_=${Date.now()}`;
}

async function run() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 1100 } });
  page.setDefaultTimeout(60000);

  let itemCount = 0;
  const opportunities = [];

  try {
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(2000);
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
        id: `telangana_eprocurement-${tenderId}`,
        source: SOURCE,
        sourceType: 'government_tender',
        isGovernment: true,
        title: nameOfWork,
        description: `${noticeNumber} — ${category}`,
        organization: department,
        state: 'Telangana',
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
