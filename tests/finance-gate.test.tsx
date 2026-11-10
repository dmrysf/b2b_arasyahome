import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { mapOrderDetail, type Order } from '../src/api/orders';
import { ApiError } from '../src/api/errors';
import { createTranslator, MESSAGES } from '../src/i18n';
import { I18nProvider } from '../src/i18n/context';
import { FinancePanel } from '../src/orders/FinancePanel';

// Synthetic data only. The gate is decided by the server (Operations API 2.67.0); the browser only explains it.
const line = { id: '00000000-0000-4000-8000-000000000001', productCode: 'P1', productName: null, variant: null, color: null, kind: 'curtain', width: null, height: null, quantity: 1,
  meters: '6.5', pricingUnit: 'meter', unitPriceNet: '10.00', discountPercent: '0', vatPercent: '19', notes: null, productionNotes: null };
const totals = { net: '65.00', vat: '12.35', gross: '77.35' };
const actor = { id: 'e1', displayName: 'Synthetic Employee' };
const base = { companyId: 'c1', currencyCode: 'RON', orderType: 'CUT_ONLY', contactId: null, billingAddressId: null, deliveryAddressId: null, notes: null, productionNotes: null, customerReference: null,
  lines: [line], id: 'o1', code: 'B2BO-000001', status: 'draft', version: 1, sourceOrderId: null, companySnapshot: {}, contactSnapshot: null, billingAddressSnapshot: null, deliveryAddressSnapshot: null,
  createdAt: '2026-11-10T08:00:00.000000Z', updatedAt: '2026-11-10T08:00:00.000000Z', finalizedAt: null, cancelledAt: null, createdBy: actor, updatedBy: actor, finalizedBy: null,
  calculation: { currencyCode: 'RON', lines: [{ totals: { baseNet: '65.00', discountNet: '0.00', ...totals } }], totals, complete: true }, origin: null };
const capabilities = { canView: true, canCreate: true, canUpdate: true, canFinalize: true, canCancel: true };
const map = (extra: Record<string, unknown>): Order => mapOrderDetail({ order: { ...base, ...extra }, capabilities }).order;
const gate = (preview: unknown, modes: [string | null, string | null] = ['enforce', 'enforce'], configured = true) => ({ configured, finalizationMode: modes[0], releaseMode: modes[1], preview });
const render = (order: Order, locale: 'ro' | 'tr' = 'ro', enabled = true) => renderToStaticMarkup(<I18nProvider locale={locale}><FinancePanel order={order} enabled={enabled} /></I18nProvider>);
const REASONS = ['IDENTITY_NOT_VERIFIED', 'ACCOUNT_NOT_RECONCILED', 'CURRENCY_ISSUE_OPEN', 'RISK_NOT_ASSIGNED', 'RISK_RED', 'NO_APPROVED_LIMIT', 'LIMIT_EXPIRED', 'LIMIT_SUSPENDED',
  'LIMIT_NOT_YET_EFFECTIVE', 'LIMIT_ZERO', 'LIMIT_CURRENCY_MISMATCH', 'CREDIT_REVIEW_REQUIRED', 'NO_AVAILABLE_CREDIT', 'ORDER_CURRENCY_MISMATCH', 'CREDIT_LIMIT_EXCEEDED'];

test('the gate state is mapped strictly; an older API has none; amounts of a snapshot are never mapped', () => {
  assert.equal(map({}).financeGate, null, 'an API before 2.67.0 sends no gate');
  const order = map({ financeGate: gate({ phase: 'finalization', mode: 'enforce', outcome: 'BLOCKED', reasons: ['RISK_RED'] }),
    financeDecision: { mode: 'enforce', phase: 'finalization', outcome: 'ALLOWED', reasons: [], decidedAt: '2026-11-10 08:00:00.000000', profile: { approvedCreditLimit: '100.00', currentExposure: '0.00', availableCredit: '100.00' } },
    financeReleaseDecision: { mode: 'shadow', phase: 'production_submission', outcome: 'WOULD_BLOCK', reasons: ['NO_APPROVED_LIMIT'], changedSinceFinalization: ['creditLimitStatus'], grandfathered: false } });
  assert.deepEqual(order.financeGate, { configured: true, finalizationMode: 'enforce', releaseMode: 'enforce', preview: { phase: 'finalization', mode: 'enforce', outcome: 'BLOCKED', reasons: ['RISK_RED'] } });
  assert.deepEqual(order.financeDecision, { mode: 'enforce', outcome: 'ALLOWED', reasons: [], phase: 'finalization', changedSinceFinalization: [], grandfathered: false });
  assert.doesNotMatch(JSON.stringify(order), /100\.00|availableCredit|currentExposure|approvedCreditLimit/, 'no limit or exposure amount reaches the screen model');
  assert.deepEqual(order.financeReleaseDecision?.changedSinceFinalization, ['creditLimitStatus']);
  assert.deepEqual(map({ financeGate: gate({ phase: null, mode: null, outcome: 'CONFIGURATION_INVALID', reasons: [] }, [null, null], false) }).financeGate?.configured, false);
  for (const bad of [gate({ phase: 'finalization', mode: 'enforced', outcome: 'ALLOWED', reasons: [] }), gate({ phase: 'shipping', mode: 'enforce', outcome: 'ALLOWED', reasons: [] }),
    gate({ phase: 'finalization', mode: 'enforce', outcome: 'MAYBE', reasons: [] }), gate({ phase: 'finalization', mode: 'enforce', outcome: 'BLOCKED', reasons: [7] }),
    gate(null, ['on', 'enforce']), { ...gate(null), configured: 'yes' }]) {
    assert.throws(() => map({ financeGate: bad }), /INVALID_RESPONSE/);
  }
  assert.throws(() => map({ financeDecision: { mode: 'enforce', outcome: 'APPROVED', reasons: [] } }), /INVALID_RESPONSE/, 'an unknown outcome is never shown as allowed');
});

