const { boot, finish } = require('./lib.cjs');
(async () => {
  const S = await boot();
  console.log('server up:', S.base, S.dir);
  let code = 1;
  try {
    await require('./http.cjs')(S);
    if (process.env.BROWSER !== '0') await require('./browser.cjs')(S);
    await require('./ops.cjs')(S);
    await require('./report.cjs')(S);
  } catch (e) { console.error('RUNNER ERROR', e); }
  finally { code = finish(); S.stop(); }
  process.exit(code ? 1 : 0);
})();
