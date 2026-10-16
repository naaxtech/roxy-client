// Reproduce the seed sign-in on the local release candidate and print what goes wrong.
const { chromium } = require('@playwright/test');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 412, height: 915 } });
  p.on('pageerror', (e) => console.log('PAGEERROR', e.message.slice(0, 200)));
  p.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('CONSOLE', m.type(), m.text().slice(0, 240)); });
  p.on('response', async (r) => {
    const u = r.url();
    if (u.includes('supabase.co') && r.status() >= 400) {
      let body = ''; try { body = (await r.text()).slice(0, 240); } catch {}
      console.log('HTTP', r.status(), r.request().method(), u.replace(/^https:\/\/[^/]+/, '').slice(0, 160), body);
    }
  });
  await p.goto('http://localhost:8091/');
  await p.waitForTimeout(4000);
  const already = p.getByTestId('already-have-account');
  if (await already.count()) await already.click();
  await p.getByTestId('auth-email-input').fill('e2e-playwright@seed.roxy.app').catch(() => p.getByPlaceholder('your@email.com').fill('e2e-playwright@seed.roxy.app'));
  await p.locator('input[type=password]').fill('e2e-playwright-pass-123');
  await p.getByTestId('auth-submit-btn').click();
  await p.waitForTimeout(12000);
  console.log('URL', p.url());
  console.log('NAVBAR', await p.getByTestId('nav-bar').count());
  await p.screenshot({ path: 'C:/Users/Admin/AppData/Local/hermes/cache/scratch/roxy-launch/repro-signin.png' });
  await b.close();
})();
