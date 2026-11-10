import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactElement } from 'react';
import { mapOrderDetail } from '../src/api/orders';
import { mapProduction, STAGES } from '../src/api/production';
import { I18nProvider } from '../src/i18n/context';
import { OrderConfirmation } from '../src/orders/OrderPage';
import { ProductionConfirmation, ProductionProgress } from '../src/production/ProductionCard';

// Synthetic data only. A historical typed order (created while order types were on) must not reveal its type or route
// once the server stops announcing `orderTypes` (B2B 0.10.2); with the feature on, everything stays as before.
const line = { id: '00000000-0000-4000-8000-000000000001', productCode: 'P1', productName: null, variant: null, color: null, kind: 'curtain', width: null, height: null, quantity: 1,
  meters: '6.5', pricingUnit: 'meter', unitPriceNet: '10.00', discountPercent: '0', vatPercent: '19', notes: null, productionNotes: null };
const totals = { net: '65.00', vat: '12.35', gross: '77.35' };
const actor = { id: 'e1', displayName: 'Synthetic Employee' };
const detail = mapOrderDetail({ order: { companyId: 'c1', currencyCode: 'RON', orderType: 'CUT_ONLY', contactId: null, billingAddressId: null, deliveryAddressId: null, notes: null,
  productionNotes: null, customerReference: null, lines: [line], id: 'o1', code: 'B2B-ORD-000001', status: 'finalized', version: 2, sourceOrderId: null,
  companySnapshot: { legalName: 'Synthetic Typed SRL' }, contactSnapshot: null, billingAddressSnapshot: null, deliveryAddressSnapshot: null,
  createdAt: '2026-11-10T08:00:00.000000Z', updatedAt: '2026-11-10T08:00:00.000000Z', finalizedAt: '2026-11-10T08:00:00.000000Z', cancelledAt: null,
  createdBy: actor, updatedBy: actor, finalizedBy: actor, calculation: { currencyCode: 'RON', lines: [{ totals: { baseNet: '65.00', discountNet: '0.00', ...totals } }], totals, complete: true },
  origin: null }, capabilities: { canView: true, canCreate: true, canUpdate: true, canFinalize: true, canCancel: true } });
const id = '00000000-0000-4000-8000-000000000002';
const short = mapProduction({ production: { submitted: true, orderCode: 'B2B-ORD-000001', operationalOrderId: `b2b:${id}`, submittedAt: '2026-10-05T00:00:00Z',
  stageChangedAt: '2026-10-05T00:00:00Z', completedAt: null, workflow: 'curtain-production@1', totalStages: 14, stage: { id: 'material-preparation', label: 'Pregătire material', ordinal: 2 },
  document: { status: 'active', revisionNumber: 1 }, orderType: 'CUT_ONLY', nextStage: { id: 'delivery', label: 'Livrare' }, stage2Completed: false, delivery: 'IN_PRODUCTION',
  route: { stages: ['waiting', 'material-preparation', 'delivery'], shortRoute: true, notApplicable: STAGES.slice(2, 13) } } });
assert.ok(short.submitted && short.route?.shortRoute);
const html = (element: ReactElement, locale: 'ro' | 'tr' = 'ro') => renderToStaticMarkup(<I18nProvider locale={locale}>{element}</I18nProvider>);
const noop = () => undefined;
const TYPE_TEXT = /Doar debitare|Yalnız Kesim|Pregătire material → Livrare|Malzeme Hazırlama → Teslimat|Tip comandă|Sipariş tipi/;

test('finalize and cancel dialogs show a historical order type only while orderTypes is announced', () => {
  for (const locale of ['ro', 'tr'] as const) for (const action of ['finalize', 'cancel'] as const) {
    const dialog = (orderTypes: boolean) => html(<OrderConfirmation detail={detail} action={action} orderTypes={orderTypes} busy={false} onConfirm={noop} onClose={noop} />, locale);
    assert.doesNotMatch(dialog(false), /confirm-order-type/, `${locale} ${action}: off`);
    assert.doesNotMatch(dialog(false), TYPE_TEXT, `${locale} ${action}: no type text`);
    assert.match(dialog(false), /B2B-ORD-000001/, 'the rest of the dialog stays');
    assert.match(dialog(true), /data-testid="confirm-order-type"/, `${locale} ${action}: on`);
  }
  assert.match(html(<OrderConfirmation detail={detail} action="finalize" orderTypes={true} busy={false} onConfirm={noop} onClose={noop} />), /Doar debitare/);
});

test('the production submission dialog hides the type and the route sentence while orderTypes is off', () => {
  for (const locale of ['ro', 'tr'] as const) {
    const dialog = (orderTypes: boolean, order = detail.order) => html(<ProductionConfirmation order={order} orderTypes={orderTypes} busy={false} error={null} onClose={noop} onConfirm={noop} />, locale);
    assert.doesNotMatch(dialog(false), /production-confirm-type|production-confirm-route/, `${locale}: off`);
    assert.doesNotMatch(dialog(false), TYPE_TEXT);
    assert.doesNotMatch(dialog(false), /Traseul este stabilit|Rota, kesinleştirmede/, `${locale}: no route sentence, also for an order without type`);
    assert.doesNotMatch(dialog(false, { ...detail.order, orderType: null }), /production-confirm-route/);
    assert.match(dialog(false), /B2B-ORD-000001/);
    assert.match(dialog(true), /data-testid="production-confirm-type"/, `${locale}: on`);
    assert.match(dialog(true), /data-testid="production-confirm-route"/);
  }
});

test('a historical short route keeps the canonical 14-stage progress while orderTypes is off', () => {
  assert.ok(short.submitted);
  for (const locale of ['ro', 'tr'] as const) {
    const off = html(<ProductionProgress production={short} orderTypes={false} />, locale);
    assert.match(off, /max="14"/, `${locale}: 14 stages`);
    assert.match(off, /value="2"/);
    assert.match(off, locale === 'ro' ? /Etapa 2 din 14/ : /Aşama 2 \/ 14/);
    assert.doesNotMatch(off, /traseului|Rotanın/);
    const on = html(<ProductionProgress production={short} orderTypes={true} />, locale);
    assert.match(on, /max="3"/, `${locale}: on, the short route counts its own steps`);
    assert.match(on, locale === 'ro' ? /Pasul 2 din 3 ai traseului/ : /Rotanın 3 adımından 2\./);
  }
  const full = mapProduction({ production: { ...(short as object), route: undefined, orderType: undefined, nextStage: undefined, stage2Completed: undefined, delivery: undefined } });
  assert.ok(full.submitted && full.route === null, 'API 2.66.0: no route');
  for (const orderTypes of [false, true]) assert.match(html(<ProductionProgress production={full} orderTypes={orderTypes} />), /Etapa 2 din 14/);
});
