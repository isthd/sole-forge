import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SneakerDesign } from '../../models/types';
import { deleteDesign, duplicateDesign, listDesigns, moveDesign, reorderDesigns, updateDesignMeta } from '../../db/repo';
import { useApp, confirmDialog, promptDialog } from '../../store/appStore';
import { useEditor } from '../../store/editorStore';
import { ensureThumbnail, flushSave, newDesign, openDesign } from '../../store/persistence';
import { Icon } from '../../ui/Icon';
import { SneakerCanvas } from '../../renderers/r3f/SneakerCanvas';
import { ExportDialog, ScalePicker } from '../editor/ExportDialog';
import { downloadBlob, stamp } from '../../lib/download';
import { setSetting } from '../../db/repo';

type Sort = 'manual' | 'updated' | 'name';

export function ShelfScreen() {
  const [designs, setDesigns] = useState<SneakerDesign[] | null>(null);
  const [sort, setSort] = useState<Sort>('manual');
  const [favOnly, setFavOnly] = useState(false);
  const [viewer, setViewer] = useState<SneakerDesign | null>(null);
  const [menu, setMenu] = useState<{ d: SneakerDesign; x: number; y: number } | null>(null);
  const [exporting, setExporting] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const shelfVersion = useApp((s) => s.shelfVersion);
  const toast = useApp((s) => s.showToast);
  const scale = useApp((s) => s.exportScale);
  const setScale = useApp((s) => s.setExportScale);
  const setRoute = useApp((s) => s.setRoute);

  const reload = useCallback(async () => {
    await flushSave();
    setDesigns(await listDesigns());
  }, []);
  useEffect(() => {
    void reload();
  }, [reload, shelfVersion]);

  const shown = useMemo(() => {
    if (!designs) return [];
    let list = favOnly ? designs.filter((d) => d.favorite) : [...designs];
    if (sort === 'updated') list.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    if (sort === 'name') list.sort((a, b) => a.name.localeCompare(b.name, 'ja'));
    return list;
  }, [designs, sort, favOnly]);

  const act = {
    edit: async (d: SneakerDesign) => {
      await openDesign(d.id);
      setRoute('editor');
    },
    rename: async (d: SneakerDesign) => {
      const name = await promptDialog('名前を変更', d.name);
      if (!name) return;
      await updateDesignMeta(d.id, { name });
      if (useEditor.getState().design?.id === d.id) useEditor.getState().rename(name);
      await reload();
      setViewer((v) => (v?.id === d.id ? { ...v, name } : v));
    },
    duplicate: async (d: SneakerDesign) => {
      const c = await duplicateDesign(d.id);
      if (c) toast(`「${c.name}」を作りました`);
      await reload();
    },
    favorite: async (d: SneakerDesign) => {
      await updateDesignMeta(d.id, { favorite: !d.favorite });
      await reload();
      setViewer((v) => (v?.id === d.id ? { ...v, favorite: !d.favorite } : v));
    },
    remove: async (d: SneakerDesign) => {
      if (!(await confirmDialog('削除', `「${d.name}」を削除します。元に戻せません。`, true))) return;
      const wasOpen = useEditor.getState().design?.id === d.id;
      await deleteDesign(d.id);
      setViewer(null);
      const rest = await listDesigns();
      if (wasOpen) {
        if (rest.length) await openDesign(rest[0].id);
        else await newDesign();
      }
      toast('削除しました');
      await reload();
    },
    move: async (d: SneakerDesign, delta: -1 | 1) => {
      await moveDesign(d.id, delta);
      await reload();
    },
  };

  const exportShelf = async () => {
    if (!shown.length) return;
    setExporting('準備中…');
    try {
      const { renderShelfPNG } = await import('../../renderers/three/offscreen');
      const res = await renderShelfPNG(shown, scale, (i, n) => setExporting(`描画中 ${i}/${n}`));
      downloadBlob(res.blob, `sole-forge-shelf_${scale}x_${stamp()}.png`);
      toast(res.scale < scale ? `端末の上限のため ${res.width}×${res.height}px で保存しました` : `棚を PNG で保存しました（${res.width}×${res.height}px）`);
    } catch (e) {
      console.error(e);
      toast('書き出しに失敗しました');
    } finally {
      setExporting(null);
    }
  };

  const onDrop = async (targetId: string) => {
    if (!designs || !dragId || dragId === targetId) return;
    const ids = designs.map((d) => d.id);
    const from = ids.indexOf(dragId);
    const to = ids.indexOf(targetId);
    ids.splice(from, 1);
    ids.splice(to, 0, dragId);
    await reorderDesigns(ids);
    setDragId(null);
    setOverId(null);
    await reload();
  };

  return (
    <div className="page" onClick={() => setMenu(null)}>
      <div className="page-head">
        <h1 className="page-title">
          COLLECTION <span className="muted small">{designs ? `${designs.length} 足` : ''}</span>
        </h1>
        <button className="btn primary" onClick={() => void newDesign().then(() => setRoute('editor'))} data-testid="shelf-new">
          <Icon name="plus" size={18} /> 新規作成
        </button>
      </div>
      <div className="page-head">
        <select className="input" style={{ width: 'auto' }} value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="並び順">
          <option value="manual">並び順（手動）</option>
          <option value="updated">更新が新しい順</option>
          <option value="name">名前順</option>
        </select>
        <button className={'btn' + (favOnly ? ' primary' : '')} aria-pressed={favOnly} onClick={() => setFavOnly(!favOnly)}>
          <Icon name="star" size={16} filled={favOnly} /> お気に入り
        </button>
        <span style={{ flex: 1 }} />
        <ScalePicker
          value={scale}
          onChange={(s) => {
            setScale(s);
            void setSetting('exportScale', s);
          }}
        />
        <button className="btn" onClick={() => void exportShelf()} disabled={!!exporting || !shown.length} data-testid="export-shelf">
          <Icon name="download" size={16} /> {exporting ?? '棚を PNG'}
        </button>
      </div>

      {designs && shown.length === 0 && (
        <div className="empty">
          <p>{favOnly ? 'お気に入りはまだありません' : 'まだ作品がありません'}</p>
        </div>
      )}

      <div className="rack" data-testid="rack">
        {shown.map((d) => (
          <ShoeCard
            key={d.id}
            d={d}
            version={shelfVersion}
            dragging={dragId === d.id}
            dropTarget={overId === d.id && dragId !== d.id}
            draggable={sort === 'manual' && !favOnly}
            onOpen={() => setViewer(d)}
            onMenu={(x, y) => setMenu({ d, x, y })}
            onFavorite={() => void act.favorite(d)}
            onDragStart={() => setDragId(d.id)}
            onDragOver={() => setOverId(d.id)}
            onDrop={() => void onDrop(d.id)}
            onDragEnd={() => {
              setDragId(null);
              setOverId(null);
            }}
          />
        ))}
      </div>

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          d={menu.d}
          canMove={sort === 'manual' && !favOnly}
          onClose={() => setMenu(null)}
          act={act}
        />
      )}
      {viewer && <Viewer d={viewer} onClose={() => setViewer(null)} act={act} />}
    </div>
  );
}

