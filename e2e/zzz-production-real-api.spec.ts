import { test, expect, request, type APIRequestContext } from '@playwright/test';
import { readFileSync } from 'node:fs';
import type { OrderFields, OrderDetail } from '../src/api/orders';

const fixture = JSON.parse(readFileSync(new URL('./.real-api-fixture.json', import.meta.url), 'utf8')) as {
  origins: { admin: string; b2b: string }; root: { username: string; password: string };
  productionUser: { username: string; temporaryPassword: string }; operatorUser: { username: string; temporaryPassword: string };
};
const API = 'http://127.0.0.1:8789';
test('explicit frozen handoff, canonical Staff progress, RO/TR and responsive read-only UI', async ({ page }) => {
  test.setTimeout(120_000);
  page.on('pageerror', error => { throw error; });
  const admin = await request.newContext();
  const login = await admin.post(API + '/auth/login', { headers: { Origin: fixture.origins.admin }, data: fixture.root });
  expect(login.status()).toBe(200); const csrf = (await login.json()).csrfToken as string;
  const headers = () => ({ Origin: fixture.origins.admin, 'X-CSRF-Token': csrf, 'Idempotency-Key': crypto.randomUUID() });
  const companyResponse = await admin.post(API + '/b2b/companies', { headers: headers(), data: { legalName: 'Production Frozen Client', countryCode: 'RO', taxIdentifier: 'PROD-E2E-1' } });
  expect(companyResponse.status()).toBe(201); const companyId = (await companyResponse.json()).companyId as string;
  const fields: OrderFields = { companyId, currencyCode: 'EUR', contactId: null, billingAddressId: null, deliveryAddressId: null,
    customerReference: null, notes: 'Commercial note', productionNotes: 'Frozen workshop note', lines: ['curtain','drapery','other'].map(kind => ({
      id: null, kind: kind as 'curtain' | 'drapery' | 'other', productCode: `PROD-${kind}`, productName: null, variant: 'Wave', color: 'White', width: '200', height: '260',
      quantity: 4, meters: '13.5', pricingUnit: 'meter', unitPriceNet: '10.00', discountPercent: '0', vatPercent: '19', notes: 'Line snapshot', productionNotes: 'Workshop line',
    })) };
  const create = await admin.post(API + '/b2b/orders', { headers: headers(), data: fields }); expect(create.status()).toBe(201);
  let detail = (await create.json()).detail as OrderDetail; const id = detail.order.id;
  await page.goto('/'); await page.getByLabel('Nume utilizator').fill(fixture.productionUser.username);
  await page.getByLabel('Parolă', { exact: true }).fill(fixture.productionUser.temporaryPassword); await page.getByRole('button', { name: 'Intrare în cont' }).click();
  await page.getByLabel('Parola actuală').fill(fixture.productionUser.temporaryPassword);
  await page.getByLabel('Parola nouă', { exact: true }).fill('production sales permanent e2e 2026');
  await page.getByLabel('Confirmați parola nouă').fill('production sales permanent e2e 2026'); await page.getByRole('button', { name: 'Salvează parola' }).click();
  await expect(page.getByRole('heading', { name: 'Bun venit, Dana Producție.' })).toBeVisible();
  await page.goto(`/comenzi/${id}`);
  const card = page.locator('.production-card'); await expect(card).toContainText('Finalizați comanda');
  await expect(card.getByRole('button', { name: 'Trimite în producție', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Finalizează', exact: true }).click(); await page.getByRole('button', { name: 'Confirmă finalizarea' }).click();
  await expect(card.getByRole('button', { name: 'Trimite în producție', exact: true })).toBeVisible();
  detail = await (await admin.get(`${API}/b2b/orders/${id}`)).json(); const frozen = detail.order;
  expect((await (await admin.get(`${API}/b2b/orders/${id}/production`)).json()).production.submitted).toBe(false);
  const liveCompany = await (await admin.get(`${API}/b2b/companies/${companyId}`)).json();
  expect((await admin.post(`${API}/b2b/companies/${companyId}/deactivate`, { headers: headers(), data: { expectedVersion: liveCompany.company.version } })).status()).toBe(200);
  const account = await (await admin.get(`${API}/b2b/accounts/${companyId}`)).json();
  await card.getByRole('button', { name: 'Trimite în producție', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('anularea comercială nu mai este permisă');
  await page.setViewportSize({ width: 360, height: 780 });
  await expect(page.getByRole('dialog').getByRole('list')).toContainText('Metri total: 13.5');
  await expect(page.getByRole('dialog')).toContainText('Frozen workshop note');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Confirmă trimiterea' }).dblclick();
  await expect(card).toContainText('Trimisă în producție'); await expect(card).toContainText('Etapa 1 din 14');
  await expect(page.getByRole('button', { name: 'Anulează comanda' })).toHaveCount(0);
  expect((await (await admin.get(`${API}/b2b/accounts/${companyId}`)).json())).toEqual(account);
  const after = (await (await admin.get(`${API}/b2b/orders/${id}`)).json()).order;
  expect({ ...after, productionSubmitted: frozen.productionSubmitted }).toEqual(frozen);
  const operator = await request.newContext();
  const operatorLogin = await operator.post(API + '/auth/login', { headers: { Origin: fixture.origins.admin }, data: { username: fixture.operatorUser.username, password: fixture.operatorUser.temporaryPassword } });
  let operatorCsrf = (await operatorLogin.json()).csrfToken as string;
  const changed = await operator.post(API + '/auth/password', { headers: { Origin: fixture.origins.admin, 'X-CSRF-Token': operatorCsrf }, data: { currentPassword: fixture.operatorUser.temporaryPassword, newPassword: 'production operator permanent e2e 2026' } });
  expect(changed.status()).toBe(200); operatorCsrf = (await changed.json()).csrfToken;
  const global = `b2b:${id}`;
  const staff = await (await operator.get(`${API}/orders/${encodeURIComponent(global)}`)).json();
  expect(staff.source).toBe('b2b'); expect(staff.products).toHaveLength(3); expect(staff.productionContext.company.legalName).toBe('Production Frozen Client');
  expect(staff.products.map((p: { meters: number; quantity: number }) => [p.meters,p.quantity])).toEqual([[13.5,4],[13.5,4],[13.5,4]]);
  const mutate = async (context: APIRequestContext, action: string, version: number) => context.post(`${API}/orders/${encodeURIComponent(global)}/${action}`, { headers: { Origin: fixture.origins.admin, 'X-CSRF-Token': operatorCsrf, 'Idempotency-Key': crypto.randomUUID() }, data: { expectedVersion: version } });
  expect((await mutate(operator,'claim',1)).status()).toBe(200); expect((await mutate(operator,'transition',2)).status()).toBe(200);
  await card.getByRole('button', { name: 'Actualizează producția' }).click(); await expect(card).toContainText('Etapa 2 din 14');
  await expect(card).toContainText('Tăiere'); await page.reload(); await expect(page.locator('.production-card')).toContainText('Etapa 2 din 14');
  for (const width of [1440,768,390,360]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: test.info().outputPath(`production-ro-${width}.png`), fullPage: true });
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByRole('button', { name: 'TR — Türkçe', exact: true }).click();
  await expect(page.locator('.production-card')).toContainText('Kesim'); await expect(page.locator('.production-card')).toContainText('Aşama 2 / 14');
  await expect(page.locator('.production-card')).toContainText('İptal engellendi');
  await page.screenshot({ path: test.info().outputPath('production-tr-360-reduced-motion.png'), fullPage: true });
  await expect(page.locator('.production-card select, .production-card input')).toHaveCount(0);
  expect(await page.evaluate(() => Object.keys(localStorage).some(k => /token|session|csrf/i.test(k)))).toBe(false);
  await operator.dispose(); await admin.dispose();
});
