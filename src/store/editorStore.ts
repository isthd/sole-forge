import { create } from 'zustand';
import { temporal } from 'zundo';
import type { CameraState, Decal, MaterialId, PartId, PartStyle, PatternType, SneakerDesign } from '../models/types';
import { cloneDesign, mirrorDecals, normalizeHex, normalizeZ, uid } from '../models/design';
import { randomParts } from './random';

export const HISTORY_LIMIT = 100;
const BURST_MS = 400;

/** 新しく貼るデカールの下書き（モデルをタップすると確定） */
export type DecalDraft = Omit<Decal, 'id' | 'part' | 'position' | 'normal' | 'z'>;

export interface EditorState {
  design: SneakerDesign | null;
  selectedPart: PartId;
  selectedDecalId: string | null;
  placing: DecalDraft | null;
  moveMode: boolean;
  camera: CameraState | null;
  recentColors: string[];

  loadDesign: (d: SneakerDesign) => void;
  rename: (name: string) => void;
  selectPart: (p: PartId) => void;
  setPartColor: (p: PartId, color: string) => void;
  setMaterial: (p: PartId, m: MaterialId) => void;
  setPattern: (p: PartId, type: PatternType | null, colors?: string[]) => void;
  setPatternColor: (p: PartId, index: number, color: string) => void;
  pushRecentColor: (color: string) => void;
  setRecentColors: (c: string[]) => void;

  startPlacing: (draft: DecalDraft | null) => void;
  placeDecal: (part: PartId, position: Decal['position'], normal: Decal['normal']) => string | null;
  selectDecal: (id: string | null) => void;
  updateDecal: (id: string, patch: Partial<Decal>) => void;
  removeDecal: (id: string) => void;
  moveDecalZ: (id: string, dir: 'up' | 'down' | 'top' | 'bottom') => void;
  setMoveMode: (on: boolean) => void;

  randomize: (seed?: number) => void;
  mirror: (from: 'lateral' | 'medial') => void;
  setCamera: (c: CameraState) => void;
}

// ---- 連続操作（スライダーやカラーピッカーのドラッグ）を 1 手にまとめる ----
let burstTimer: ReturnType<typeof setTimeout> | null = null;
/** 次の変更を必ず新しい 1 手として記録させる（ボタン操作の前に呼ぶ） */
export function endBurst() {
  if (burstTimer) clearTimeout(burstTimer);
  burstTimer = null;
}

