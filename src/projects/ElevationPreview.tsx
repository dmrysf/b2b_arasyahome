import type { Scene } from "../api/projects";
import { useI18n } from "../i18n/context";
import { cm } from "./model";

type SceneOpening = Scene["rooms"][number]["openings"][number];
const FILL: Record<string, string> = { sheer: "#f3ead9", drapery: "#9c7a4f", blackout: "#4b4f57", rail: "#15171c", accessory: "#b9853a", other: "#c9ccd3" };

/**
 * Structural 2D elevation of one opening, drawn only from the renderer-neutral scene contract (arasya.scene/1):
 * opening outline, measurement labels and treatment layers with their panel layout. It is a validation sketch,
 * not a renderer; the future 3D view consumes the same scene document. A missing opening dimension is named, never
 * drawn with an invented size; the legend lists each treatment's product and the opening's stored position.
 */
export function ElevationPreview({ opening, revision = null }: { opening: SceneOpening | null; revision?: number | null }) {
  const { t } = useI18n(), p = t.projects;
  if (!opening) return <figure className="elevation empty" aria-label={p.preview}><figcaption>{p.preview}</figcaption></figure>;
  const missing = [opening.width === null && p.width, opening.height === null && p.height].filter(Boolean).join(", ");
  const position = [opening.wallIndex !== null && `${p.wall} ${opening.wallIndex}`, opening.offsetLeft !== null && `${p.offsetLeft}: ${cm(String(opening.offsetLeft))}`,
    opening.wallWidth !== null && `${p.wallWidth}: ${cm(String(opening.wallWidth))}`].filter(Boolean).join(" · ");
  const legend = <>
    {position && <p className="elevation-position">{p.previewPosition}: {position}</p>}
    {opening.treatments.length > 0 && <ul className="elevation-legend">{opening.treatments.map(layer => <li key={layer.id}>
      <span className={`swatch swatch-${layer.type}`} aria-hidden="true" />
      {[p.treatmentTypes[layer.type], layer.product.code || p.previewNoProduct, layer.product.color,
        layer.width !== null && layer.height !== null ? `${cm(String(layer.width))} × ${cm(String(layer.height))} cm` : null].filter(Boolean).join(" · ")}
    </li>)}</ul>}
    <figcaption>{p.previewHint}{revision !== null && ` · ${p.previewRevision(revision)}`}</figcaption>
  </>;
  if (opening.width === null || opening.height === null) return <figure className="elevation empty" aria-label={`${p.preview}: ${opening.name}`}>
    <p className="elevation-missing" role="note">{p.previewMissing(missing)}</p>{legend}</figure>;
  const w = opening.width, h = opening.height, margin = Math.max(w, h) * 0.18, sill = opening.sillHeight ?? 0;
  const viewW = w + margin * 2, viewH = h + margin * 2 + Math.min(sill, h * 0.4);
  const x0 = margin, y0 = margin, unit = Math.max(w, h) / 60;
  const layers = [...opening.treatments].sort((a, b) => b.layer - a.layer);
  return <figure className="elevation" aria-label={`${p.preview}: ${opening.name}`}>
    <svg viewBox={`0 0 ${viewW} ${viewH}`} role="img" aria-label={`${opening.name} ${cm(String(w))} × ${cm(String(h))} cm`} preserveAspectRatio="xMidYMid meet">
      <rect x={0} y={0} width={viewW} height={viewH} fill="#f5f6f8" />
      <line x1={0} x2={viewW} y1={y0 + h + Math.min(sill, h * 0.4)} y2={y0 + h + Math.min(sill, h * 0.4)} stroke="#d3d6dc" strokeWidth={unit / 2} />
      <rect x={x0} y={y0} width={w} height={h} fill="#dfe9f2" stroke="#3d424d" strokeWidth={unit / 2} />
      {layers.map(layer => {
        const tw = layer.width ?? w * 1.1, th = layer.height ?? h, left = x0 + (w - tw) / 2, top = y0 - unit * 2;
        if (layer.type === "rail") return <rect key={layer.id} x={left} y={top - unit} width={tw} height={unit} fill={FILL.rail} />;
        const opacity = layer.type === "sheer" ? 0.7 : 0.88;
        const panels = layer.panelLayout === "pair" ? [[left, tw * 0.28], [left + tw * 0.72, tw * 0.28]] : layer.panelLayout === "left" ? [[left, tw * 0.32]]
          : layer.panelLayout === "right" ? [[left + tw * 0.68, tw * 0.32]] : [[left, tw]];
        return <g key={layer.id}>{panels.map(([x, width], i) => <rect key={i} x={x} y={top} width={width} height={th} fill={FILL[layer.type]} opacity={opacity} stroke="#00000022" strokeWidth={unit / 4} />)}</g>;
      })}
      <text x={x0 + w / 2} y={y0 + h + unit * 3.4} fontSize={unit * 2.4} textAnchor="middle" fill="#15171c">{cm(String(w))} cm</text>
      <text x={x0 + w + unit * 1.2} y={y0 + h / 2} fontSize={unit * 2.4} fill="#15171c">{cm(String(h))}</text>
    </svg>
    {legend}
  </figure>;
}
