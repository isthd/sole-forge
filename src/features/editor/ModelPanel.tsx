import { useEditor } from '../../store/editorStore';
import { useApp } from '../../store/appStore';
import { BASE_MODEL_IDS, getBaseModel } from '../../models';
import type { BaseModelId } from '../../models/types';

/** ベース型の横から見たシルエット（寸法パラメータから描く簡易図） */
export function ModelSilhouette({ id }: { id: BaseModelId }) {
  const p = getBaseModel(id).params;
  const a = p.length / 2;
  const s = p.soleThickness;
  const sh = p.soleHeelThickness ?? s; // かかと側のソール上面
  // 座標系: x = かかと(-) → つま先(+), y = 上。SVG は y が下向きなので反転する
  const upper = [
    [a - 0.05, s],
    [a - 0.25, s + 0.3],
    [0.55, p.throatHeight],
    [-0.56, p.collarHeight],
    [-0.92, p.collarHeight + (p.collarBackHeight - p.collarHeight) * 0.35 - p.collarDip],
    [-1.39, p.collarBackHeight],
    [-a + 0.04, p.collarBackHeight - 0.15],
    [-a, sh],
  ];
  const H = 2.2;
  const pt = ([x, y]: number[]) => `${(x + a + 0.1).toFixed(3)},${(H - y).toFixed(3)}`;
  return (
    <svg viewBox={`0 0 ${p.length + 0.2} ${H}`} className="model-sil" aria-hidden="true">
      <polygon points={upper.map(pt).join(' ')} className="sil-upper" />
      <polygon
        points={[[a + 0.04, p.outsoleThickness], [a + 0.04, s], [-a - 0.04, sh + (p.midsoleLip ?? 0)], [-a - 0.04, p.outsoleThickness]].map(pt).join(' ')}
        className="sil-mid"
      />
      <rect x={0.06} y={H - p.outsoleThickness} width={p.length + 0.08} height={p.outsoleThickness} rx={0.04} className="sil-out" />
    </svg>
  );
}

/** ベース型の選択。切り替えても配色とデカールは引き継ぐ（Undo で戻せる） */
export function ModelPanel({ compact = false }: { compact?: boolean }) {
  const current = useEditor((s) => s.design?.baseModel);
  const setBaseModel = useEditor((s) => s.setBaseModel);
  const toast = useApp((s) => s.showToast);
  const requestView = useApp((s) => s.requestView);
  if (!current) return null;
  return (
    <div className={compact ? 'model-list compact' : 'panel-body'}>
      <div className="model-grid" role="radiogroup" aria-label="スニーカーの型">
        {BASE_MODEL_IDS.map((id) => {
          const def = getBaseModel(id);
          const active = id === current;
          return (
            <button
              key={id}
              role="radio"
              aria-checked={active}
              className={'tile model-tile' + (active ? ' active' : '')}
              data-model={id}
              title={def.description}
              onClick={() => {
                if (active) return;
                setBaseModel(id);
                requestView('threeQuarter');
                toast(`${def.label} に切り替えました`);
              }}
            >
              <ModelSilhouette id={id} />
              <span>{def.label}</span>
              {!compact && <span className="muted small model-desc">{def.description}</span>}
            </button>
          );
        })}
      </div>
      {!compact && <p className="muted small">型を切り替えても配色とデカールはそのまま引き継ぎます（元に戻すで戻せます）。</p>}
    </div>
  );
}