type Act = {
  edit: (d: SneakerDesign) => Promise<void>;
  rename: (d: SneakerDesign) => Promise<void>;
  duplicate: (d: SneakerDesign) => Promise<void>;
  favorite: (d: SneakerDesign) => Promise<void>;
  remove: (d: SneakerDesign) => Promise<void>;
  move: (d: SneakerDesign, delta: -1 | 1) => Promise<void>;
};

function useThumb(d: SneakerDesign, version: number) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    let u: string | null = null;
    void ensureThumbnail(d).then((b) => {
      if (!alive || !b) return;
      u = URL.createObjectURL(b);
      setUrl(u);
    });
    return () => {
      alive = false;
      if (u) URL.revokeObjectURL(u);
    };
  }, [d.id, d.updatedAt, version]);
  return url;
}

function ShoeCard(props: {
  d: SneakerDesign;
  version: number;
  dragging: boolean;
  dropTarget: boolean;
  draggable: boolean;
  onOpen: () => void;
  onMenu: (x: number, y: number) => void;
  onFavorite: () => void;
  onDragStart: () => void;
  onDragOver: () => void;
  onDrop: () => void;
  onDragEnd: () => void;
}) {
  const { d } = props;
  const url = useThumb(d, props.version);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const longPressed = useRef(false);
  const start = useRef<{ x: number; y: number } | null>(null);
  return (
    <div
      className={'shoe-card' + (props.dragging ? ' dragging' : '') + (props.dropTarget ? ' drop-target' : '')}
      data-testid="shoe-card"
      data-id={d.id}
      draggable={props.draggable}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move';
        props.onDragStart();
      }}
      onDragOver={(e) => {
        e.preventDefault();
        props.onDragOver();
      }}
      onDrop={(e) => {
        e.preventDefault();
        props.onDrop();
      }}
      onDragEnd={props.onDragEnd}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        props.onMenu(e.clientX, e.clientY);
      }}
    >
      <button
        className="thumb-btn"
        aria-label={`${d.name} を 3D で見る`}
        onPointerDown={(e) => {
          longPressed.current = false;
          start.current = { x: e.clientX, y: e.clientY };
          if (e.pointerType === 'mouse') return;
          const x = e.clientX;
          const y = e.clientY;
          timer.current = setTimeout(() => {
            longPressed.current = true;
            props.onMenu(x, y);
          }, 520);
        }}
        onPointerMove={(e) => {
          if (start.current && Math.hypot(e.clientX - start.current.x, e.clientY - start.current.y) > 10) clearTimeout(timer.current);
        }}
        onPointerUp={() => clearTimeout(timer.current)}
        onPointerCancel={() => clearTimeout(timer.current)}
        onClick={(e) => {
          e.stopPropagation();
          if (longPressed.current) return;
          props.onOpen();
        }}
      >
        {url ? <img src={url} alt="" draggable={false} /> : <span className="muted small">…</span>}
      </button>
      <div className="board" />
      <div className="meta">
        <span className="name" title={d.name}>
          {d.name}
        </span>
        <button
          className={'fav' + (d.favorite ? ' on' : '')}
          aria-label={d.favorite ? 'お気に入りを外す' : 'お気に入りにする'}
          aria-pressed={d.favorite}
          onClick={(e) => {
            e.stopPropagation();
            props.onFavorite();
          }}
        >
          <Icon name="star" size={18} filled={d.favorite} />
        </button>
        <button
          className="fav"
          aria-label="メニュー"
          data-testid="card-menu"
          onClick={(e) => {
            e.stopPropagation();
            const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
            props.onMenu(r.left, r.bottom);
          }}
        >
          <Icon name="more" size={18} />
        </button>
      </div>
    </div>
  );
}