test('every server reason has a Romanian and a Turkish text, and both languages hold the same keys', () => {
  const ro = MESSAGES.ro.orders.finance, tr = MESSAGES.tr.orders.finance;
  const keys = (value: unknown): string[] => value && typeof value === 'object' ? Object.entries(value).flatMap(([k, v]) => [k, ...keys(v).map(inner => `${k}.${inner}`)]) : [];
  assert.deepEqual(keys(tr), keys(ro));
  assert.deepEqual(Object.keys(ro.reasons), REASONS);
  for (const messages of [ro, tr]) for (const text of Object.values(messages.reasons)) assert.ok(text.length > 8 && !/[A-Z]{3,}_[A-Z]/.test(text), text);
  assert.deepEqual(Object.keys(ro.preview.finalization), ['NOT_EVALUATED', 'ALLOWED', 'ALLOWED_BY_CEO_EXCEPTION', 'WOULD_BLOCK', 'BLOCKED']);
  assert.deepEqual(Object.keys(ro.preview.production_submission), Object.keys(ro.preview.finalization));
});

test('the panel says whether the order can be finalized or released, why not, and who owns the next step', () => {
  assert.equal(render(map({})), '', 'nothing is shown without a gate state');
  const blocked = render(map({ financeGate: gate({ phase: 'finalization', mode: 'enforce', outcome: 'BLOCKED', reasons: ['IDENTITY_NOT_VERIFIED', 'NO_APPROVED_LIMIT'] }) }));
  assert.match(blocked, /data-outcome="BLOCKED"/);
  assert.match(blocked, /Comanda nu poate fi finalizată pe credit\./);
  assert.match(blocked, /Identitatea companiei nu este verificată\./);
  assert.match(blocked, /Compania nu are o limită de cumpărare aprobată\./);
  assert.match(blocked, /Pasul următor aparține departamentului Financiar/);
  assert.match(blocked, /notice-error/);
  assert.doesNotMatch(blocked, /IDENTITY_NOT_VERIFIED<|>NO_APPROVED_LIMIT/, 'codes are translated');
  const turkish = render(map({ financeGate: gate({ phase: 'finalization', mode: 'enforce', outcome: 'BLOCKED', reasons: ['RISK_RED'] }) }), 'tr');
  assert.match(turkish, /Sipariş vadeli olarak kesinleştirilemez\./);
  assert.match(turkish, /Şirketin riski KIRMIZI\./);
  assert.match(turkish, /Finans departmanına aittir/);
  const allowed = render(map({ financeGate: gate({ phase: 'finalization', mode: 'enforce', outcome: 'ALLOWED', reasons: [] }) }));
  assert.match(allowed, /Clientul este eligibil\. Comanda poate fi finalizată\./);
  assert.doesNotMatch(allowed, /Pasul următor/);
  const off = render(map({ financeGate: gate({ phase: 'finalization', mode: 'off', outcome: 'NOT_EVALUATED', reasons: [] }, ['off', 'off']) }));
  assert.match(off, /Verificarea financiară este oprită/);
  const shadow = render(map({ financeGate: gate({ phase: 'finalization', mode: 'shadow', outcome: 'WOULD_BLOCK', reasons: ['RISK_NOT_ASSIGNED'] }, ['shadow', 'shadow']) }));
  assert.match(shadow, /Doar observare/);
  assert.match(shadow, /notice-warning/);
  // A finalized order previews its release check and shows the stored finalization decision.
  const release = render(map({ status: 'finalized', financeGate: gate({ phase: 'production_submission', mode: 'enforce', outcome: 'BLOCKED', reasons: ['RISK_RED'] }),
    financeDecision: { mode: 'enforce', phase: 'finalization', outcome: 'ALLOWED', reasons: [] } }));
  assert.match(release, /Comanda nu poate fi trimisă în producție acum\./);
  assert.match(release, /data-testid="finance-decision"/);
  assert.match(release, /La finalizare<\/strong>: Verificare activă · Permisă/);
  // After the handoff the release preview is gone and the release decision is shown with what changed.
  const released = render(map({ status: 'finalized', productionSubmitted: true, financeGate: gate({ phase: 'production_submission', mode: 'enforce', outcome: 'ALLOWED', reasons: [] }),
    financeDecision: { mode: 'enforce', phase: 'finalization', outcome: 'ALLOWED', reasons: [] },
    financeReleaseDecision: { mode: 'enforce', phase: 'production_submission', outcome: 'ALLOWED', reasons: [], changedSinceFinalization: ['approvedCreditLimit'], grandfathered: false } }));
  assert.doesNotMatch(released, /data-testid="finance-preview"/);
  assert.match(released, /data-testid="finance-release-decision"/);
  assert.match(released, /Schimbat de la finalizare: limita aprobată/);
  const exception = render(map({ status: 'finalized', productionSubmitted: true, financeGate: gate(null), financeDecision: { mode: 'enforce', phase: 'finalization', outcome: 'ALLOWED_BY_CEO_EXCEPTION', reasons: ['RISK_RED'] } }));
  assert.match(exception, /Permisă prin excepție aprobată/);
  // An invalid server configuration is said plainly and nothing else is claimed.
  const invalid = render(map({ financeGate: gate({ phase: null, mode: null, outcome: 'CONFIGURATION_INVALID', reasons: [] }, [null, null], false) }));
  assert.match(invalid, /data-testid="finance-invalid"/);
  assert.match(invalid, /Configurația verificării financiare este invalidă/);
  assert.doesNotMatch(invalid, /poate fi finalizată\.|eligibil/);
  // An unknown reason code is shown as it is, never dropped and never an object key lookup.
  assert.match(render(map({ financeGate: gate({ phase: 'finalization', mode: 'enforce', outcome: 'BLOCKED', reasons: ['NEW_SERVER_REASON', 'constructor'] }) })), /NEW_SERVER_REASON<\/li><li data-reason="constructor">constructor</);
});

