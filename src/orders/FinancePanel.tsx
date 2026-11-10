import type { FinanceDecision, Order } from '../api/orders';
import { useI18n } from '../i18n/context';

/**
 * Finance eligibility of one order (Operations API 2.67.0). Read-only: it shows what the server decided or would
 * decide, the reasons, and who owns the next step. It holds no amount and never enables or disables an action.
 */
export function FinancePanel({ order }: { order: Order }) {
  const { t } = useI18n(), f = t.orders.finance;
  const gate = order.financeGate;
  if (!gate) return null;
  const reason = (code: string) => Object.hasOwn(f.reasons, code) ? f.reasons[code] : code;
  const field = (name: string) => Object.hasOwn(f.fields, name) ? f.fields[name] : name;
  // A handoff made on this screen: the release preview of the loaded order no longer applies.
  const preview = gate.preview && !(gate.preview.phase === 'production_submission' && order.productionSubmitted) ? gate.preview : null;
  const tone = (outcome: string) => outcome === 'BLOCKED' || outcome === 'CONFIGURATION_INVALID' ? 'notice-error'
    : outcome === 'WOULD_BLOCK' ? 'notice-warning' : outcome === 'NOT_EVALUATED' ? '' : 'notice-success';
  const stored = (decision: FinanceDecision | null | undefined, testId: string) => decision && decision.phase && <li data-testid={testId}>
    <strong>{f.phases[decision.phase]}</strong>: {f.modes[decision.mode]} · {f.outcomes[decision.outcome]}
    {decision.reasons.length > 0 && <> · {decision.reasons.map(reason).join(' ')}</>}
    {decision.changedSinceFinalization.length > 0 && <> · {f.changed}: {decision.changedSinceFinalization.map(field).join(', ')}</>}
    {decision.grandfathered && decision.phase === 'production_submission' && decision.outcome !== 'NOT_EVALUATED' && <> · {f.grandfathered}</>}
  </li>;
  return <section className="card finance-panel" aria-labelledby="finance-panel-title" data-testid="finance-panel">
    <h2 id="finance-panel-title">{f.title}</h2>
    {!gate.configured ? <p className="notice notice-error" role="alert" data-testid="finance-invalid">{f.invalid}</p> : <>
      {preview && preview.phase && <div className={`notice ${tone(preview.outcome)}`} role="status" data-testid="finance-preview" data-outcome={preview.outcome}>
        <p><span className="badge">{preview.mode ? f.modes[preview.mode] : ''}</span><strong>{f.preview[preview.phase][preview.outcome]}</strong></p>
        {preview.reasons.length > 0 && <><p>{f.reasonsTitle}:</p><ul className="finance-reasons">{preview.reasons.map(code => <li key={code} data-reason={code}>{reason(code)}</li>)}</ul></>}
        {(preview.outcome === 'BLOCKED' || preview.outcome === 'WOULD_BLOCK') && <p>{f.nextStep}</p>}
      </div>}
      {(order.financeDecision?.phase || order.financeReleaseDecision?.phase) && <><h3>{f.stored}</h3><ul className="finance-decisions">
        {stored(order.financeDecision, 'finance-decision')}{stored(order.financeReleaseDecision, 'finance-release-decision')}</ul></>}
      <p className="muted">{f.hint}</p>
    </>}
  </section>;
}