export const useEditor = create<EditorState>()(
  temporal(
    (set, get) => {
      const patchDesign = (fn: (d: SneakerDesign) => SneakerDesign) => {
        const d = get().design;
        if (!d) return;
        set({ design: fn(d) });
      };
      const patchPart = (p: PartId, fn: (s: PartStyle) => PartStyle) =>
        patchDesign((d) => ({ ...d, parts: { ...d.parts, [p]: fn(d.parts[p]) } }));

      return {
        design: null,
        selectedPart: 'upper',
        selectedDecalId: null,
        placing: null,
        moveMode: false,
        camera: null,
        recentColors: [],

        loadDesign: (d) => {
          set({ design: cloneDesign(d), selectedDecalId: null, placing: null, moveMode: false, camera: d.camera ?? null });
          endBurst();
          useEditor.temporal.getState().clear();
        },
        rename: (name) => patchDesign((d) => ({ ...d, name: name.slice(0, 60) })),
        selectPart: (p) => set({ selectedPart: p }),
        setPartColor: (p, color) => {
          const c = normalizeHex(color);
          if (!c) return;
          patchPart(p, (s) => ({ ...s, color: c }));
        },
        setMaterial: (p, m) => {
          endBurst();
          patchPart(p, (s) => ({ ...s, material: m }));
        },
        setPattern: (p, type, colors) => {
          endBurst();
          patchPart(p, (s) => {
            if (!type) {
              const { pattern: _omit, ...rest } = s;
              void _omit;
              return rest;
            }
            const def =
              type === 'camo'
                ? [s.color, '#3F4A2A', '#7A7F55', '#1C1F14']
                : type === 'gradient'
                  ? [s.color, '#C6FF00']
                  : [s.color, '#0E0E10'];
            return { ...s, pattern: { type, colors: colors ?? s.pattern?.colors ?? def } };
          });
        },
        setPatternColor: (p, index, color) => {
          const c = normalizeHex(color);
          if (!c) return;
          patchPart(p, (s) => {
            if (!s.pattern) return s;
            const colors = [...s.pattern.colors];
            colors[index] = c;
            return { ...s, pattern: { ...s.pattern, colors } };
          });
        },
        pushRecentColor: (color) => {
          const c = normalizeHex(color);
          if (!c) return;
          set({ recentColors: [c, ...get().recentColors.filter((x) => x !== c)].slice(0, 12) });
        },
        setRecentColors: (c) => set({ recentColors: c }),

        startPlacing: (draft) => set({ placing: draft, moveMode: false }),
        placeDecal: (part, position, normal) => {
          const { placing, design } = get();
          if (!placing || !design) return null;
          endBurst();
          const id = uid('dc_');
          const z = design.decals.reduce((m, d) => Math.max(m, d.z + 1), 0);
          const decal: Decal = { ...placing, id, part, position, normal, z };
          set({ design: { ...design, decals: [...design.decals, decal] }, placing: null, selectedDecalId: id });
          return id;
        },
        selectDecal: (id) => set({ selectedDecalId: id, moveMode: id ? get().moveMode : false }),
        updateDecal: (id, patch) =>
          patchDesign((d) => ({ ...d, decals: d.decals.map((x) => (x.id === id ? { ...x, ...patch, id } : x)) })),
        removeDecal: (id) => {
          endBurst();
          patchDesign((d) => ({ ...d, decals: d.decals.filter((x) => x.id !== id) }));
          if (get().selectedDecalId === id) set({ selectedDecalId: null, moveMode: false });
        },
        moveDecalZ: (id, dir) => {
          endBurst();
          patchDesign((d) => {
            const sorted = [...normalizeZ(d.decals)].sort((a, b) => a.z - b.z);
            const i = sorted.findIndex((x) => x.id === id);
            if (i < 0) return d;
            const [item] = sorted.splice(i, 1);
            const j = dir === 'up' ? Math.min(i + 1, sorted.length) : dir === 'down' ? Math.max(i - 1, 0) : dir === 'top' ? sorted.length : 0;
            sorted.splice(j, 0, item);
            const zmap = new Map(sorted.map((x, k) => [x.id, k]));
            return { ...d, decals: d.decals.map((x) => ({ ...x, z: zmap.get(x.id)! })) };
          });
        },
        setMoveMode: (on) => set({ moveMode: on, placing: on ? null : get().placing }),

        randomize: (seed) => {
          endBurst();
          patchDesign((d) => ({ ...d, parts: randomParts(seed ?? Date.now() + Math.floor(Math.random() * 1e6)) }));
        },
        mirror: (from) => {
          endBurst();
          patchDesign((d) => ({ ...d, decals: mirrorDecals(d.decals, from) }));
        },
        setCamera: (c) => set({ camera: c }),
      };
    },
    {
      limit: HISTORY_LIMIT,
      // 履歴に残すのは作品データだけ（選択状態やカメラは対象外）
      partialize: (s) => ({ design: s.design }),
      equality: (a, b) => a.design === b.design,
      handleSet: (handleSet) =>
        ((...args: Parameters<typeof handleSet>) => {
          if (burstTimer === null) handleSet(...args);
          else clearTimeout(burstTimer);
          burstTimer = setTimeout(() => {
            burstTimer = null;
          }, BURST_MS);
        }) as typeof handleSet,
    },
  ),
);

export const undo = () => {
  endBurst();
  useEditor.temporal.getState().undo();
};
export const redo = () => {
  endBurst();
  useEditor.temporal.getState().redo();
};
