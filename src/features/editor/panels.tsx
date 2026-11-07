import { useEffect, useRef, useState } from 'react';
import { useEditor, endBurst } from '../../store/editorStore';
import { useApp } from '../../store/appStore';
import type { MaterialId, PartId, PatternType } from '../../models/types';
import {
  MATERIAL_IDS,
  MATERIAL_LABELS,
  PART_IDS,
  PART_LABELS,
  PATTERN_DIRECTION_LABELS,
  PATTERN_DIRECTIONS,
  PATTERN_LABELS,
  PATTERN_SCALE_MAX,
  PATTERN_SCALE_MIN,
  PATTERN_TYPES,
} from '../../models/types';
import { normalizeHex } from '../../models/design';
import { PART_SHAPE_KEYS, SHAPE_OPTIONS, shapeValue } from '../../models/shape';
import { Icon } from '../../ui/Icon';

export const SWATCHES = [
  '#0E0E10', '#2A2A30', '#6B6B73', '#B8B8BE', '#F2F2EE', '#FFFFFF',
  '#C6FF00', '#00E5A0', '#00B3FF', '#3A4BFF', '#8A3CFF', '#FF3CAC',
  '#FF2E2E', '#FF7A00', '#FFC400', '#7A5230', '#3F4A2A', '#C9B79C',
];

function usePart() {
  const part = useEditor((s) => s.selectedPart);
  const style = useEditor((s) => s.design?.parts[s.selectedPart]);
  return { part, style };
}

export function PartList({ compact = false }: { compact?: boolean }) {
  const selected = useEditor((s) => s.selectedPart);
  const parts = useEditor((s) => s.design?.parts);
  const select = useEditor((s) => s.selectPart);
  const flash = useApp((s) => s.flash);
  if (!parts) return null;
  return (
    <div className={compact ? 'part-chips' : 'part-list'} role="listbox" aria-label="パーツ">
      {PART_IDS.map((id) => (
        <button
          key={id}
          role="option"
          aria-selected={selected === id}
          className={'part-item' + (selected === id ? ' active' : '')}
          data-part={id}
          onClick={() => {
            select(id);
            flash(id);
          }}
        >
          <span className="swatch" style={swatchStyle(parts[id].color, parts[id].pattern?.colors)} />
          <span className="part-name">{PART_LABELS[id]}</span>
          {!compact && <span className="part-mat">{MATERIAL_LABELS[parts[id].material]}</span>}
        </button>
      ))}
    </div>
  );
}

export function swatchStyle(color: string, pattern?: string[]) {
  return pattern && pattern.length > 1 ? { background: `linear-gradient(135deg, ${pattern.join(',')})` } : { background: color };
}

function ColorField({ value, onLive, onCommit, label }: { value: string; onLive: (c: string) => void; onCommit: (c: string) => void; label: string }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <div className="color-field">
      <label className="color-input-wrap" title="カラーピッカー">
        <input
          type="color"
          aria-label={label + ' カラーピッカー'}
          value={value.toLowerCase()}
          onChange={(e) => onLive(e.target.value)}
          onBlur={(e) => onCommit(e.target.value)}
        />
        <span className="color-chip" style={{ background: value }} />
      </label>
      <form
        className="hex-form"
        onSubmit={(e) => {
          e.preventDefault();
          const c = normalizeHex(text);
          if (c) {
            endBurst();
            onLive(c);
            onCommit(c);
          } else setText(value);
        }}
      >
        <input
          className="input mono"
          aria-label={label + ' HEX'}
          value={text}
          maxLength={7}
          spellCheck={false}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => {
            const c = normalizeHex(text);
            if (c && c !== value) {
              endBurst();
              onLive(c);
              onCommit(c);
            } else setText(value);
          }}
        />
      </form>
    </div>
  );
}

function Swatches({ onPick }: { onPick: (c: string) => void }) {
  const recent = useEditor((s) => s.recentColors);
  return (
    <>
      <div className="label">パレット</div>
      <div className="swatch-grid">
        {SWATCHES.map((c) => (
          <button key={c} className="swatch-btn" style={{ background: c }} aria-label={c} title={c} onClick={() => onPick(c)} />
        ))}
      </div>
      <div className="label">最近使った色</div>
      {recent.length ? (
        <div className="swatch-grid">
          {recent.map((c) => (
            <button key={c} className="swatch-btn" style={{ background: c }} aria-label={'最近 ' + c} title={c} onClick={() => onPick(c)} />
          ))}
        </div>
      ) : (
        <p className="muted small">まだありません</p>
      )}
    </>
  );
}