function ContextMenu({ x, y, d, act, onClose, canMove }: { x: number; y: number; d: SneakerDesign; act: Act; onClose: () => void; canMove: boolean }) {
  const w = 200;
  const h = 330;
  const left = Math.max(8, Math.min(x, window.innerWidth - w - 8));
  const top = Math.max(8, Math.min(y, window.innerHeight - h - 8));
  const run = (fn: () => Promise<void>) => () => {
    onClose();
    void fn();
  };
  return (
    <div className="ctx-menu" role="menu" style={{ left, top }} onClick={(e) => e.stopPropagation()}>
      <button role="menuitem" onClick={run(() => act.edit(d))}>
        <Icon name="edit" size={16} /> 編集する
      </button>
      <button role="menuitem" onClick={run(() => act.rename(d))}>
        <Icon name="text" size={16} /> 名前を変更
      </button>
      <button role="menuitem" onClick={run(() => act.duplicate(d))}>
        <Icon name="copy" size={16} /> 複製
      </button>
      <button role="menuitem" onClick={run(() => act.favorite(d))}>
        <Icon name="star" size={16} filled={d.favorite} /> {d.favorite ? 'お気に入りを外す' : 'お気に入り'}
      </button>
      {canMove && (
        <>
          <button role="menuitem" onClick={run(() => act.move(d, -1))}>
            <Icon name="left" size={16} /> 前へ移動
          </button>
          <button role="menuitem" onClick={run(() => act.move(d, 1))}>
            <Icon name="right" size={16} /> 後ろへ移動
          </button>
        </>
      )}
      <button role="menuitem" className="danger" onClick={run(() => act.remove(d))}>
        <Icon name="trash" size={16} /> 削除
      </button>
    </div>
  );
}

function Viewer({ d, onClose, act }: { d: SneakerDesign; onClose: () => void; act: Act }) {
  const [exportOpen, setExportOpen] = useState(false);
  const [camera, setCamera] = useState(d.camera ?? null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal viewer" role="dialog" aria-modal="true" aria-label={d.name} onClick={(e) => e.stopPropagation()} data-testid="viewer">
        <div className="viewer-head">
          <h2>{d.name}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="閉じる">
            <Icon name="close" />
          </button>
        </div>
        <SneakerCanvas design={d} initialCamera={d.camera} onCameraChange={setCamera} />
        <div className="viewer-actions">
          <button className="btn primary" onClick={() => void act.edit(d)}>
            <Icon name="edit" size={16} /> 編集
          </button>
          <button className="btn" onClick={() => void act.favorite(d)} aria-pressed={d.favorite}>
            <Icon name="star" size={16} filled={d.favorite} /> お気に入り
          </button>
          <button className="btn" onClick={() => void act.rename(d)}>
            名前変更
          </button>
          <button className="btn" onClick={() => void act.duplicate(d).then(onClose)}>
            <Icon name="copy" size={16} /> 複製
          </button>
          <button className="btn" onClick={() => setExportOpen(true)}>
            <Icon name="download" size={16} /> PNG
          </button>
          <button className="btn danger" onClick={() => void act.remove(d)}>
            <Icon name="trash" size={16} /> 削除
          </button>
        </div>
      </div>
      {exportOpen && (
        <div onClick={(e) => e.stopPropagation()}>
          <ExportDialog design={{ ...d, camera: camera ?? d.camera }} onClose={() => setExportOpen(false)} />
        </div>
      )}
    </div>
  );
}
