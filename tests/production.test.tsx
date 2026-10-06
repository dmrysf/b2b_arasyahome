import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { createApi } from '../src/api/client';
import { mapProduction, PRODUCTION_PERMISSIONS, STAGES } from '../src/api/production';
import { ProductionCard } from '../src/production/ProductionCard';
import { I18nProvider } from '../src/i18n/context';
import { stagesTr } from '../src/production/messages';
import { fakeFetch, sessionPayload, API, accessPayload } from './support';
import type { Order } from '../src/api/orders';

const id = '00000000-0000-4000-8000-000000000001';
const production = { submitted: true, orderCode: 'B2B-ORD-000001', operationalOrderId: `b2b:${id}`,
  submittedAt: '2026-10-05T00:00:00Z', stageChangedAt: '2026-10-05T00:00:00Z', completedAt: null,
  workflow: 'curtain-production@1', totalStages: 14, stage: { id: 'waiting', label: 'În așteptare', ordinal: 1 },
  document: { status: 'active', revisionNumber: 1 } };
test('production mapping fails closed on invalid stage identity, ordering, workflow and dates', () => {
  assert.deepEqual(mapProduction({ production }), production);
  assert.deepEqual(mapProduction({ production: { submitted: false, orderCode: production.orderCode } }), { submitted: false, orderCode: production.orderCode });
  for (const delta of [{ submitted: 'true' }, { workflow: 'other@1' }, { totalStages: 15 }, { submittedAt: 'yesterday' }, { completedAt: 3 },
    { operationalOrderId: 'trendhome:42' }, { stage: { id: 'waiting', label: 'Waiting', ordinal: 2 } }, { stage: { id: 'invented', label: 'X', ordinal: 1 } }]) {
    assert.throws(() => mapProduction({ production: { ...production, ...delta } }), /INVALID_RESPONSE/);
  }
  assert.deepEqual(Object.keys(stagesTr), [...STAGES]);
  // The central document state is optional (older API) and never invented.
  const legacy = { ...production } as Record<string, unknown>; delete legacy.document;
  assert.equal((mapProduction({ production: legacy }) as { document: unknown }).document, null);
  assert.deepEqual((mapProduction({ production: { ...production, document: { status: 'stale', revisionNumber: 2, customer: 'x' } } }) as { document: unknown }).document, { status: 'stale', revisionNumber: 2 });
});
test('the workshop download is the canonical ticket: a POST with CSRF and one idempotency key per print', async () => {
  const fake = fakeFetch(c => ({ body: c.url.pathname.endsWith('/production-sheet.pdf') ? '%PDF-1.4' : c.url.pathname === '/auth/session' ? sessionPayload() : accessPayload({ permissions: [...PRODUCTION_PERMISSIONS] }) }));
  const api = createApi(API, fake.fetchImpl); await api.getSession();
  await api.productionSheetFile(id, 'print-key-0123456789');
  const call = fake.calls.find(c => c.url.pathname.endsWith('/production-sheet.pdf'))!;
  assert.equal(call.method, 'POST');
  assert.equal(call.headers['Idempotency-Key'], 'print-key-0123456789');
  assert.ok(call.headers['X-CSRF-Token']);
  assert.deepEqual(call.body, { reason: null });
  assert.equal(call.url.search, '');
});
test('the API has only one read and one explicit authenticated production mutation', async () => {
  const fake = fakeFetch(c => ({ body: c.url.pathname === '/auth/session' ? sessionPayload() : c.url.pathname === '/b2b/access'
    ? accessPayload({ permissions: [...PRODUCTION_PERMISSIONS, 'unknown'] }) : { production } }));
  const api = createApi(API, fake.fetchImpl); await api.getSession();
  assert.deepEqual((await api.access()).permissions, [...PRODUCTION_PERMISSIONS]);
  await api.getProduction(id); assert.equal(fake.calls.at(-1)!.method, 'GET');
  await api.submitProduction(id, 3, { idempotencyKey: 'same-production-intent' });
  const c = fake.calls.at(-1)!;
  assert.equal(c.url.pathname, `/b2b/orders/${id}/production`); assert.equal(c.method, 'POST');
  assert.deepEqual(c.body, { expectedVersion: 3 }); assert.equal(c.headers['X-CSRF-Token'], 'csrf-token-1');
  assert.equal(c.headers['Idempotency-Key'], 'same-production-intent');
});
test('production CTA requires finalized order plus narrow submit permission; never exposes stage controls', () => {
  const order = { id, code: production.orderCode, status: 'finalized', version: 3, lines: [], companySnapshot: { legalName: 'Client' } } as unknown as Order;
  const api = createApi(API);
  const render = (status: Order['status'], canSubmit: boolean, submitted = false, locale: 'ro' | 'tr' = 'ro') => renderToStaticMarkup(
    <I18nProvider locale={locale}><ProductionCard api={api} order={{ ...order, status, productionSubmitted: submitted }} capabilities={{ canView: false, canSubmit }} disabled={false} onSubmitted={() => undefined} /></I18nProvider>);
  assert.match(render('finalized', true), />Trimite în producție</);
  assert.match(render('finalized', true, false, 'tr'), />Üretime gönder</);
  for (const html of [render('draft', true), render('cancelled', true), render('finalized', false), render('finalized', true, true)]) assert.doesNotMatch(html, />Trimite în producție</);
  assert.match(render('finalized', true, true), /Anularea este blocată/);
  assert.doesNotMatch(render('finalized', true), /<select|claim|complete_stage|advance_stage/);
});
