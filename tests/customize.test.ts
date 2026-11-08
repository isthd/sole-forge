import { beforeEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  BASE_MODEL_IDS,
  PART_IDS,
  SHAPE_KEYS,
  SHAPE_OPTIONS,
  countTriangles,
  getBaseModel,
  getDesignModel,
  getGeometries,
  modelOf,
  normalizeShape,
  shapeKey,
} from '../src/models';
import type { ShapeOptions } from '../src/models/types';
import { createDesign } from '../src/models/design';
import { useEditor, undo, redo, endBurst } from '../src/store/editorStore';
import { migrate } from '../src/db/backup';
import { surfaceOf } from '../src/renderers/three/textures';
import { classifyChange } from '../src/renderers/three/fx/processMath';

const s = () => useEditor.getState();
const maxY = (g: THREE.BufferGeometry) => {
  g.computeBoundingBox();
  return g.boundingBox!.max.y;
};
const width = (g: THREE.BufferGeometry, axis: 'x' | 'y' | 'z') => {
  g.computeBoundingBox();
  return g.boundingBox!.max[axis] - g.boundingBox!.min[axis];
};

describe('パーツの形の選択', () => {
  it('すべて標準なら（標準の値を明示しても）ベース型そのものを返す', () => {
    for (const id of BASE_MODEL_IDS) {
      expect(getDesignModel(id, undefined)).toBe(getBaseModel(id));
      expect(getDesignModel(id, { toeCap: 'standard', eyelets: '7', pullTab: 'auto' })).toBe(getBaseModel(id));
    }
  });

  it('同じ組み合わせには同じ定義を返し、キーは並び順によらない', () => {
    const a = getDesignModel('hicut-01', { laceWidth: 'thick', toeCap: 'long' });
    const b = getDesignModel('hicut-01', { toeCap: 'long', laceWidth: 'thick' });
    expect(a).toBe(b);
    expect(a.key).toBe('hicut-01|toeCap=long,laceWidth=thick');
    expect(a.params).toEqual(getBaseModel('hicut-01').params);
    expect(modelOf({ baseModel: 'hicut-01', shape: { toeCap: 'long', laceWidth: 'thick' } })).toBe(a);
  });

  it('不正な値・標準の値は取り除く', () => {
    expect(normalizeShape({ toeCap: 'huge', laceTie: 'tucked', eyelets: 6, sidePanel: 'hex', foo: 'bar' })).toEqual({ laceTie: 'tucked' });
    expect(normalizeShape(null)).toEqual({});
    expect(shapeKey({})).toBe('');
  });

  it.each(SHAPE_KEYS)('%s: どの選択肢・どのベース型でも有効なジオメトリができる', (key) => {
    for (const id of BASE_MODEL_IDS) {
      for (const c of SHAPE_OPTIONS[key].choices) {
        const def = getDesignModel(id, { [key]: c.value } as ShapeOptions);
        const geos = getGeometries(def);
        for (const p of PART_IDS) {
          const pos = geos[p].getAttribute('position').array as Float32Array;
          expect(pos.length, `${id} ${key}=${c.value} ${p}`).toBeGreaterThan(30);
          expect(pos.every((v) => Number.isFinite(v)), `${id} ${key}=${c.value} ${p} finite`).toBe(true);
        }
      }
    }
  });

  it('一番ポリゴンが多い組み合わせでも 1 足 5 万ポリゴン以下', () => {
    const heavy: ShapeOptions = { sidePanel: 'quarter', mudguard: 'high', toeCap: 'long', heelCounter: 'high', pullTab: 'long', laceWidth: 'thick', laceStyle: 'cross', laceTie: 'bow', eyelets: '7' };
    for (const id of BASE_MODEL_IDS) expect(countTriangles(getGeometries(getDesignModel(id, heavy))) * 2).toBeLessThanOrEqual(50000);
  });

  it('選択に応じて形が変わる', () => {
    const g = (shape: ShapeOptions) => getGeometries(getDesignModel('hicut-01', shape));
    // トゥキャップ: ロング > 標準 > ショート（上端の高さ）
    expect(maxY(g({ toeCap: 'long' }).toe)).toBeGreaterThan(maxY(g({}).toe));
    expect(maxY(g({}).toe)).toBeGreaterThan(maxY(g({ toeCap: 'short' }).toe));
    // ヒール: 高め > 低め
    expect(maxY(g({ heelCounter: 'high' }).heel)).toBeGreaterThan(maxY(g({ heelCounter: 'low' }).heel) + 0.2);
    // プルタブ: ロングはヒールが履き口より上へ伸びる
    expect(maxY(g({ pullTab: 'long' }).heel)).toBeGreaterThan(maxY(g({}).heel) + 0.15);
    // シュータン: ロング > ショート
    expect(maxY(g({ tongue: 'long' }).tongue)).toBeGreaterThan(maxY(g({ tongue: 'short' }).tongue));
    // サドルは六角より縦に大きい
    expect(width(g({ sidePanel: 'saddle' }).sidePanel, 'y')).toBeGreaterThan(width(g({}).sidePanel, 'y') + 0.3);
    // ハトメの数でアイステイの頂点数が変わる
    expect(g({ eyelets: '5' }).eyestay.getAttribute('position').count).toBeLessThan(g({}).eyestay.getAttribute('position').count);
    // 太いひもは細いひもより太い（同じ本数・同じ頂点数で、甲からの浮きも大きい）
    expect(maxY(g({ laceWidth: 'thick' }).laces)).toBeGreaterThan(maxY(g({ laceWidth: 'thin' }).laces));
    // 結ばないと蝶結びのループが無くなる
    expect(g({ laceTie: 'tucked' }).laces.getAttribute('position').count).toBeLessThan(g({}).laces.getAttribute('position').count);
  });

  it('ランナーのプルタブは「なし」で消せる', () => {
    const base = getGeometries(getBaseModel('hightop-01'));
    const none = getGeometries(getDesignModel('hightop-01', { pullTab: 'none' }));
    expect(maxY(none.heel)).toBeLessThan(maxY(base.heel) - 0.08);
  });
});

