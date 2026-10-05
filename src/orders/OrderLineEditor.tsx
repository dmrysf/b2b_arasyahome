import { memo } from "react";
import type { LineTotals } from "../api/orders";
import { useI18n } from "../i18n/context";
import type { LineDraft } from "./model";

export function FieldError({ reason }: { reason?: string }) {
  const { t } = useI18n(), o = t.orders;
  return reason ? <span className="field-error" role="alert">{reason === "required" ? o.fieldRequired : reason === "inactive" ? o.fieldInactive : reason === "too_long" ? o.fieldLong : o.fieldInvalid}</span> : null;
}

/** A row rerenders only for its own inputs, error state, position or authoritative preview. */
export const OrderLineEditor = memo(function OrderLineEditor({ line, index, count, editable, fields, totals, currency, onChange, onAction }: {
  line: LineDraft; index: number; count: number; editable: boolean; fields: Record<string, string>; totals: LineTotals | null; currency: string;
  onChange: (uuid: string, field: keyof LineDraft, value: string) => void;
  onAction: (uuid: string, action: "duplicate" | "remove" | "up" | "down") => void;
}) {
  const { t } = useI18n(), o = t.orders;
  const input = (field: keyof LineDraft, label: string, numeric = false) => {
    const reason = fields[`lines.${index}.${field}`];
    if (field === "notes" || field === "productionNotes") return <label key={field}>{label}<textarea
      aria-label={`${label} ${index + 1}`} id={`line-${line.id}-${field}`} value={line[field]} maxLength={2000}
      aria-invalid={!!reason} onChange={e => onChange(line.id, field, e.target.value)} /><FieldError reason={reason} /></label>;
    return <label key={field}>{label}<input aria-label={`${label} ${index + 1}`} id={`line-${line.id}-${field}`}
      value={line[field]} inputMode={numeric ? "decimal" : undefined} maxLength={numeric ? 16 : 160}
      aria-invalid={!!reason} onChange={e => onChange(line.id, field, e.target.value)} /><FieldError reason={reason} /></label>;
  };
  return <article className="order-line" data-line-id={line.id}>
    <div className="order-line-header"><span className="line-position">{String(index + 1).padStart(2, "0")}</span>
      <strong>{line.productCode || o.productCode}</strong>
      {editable && <div className="row-actions">
        <button type="button" className="button button-ghost" disabled={index === 0} onClick={() => onAction(line.id, "up")} aria-label={`${o.moveUp} ${index + 1}`}>↑</button>
        <button type="button" className="button button-ghost" disabled={index === count - 1} onClick={() => onAction(line.id, "down")} aria-label={`${o.moveDown} ${index + 1}`}>↓</button>
        <button type="button" className="button button-ghost" disabled={count >= 100} onClick={() => onAction(line.id, "duplicate")} aria-label={`${o.duplicateLine} ${index + 1}`}>{o.duplicateLine}</button>
        <button type="button" className="button button-ghost" onClick={() => onAction(line.id, "remove")} aria-label={`${o.removeLine} ${index + 1}`}>{o.removeLine}</button>
      </div>}
    </div>
    <div className="order-line-grid">
      {input("productCode", o.productCode)}
      <label>{o.kind}<select aria-label={`${o.kind} ${index + 1}`} value={line.kind} onChange={e => onChange(line.id, "kind", e.target.value)}>
        {(["curtain", "drapery", "other"] as const).map(k => <option key={k} value={k}>{o[k]}</option>)}</select></label>
      {input("productName", o.productName)}{input("color", o.color)}{input("variant", o.variant)}
      {input("width", o.width, true)}{input("height", o.height, true)}
      {input("quantity", o.quantity, true)}{input("meters", o.meters, true)}
      <label>{o.pricingUnit}<select aria-label={`${o.pricingUnit} ${index + 1}`} value={line.pricingUnit} onChange={e => onChange(line.id, "pricingUnit", e.target.value)}>
        <option value="piece">{o.piece}</option><option value="meter">{o.meter}</option></select></label>
      {input("unitPriceNet", o.unitPriceNet, true)}{input("discountPercent", o.discountPercent, true)}{input("vatPercent", o.vatPercent, true)}
      <div className="row-total"><span>{o.gross}</span><strong>{totals?.gross ?? "—"}</strong><small>{currency}</small></div>
    </div>
    <details><summary>{o.lineNotes}</summary><div className="grid-2">{input("notes", o.lineNotes)}{input("productionNotes", o.productionNotes)}</div></details>
    {totals && <dl className="line-totals">{(["baseNet", "discountNet", "net", "vat"] as const).map(k =>
      <div key={k}><dt>{o[k]}</dt><dd>{totals[k]} {currency}</dd></div>)}</dl>}
  </article>;
});
