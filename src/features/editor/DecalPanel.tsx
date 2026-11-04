import { useEffect, useRef, useState } from 'react';
import { useEditor, endBurst, type DecalDraft } from '../../store/editorStore';
import { useApp } from '../../store/appStore';
import { DECAL_FONTS, LOGOS } from '../../renderers/logos';
import { PART_LABELS, type Decal } from '../../models/types';
import { uid } from '../../models/design';
import { putBlob } from '../../db/repo';
import { normalizeImageFile } from '../../renderers/three/decalTextures';
import { Icon } from '../../ui/Icon';

type Kind = 'logo' | 'image' | 'text';

function LogoPreview({ id, color }: { id: string; color: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const logo = LOGOS.find((l) => l.id === id)!;
    const c = ref.current!;
    const draw = () => {
      const ctx = c.getContext('2d')!;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, c.width, c.height);
      const k = Math.min(c.width / (100 * logo.aspect), c.height / 100);
      ctx.translate((c.width - 100 * logo.aspect * k) / 2, (c.height - 100 * k) / 2);
      ctx.scale(k, k);
      logo.draw(ctx, color);
    };
    draw();
    document.fonts?.load('700 40px "Oswald"').then(draw).catch(() => {});
  }, [id, color]);
  return <canvas ref={ref} width={96} height={64} className="logo-preview" />;
}

export function DecalPanel() {
  const [kind, setKind] = useState<Kind>('logo');
  const [logo, setLogo] = useState(LOGOS[0].id);
  const [color, setColor] = useState('#C6FF00');
  const [text, setText] = useState('FORGE');
  const [font, setFont] = useState<string>(DECAL_FONTS[0].id);
  const [imageKey, setImageKey] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const placing = useEditor((s) => s.placing);
  const startPlacing = useEditor((s) => s.startPlacing);
  const toast = useApp((s) => s.showToast);

  useEffect(() => () => {
    if (imageUrl) URL.revokeObjectURL(imageUrl);
  }, [imageUrl]);

  const draft = (): DecalDraft | null => {
    const base = { scale: kind === 'text' ? 0.6 : 0.42, rotation: 0, flip: false };
    if (kind === 'logo') return { ...base, kind, src: logo, color };
    if (kind === 'text') return { ...base, kind, text: text.trim() || 'TEXT', font, color };
    if (!imageKey) return null;
    return { ...base, kind, src: imageKey };
  };

  return (
    <div className="panel-body">
      <div className="seg" role="tablist" aria-label="デカールの種類">
        {(['logo', 'image', 'text'] as Kind[]).map((k) => (
          <button key={k} role="tab" aria-selected={kind === k} className={kind === k ? 'active' : ''} onClick={() => setKind(k)}>
            {k === 'logo' ? 'ロゴ' : k === 'image' ? '画像' : '文字'}
          </button>
        ))}
      </div>

      {kind === 'logo' && (
        <>
          <div className="logo-grid">
            {LOGOS.map((l) => (
              <button key={l.id} className={'tile' + (logo === l.id ? ' active' : '')} aria-pressed={logo === l.id} onClick={() => setLogo(l.id)} title={l.label} data-logo={l.id}>
                <LogoPreview id={l.id} color={logo === l.id ? color : '#F2F2EE'} />
                <span className="small">{l.label}</span>
              </button>
            ))}
          </div>
          <label className="row gap center">
            <span className="label">色</span>
            <input type="color" value={color.toLowerCase()} onChange={(e) => setColor(e.target.value.toUpperCase())} aria-label="ロゴの色" />
          </label>
        </>
      )}

      {kind === 'text' && (
        <>
          <input className="input" value={text} maxLength={24} onChange={(e) => setText(e.target.value)} aria-label="貼る文字" placeholder="文字を入力" />
          <div className="row gap center wrap">
            <select className="input" value={font} onChange={(e) => setFont(e.target.value)} aria-label="フォント" style={{ flex: 1 }}>
              {DECAL_FONTS.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
            </select>
            <input type="color" value={color.toLowerCase()} onChange={(e) => setColor(e.target.value.toUpperCase())} aria-label="文字の色" />
          </div>
          <div className="text-preview" style={{ fontFamily: `"${font}"`, color, fontWeight: font === 'Permanent Marker' ? 400 : 700 }}>
            {text || 'TEXT'}
          </div>
        </>
      )}

      {kind === 'image' && (
        <>
          <label className="btn file-btn">
            <Icon name="image" /> 画像を選ぶ
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
              data-testid="decal-image-input"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (!f) return;
                try {
                  const png = await normalizeImageFile(f);
                  const key = uid('img:');
                  await putBlob(key, png);
                  setImageKey(key);
                  setImageUrl(URL.createObjectURL(png));
                } catch {
                  toast('画像を読み込めませんでした');
                }
              }}
            />
          </label>
          {imageUrl ? <img className="image-preview" src={imageUrl} alt="読み込んだ画像" /> : <p className="muted small">PNG / JPEG / WebP。1024px 以下に縮小して端末内に保存します。</p>}
        </>
      )}

      <button
        className={'btn primary wide' + (placing ? ' pulse' : '')}
        data-testid="start-placing"
        disabled={kind === 'image' && !imageKey}
        onClick={() => {
          if (placing) return startPlacing(null);
          const d = draft();
          if (d) startPlacing(d);
        }}
      >
        <Icon name="sticker" /> {placing ? '貼り付けをやめる' : 'モデルをタップして貼る'}
      </button>

      <DecalList />
    </div>
  );
}

