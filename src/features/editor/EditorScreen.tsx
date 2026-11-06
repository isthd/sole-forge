import { useEffect, useState } from 'react';
import { useStore } from 'zustand';
import { useEditor, undo, redo, endBurst } from '../../store/editorStore';
import { useApp, type EditorTab } from '../../store/appStore';
import { SneakerCanvas } from '../../renderers/r3f/SneakerCanvas';
import { ColorPanel, MaterialPanel, PartList, PatternPanel, useHighlight } from './panels';
import { DecalPanel } from './DecalPanel';
import { ModelPanel } from './ModelPanel';
import { ExportDialog } from './ExportDialog';
import { Icon } from '../../ui/Icon';
import { PART_LABELS } from '../../models/types';
import type { ViewPreset } from '../../models/baseModel';
import { newDesign } from '../../store/persistence';

const TABS: { id: EditorTab; label: string; icon: Parameters<typeof Icon>[0]['name'] }[] = [
  { id: 'model', label: '型', icon: 'boot' },
  { id: 'parts', label: 'パーツ', icon: 'shoe' },
  { id: 'color', label: '色', icon: 'palette' },
  { id: 'material', label: '素材', icon: 'cube' },
  { id: 'pattern', label: '柄', icon: 'grid' },
  { id: 'decal', label: 'デカール', icon: 'sticker' },
];

const VIEWS: { id: ViewPreset; label: string; key: string }[] = [
  { id: 'front', label: '正面', key: '1' },
  { id: 'side', label: '横', key: '2' },
  { id: 'back', label: '後ろ', key: '3' },
  { id: 'top', label: '上', key: '4' },
];

function useIsDesktop() {
  const q = '(min-width: 900px)';
  const [m, setM] = useState(() => window.matchMedia(q).matches);
  useEffect(() => {
    const mq = window.matchMedia(q);
    const fn = () => setM(mq.matches);
    mq.addEventListener('change', fn);
    return () => mq.removeEventListener('change', fn);
  }, []);
  return m;
}

export function EditorScreen() {
  const design = useEditor((s) => s.design);
  const isDesktop = useIsDesktop();
  const tab = useApp((s) => s.editorTab);
  const setTab = useApp((s) => s.setEditorTab);
  const sheetOpen = useApp((s) => s.sheetOpen);
  const setSheetOpen = useApp((s) => s.setSheetOpen);
  const [exportOpen, setExportOpen] = useState(false);
  useShortcuts();

  if (!design) return <div className="loading">読み込み中…</div>;

  const rightTab = tab === 'parts' || tab === 'model' ? 'color' : tab;
  const panel = (t: EditorTab) =>
    t === 'model' ? (
      <ModelPanel />
    ) : t === 'parts' ? (
      <PartList />
    ) : t === 'color' ? (
      <ColorPanel />
    ) : t === 'material' ? (
      <MaterialPanel />
    ) : t === 'pattern' ? (
      <PatternPanel />
    ) : (
      <DecalPanel />
    );

  return (
    <div className={'editor ' + (isDesktop ? 'desktop' : 'mobile')}>
      {isDesktop && (
        <aside className="side left" aria-label="パーツ一覧">
          <h2 className="side-title">MODEL</h2>
          <ModelPanel compact />
          <h2 className="side-title">PARTS</h2>
          <PartList />
        </aside>
      )}

      <section className="stage">
        <Toolbar onExport={() => setExportOpen(true)} />
        <Viewport />
        <PlacingBanner />
      </section>

      {isDesktop ? (
        <aside className="side right" aria-label="編集パネル">
          <div className="tabs" role="tablist">
            {TABS.filter((t) => t.id !== 'parts' && t.id !== 'model').map((t) => (
              <button key={t.id} role="tab" aria-selected={rightTab === t.id} className={rightTab === t.id ? 'active' : ''} onClick={() => setTab(t.id)} data-tab={t.id}>
                {t.label}
              </button>
            ))}
          </div>
          <div className="side-scroll">{panel(rightTab)}</div>
        </aside>
      ) : (
        <>
          {sheetOpen && (
            <div className="sheet" role="region" aria-label="編集パネル">
              {tab !== 'parts' && tab !== 'decal' && tab !== 'model' && <PartList compact />}
              <div className="sheet-scroll">{panel(tab)}</div>
            </div>
          )}
          <nav className="tabbar" role="tablist" aria-label="編集ツール">
            {TABS.map((t) => (
              <button
                key={t.id}
                role="tab"
                aria-selected={tab === t.id && sheetOpen}
                className={tab === t.id && sheetOpen ? 'active' : ''}
                data-tab={t.id}
                onClick={() => (tab === t.id ? setSheetOpen(!sheetOpen) : setTab(t.id))}
              >
                <Icon name={t.icon} size={20} />
                <span>{t.label}</span>
              </button>
            ))}
          </nav>
        </>
      )}
      {exportOpen && <ExportDialog onClose={() => setExportOpen(false)} />}
    </div>
  );
}