test('a finance refusal is explained with its reasons in both languages, without any amount', () => {
  const ro = createTranslator('ro'), tr = createTranslator('tr');
  const refusal = new ApiError('FINANCE_NOT_ELIGIBLE', 409, undefined, { reasons: ['RISK_RED', 'CREDIT_LIMIT_EXCEEDED'], phase: 'finalization' });
  assert.equal(ro.problem(refusal), 'Comanda nu poate fi finalizată pe credit. Nu a fost modificat nimic. Compania are risc ROȘU. Limita de cumpărare ar fi depășită.');
  assert.equal(tr.problem(refusal), 'Sipariş vadeli olarak kesinleştirilemez. Hiçbir şey değiştirilmedi. Şirketin riski KIRMIZI. Alım limiti aşılırdı.');
  const release = new ApiError('FINANCE_RELEASE_BLOCKED', 409, undefined, { reasons: ['NO_APPROVED_LIMIT'], phase: 'production_submission' });
  assert.match(ro.problem(release), /^Comanda nu poate fi trimisă în producție acum\. Rămâne finalizată; nu a fost trimis nimic\. Compania nu are o limită de cumpărare aprobată\.$/);
  assert.match(tr.problem(release), /^Sipariş şu anda üretime gönderilemez\./);
  assert.equal(ro.problem(new ApiError('FINANCE_NOT_ELIGIBLE', 409, undefined, { reasons: 'RISK_RED' })), 'Comanda nu poate fi finalizată pe credit. Nu a fost modificat nimic.', 'malformed details add nothing');
  assert.match(ro.problem(new ApiError('FINANCE_GATE_MISCONFIGURED', 503)), /Configurația verificării financiare este invalidă/);
  assert.match(tr.problem(new ApiError('FINANCE_GATE_MISCONFIGURED', 503)), /Finans kontrolü yapılandırması geçersiz/);
});

test('the panel follows the financeGate feature, never the gate data alone (API 2.68.0 sends the gate state while it is off)', () => {
  const off = map({ financeGate: gate({ phase: 'finalization', mode: 'off', outcome: 'NOT_EVALUATED', reasons: [] }, ['off', 'off']) });
  assert.equal(render(off, 'ro', false), '', 'gate off (feature absent): no panel although the order carries a gate state');
  assert.equal(render(off, 'tr', false), '');
  const blocked = map({ financeGate: gate({ phase: 'finalization', mode: 'enforce', outcome: 'BLOCKED', reasons: ['RISK_RED'] }) });
  assert.equal(render(blocked, 'ro', false), '', 'even a blocking preview stays hidden without the feature');
  assert.match(render(blocked, 'ro', true), /data-testid="finance-panel"/, 'feature on: the panel is unchanged');
  assert.equal(render(map({}), 'ro', true), '', 'API 2.66.0: no gate state, no panel');
});