export function ColorPanel() {
  const { part, style } = usePart();
  const setColor = useEditor((s) => s.setPartColor);
  const push = useEditor((s) => s.pushRecentColor);
  const sprayMode = useEditor((s) => s.sprayMode);
  const setSprayMode = useEditor((s) => s.setSprayMode);
  const setBrush = useEditor((s) => s.setBrushColor);
  if (!style) return null;
  const pick = (c: string) => {
    endBurst();
    setColor(part, c);
    setBrush(c);
    push(c);
  };
  return (
    <div className="panel-body">
      <PanelHead part={part} />
      <ColorField
        value={style.color}
        label={PART_LABELS[part]}
        onLive={(c) => {
          setColor(part, c);
          setBrush(c);
        }}
        onCommit={push}
      />
      <button
        className={'btn wide' + (sprayMode ? ' primary' : '')}
        aria-pressed={sprayMode}
        data-testid="spray-mode"
        onClick={() => {
          if (!sprayMode) setBrush(style.color);
          setSprayMode(!sprayMode);
        }}
      >
        <Icon name="spray" /> {sprayMode ? 'スプレー中（パーツをタップ）' : 'この色をスプレーで塗る'}
      </button>
      <p className="muted small">モデルをタップした位置から塗り広がります。</p>
      {style.pattern && <p className="muted small">柄が有効です。柄の色は「柄」タブで変更できます。</p>}
      <Swatches onPick={pick} />
    </div>
  );
}

function PanelHead({ part }: { part: PartId }) {
  return (
    <div className="panel-head">
      <span className="sticker">{PART_LABELS[part]}</span>
    </div>
  );
}

const MAT_PREVIEW: Record<MaterialId, string> = {
  leather: 'radial-gradient(circle at 30% 30%, #fff6 0, #0000 45%), #8a8a90',
  suede: 'repeating-linear-gradient(45deg, #7a7a80 0 2px, #84848a 2px 4px)',
  mesh: 'radial-gradient(circle, #2a2a30 30%, #9a9aa0 32%) 0 0/8px 8px, #9a9aa0',
  canvas: 'repeating-linear-gradient(0deg, #8f8f95 0 2px, #7c7c82 2px 3px), #8a8a90',
  patent: 'linear-gradient(135deg, #fff 0, #9a9aa0 30%, #3a3a40 60%, #d0d0d6 100%)',
  knit: 'repeating-linear-gradient(60deg, #0000 0 3px, #6e6e74 3px 5px), repeating-linear-gradient(-60deg, #0000 0 3px, #6e6e74 3px 5px), #8f8f95',
  metallic: 'repeating-linear-gradient(0deg, #fff1 0 1px, #0000 1px 3px), linear-gradient(160deg, #e8e8ee 0, #7c7c84 35%, #f4f4f8 55%, #5c5c64 100%)',
  rubber: 'radial-gradient(circle, #6a6a70 35%, #0000 40%) 0 0/5px 5px, #7c7c82',
  foam: 'radial-gradient(circle at 35% 30%, #b4b4ba 0, #8f8f95 70%)',
};

function finishLabel(f: number) {
  if (Math.abs(f) < 0.05) return '素材なり';
  return f < 0 ? `マット ${Math.round(-f * 100)}%` : `光沢 ${Math.round(f * 100)}%`;
}