function DecalList() {
  const decals = useEditor((s) => s.design?.decals ?? []);
  const selectedId = useEditor((s) => s.selectedDecalId);
  const select = useEditor((s) => s.selectDecal);
  const sorted = [...decals].sort((a, b) => b.z - a.z);
  const selected = decals.find((d) => d.id === selectedId) ?? null;
  return (
    <>
      <div className="label">貼ったデカール（上が前面）</div>
      {sorted.length === 0 && <p className="muted small">まだありません</p>}
      <ul className="decal-list">
        {sorted.map((d) => (
          <li key={d.id}>
            <button className={'decal-row' + (d.id === selectedId ? ' active' : '')} onClick={() => select(d.id === selectedId ? null : d.id)} aria-pressed={d.id === selectedId}>
              <Icon name={d.kind === 'image' ? 'image' : d.kind === 'text' ? 'text' : 'sticker'} size={16} />
              <span className="grow ellipsis">{d.kind === 'text' ? d.text : d.kind === 'logo' ? LOGOS.find((l) => l.id === d.src)?.label : '画像'}</span>
              <span className="muted small">{PART_LABELS[d.part]}</span>
            </button>
          </li>
        ))}
      </ul>
      {selected && <DecalEditor decal={selected} />}
    </>
  );
}

function DecalEditor({ decal }: { decal: Decal }) {
  const update = useEditor((s) => s.updateDecal);
  const remove = useEditor((s) => s.removeDecal);
  const moveZ = useEditor((s) => s.moveDecalZ);
  const moveMode = useEditor((s) => s.moveMode);
  const setMoveMode = useEditor((s) => s.setMoveMode);
  const nudge = useApp((s) => s.requestNudge);
  const step = 0.04;
  return (
    <div className="decal-editor" data-testid="decal-editor">
      <button className={'btn wide' + (moveMode ? ' primary' : '')} aria-pressed={moveMode} onClick={() => setMoveMode(!moveMode)} data-testid="move-mode">
        <Icon name="move" /> {moveMode ? '移動モード中（モデル上をドラッグ）' : '移動モード'}
      </button>
      <div className="nudge">
        <button className="icon-btn" aria-label="上へ" onClick={() => nudge(decal.id, 0, step)}>
          <Icon name="up" />
        </button>
        <button className="icon-btn" aria-label="左へ" onClick={() => nudge(decal.id, -step, 0)}>
          <Icon name="left" />
        </button>
        <button className="icon-btn" aria-label="右へ" onClick={() => nudge(decal.id, step, 0)}>
          <Icon name="right" />
        </button>
        <button className="icon-btn" aria-label="下へ" onClick={() => nudge(decal.id, 0, -step)}>
          <Icon name="down" />
        </button>
      </div>
      <label className="slider">
        <span>大きさ</span>
        <input type="range" min={0.08} max={1.6} step={0.01} value={decal.scale} onChange={(e) => update(decal.id, { scale: +e.target.value })} aria-label="大きさ" />
        <output>{decal.scale.toFixed(2)}</output>
      </label>
      <label className="slider">
        <span>回転</span>
        <input type="range" min={-180} max={180} step={1} value={decal.rotation} onChange={(e) => update(decal.id, { rotation: +e.target.value })} aria-label="回転" />
        <output>{Math.round(decal.rotation)}°</output>
      </label>
      <div className="row gap wrap">
        <button
          className={'btn' + (decal.flip ? ' primary' : '')}
          aria-pressed={decal.flip}
          onClick={() => {
            endBurst();
            update(decal.id, { flip: !decal.flip });
          }}
        >
          <Icon name="flip" /> 左右反転
        </button>
        <button className="btn danger" onClick={() => remove(decal.id)}>
          <Icon name="trash" /> 削除
        </button>
      </div>
      <div className="label">重ね順</div>
      <div className="row gap wrap">
        <button className="btn small" onClick={() => moveZ(decal.id, 'top')}>
          最前面
        </button>
        <button className="btn small" onClick={() => moveZ(decal.id, 'up')}>
          前へ
        </button>
        <button className="btn small" onClick={() => moveZ(decal.id, 'down')}>
          後ろへ
        </button>
        <button className="btn small" onClick={() => moveZ(decal.id, 'bottom')}>
          最背面
        </button>
      </div>
    </div>
  );
}
