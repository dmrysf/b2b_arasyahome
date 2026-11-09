import { ApiError } from './errors';
import { ORDER_TYPES, type OrderType } from './orders';

export const PRODUCTION_PERMISSIONS = ['b2b.production.view', 'b2b.production.submit'] as const;
export type ProductionPermission = typeof PRODUCTION_PERMISSIONS[number];
export type ProductionCapabilities = { canView: boolean; canSubmit: boolean };
export const STAGES = ['waiting', 'material-preparation', 'workshop-receiving', 'labeling', 'material-straightening', 'bottom-hem', 'side-hem', 'ironing', 'height', 'header-tape', 'sewing-finishing', 'quality-control', 'packing', 'delivery'] as const;
export type StageId = typeof STAGES[number];
export type DeliveryState = 'IN_PRODUCTION' | 'READY_FOR_LIVRARE' | 'RECEIVED_BY_LIVRARE' | 'HANDED_OVER';
/** Route decided by the server from the frozen order type (API 2.64.0). Absent from an older API: no route details. */
export type ProductionRoute = { orderType: OrderType | null; stages: StageId[]; notApplicable: StageId[]; shortRoute: boolean;
  nextStage: { id: StageId; label: string } | null; stage2Completed: boolean; delivery: DeliveryState };
export type Production = { submitted: false; orderCode: string } | {
  submitted: true; orderCode: string; operationalOrderId: string; submittedAt: string; stageChangedAt: string;
  completedAt: string | null; workflow: 'curtain-production@1'; totalStages: 14;
  stage: { id: StageId; label: string; ordinal: number };
  /** Central production document: revision and whether it is usable (none before the first print). */
  document: { status: 'none' | 'active' | 'stale' | 'revoked'; revisionNumber: number | null } | null;
  route: ProductionRoute | null;
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
    stage: { id: STAGES[index], label: text(stage.label), ordinal: index + 1 }, document: mapDocument(r.document), route: mapRoute(r, fail) };
}
function mapRoute(r: Record<string, unknown>, fail: () => never): ProductionRoute | null {
  if (r.route === undefined) return null;
  const stage = (v: unknown): StageId => STAGES.includes(v as StageId) ? v as StageId : fail();
  const route = r.route && typeof r.route === 'object' && !Array.isArray(r.route) ? r.route as Record<string, unknown> : fail();
  const list = (v: unknown) => Array.isArray(v) ? v.map(stage) : fail();
  const nextRaw = r.nextStage === null ? null : r.nextStage && typeof r.nextStage === 'object' ? r.nextStage as Record<string, unknown> : fail();
  const next = nextRaw === null ? null : { id: stage(nextRaw.id), label: typeof nextRaw.label === 'string' && nextRaw.label ? nextRaw.label : fail() };
  const type = r.orderType === null ? null : ORDER_TYPES.includes(r.orderType as OrderType) ? r.orderType as OrderType : fail();
  const delivery = ['IN_PRODUCTION', 'READY_FOR_LIVRARE', 'RECEIVED_BY_LIVRARE', 'HANDED_OVER'].includes(r.delivery as string) ? r.delivery as DeliveryState : fail();
  if (typeof route.shortRoute !== 'boolean' || typeof r.stage2Completed !== 'boolean') fail();
  return { orderType: type, stages: list(route.stages), notApplicable: list(route.notApplicable), shortRoute: route.shortRoute as boolean, nextStage: next,
    stage2Completed: r.stage2Completed as boolean, delivery };
}
function mapDocument(value: unknown): { status: 'none' | 'active' | 'stale' | 'revoked'; revisionNumber: number | null } | null {
  if (value === undefined || value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (!['none', 'active', 'stale', 'revoked'].includes(raw.status as string)) return null;
  const revision = typeof raw.revisionNumber === 'number' && Number.isInteger(raw.revisionNumber) && raw.revisionNumber > 0 ? raw.revisionNumber : null;
  return { status: raw.status as 'none' | 'active' | 'stale' | 'revoked', revisionNumber: revision };
}