describe('形・ツヤ・柄の大きさの編集（ストア）', () => {
  beforeEach(() => {
    // 形がすべて標準の作品（新しい作品はクォーターとマッドガード付きで始まるので、ここでは外す）
    const d = createDesign('t', 0, 'hicut-01');
    delete d.shape;
    s().loadDesign(d);
    endBurst();
  });

  it('新しい作品はソールからアイステイまでつながるクォーターと低めのマッドガードで始まる', () => {
    const d = createDesign('n', 0, 'hicut-01');
    expect(d.shape).toEqual({ sidePanel: 'quarter', mudguard: 'low' });
    // クォーターは靴底（h=0）からアイステイ（h≈0.86）の下まで届く。マッドガードはトゥに含まれ、トゥが一周近く伸びる
    const g = getGeometries(modelOf(d));
    const plain = getGeometries(getBaseModel('hicut-01'));
    g.toe.computeBoundingBox();
    plain.toe.computeBoundingBox();
    expect(g.toe.boundingBox!.min.x).toBeLessThan(plain.toe.boundingBox!.min.x - 1);
    g.sidePanel.computeBoundingBox();
    expect(g.sidePanel.boundingBox!.min.y).toBeLessThan(plain.sidePanel.boundingBox!.min.y - 0.2);
  });

  it('形の変更は 1 手で記録され、デカールは新しい表面へ載せ直され、Undo で戻る', () => {
    s().startPlacing({ kind: 'logo', src: 'logo:hex', scale: 0.3, rotation: 0, flip: false });
    // 六角パネルの中央付近（外側）
    const geo = getGeometries(getBaseModel('hicut-01')).sidePanel;
    geo.computeBoundingBox();
    const c = geo.boundingBox!.getCenter(new THREE.Vector3());
    s().placeDecal('sidePanel', [c.x, c.y, 0.6], [0, 0, 1]);
    const before = s().design!.decals[0];
    endBurst();
    const n = useEditor.temporal.getState().pastStates.length;
    s().setShape('sidePanel', 'saddle');
    expect(useEditor.temporal.getState().pastStates.length).toBe(n + 1);
    expect(s().design!.shape).toEqual({ sidePanel: 'saddle' });
    const after = s().design!.decals[0];
    expect(after.id).toBe(before.id);
    expect(after.position).not.toEqual(before.position); // 新しい表面へ投影し直した
    expect(after.part).toBe('sidePanel');
    // 同じ値を選び直しても履歴は増えない
    s().setShape('sidePanel', 'saddle');
    expect(useEditor.temporal.getState().pastStates.length).toBe(n + 1);
    undo();
    expect(s().design!.shape).toBeUndefined();
    expect(s().design!.decals[0].position).toEqual(before.position);
    redo();
    expect(s().design!.shape?.sidePanel).toBe('saddle');
  });

  it('標準に戻すと shape を消す / 型を切り替えても形の選択は残る', () => {
    s().setShape('toeCap', 'long');
    s().setShape('laceWidth', 'thick');
    s().resetShape(['toeCap']);
    expect(s().design!.shape).toEqual({ laceWidth: 'thick' });
    s().resetShape(['laceWidth']);
    expect(s().design!.shape).toBeUndefined();
    s().setShape('heelCounter', 'high');
    s().setBaseModel('lowtop-01');
    expect(s().design!.shape).toEqual({ heelCounter: 'high' });
  });

  it('ツヤは -1〜1 に収め、0 なら保存しない。連続操作は 1 手', () => {
    const n = useEditor.temporal.getState().pastStates.length;
    for (let i = 1; i <= 10; i++) s().setFinish('upper', i / 5);
    expect(s().design!.parts.upper.finish).toBe(1);
    expect(useEditor.temporal.getState().pastStates.length).toBe(n + 1);
    s().setFinish('upper', -3);
    expect(s().design!.parts.upper.finish).toBe(-1);
    s().setFinish('upper', 0);
    expect('finish' in s().design!.parts.upper).toBe(false);
  });

  it('柄の大きさ・向き。種類を変えても引き継ぎ、柄なしでは何もしない', () => {
    s().setPatternScale('toe', 1.5);
    expect(s().design!.parts.toe.pattern).toBeUndefined();
    s().setPattern('toe', 'stripe');
    s().setPatternScale('toe', 5);
    s().setPatternDirection('toe', 'd');
    expect(s().design!.parts.toe.pattern).toMatchObject({ type: 'stripe', scale: 2, direction: 'd' });
    s().setPattern('toe', 'splatter');
    expect(s().design!.parts.toe.pattern).toMatchObject({ type: 'splatter', scale: 2, direction: 'd' });
    expect(s().design!.parts.toe.pattern!.colors.length).toBeGreaterThanOrEqual(2);
    s().setPatternScale('toe', 1);
    s().setPatternDirection('toe', 'h');
    expect(Object.keys(s().design!.parts.toe.pattern!).sort()).toEqual(['colors', 'type']);
  });
});