function Viewport() {
  const design = useEditor((s) => s.design)!;
  const selectedDecalId = useEditor((s) => s.selectedDecalId);
  const camera = useEditor((s) => s.camera);
  const moveMode = useEditor((s) => s.moveMode);
  const placingDraft = useEditor((s) => s.placing);
  const placing = !!placingDraft;
  const sprayMode = useEditor((s) => s.sprayMode);
  const viewRequest = useApp((s) => s.viewRequest);
  const nudgeRequest = useApp((s) => s.nudgeRequest);
  const processFx = useApp((s) => s.processFx);
  const paintOrigin = useApp((s) => s.paintOrigin);
  const highlight = useHighlight();
  const [initialCamera, setInitialCamera] = useState(camera);
  useEffect(() => setInitialCamera(useEditor.getState().camera), [design.id]);

  return (
    <SneakerCanvas
      design={design}
      highlightPart={highlight}
      selectedDecalId={selectedDecalId}
      initialCamera={initialCamera}
      viewRequest={viewRequest}
      nudgeRequest={nudgeRequest}
      dragMode={moveMode && !!selectedDecalId}
      placing={placing}
      placingDraft={placingDraft}
      spray={sprayMode}
      processFx={processFx}
      paintOrigin={paintOrigin}
      onPick={(p) => {
        const s = useEditor.getState();
        const app = useApp.getState();
        if (s.placing && p.part) {
          s.placeDecal(p.part, p.position, p.normal);
          app.showToast('貼り付けました');
          return;
        }
        // タップした位置を塗りの起点にする（スプレーもパネルからの色変更も、ここから塗り広がる）
        if (p.part) app.setPaintOrigin({ part: p.part, position: p.position, normal: p.normal });
        if (s.sprayMode && p.part) {
          s.sprayPart(p.part);
          return;
        }
        if (p.decalId) {
          s.selectDecal(p.decalId);
          if (app.editorTab !== 'decal') app.setEditorTab('decal');
          return;
        }
        if (p.part) {
          s.selectPart(p.part);
          s.selectDecal(null);
          app.flash(p.part);
          if (app.editorTab === 'decal' || app.editorTab === 'parts') app.setEditorTab('color');
        }
      }}
      onDrag={(p) => {
        const s = useEditor.getState();
        if (s.selectedDecalId && p.part) s.updateDecal(s.selectedDecalId, { part: p.part, position: p.position, normal: p.normal });
      }}
      onNudged={(id, p) => {
        endBurst();
        if (p.part) useEditor.getState().updateDecal(id, { part: p.part, position: p.position, normal: p.normal });
      }}
      onCameraChange={(c) => useEditor.getState().setCamera(c)}
      onDecalTransformStart={() => endBurst()}
      onDecalTransform={(id, patch) => useEditor.getState().updateDecal(id, patch)}
      onDecalTransformEnd={() => endBurst()}
    />
  );
}

function PlacingBanner() {
  const placing = useEditor((s) => s.placing);
  const moveMode = useEditor((s) => s.moveMode);
  const selectedDecalId = useEditor((s) => s.selectedDecalId);
  const startPlacing = useEditor((s) => s.startPlacing);
  const setMoveMode = useEditor((s) => s.setMoveMode);
  const sprayMode = useEditor((s) => s.sprayMode);
  const brush = useEditor((s) => s.brushColor);
  const setSprayMode = useEditor((s) => s.setSprayMode);
  if (sprayMode)
    return (
      <div className="banner" role="status" data-testid="spray-banner">
        <span className="brush-dot" style={{ background: brush }} aria-hidden="true" />
        スプレー: タップして塗る
        <button className="btn small" onClick={() => setSprayMode(false)}>
          完了
        </button>
      </div>
    );
  if (placing)
    return (
      <div className="banner" role="status">
        モデルの表面をタップして貼り付け
        <button className="btn small" onClick={() => startPlacing(null)}>
          やめる
        </button>
      </div>
    );
  if (moveMode && selectedDecalId)
    return (
      <div className="banner" role="status">
        モデル上をドラッグして移動（回転は停止中）
        <button className="btn small" onClick={() => setMoveMode(false)}>
          完了
        </button>
      </div>
    );
  return null;
}

