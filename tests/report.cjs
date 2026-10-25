// Requests Excel report: exact numbers on fixed fixtures (own temporary database), plus the downloaded file.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { group, test, assert, eq, has, Client, unzip, sheetRows } = require('./lib.cjs');

module.exports = async (S) => {
  group('Requests report (Excel) · تقرير الطلبات');

  // fixtures in a separate DATA_DIR so the numbers are exact
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'smv-report-'));
  const { run } = await import(pathToFileURL(path.resolve(__dirname, '../src/db.js')).href);
  const { requestReport } = await import(pathToFileURL(path.resolve(__dirname, '../src/admin/requests.js')).href);
  const add = (code, kind, created, { sentAfterH = null, decision = null, status = 'new' } = {}) => run(
    `INSERT INTO requests(code,kind,name,phone,status,decision,created_at,quote_sent_at) VALUES(?,?,?,?,?,?,?, CASE WHEN ? IS NULL THEN NULL ELSE datetime(?, '+' || ? || ' hours') END)`,
    code, kind, 'x', '0500000000', status, decision, created, sentAfterH, created, sentAfterH);
  add('A', 'quote', '2026-08-31 22:00:00', { sentAfterH: 24, decision: 'accept', status: 'accepted' }); // 01:00 on 1 Sep in Riyadh → September
  add('B', 'catering', '2026-09-10 10:00:00', { sentAfterH: 48, decision: 'reject', status: 'rejected' });
  add('C', 'quote', '2026-09-15 08:00:00', { sentAfterH: 12, status: 'quoted' }); // awaiting the customer
  add('D', 'quote', '2026-10-01 09:00:00');
  add('E', 'contact', '2026-10-02 09:00:00'); // contact-form message: not in the report
  add('F', 'quote', '2026-10-03 09:00:00', { sentAfterH: 6, decision: 'accept', status: 'confirmed' });

  await test('per month in Riyadh time: counts, acceptance rate (accepted ÷ decided) and average hours to send the quote', async () => {
    const { months, total } = requestReport();
    eq(JSON.stringify(months.map((m) => m.m)), JSON.stringify(['2026-09', '2026-10']), 'months');
    const [sep, oct] = months;
    eq(JSON.stringify([sep.n, sep.q, sep.c, sep.sent, sep.acc, sep.rej, sep.pend, sep.rate, sep.hrs]), JSON.stringify([3, 2, 1, 3, 1, 1, 1, 0.5, 28]));
    eq(JSON.stringify([oct.n, oct.q, oct.c, oct.sent, oct.acc, oct.rej, oct.pend, oct.rate, oct.hrs]), JSON.stringify([2, 2, 0, 1, 1, 0, 0, 1, 6]));
    eq(JSON.stringify([total.n, total.sent, total.acc, total.rej, total.pend, total.hrs]), JSON.stringify([5, 4, 2, 1, 1, 22.5])); eq(total.rate.toFixed(4), (2 / 3).toFixed(4));
  });
  await test('month filter (from/to) and an empty period', async () => {
    eq(JSON.stringify(requestReport({ from: '2026-10' }).months.map((m) => m.m)), JSON.stringify(['2026-10']));
    eq(JSON.stringify(requestReport({ to: '2026-09' }).months.map((m) => m.m)), JSON.stringify(['2026-09']));
    const e = requestReport({ from: '2030-01' }); eq(e.months.length, 0); eq(e.total.n, 0); eq(e.total.rate, null);
    eq(requestReport({ from: "2026-10' OR 1=1 --" }).total.n, 5, 'bad filter ignored, not injected');
  });

  await test('download from the requests page: valid .xlsx, right-to-left, summary + monthly sheet with a totals row', async () => {
    const owner = new Client(S.base); owner.rotate(); await owner.fullLogin('owner@test.local', process.env.BROWSER === '0' ? 'Test-Pass-12345' : 'New-Pass-1234567');
    has((await owner.get('/admin/requests')).text, 'action="/admin/requests/report.xlsx"');
    const r = await fetch(S.base + '/admin/requests/report.xlsx', { headers: { cookie: owner._cookies(), 'x-forwarded-for': owner.ip } });
    eq(r.status, 200); has(r.headers.get('content-type'), 'spreadsheetml.sheet'); has(r.headers.get('content-disposition'), '.xlsx');
    const z = unzip(Buffer.from(await r.arrayBuffer()));
    for (const f of ['[Content_Types].xml', 'xl/workbook.xml', 'xl/styles.xml', 'xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml']) assert(z.has(f), 'missing ' + f);
    has(z.get('xl/workbook.xml').toString(), 'name="حسب الشهر"');
    const xml = z.get('xl/worksheets/sheet2.xml').toString(); has(xml, 'rightToLeft="1"');
    const rows = sheetRows(xml); eq(rows[0][0], 'الشهر'); eq(rows[0][8], 'نسبة القبول');
    const tot = rows.at(-1); eq(tot[0], 'الإجمالي');
    assert(tot[1] >= 2, 'total requests'); assert(tot[5] >= 1, 'accepted (the HTTP suite accepts one quote)');
    assert(tot[8] > 0 && tot[8] <= 1, 'rate is a fraction'); assert(typeof tot[9] === 'number' && tot[9] >= 0, 'average hours');
    const summary = sheetRows(z.get('xl/worksheets/sheet1.xml').toString()); assert(summary.some((x) => x[0] === 'نسبة القبول'), 'summary rate row');
  });
  await test('report needs the requests permission (editor gets 403)', async () => {
    const ed = new Client(S.base); ed.rotate(); await ed.login('editor@test.local', 'Role-Pass-123456');
    eq((await ed.get('/admin/requests/report.xlsx')).status, 403);
  });
};