describe('ツヤ・素材の見た目', () => {
  it('光沢側で粗さが下がり、マット側で上がる', () => {
    for (const material of ['leather', 'suede', 'knit', 'metallic', 'rubber', 'patent'] as const) {
      const mid = surfaceOf({ material });
      expect(surfaceOf({ material, finish: 1 }).roughness, material).toBeLessThan(mid.roughness + 1e-9);
      expect(surfaceOf({ material, finish: -1 }).roughness, material).toBeGreaterThanOrEqual(mid.roughness);
      expect(surfaceOf({ material, finish: -1 }).roughness, material).toBeCloseTo(1);
    }
    expect(surfaceOf({ material: 'patent', finish: -1 }).clearcoat).toBe(0);
  });

  it('ツヤの変化は素材の張り替えとして演出する', () => {
    expect(classifyChange({ color: '#FFFFFF', material: 'leather' }, { color: '#FFFFFF', material: 'leather', finish: 0.5 })).toBe('material');
  });
});

describe('JSON バックアップ', () => {
  it('形・ツヤ・柄の大きさと向きを保ち、不正な値は落とす', () => {
    const file = migrate({
      app: 'sole-forge',
      schemaVersion: 1,
      designs: [
        {
          name: 'a',
          baseModel: 'midcut-01',
          shape: { toeCap: 'straight', eyelets: '5', laceTie: 'zip', sidePanel: 'hex' },
          parts: {
            upper: { color: '#112233', material: 'knit', finish: 0.4, pattern: { type: 'marble', colors: ['#FFFFFF', '#000000'], scale: 9, direction: 'v' } },
            toe: { color: '#112233', material: 'metallic', finish: 'shiny', pattern: { type: 'stripe', colors: ['#FFFFFF'], direction: 'x' } },
          },
        },
      ],
    });
    const d = file.designs[0];
    expect(d.shape).toEqual({ toeCap: 'straight', eyelets: '5' });
    expect(d.parts.upper).toEqual({ color: '#112233', material: 'knit', finish: 0.4, pattern: { type: 'marble', colors: ['#FFFFFF', '#000000'], scale: 2, direction: 'v' } });
    expect(d.parts.toe.material).toBe('metallic');
    expect(d.parts.toe.finish).toBeUndefined();
    expect(d.parts.toe.pattern?.direction).toBeUndefined();
    expect(migrate({ app: 'sole-forge', schemaVersion: 1, designs: [{ name: 'b' }] }).designs[0].shape).toBeUndefined();
  });
});
