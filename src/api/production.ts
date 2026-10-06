import { ApiError } from './errors';

export const PRODUCTION_PERMISSIONS = ['b2b.production.view', 'b2b.production.submit'] as const;
export type ProductionPermission = typeof PRODUCTION_PERMISSIONS[number];
export type ProductionCapabilities = { canView: boolean; canSubmit: boolean };
export const STAGES = ['waiting', 'material-preparation', 'workshop-receiving', 'labeling', 'material-straightening', 'bottom-hem', 'side-hem', 'ironing', 'height', 'header-tape', 'sewing-finishing', 'quality-control', 'packing', 'delivery'] as const;
export type StageId = typeof STAGES[number];
export type Production = { submitted: false; orderCode: string } | {
  submitted: true; orderCode: string; operationalOrderId: string; submittedAt: string; stageChangedAt: string;
  completedAt: string | null; workflow: 'curtain-production@1'; totalStages: 14;
  stage: { id: StageId; label: string; ordinal: number };
  /** Central production document: revision and whether it is usable (none before the first print). */
  document: { status: 'none' | 'active' | 'stale' | 'revoked'; revisionNumber: number | null } | null;
};
export function mapProduction(value: unknown): Production {
  const fail = (): never => { throw new ApiError('INVALID_RESPONSE', 502); };
  const obj = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : fail();
  const text = (v: unknown) => typeof v === 'string' && v ? v : fail();
  const date = (v: unknown) => { const s = text(v); return /Z$/.test(s) && Number.isFinite(Date.parse(s)) ? s : fail(); };
  const raw = obj(value), r = obj(raw.production), orderCode = text(r.orderCode);
  if (r.submitted === false) return { submitted: false, orderCode };
  if (r.submitted !== true || r.workflow !== 'curtain-production@1' || r.totalStages !== 14) fail();
  const stage = obj(r.stage), index = STAGES.indexOf(stage.id as StageId);
  if (index < 0 || stage.ordinal !== index + 1) fail();
  const operationalOrderId = text(r.operationalOrderId);
  if (!/^b2b:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(operationalOrderId)) fail();
  return { submitted: true, orderCode, operationalOrderId, submittedAt: date(r.submittedAt), stageChangedAt: date(r.stageChangedAt),
    completedAt: r.completedAt === null ? null : date(r.completedAt), workflow: 'curtain-production@1', totalStages: 14,
    stage: { id: STAGES[index], label: text(stage.label), ordinal: index + 1 }, document: mapDocument(r.document) };
}
function mapDocument(value: unknown): { status: 'none' | 'active' | 'stale' | 'revoked'; revisionNumber: number | null } | null {
  if (value === undefined || value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (!['none', 'active', 'stale', 'revoked'].includes(raw.status as string)) return null;
  const revision = typeof raw.revisionNumber === 'number' && Number.isInteger(raw.revisionNumber) && raw.revisionNumber > 0 ? raw.revisionNumber : null;
  return { status: raw.status as 'none' | 'active' | 'stale' | 'revoked', revisionNumber: revision };
}
