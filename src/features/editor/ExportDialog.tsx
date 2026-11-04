import { useState } from 'react';
import { useEditor } from '../../store/editorStore';
import { useApp, type ExportScale } from '../../store/appStore';
import { setSetting } from '../../db/repo';
import { downloadBlob, safeFileName } from '../../lib/download';
import type { SneakerDesign } from '../../models/types';

export const BG_OPTIONS: { id: string; label: string; value: string | null }[] = [
  { id: 'transparent', label: '透過', value: null },
  { id: 'dark', label: 'ダーク', value: '#0E0E10' },
  { id: 'light', label: 'ライト', value: '#F2F2EE' },
  { id: 'lime', label: 'ライム', value: '#C6FF00' },
];

export const BASE_EXPORT_SIZE = 1024;

export function ScalePicker({ value, onChange }: { value: ExportScale; onChange: (s: ExportScale) => void }) {
  return (
    <div className="seg" role="radiogroup" aria-label="解像度">
      {([1, 2, 4] as ExportScale[]).map((s) => (
        <button key={s} role="radio" aria-checked={value === s} className={value === s ? 'active' : ''} onClick={() => onChange(s)} data-scale={s}>
          {s}x
        </button>
      ))}
    </div>
  );
}

/** 単体 PNG 書き出し。design と camera を省略するとエディタの現在の作品・角度を使う */
export function ExportDialog({ onClose, design: designProp }: { onClose: () => void; design?: SneakerDesign }) {
  const editorDesign = useEditor((s) => s.design);
  const camera = useEditor((s) => s.camera);
  const design = designProp ?? editorDesign;
  const scale = useApp((s) => s.exportScale);
  const bg = useApp((s) => s.exportBg);
  const setScale = useApp((s) => s.setExportScale);
  const setBg = useApp((s) => s.setExportBg);
  const toast = useApp((s) => s.showToast);
  const [busy, setBusy] = useState(false);
  const [custom, setCustom] = useState('#2A2A30');
  if (!design) return null;
  const bgId = BG_OPTIONS.find((o) => o.value === bg)?.id ?? 'custom';

  const run = async () => {
    setBusy(true);
    try {
      const { renderDesignPNG, maxRenderSize } = await import('../../renderers/three/offscreen');
      const size = BASE_EXPORT_SIZE * scale;
      const max = maxRenderSize();
      const blob = await renderDesignPNG(design, {
        width: size,
        height: size,
        background: bg,
        camera: designProp ? design.camera ?? null : camera ?? design.camera ?? null,
      });
      const actual = Math.min(size, max);
      downloadBlob(blob, `${safeFileName(design.name)}_${scale}x.png`);
      toast(actual < size ? `端末の上限のため ${actual}px で保存しました` : `PNG を保存しました（${size}px）`);
      onClose();
    } catch (e) {
      console.error(e);
      toast('書き出しに失敗しました');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="PNG 書き出し" onClick={(e) => e.stopPropagation()}>
        <h2 className="modal-title">PNG 書き出し</h2>
        <p className="muted small">{designProp ? '最後に見ていた角度' : 'いまの 3D ビューの角度'}で、高解像度に描き直して保存します。</p>
        <div className="label">解像度（{BASE_EXPORT_SIZE * scale}px 四方）</div>
        <ScalePicker
          value={scale}
          onChange={(s) => {
            setScale(s);
            void setSetting('exportScale', s);
          }}
        />
        <div className="label">背景</div>
        <div className="seg wrap" role="radiogroup" aria-label="背景">
          {BG_OPTIONS.map((o) => (
            <button
              key={o.id}
              role="radio"
              aria-checked={bgId === o.id}
              className={bgId === o.id ? 'active' : ''}
              data-bg={o.id}
              onClick={() => {
                setBg(o.value);
                void setSetting('exportBg', o.value);
              }}
            >
              {o.label}
            </button>
          ))}
          <label className={'seg-color' + (bgId === 'custom' ? ' active' : '')}>
            <input
              type="color"
              aria-label="背景色"
              value={(bgId === 'custom' && bg ? bg : custom).toLowerCase()}
              onChange={(e) => {
                setCustom(e.target.value);
                setBg(e.target.value.toUpperCase());
                void setSetting('exportBg', e.target.value.toUpperCase());
              }}
            />
            任意色
          </label>
        </div>
        <div className="row end gap" style={{ marginTop: 16 }}>
          <button className="btn" onClick={onClose}>
            閉じる
          </button>
          <button className="btn primary" onClick={run} disabled={busy} data-testid="do-export">
            {busy ? '書き出し中…' : 'PNG を保存'}
          </button>
        </div>
      </div>
    </div>
  );
}