export function MaterialPanel() {
  const { part, style } = usePart();
  const setMat = useEditor((s) => s.setMaterial);
  const setFinish = useEditor((s) => s.setFinish);
  if (!style) return null;
  const finish = style.finish ?? 0;
  return (
    <div className="panel-body">
      <PanelHead part={part} />
      <div className="tile-grid">
        {MATERIAL_IDS.map((m) => (
          <button key={m} className={'tile' + (style.material === m ? ' active' : '')} aria-pressed={style.material === m} onClick={() => setMat(part, m)} data-material={m}>
            <span className="tile-preview" style={{ background: MAT_PREVIEW[m] }} />
            <span>{MATERIAL_LABELS[m]}</span>
          </button>
        ))}
      </div>
      <label className="slider wide-out">
        <span>ツヤ</span>
        <input
          type="range"
          min={-1}
          max={1}
          step={0.05}
          value={finish}
          onChange={(e) => setFinish(part, +e.target.value)}
          aria-label="ツヤ"
          data-testid="finish"
        />
        <output>{finishLabel(finish)}</output>
      </label>
      <div className="row gap">
        <button className="btn ghost" disabled={finish === 0} onClick={() => (endBurst(), setFinish(part, 0))}>
          ツヤを素材なりに戻す
        </button>
      </div>
      <p className="muted small">PBR マテリアル（粗さ・光沢・ノーマルマップ）。ツヤを左へ動かすとマット、右へ動かすと光沢が出ます。回して光の当たり方を確認できます。</p>
    </div>
  );
}

const PATTERN_PREVIEW: Record<PatternType, string> = {
  gradient: 'linear-gradient(0deg, #F2F2EE, #C6FF00)',
  camo: 'radial-gradient(circle at 20% 30%, #3F4A2A 0 22%, #0000 23%), radial-gradient(circle at 70% 60%, #1C1F14 0 25%, #0000 26%), radial-gradient(circle at 60% 10%, #7A7F55 0 18%, #0000 19%), #5B6340',
  check: 'conic-gradient(#0E0E10 25%, #F2F2EE 0 50%, #0E0E10 0 75%, #F2F2EE 0) 0 0/16px 16px',
  dot: 'radial-gradient(circle, #0E0E10 28%, #0000 30%) 0 0/10px 10px, #F2F2EE',
  stripe: 'repeating-linear-gradient(0deg, #F2F2EE 0 5px, #0E0E10 5px 10px)',
  splatter:
    'radial-gradient(circle at 22% 30%, #0E0E10 0 9%, #0000 10%), radial-gradient(circle at 70% 62%, #C6FF00 0 11%, #0000 12%), radial-gradient(circle at 48% 80%, #0E0E10 0 4%, #0000 5%), radial-gradient(circle at 84% 22%, #0E0E10 0 3%, #0000 4%), radial-gradient(circle at 34% 58%, #C6FF00 0 3%, #0000 4%), #F2F2EE',
  marble: 'linear-gradient(115deg, #0000 0 40%, #2A2A30 42%, #0000 45%), linear-gradient(60deg, #0000 0 62%, #B8B8BE 64%, #0000 68%), linear-gradient(160deg, #0000 0 22%, #6B6B73 24%, #0000 26%), #E6E4DE',
};

