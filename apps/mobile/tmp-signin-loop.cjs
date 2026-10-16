// Sign in N times with fresh contexts; record failures, Supabase HTTP >= 400 and console errors.
const { chromium } = require('@playwright/test');
const BASE = process.env.BASE || 'http://localhost:8092';
(async () => {
  const b = await chromium.launch();
  for (let i = 1; i <= 6; i++) {
    const ctx = await b.newContext({ viewport: { width: 412, height: 915 } });
    const p = await ctx.newPage();
    const log = [];
    p.on('pageerror', (e) => log.push('PAGEERROR ' + e.message.slice(0, 160)));
    p.on('console', (m) => { if (m.type() === 'error') log.push('CONSOLE ' + m.text().slice(0, 200)); });
    p.on('response', async (r) => {
      const u = r.url();
      if (u.includes('supabase.co') && (r.status() >= 400 || u.includes('/auth/v1/token'))) {
        let body = ''; try { body = (await r.text()).slice(0, 160); } catch {}
        log.push(`HTTP ${r.status()} ${r.request().method()} ${u.replace(/^https:\/\/[^/]+/, '').split('?')[0]} ${r.status() >= 400 ? body : ''}`);
      }
    });
    const t0 = Date.now();
    await p.goto(BASE + '/');
    await p.getByTestId('already-have-account').click({ timeout: 60000 });
    await p.getByTestId('email-input').fill('e2e-playwright@seed.roxy.app');
    await p.getByTestId('password-input').fill('e2e-playwright-pass-123');
    await p.getByTestId('auth-submit-btn').click();
    let ok = true;
    try { await p.getByTestId('nav-bar').waitFor({ timeout: 30000 }); } catch { ok = false; }
    console.log(`#${i} ${ok ? 'OK' : 'FAIL'} ${Date.now() - t0}ms url=${p.url().replace(BASE, '')}`);
    if (!ok) {
      for (const l of log) console.log('   ', l);
      const txt = (await p.locator('body').innerText()).replace(/\s+/g, ' ').slice(0, 300);
      console.log('    BODY', txt);
      await p.screenshot({ path: `C:/Users/Admin/AppData/Local/hermes/cache/scratch/roxy-launch/signin-fail-${i}.png` });
    } else {
      for (const l of log.filter((x) => !x.startsWith('HTTP 200'))) console.log('   ', l);
    }
    await ctx.close();
  }
  await b.close();
})();