function Toolbar({ onExport }: { onExport: () => void }) {
  const canUndo = useStore(useEditor.temporal, (s) => s.pastStates.length > 0);
  const canRedo = useStore(useEditor.temporal, (s) => s.futureStates.length > 0);
  const randomize = useEditor((s) => s.randomize);
  const mirror = useEditor((s) => s.mirror);
  const name = useEditor((s) => s.design?.name ?? '');
  const baseModel = useEditor((s) => s.design?.baseModel);
  const rename = useEditor((s) => s.rename);
  const requestView = useApp((s) => s.requestView);
  const toast = useApp((s) => s.showToast);
  const [mirrorOpen, setMirrorOpen] = useState(false);
  const selectedPart = useEditor((s) => s.selectedPart);
  return (
    <div className="toolbar">
      <div className="toolbar-row">
        <input className="name-input" value={name} onChange={(e) => rename(e.target.value)} onBlur={() => endBurst()} aria-label="作品名" maxLength={60} />
        <button className="icon-btn" onClick={() => void newDesign(baseModel).then(() => toast('新しいスニーカーを作成しました'))} title="新規作成" aria-label="新規作成" data-testid="new-design">
          <Icon name="plus" />
        </button>
      </div>
      <div className="toolbar-row scroll-x">
        <button className="icon-btn" onClick={undo} disabled={!canUndo} title="元に戻す (Ctrl+Z)" aria-label="元に戻す">
          <Icon name="undo" />
        </button>
        <button className="icon-btn" onClick={redo} disabled={!canRedo} title="やり直し (Ctrl+Shift+Z)" aria-label="やり直し">
          <Icon name="redo" />
        </button>
        <span className="sep" />
        <button className="icon-btn" onClick={() => randomize()} title="ランダム配色" aria-label="ランダム配色">
          <Icon name="shuffle" />
        </button>
        <div className="menu-anchor">
          <button className="icon-btn" onClick={() => setMirrorOpen(!mirrorOpen)} title="左右コピー" aria-label="左右コピー" aria-expanded={mirrorOpen}>
            <Icon name="mirror" />
          </button>
          {mirrorOpen && (
            <div className="menu" role="menu" onMouseLeave={() => setMirrorOpen(false)}>
              <button
                role="menuitem"
                onClick={() => {
                  mirror('lateral');
                  setMirrorOpen(false);
                  toast('外側 → 内側へコピーしました');
                }}
              >
                外側 → 内側へコピー
              </button>
              <button
                role="menuitem"
                onClick={() => {
                  mirror('medial');
                  setMirrorOpen(false);
                  toast('内側 → 外側へコピーしました');
                }}
              >
                内側 → 外側へコピー
              </button>
              <p className="menu-note">配色は左右共通です。デカールを反対側へ鏡像コピーします。</p>
            </div>
          )}
        </div>
        <span className="sep" />
        {VIEWS.map((v) => (
          <button key={v.id} className="chip" onClick={() => requestView(v.id)} title={`${v.label} (${v.key})`} data-view={v.id}>
            {v.label}
          </button>
        ))}
        <span className="sep" />
        <button className="btn primary small" onClick={onExport} data-testid="open-export">
          <Icon name="download" size={16} /> PNG
        </button>
        <span className="sr-only">選択中: {PART_LABELS[selectedPart]}</span>
      </div>
    </div>
  );
}

function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z' && !typing) {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (mod && e.key.toLowerCase() === 'y' && !typing) {
        e.preventDefault();
        redo();
        return;
      }
      if (typing || mod) return;
      const s = useEditor.getState();
      const app = useApp.getState();
      const v = VIEWS.find((x) => x.key === e.key);
      if (v) app.requestView(v.id);
      if ((e.key === 'Delete' || e.key === 'Backspace') && s.selectedDecalId) s.removeDecal(s.selectedDecalId);
      if (e.key === 'Escape') {
        s.startPlacing(null);
        s.setMoveMode(false);
        s.setSprayMode(false);
      }
      if (s.selectedDecalId && e.key.startsWith('Arrow')) {
        e.preventDefault();
        const st = e.shiftKey ? 0.12 : 0.03;
        const dx = e.key === 'ArrowLeft' ? -st : e.key === 'ArrowRight' ? st : 0;
        const dy = e.key === 'ArrowUp' ? st : e.key === 'ArrowDown' ? -st : 0;
        app.requestNudge(s.selectedDecalId, dx, dy);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
