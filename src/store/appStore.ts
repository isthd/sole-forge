import { create } from 'zustand';
import type { ViewPreset } from '../models/baseModel';
import type { PartId, Vec3 } from '../models/types';

/** モデル上でタップした位置（塗りの起点に使う） */
export interface PaintOrigin {
  part: PartId;
  position: Vec3;
  normal: Vec3;
  nonce: number;
}

/** 動きを減らす設定の端末では、制作過程の演出を最初からオフにする */
function defaultProcessFx(): boolean {
  try {
    return !(typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches);
  } catch {
    return true;
  }
}

export type Route = 'editor' | 'shelf' | 'settings';
export type ExportScale = 1 | 2 | 4;
export type EditorTab = 'model' | 'parts' | 'color' | 'material' | 'pattern' | 'shape' | 'decal';

export interface AppState {
  route: Route;
  ready: boolean;
  exportScale: ExportScale;
  exportBg: string | null; // null = 透過
  toast: { id: number; text: string } | null;
  shelfVersion: number;
  viewRequest: { preset: ViewPreset; nonce: number } | null;
  nudgeRequest: { id: string; dx: number; dy: number; nonce: number } | null;
  editorTab: EditorTab;
  sheetOpen: boolean;
  flashPart: { part: string; nonce: number } | null;
  dialog: DialogState | null;
  /** 着色・デカール貼り付けの過程を 3D で見せる */
  processFx: boolean;
  paintOrigin: PaintOrigin | null;

  setRoute: (r: Route) => void;
  setReady: () => void;
  setExportScale: (s: ExportScale) => void;
  setExportBg: (bg: string | null) => void;
  showToast: (text: string) => void;
  bumpShelf: () => void;
  requestView: (p: ViewPreset) => void;
  requestNudge: (id: string, dx: number, dy: number) => void;
  setEditorTab: (t: EditorTab) => void;
  setSheetOpen: (o: boolean) => void;
  flash: (part: string) => void;
  setProcessFx: (on: boolean) => void;
  setPaintOrigin: (p: Omit<PaintOrigin, 'nonce'> | null) => void;
}

export type DialogState =
  | { kind: 'confirm'; title: string; message: string; danger?: boolean; resolve: (v: boolean) => void }
  | { kind: 'prompt'; title: string; value: string; resolve: (v: string | null) => void };

let toastId = 0;
let nonce = 0;

export const useApp = create<AppState>()((set) => ({
  route: 'editor',
  ready: false,
  exportScale: 2,
  exportBg: null,
  toast: null,
  shelfVersion: 0,
  viewRequest: null,
  nudgeRequest: null,
  editorTab: 'parts',
  sheetOpen: true,
  flashPart: null,
  dialog: null,
  processFx: defaultProcessFx(),
  paintOrigin: null,

  setRoute: (route) => {
    set({ route });
    if (typeof location !== 'undefined' && location.hash !== '#/' + route) history.replaceState(null, '', '#/' + route);
  },
  setReady: () => set({ ready: true }),
  setExportScale: (exportScale) => set({ exportScale }),
  setExportBg: (exportBg) => set({ exportBg }),
  showToast: (text) => set({ toast: { id: ++toastId, text } }),
  bumpShelf: () => set((s) => ({ shelfVersion: s.shelfVersion + 1 })),
  requestView: (preset) => set({ viewRequest: { preset, nonce: ++nonce } }),
  requestNudge: (id, dx, dy) => set({ nudgeRequest: { id, dx, dy, nonce: ++nonce } }),
  setEditorTab: (editorTab) => set({ editorTab, sheetOpen: true }),
  setSheetOpen: (sheetOpen) => set({ sheetOpen }),
  flash: (part) => set({ flashPart: { part, nonce: ++nonce } }),
  setProcessFx: (processFx) => set({ processFx }),
  setPaintOrigin: (p) => set({ paintOrigin: p ? { ...p, nonce: ++nonce } : null }),
}));

export function confirmDialog(title: string, message: string, danger = false): Promise<boolean> {
  return new Promise((resolve) =>
    useApp.setState({
      dialog: {
        kind: 'confirm',
        title,
        message,
        danger,
        resolve: (v) => {
          useApp.setState({ dialog: null });
          resolve(v);
        },
      },
    }),
  );
}

export function promptDialog(title: string, value: string): Promise<string | null> {
  return new Promise((resolve) =>
    useApp.setState({
      dialog: {
        kind: 'prompt',
        title,
        value,
        resolve: (v) => {
          useApp.setState({ dialog: null });
          resolve(v);
        },
      },
    }),
  );
}
