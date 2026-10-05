import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createApi } from '../src/api/client';
import { mapCalculation, mapOrderDetail, ORDER_PERMISSIONS, type LineInput } from '../src/api/orders';
import { emptyLine, emptyOrder, orderFields, currencyLocked, LatestCalculation } from '../src/orders/model';
import { fakeFetch, sessionPayload, API, accessPayload } from './support';

const line: LineInput = { id:'00000000-0000-4000-8000-000000000001',productCode: 'P1', productName: null, variant: null, color: null, kind: 'curtain', width: null, height: null, quantity: 4, meters: '13.5', pricingUnit: 'meter', unitPriceNet: '10.00', discountPercent: '0', vatPercent: '19', notes: null,productionNotes:null };
const totals = { net: '135.00', vat: '25.65', gross: '160.65' };
const calculation = { currencyCode: 'EUR', lines: [{ totals: { baseNet: '135.00', discountNet: '0.00', ...totals } }], totals, complete: true };
const capabilities = { canView: true, canCreate: true, canUpdate: true, canFinalize: true,canCancel:true };
const order = { companyId: 'company-1', currencyCode: 'EUR', contactId: null, billingAddressId: null, deliveryAddressId: null, notes: null, productionNotes:null, customerReference:null, lines: [line], id: 'order-1', code: 'B2BO-000001', status: 'draft', version: 1, sourceOrderId: null, companySnapshot: { legalName: 'Client SRL', displayName: null, countryCode: 'RO', taxIdentifier: '1', vatNumber: null, companyCode: 'B2B-000001' }, contactSnapshot: null, billingAddressSnapshot: null, deliveryAddressSnapshot: null, createdAt: '2026-10-05T00:00:00Z', updatedAt: '2026-10-05T00:00:00Z', finalizedAt: null, cancelledAt:null, createdBy: { id: '1', displayName: 'E' }, updatedBy: { id: '1', displayName: 'E' }, finalizedBy: null, calculation };

test('strict order mapping preserves exact string amounts and rejects missing or floating decimals', () => {
 assert.deepEqual(mapCalculation(calculation), calculation);
 assert.equal(mapOrderDetail({ order, capabilities }).order.lines[0].meters, '13.5');
 for (const invalid of [{ ...calculation, totals: { ...totals, net: 135 } }, { ...calculation, currencyCode: 'USD' }, { ...calculation, complete: 'true' }, { ...calculation, totals: { net: '135.00' } }]) assert.throws(() => mapCalculation(invalid), /INVALID_RESPONSE/);
 assert.throws(() => mapOrderDetail({ order: { ...order, lines: [{ ...line, vatPercent: 19 }] }, capabilities }), /INVALID_RESPONSE/);
});

test('submission normalizes comma decimals without changing physical quantity or deriving meters', () => {
 const fields = orderFields({ ...emptyOrder('c'), lines: [{ ...emptyLine(), quantity: '4', meters: '13,5', unitPriceNet: '10,00', width: '50,123', discountPercent: '0,05', vatPercent: '' }] });
 assert.equal(fields.lines[0].quantity, 4); assert.equal(fields.lines[0].meters, '13.5'); assert.equal(fields.lines[0].unitPriceNet, '10.00'); assert.equal(fields.lines[0].width, '50.123'); assert.equal(fields.lines[0].vatPercent, null);
 assert.equal(currencyLocked(fields.lines, []), true);
 assert.equal(currencyLocked([{ ...line, unitPriceNet: null }], [{ ...line, unitPriceNet: '0.00' }]), true);
 assert.equal(currencyLocked([], []), false);
});

test('a stale calculation cannot replace newer totals, including invalid newer input', () => {
 const latest = new LatestCalculation(); const old = latest.begin(); const current = latest.begin();
 assert.equal(latest.accept(old), false); assert.equal(latest.accept(current), true); latest.begin(); assert.equal(latest.accept(current), false);
});

test('all order endpoints use canonical envelopes and authenticated mutation headers', async () => {
 const fake = fakeFetch(c => ({ body: c.url.pathname === '/auth/session' ? sessionPayload() : c.url.pathname === '/b2b/access' ? accessPayload({ permissions: [...ORDER_PERMISSIONS, 'unknown'] }) : c.url.pathname.endsWith('/calculate') ? calculation : c.url.pathname.endsWith('/activity') ? {items: [],nextCursor:null} : c.method === 'GET' ? c.url.pathname === '/b2b/orders' ? {items:[], nextCursor:null,capabilities} : {order, capabilities} : {orderId:order.id,detail:{order,capabilities}} }));
 const api = createApi(API, fake.fetchImpl); await api.getSession(); assert.deepEqual((await api.access()).permissions, [...ORDER_PERMISSIONS]);
 await api.listOrders({companyId:'c',status:'draft',search:' abc ',limit:25,cursor:'next'});
 assert.deepEqual(Object.fromEntries(fake.calls.at(-1)!.url.searchParams),{companyId:'c',search:'abc',status:'draft',limit:'25',cursor:'next'});
 const fields = orderFields(emptyOrder('c'));
 await api.calculateOrder({currencyCode:'EUR',lines:[line as never]}); assert.equal(fake.calls.at(-1)!.headers['X-CSRF-Token'],'csrf-token-1');
 await api.createOrder(fields,{idempotencyKey:'same-order-intent-1'}); assert.equal(fake.calls.at(-1)!.headers['Idempotency-Key'],'same-order-intent-1');
 await api.updateOrder('id',fields,3,{idempotencyKey:'same-order-intent-2'}); assert.deepEqual(fake.calls.at(-1)!.body,{...fields,expectedVersion:3});
 for (const action of ['finalizeOrder','cancelOrder','duplicateOrder'] as const) { await api[action]('id',3,{idempotencyKey:'same-order-intent-3'}); assert.deepEqual(fake.calls.at(-1)!.body,{expectedVersion:3}); }
 await api.createOrderLine('id',line,3,{idempotencyKey:'same-line-intent-1'});
 assert.deepEqual(fake.calls.at(-1)!.body,{...line,id:null,expectedVersion:3});
 await api.updateOrderLine('id',line.id!,line,4,{idempotencyKey:'same-line-intent-2'});
 assert.deepEqual(fake.calls.at(-1)!.body,{...line,expectedVersion:4});
 for(const action of ['duplicateOrderLine','removeOrderLine'] as const) {
  await api[action]('id',line.id!,5,{idempotencyKey:'same-line-intent-3'});
  assert.deepEqual(fake.calls.at(-1)!.body,{expectedVersion:5});
 }
 await api.reorderOrderLines('id',[line.id!],6,{idempotencyKey:'same-line-intent-4'});
 assert.deepEqual(fake.calls.at(-1)!.body,{lineIds:[line.id],expectedVersion:6});
 await api.orderActivity('id');
});
