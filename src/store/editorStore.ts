import { create } from 'zustand';
import { temporal } from 'zundo';
import type {
  BaseModelId,
  CameraState,
  Decal,
  MaterialId,
  PartId,
  PartStyle,
  PatternDirection,
  PatternType,
  ShapeKey,
  ShapeOptions,
  SneakerDesign,
} from '../models/types';
import { PATTERN_SCALE_MAX, PATTERN_SCALE_MIN } from '../models/types';
import { cloneDesign, mirrorDecals, normalizeHex, normalizeZ, uid } from '../models/design';
import { randomParts } from './random';
import { getDesignModel } from '../models';
import { normalizeShape, shapeKey } from '../models/shape';
import { reprojectDecals } from '../models/reproject';

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
  /** スプレーモード: モデルのパーツをタップすると brushColor で塗る */
  sprayMode: boolean;
  brushColor: string;
  camera: CameraState | null;
  recentColors: string[];

  loadDesign: (d: SneakerDesign) => void;
  rename: (name: string) => void;
  /** ベース型を切り替える（デカールは新しい型の表面へ載せ直す）。1 手として記録 */
  setBaseModel: (id: BaseModelId) => void;
  selectPart: (p: PartId) => void;
  setPartColor: (p: PartId, color: string) => void;
  setMaterial: (p: PartId, m: MaterialId) => void;
  setPattern: (p: PartId, type: PatternType | null, colors?: string[]) => void;
  setPatternColor: (p: PartId, index: number, color: string) => void;
  /** 柄の大きさ（スライダー。連続操作は 1 手にまとまる） */
  setPatternScale: (p: PartId, scale: number) => void;
  setPatternDirection: (p: PartId, dir: PatternDirection) => void;
  /** ツヤ（-1 マット 〜 1 光沢。スライダー） */
  setFinish: (p: PartId, finish: number) => void;
  /** パーツの形を変える（デカールは新しい表面へ載せ直す）。1 手として記録 */
  setShape: <K extends ShapeKey>(key: K, value: NonNullable<ShapeOptions[K]>) => void;
  /** 指定した形の項目を標準に戻す（1 手） */
  resetShape: (keys: ShapeKey[]) => void;
  pushRecentColor: (color: string) => void;
  setRecentColors: (c: string[]) => void;

  startPlacing: (draft: DecalDraft | null) => void;
  placeDecal: (part: PartId, position: Decal['position'], normal: Decal['normal']) => string | null;
  selectDecal: (id: string | null) => void;
  updateDecal: (id: string, patch: Partial<Decal>) => void;
  removeDecal: (id: string) => void;
  moveDecalZ: (id: string, dir: 'up' | 'down' | 'top' | 'bottom') => void;
  setMoveMode: (on: boolean) => void;
  setSprayMode: (on: boolean) => void;
  setBrushColor: (color: string) => void;
  /** スプレーモードでタップしたパーツを塗る（1 手） */
  sprayPart: (p: PartId) => void;

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
      /** 形を差し替え、デカールを新しい表面へ載せ直す */
      const applyShape = (raw: ShapeOptions) => {
        const d = get().design;
        if (!d) return;
        const shape = normalizeShape(raw);
        if (shapeKey(shape) === shapeKey(d.shape)) return;
        endBurst();
        const decals = reprojectDecals(d.decals, getDesignModel(d.baseModel, d.shape), getDesignModel(d.baseModel, shape));
        const next: SneakerDesign = { ...d, decals, shape };
        if (!Object.keys(shape).length) delete next.shape;
        set({ design: next });
      };

      return {
        design: null,
        selectedPart: 'upper',
        selectedDecalId: null,
        placing: null,
        moveMode: false,
        sprayMode: false,
        brushColor: '#C6FF00',
        camera: null,
        recentColors: [],

        loadDesign: (d) => {
          set({ design: cloneDesign(d), selectedDecalId: null, placing: null, moveMode: false, camera: d.camera ?? null });
          endBurst();
          useEditor.temporal.getState().clear();
        },
        rename: (name) => patchDesign((d) => ({ ...d, name: name.slice(0, 60) })),
        setBaseModel: (id) => {
          const d = get().design;
          if (!d || d.baseModel === id) return;
          endBurst();
          const decals = reprojectDecals(d.decals, getDesignModel(d.baseModel, d.shape), getDesignModel(id, d.shape));
          // 型ごとに高さが違うので、保存していた角度は使わず新しい型の標準の角度に戻す
          set({ design: { ...d, baseModel: id, decals, camera: undefined }, camera: null });
        },
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
                  : type === 'splatter'
                    ? [s.color, '#0E0E10', '#C6FF00']
                    : type === 'marble'
                      ? [s.color, '#2A2A30', '#B8B8BE']
                      : [s.color, '#0E0E10'];
            // 大きさ・向きは柄の種類を変えても引き継ぐ
            return { ...s, pattern: { ...s.pattern, type, colors: colors ?? s.pattern?.colors ?? def } };
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
        setPatternScale: (p, scale) => {
          if (!Number.isFinite(scale)) return;
          const v = Math.round(Math.min(PATTERN_SCALE_MAX, Math.max(PATTERN_SCALE_MIN, scale)) * 100) / 100;
          patchPart(p, (s) => {
            if (!s.pattern) return s;
            const { scale: _old, ...rest } = s.pattern;
            void _old;
            return { ...s, pattern: v === 1 ? rest : { ...rest, scale: v } };
          });
        },
        setPatternDirection: (p, dir) => {
          endBurst();
          patchPart(p, (s) => {
            if (!s.pattern) return s;
            const { direction: _old, ...rest } = s.pattern;
            void _old;
            return { ...s, pattern: dir === 'h' ? rest : { ...rest, direction: dir } };
          });
        },
        setFinish: (p, finish) => {
          if (!Number.isFinite(finish)) return;
          const v = Math.round(Math.min(1, Math.max(-1, finish)) * 100) / 100;
          patchPart(p, (s) => {
            const { finish: _old, ...rest } = s;
            void _old;
            return v === 0 ? rest : { ...rest, finish: v };
          });
        },
        setShape: (key, value) => applyShape({ ...get().design?.shape, [key]: value }),
        resetShape: (keys) => {
          const cur = { ...get().design?.shape } as Record<string, unknown>;
          for (const k of keys) delete cur[k];
          applyShape(cur as ShapeOptions);
        },
        pushRecentColor: (color) => {
          const c = normalizeHex(color);
          if (!c) return;
          set({ recentColors: [c, ...get().recentColors.filter((x) => x !== c)].slice(0, 12) });
        },
        setRecentColors: (c) => set({ recentColors: c }),

        startPlacing: (draft) => set({ placing: draft, moveMode: false, sprayMode: draft ? false : get().sprayMode }),
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
        setMoveMode: (on) => set({ moveMode: on, placing: on ? null : get().placing, sprayMode: on ? false : get().sprayMode }),
        setSprayMode: (on) => {
          const s = get();
          set({
            sprayMode: on,
            placing: on ? null : s.placing,
            moveMode: on ? false : s.moveMode,
            selectedDecalId: on ? null : s.selectedDecalId,
          });
        },
        setBrushColor: (color) => {
          const c = normalizeHex(color);
          if (c) set({ brushColor: c });
        },
        sprayPart: (p) => {
          const { brushColor, design } = get();
          if (!design) return;
          endBurst();
          set({ selectedPart: p });
          if (design.parts[p].color !== brushColor || design.parts[p].pattern) {
            patchPart(p, (s) => {
              const { pattern: _omit, ...rest } = s;
              void _omit;
              return { ...rest, color: brushColor };
            });
          }
          get().pushRecentColor(brushColor);
          endBurst();
        },

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