export function PatternPanel() {
  const { part, style } = usePart();
  const setPattern = useEditor((s) => s.setPattern);
  const setPatternColor = useEditor((s) => s.setPatternColor);
  const setScale = useEditor((s) => s.setPatternScale);
  const setDirection = useEditor((s) => s.setPatternDirection);
  const push = useEditor((s) => s.pushRecentColor);
  if (!style) return null;
  const pat = style.pattern;
  const scale = pat?.scale ?? 1;
  return (
    <div className="panel-body">
      <PanelHead part={part} />
      <div className="tile-grid">
        <button className={'tile' + (!pat ? ' active' : '')} aria-pressed={!pat} onClick={() => setPattern(part, null)} data-pattern="none">
          <span className="tile-preview" style={{ background: style.color }} />
          <span>なし</span>
        </button>
        {PATTERN_TYPES.map((t) => (
          <button key={t} className={'tile' + (pat?.type === t ? ' active' : '')} aria-pressed={pat?.type === t} onClick={() => setPattern(part, t)} data-pattern={t}>
            <span className="tile-preview" style={{ background: PATTERN_PREVIEW[t] }} />
            <span>{PATTERN_LABELS[t]}</span>
          </button>
        ))}
      </div>
      {pat && pat.type !== 'gradient' && (
        <label className="slider">
          <span>大きさ</span>
          <input
            type="range"
            min={PATTERN_SCALE_MIN}
            max={PATTERN_SCALE_MAX}
            step={0.05}
            value={scale}
            onChange={(e) => setScale(part, +e.target.value)}
            aria-label="柄の大きさ"
            data-testid="pattern-scale"
          />
          <output>{scale.toFixed(2)}x</output>
        </label>
      )}
      {pat?.type === 'stripe' && (
        <>
          <div className="label">ストライプの向き</div>
          <div className="seg" role="radiogroup" aria-label="ストライプの向き">
            {PATTERN_DIRECTIONS.map((d) => {
              const on = (pat.direction ?? 'h') === d;
              return (
                <button key={d} role="radio" aria-checked={on} className={on ? 'active' : ''} onClick={() => setDirection(part, d)} data-direction={d}>
                  {PATTERN_DIRECTION_LABELS[d]}
                </button>
              );
            })}
          </div>
        </>
      )}
      {pat && (
        <>
          <div className="label">柄の色</div>
          {pat.colors.map((c, i) => (
            <div key={i} className="row gap center">
              <span className="muted small" style={{ width: 28 }}>
                {i + 1}
              </span>
              <ColorField value={c} label={`柄の色 ${i + 1}`} onLive={(v) => setPatternColor(part, i, v)} onCommit={push} />
              {pat.colors.length > 2 && (
                <button className="icon-btn" aria-label="この色を削除" onClick={() => setPattern(part, pat.type, pat.colors.filter((_, k) => k !== i))}>
                  ×
                </button>
              )}
            </div>
          ))}
          {pat.colors.length < 4 && (
            <button className="btn ghost" onClick={() => setPattern(part, pat.type, [...pat.colors, '#0E0E10'])}>
              ＋ 色を追加
            </button>
          )}
        </>
      )}
    </div>
  );
}

export function useHighlight(): PartId | null {
  const flashPart = useApp((s) => s.flashPart);
  const [on, setOn] = useState<PartId | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => {
    if (!flashPart) return;
    setOn(flashPart.part as PartId);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setOn(null), 1100);
    return () => clearTimeout(timer.current);
  }, [flashPart]);
  return on;
}

/** パーツの形（トゥキャップの大きさ・サイドパネルの形・靴ひもの太さなど） */
export function ShapePanel() {
  const part = useEditor((s) => s.selectedPart);
  const shape = useEditor((s) => s.design?.shape);
  const setShape = useEditor((s) => s.setShape);
  const resetShape = useEditor((s) => s.resetShape);
  const select = useEditor((s) => s.selectPart);
  const flash = useApp((s) => s.flash);
  const keys = PART_SHAPE_KEYS[part];
  const shaped = PART_IDS.filter((id) => PART_SHAPE_KEYS[id].length > 0);
  const changed = keys.filter((k) => shapeValue(shape, k) !== SHAPE_OPTIONS[k].default);
  return (
    <div className="panel-body">
      <PanelHead part={part} />
      {keys.length === 0 ? (
        <>
          <p className="muted small">このパーツは形を変えられません。全体の形は「型」で選べます。形を変えられるパーツ:</p>
          <div className="row gap wrap">
            {shaped.map((id) => (
              <button
                key={id}
                className="chip"
                onClick={() => {
                  select(id);
                  flash(id);
                }}
              >
                {PART_LABELS[id]}
              </button>
            ))}
          </div>
        </>
      ) : (
        <>
          {keys.map((k) => {
            const def = SHAPE_OPTIONS[k];
            const cur = shapeValue(shape, k);
            return (
              <div key={k} className="shape-option">
                <div className="label">{def.label}</div>
                <div className="seg wrap" role="radiogroup" aria-label={def.label}>
                  {def.choices.map((c) => (
                    <button
                      key={c.value}
                      role="radio"
                      aria-checked={cur === c.value}
                      className={cur === c.value ? 'active' : ''}
                      data-shape={k}
                      data-value={c.value}
                      onClick={() => setShape(k, c.value as never)}
                    >
                      {c.label}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
          <div className="row gap">
            <button className="btn ghost" disabled={!changed.length} onClick={() => resetShape(keys)}>
              標準の形に戻す
            </button>
          </div>
          <p className="muted small">形を変えても色・素材・デカールはそのまま引き継ぎます（元に戻すで戻せます）。</p>
        </>
      )}
    </div>
  );
}
