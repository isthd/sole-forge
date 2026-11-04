/**
 * エディタの作品を IndexedDB へ自動保存し、棚用サムネイルを裏で作り直す。
 */
import { useEditor } from './editorStore';
import { useApp } from './appStore';
import type { SneakerDesign } from '../models/types';
import { createDesign } from '../models/design';
import { getDesign, getSetting, listDesigns, nextShelfOrder, putBlob, saveDesign, setSetting, thumbKey, getBlob } from '../db/repo';

const SAVE_MS = 350;
const THUMB_MS = 1200;

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let thumbTimer: ReturnType<typeof setTimeout> | null = null;
let started = false;

export async function flushSave(): Promise<void> {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = null;
  const { design, camera } = useEditor.getState();
  if (!design) return;
  // 削除済みの作品は保存し直さない
  const exists = await getDesign(design.id);
  if (!exists) return;
  const rec: SneakerDesign = {
    ...design,
    favorite: exists.favorite,
    shelfOrder: exists.shelfOrder,
    camera: camera ?? design.camera,
    thumbnail: thumbKey(design.id),
    updatedAt: new Date().toISOString(),
  };
  await saveDesign(rec);
}

async function makeThumb(design: SneakerDesign) {
  try {
    const { renderThumbnail } = await import('../renderers/three/offscreen');
    const blob = await renderThumbnail(design);
    if (!(await getDesign(design.id))) return;
    await putBlob(thumbKey(design.id), blob);
    useApp.getState().bumpShelf();
  } catch (e) {
    console.warn('thumbnail failed', e);
  }
}

export async function ensureThumbnail(design: SneakerDesign): Promise<Blob | undefined> {
  const b = await getBlob(thumbKey(design.id));
  if (b) return b;
  await makeThumb(design);
  return getBlob(thumbKey(design.id));
}

export function startAutosave() {
  if (started) return;
  started = true;
  useEditor.subscribe((s, prev) => {
    if (!s.design) return;
    if (s.design.id !== prev.design?.id) {
      void setSetting('lastDesignId', s.design.id);
      return;
    }
    if (s.design !== prev.design || s.camera !== prev.camera) {
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(() => void flushSave(), SAVE_MS);
    }
    if (s.design !== prev.design) {
      if (thumbTimer) clearTimeout(thumbTimer);
      const d = s.design;
      thumbTimer = setTimeout(() => void makeThumb(d), THUMB_MS);
    }
    if (s.recentColors !== prev.recentColors) void setSetting('recentColors', s.recentColors);
  });
  const flush = () => void flushSave();
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush();
  });
}

export async function openDesign(id: string): Promise<boolean> {
  await flushSave();
  const d = await getDesign(id);
  if (!d) return false;
  useEditor.getState().loadDesign(d);
  return true;
}

export async function newDesign(): Promise<SneakerDesign> {
  await flushSave();
  const order = await nextShelfOrder();
  const d = createDesign(`SNEAKER #${String(order + 1).padStart(2, '0')}`, order);
  await saveDesign(d);
  useEditor.getState().loadDesign(d);
  useApp.getState().bumpShelf();
  void makeThumb(d);
  return d;
}

/** 起動時: 設定を読み込み、最後に開いていた作品（無ければ新規）を開く。何度呼ばれても 1 回だけ実行。 */
let booting: Promise<void> | null = null;
export function bootstrap(): Promise<void> {
  if (!booting) booting = doBootstrap();
  return booting;
}
async function doBootstrap() {
  const [recent, scale, bg, lastId] = await Promise.all([
    getSetting<string[]>('recentColors', []),
    getSetting<1 | 2 | 4>('exportScale', 2),
    getSetting<string | null>('exportBg', null),
    getSetting<string | null>('lastDesignId', null),
  ]);
  useEditor.getState().setRecentColors(recent);
  useApp.setState({ exportScale: scale, exportBg: bg });
  let opened = false;
  if (lastId) opened = await openDesign(lastId);
  if (!opened) {
    const list = await listDesigns();
    if (list.length) opened = await openDesign(list[0].id);
  }
  if (!opened) await newDesign();
  startAutosave();
  useApp.getState().setReady();
}
