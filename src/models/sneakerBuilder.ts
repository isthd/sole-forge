/**
 * スニーカーの共通パーツ生成（SOLE FORGE オリジナル形状）。
 * 寸法パラメータを変えるだけで、ハイカット・ミッドカット・ローカット・厚底などの型を作れる。
 * 型を追加するときは、defineSneaker() で BaseModelDef を返すファイルを 1 つ足して registry に登録する。
 *
 * 座標系: x = かかと(-) → つま先(+), y = 上, z = 外側(+) / 内側(-)。単位はおよそ 10cm。
 */
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { BaseModelId, PartId, ShapeOptions, Vec3 } from './types';
import type { BaseModelDef, PartGeometries } from './baseModel';
import { shapeValue } from './shape';

export interface SneakerParams {
  length: number; // 全長
  halfWidth: number; // ボール部の半幅
  superN: number; // 足形の丸み（スーパー楕円の指数）
  outsoleThickness: number;
  soleThickness: number; // ソール上面の高さ
  toeSpring: number; // つま先の反り
  throatHeight: number; // 履き口（甲）前端の高さ
  collarHeight: number; // 履き口前側の高さ
  collarBackHeight: number; // 履き口うしろの高さ
  collarDip: number; // 履き口の両脇（くるぶし下）の切れ込みの深さ
  /**
   * 形のスタイル。classic = 平らなソールの定番型、runner = ランニング型
   * （かかと側が厚いソール・かかとの立ち上がり・跳ね上げ・丸いトゥ・細いかかと）
   */
  style?: 'classic' | 'runner';
  soleHeelThickness?: number; // runner: ソール上面の高さ（かかと側。厚底のドロップ）
  midsoleLip?: number; // runner: かかとでミッドソールがアッパーを包み込む立ち上がり
  heelRocker?: number; // runner: かかと底の跳ね上げ
  pullTab?: number; // かかとのプルタブの長さ（0 / 省略で無し）
}


const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const smooth = (e0: number, e1: number, x: number) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};
const wrap01 = (s: number) => ((s % 1) + 1) % 1;

export function createSneakerShape(p: SneakerParams) {
  const a = p.length / 2;
  const runner = p.style === 'runner';
  const widthAt = runner
    ? (x: number) => p.halfWidth * (0.7 + 0.3 * Math.exp(-(((x - 0.3) / 0.9) ** 2))) * (1 - 0.05 * smooth(0.6, 1.5, x))
    : (x: number) => p.halfWidth * (0.8 + 0.2 * Math.exp(-(((x - 0.35) / 0.75) ** 2)));

  /** 足形（ソール上面の輪郭）。theta: 0 = つま先, π = かかと, (0,π) が外側 */
  const rawOutline = (theta: number): [number, number] => {
    const c = Math.cos(theta);
    const s = Math.sin(theta);
    // runner はつま先側を楕円に近い丸み、かかと側を少し角ばらせる
    const e = 2 / (runner && c > 0 ? 2.2 : p.superN);
    const x = a * Math.sign(c) * Math.abs(c) ** e;
    const zn = Math.sign(s) * Math.abs(s) ** e;
    return [x, widthAt(x) * zn];
  };
  const outline = (theta: number, inflate: number): [number, number] => {
    const [x, z] = rawOutline(theta);
    if (inflate === 0) return [x, z];
    const d = 1e-3;
    const [x1, z1] = rawOutline(theta - d);
    const [x2, z2] = rawOutline(theta + d);
    let nx = z2 - z1;
    let nz = -(x2 - x1);
    const len = Math.hypot(nx, nz) || 1;
    nx /= len;
    nz /= len;
    if (nx * x / (a * a) + nz * z / (p.halfWidth * p.halfWidth) < 0) {
      nx = -nx;
      nz = -nz;
    }
    return [x + nx * inflate, z + nz * inflate];
  };

  // ベース輪郭上で、履き口の前端（甲の終わり）に対応する角度
  const xMid = -0.35;
  let lo = 0;
  let hi = Math.PI;
  for (let i = 0; i < 40; i++) {
    const m = (lo + hi) / 2;
    if (rawOutline(m)[0] > xMid) lo = m;
    else hi = m;
  }
  const thetaMid = (lo + hi) / 2;

  /** つま先の反り */
  const warp = (v: THREE.Vector3) => {
    v.y += p.toeSpring * smooth(0.4, a + 0.1, v.x) ** 1.6;
    return v;
  };

  const sideOf = (s: number) => {
    const w = wrap01(s);
    return w <= 0.5 ? { u: w / 0.5, sign: 1 } : { u: (1 - w) / 0.5, sign: -1 };
  };

  /** ソール上面（足を乗せる面）の高さ。runner はかかとが高い厚底 */
  const heelT = p.soleHeelThickness ?? p.soleThickness;
  const soleTop = runner
    ? (x: number) => lerp(heelT, p.soleThickness, smooth(-1.15, -0.05, x)) - 0.05 * smooth(0.5, 1.5, x)
    : () => p.soleThickness;
  /** ミッドソール上端。runner はかかと周りでアッパーを包むように立ち上がる */
  const midsoleTop = (x: number) => soleTop(x) + 0.02 + (p.midsoleLip ?? 0) * (1 - smooth(-1.0, -0.15, x));
  /** かかと底の跳ね上げ（ソールの下側だけ持ち上げる） */
  const rocker = (v: THREE.Vector3) => {
    const r = p.heelRocker ?? 0;
    if (r) v.y += r * smooth(-0.9, -1.6, v.x) ** 2 * (1 - clamp(v.y / 0.35, 0, 1));
    return v;
  };
  const yBase = (x: number) => soleTop(x) - 0.06;
  const baseP = (s: number) => {
    const { u, sign } = sideOf(s);
    const th = u <= 0.5 ? (u / 0.5) * thetaMid : thetaMid + ((u - 0.5) / 0.5) * (Math.PI - thetaMid);
    const [x, z] = outline(th, 0);
    return V(x, yBase(x), z * sign);
  };

  const phi0 = (40 * Math.PI) / 180;
  const topP = (s: number) => {
    const { u, sign } = sideOf(s);
    let x: number, y: number, z: number;
    if (u <= 0.5) {
      const t = u / 0.5; // 甲（アイステイ縁）
      x = lerp(0.55, -0.56, t);
      y = p.throatHeight + (p.collarHeight - p.throatHeight) * t ** 0.9;
      z = 0.21 * Math.sin((Math.min(t / 0.15, 1) * Math.PI) / 2) + 0.047 * t;
    } else {
      const t = (u - 0.5) / 0.5; // 履き口（カラー）
      const phi = lerp(phi0, Math.PI, t);
      x = -0.92 + 0.47 * Math.cos(phi);
      if (runner) {
        z = 0.37 * Math.sin(phi);
        // 前端（シューレース上端）→ くるぶしで下がる → かかとで持ち上がる
        y = lerp(p.collarHeight, p.collarBackHeight, smooth(0, 1, t)) - p.collarDip * Math.sin(Math.PI * t ** 0.9) ** 1.4;
      } else {
        z = 0.4 * Math.sin(phi);
        y = p.collarHeight + (p.collarBackHeight - p.collarHeight) * t ** 1.5 - p.collarDip * Math.sin(Math.PI * t) ** 1.5;
      }
    }
    return V(x, y, z * sign);
  };

  /** アッパー曲面: 足形の輪郭(h=0) と 履き口の輪郭(h=1) を断面の 3 次曲線でつなぐ */
  const upperRaw = (s: number, h: number) => {
    const B = baseP(s);
    const T = topP(s);
    const dir = V(T.x - B.x, 0, T.z - B.z);
    const dh = dir.length();
    if (dh > 1e-6) dir.divideScalar(dh);
    const dv = T.y - B.y;
    const k = clamp((dh / dv) * 1.2, 0, 1);
    // つま先側(k≈1)は低く寝かせたトゥボックス、かかと側(k≈0)はほぼ垂直に立ち上げる
    // classic: つま先側(k≈1)は低く寝かせたトゥボックス / runner: 丸く盛り上がったトゥボックス。かかと側(k≈0)はほぼ垂直
    const C1 = B.clone()
      .add(V(0, dv * (0.5 - (runner ? 0.06 : 0.2) * k), 0))
      .addScaledVector(dir, dh * (runner ? 0.08 : 0.2) * k - 0.05);
    const C2 = T.clone()
      .addScaledVector(dir, -dh * (runner ? 0.66 : 0.7) * k)
      .add(V(0, -dv * 0.35 * (1 - k) - dv * (runner ? 0.2 : 0.22) * k, 0));
    const it = 1 - h;
    return B.multiplyScalar(it * it * it)
      .addScaledVector(C1, 3 * it * it * h)
      .addScaledVector(C2, 3 * it * h * h)
      .addScaledVector(T, h * h * h);
  };
  const upperP = (s: number, h: number) => warp(upperRaw(s, h));

  // 法線（外向き）
  const eps = 1e-4;
  const tangents = (s: number, h: number) => {
    const ds = upperP(s + eps, h).sub(upperP(s - eps, h));
    const h0 = clamp(h - eps, 0, 1);
    const h1 = clamp(h + eps, 0, 1);
    const dh = upperP(s, h1).sub(upperP(s, h0));
    return { ds, dh };
  };
  const rawNormal = (s: number, h: number) => {
    const { ds, dh } = tangents(s, h);
    return ds.cross(dh).normalize();
  };
  const normalSign = rawNormal(0.25, 0.5).z > 0 ? 1 : -1;
  const upperN = (s: number, h: number) => rawNormal(s, h).multiplyScalar(normalSign);

  return { a, p, runner, outline, warp, rocker, soleTop, midsoleTop, upperP, upperN, tangents, topP, baseP, yBase };
}

type Shape = ReturnType<typeof createSneakerShape>;

interface Band {
  s0: number;
  s1: number;
  lo: (s: number) => number;
  hi: (s: number) => number;
  nu: number;
  nv: number;
}

/**
 * (s,h) の帯領域を、法線方向に offset ずらした曲面メッシュにする。
 * skin（アッパー全体の実寸）を渡すと、アッパーと共通の座標 uv1 = (s,h) も付ける。
 * 素材の凹凸（ノーマルマップ）とタイル柄はこの uv1 で貼るので、同じ色・素材ならパーツの境目でシボや柄が途切れない。
 */
function surface(
  shape: Shape,
  bands: Band[],
  offset: number,
  inward = false,
  skin: [number, number] | null = null,
  rim = 0,
): THREE.BufferGeometry {
  const geos: THREE.BufferGeometry[] = [];
  let sizeU = 0;
  let sizeV = 0;
  for (const b of bands) {
    const pos: number[] = [];
    const nor: number[] = [];
    const uv: number[] = [];
    const uv1: number[] = [];
    const idx: number[] = [];
    const rowLen = b.nu + 1;
    for (let i = 0; i <= b.nu; i++) {
      const s = lerp(b.s0, b.s1, i / b.nu);
      const lo = b.lo(s);
      const hi = b.hi(s);
      for (let j = 0; j <= b.nv; j++) {
        const h = lerp(lo, hi, j / b.nv);
        const n = shape.upperN(s, h);
        const pt = shape.upperP(s, h).addScaledVector(n, offset);
        if (inward) n.negate();
        pos.push(pt.x, pt.y, pt.z);
        nor.push(n.x, n.y, n.z);
        uv.push(i / b.nu, j / b.nv);
        // s は折り返さない（つま先の帯は負になる）。繰り返し回数は整数なので s と s+1 は同じ模様になる
        uv1.push(s, h);
      }
    }
    // 巻き方向を法線に合わせる
    const sc = lerp(b.s0, b.s1, 0.5);
    const hc = lerp(b.lo(sc), b.hi(sc), 0.5);
    const { ds, dh } = shape.tangents(sc, hc);
    const geomN = ds.multiplyScalar(Math.sign(b.s1 - b.s0)).cross(dh);
    const want = shape.upperN(sc, hc).multiplyScalar(inward ? -1 : 1);
    const flip = geomN.dot(want) < 0;
    for (let i = 0; i < b.nu; i++) {
      for (let j = 0; j < b.nv; j++) {
        const A = i * (b.nv + 1) + j;
        const B = (i + 1) * (b.nv + 1) + j;
        const C = B + 1;
        const D = A + 1;
        if (!flip) idx.push(A, B, D, B, C, D);
        else idx.push(A, D, B, B, D, C);
      }
    }
    void rowLen;
    if (rim > 0 && !inward) addRolledEdge(b, pos, nor, uv, uv1, idx, rim);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    if (skin) g.setAttribute('uv1', new THREE.Float32BufferAttribute(uv1, 2));
    g.setIndex(idx);
    geos.push(g);
    // UV の実寸（柄のタイル密度に使う）
    const mid = Math.floor(b.nv / 2);
    let lu = 0;
    for (let i = 0; i < b.nu; i++) {
      const p0 = i * (b.nv + 1) + mid;
      const p1 = (i + 1) * (b.nv + 1) + mid;
      lu += Math.hypot(pos[p1 * 3] - pos[p0 * 3], pos[p1 * 3 + 1] - pos[p0 * 3 + 1], pos[p1 * 3 + 2] - pos[p0 * 3 + 2]);
    }
    let lv = 0;
    const ci = Math.floor(b.nu / 2) * (b.nv + 1);
    for (let j = 0; j < b.nv; j++) {
      const p0 = ci + j;
      const p1 = ci + j + 1;
      lv += Math.hypot(pos[p1 * 3] - pos[p0 * 3], pos[p1 * 3 + 1] - pos[p0 * 3 + 1], pos[p1 * 3 + 2] - pos[p0 * 3 + 2]);
    }
    sizeU = Math.max(sizeU, lu);
    sizeV = Math.max(sizeV, lv);
  }
  const g = geos.length === 1 ? geos[0] : mergeGeometries(geos)!;
  g.userData.uvSize = [sizeU, sizeV];
  if (skin) g.userData.uv1Size = skin;
  return g;
}

/**
 * 浮いて重なるパーツの縁を丸く折り返して、アッパーの表面に沈める（革を重ねて縫い付けたような縁）。
 * 縁が紙のように薄いと、アッパーと色が違うときにシールを貼ったように見えるため。
 * r は浮かせた高さ（offset）。縁の外側へ r だけ広げながら 1/4 円で下り、最後は少しアッパーの下へ潜らせる。
 */
function addRolledEdge(b: Band, pos: number[], nor: number[], uv: number[], uv1: number[], idx: number[], r: number) {
  const nv1 = b.nv + 1;
  const at = (i: number, j: number) => i * nv1 + j;
  // 帯の外周を一周（重複点は除く）
  const ring: number[] = [];
  for (let i = 0; i <= b.nu; i++) ring.push(at(i, 0));
  for (let j = 1; j <= b.nv; j++) ring.push(at(b.nu, j));
  for (let i = b.nu - 1; i >= 0; i--) ring.push(at(i, b.nv));
  for (let j = b.nv - 1; j >= 1; j--) ring.push(at(0, j));
  const P = (k: number) => V(pos[k * 3], pos[k * 3 + 1], pos[k * 3 + 2]);
  const loop: number[] = [];
  for (const k of ring) {
    if (loop.length && P(loop[loop.length - 1]).distanceToSquared(P(k)) < 1e-12) continue;
    loop.push(k);
  }
  if (loop.length > 1 && P(loop[0]).distanceToSquared(P(loop[loop.length - 1])) < 1e-12) loop.pop();
  const L = loop.length;
  if (L < 3) return;
  const center = P(at(Math.floor(b.nu / 2), Math.floor(b.nv / 2)));
  // 断面: 0°, 45°, 90°（1/4 円）＋アッパーの下へ潜る 1 段
  const steps = [0, Math.PI / 4, Math.PI / 2];
  const tuck = r + 0.004;
  const rows = steps.length + 1;
  const base = pos.length / 3;
  for (let q = 0; q < L; q++) {
    const k = loop[q];
    const p = P(k);
    const n = V(nor[k * 3], nor[k * 3 + 1], nor[k * 3 + 2]);
    const t = P(loop[(q + 1) % L]).sub(P(loop[(q - 1 + L) % L]));
    const e = t.cross(n).normalize();
    if (e.dot(p.clone().sub(center)) < 0) e.negate();
    const put = (pt: THREE.Vector3, nn: THREE.Vector3) => {
      pos.push(pt.x, pt.y, pt.z);
      nor.push(nn.x, nn.y, nn.z);
      uv.push(uv[k * 2], uv[k * 2 + 1]);
      uv1.push(uv1[k * 2], uv1[k * 2 + 1]);
    };
    for (const phi of steps) {
      const pt = p.clone().addScaledVector(n, -r * (1 - Math.cos(phi))).addScaledVector(e, r * Math.sin(phi));
      put(pt, n.clone().multiplyScalar(Math.cos(phi)).addScaledVector(e, Math.sin(phi)).normalize());
    }
    put(p.clone().addScaledVector(n, -tuck).addScaledVector(e, r), e);
  }
  for (let q = 0; q < L; q++) {
    const q1 = (q + 1) % L;
    for (let m = 0; m < rows - 1; m++) {
      const A = base + q * rows + m;
      const B = base + q1 * rows + m;
      const C = B + 1;
      const D = A + 1;
      // 向きは 1 枚目の三角形の面法線と頂点法線で決める（周回の向きは帯ごとに違うため）
      const pa = V(pos[A * 3], pos[A * 3 + 1], pos[A * 3 + 2]);
      const fn = V(pos[B * 3], pos[B * 3 + 1], pos[B * 3 + 2]).sub(pa).cross(V(pos[D * 3], pos[D * 3 + 1], pos[D * 3 + 2]).sub(pa));
      const vn = V(nor[A * 3], nor[A * 3 + 1], nor[A * 3 + 2]);
      if (fn.dot(vn) >= 0) idx.push(A, B, D, B, C, D);
      else idx.push(A, D, B, B, D, C);
    }
  }
}

/** 帯の輪郭を (s,h) の多角形にする（下の縁を往き、上の縁を戻る） */
function bandOutline(b: Band): [number, number][] {
  const out: [number, number][] = [];
  const n = 48;
  for (let i = 0; i <= n; i++) {
    const s = lerp(b.s0, b.s1, i / n);
    out.push([s, b.lo(s)]);
  }
  for (let i = n; i >= 0; i--) {
    const s = lerp(b.s0, b.s1, i / n);
    out.push([s, b.hi(s)]);
  }
  return out;
}

/** アッパーの uv はもともと (s,h) なので、そのまま共通座標 uv1 にする */
function addSkinUV(upper: THREE.BufferGeometry): [number, number] {
  upper.setAttribute('uv1', upper.getAttribute('uv').clone());
  const size = upper.userData.uvSize as [number, number];
  upper.userData.uv1Size = size;
  return size;
}

/** ソール（classic）: 足形の輪郭を押し出し（ExtrudeGeometry） */
function sole(shape: Shape, inflate: number, y0: number, y1: number, bevel: number): THREE.BufferGeometry {
  const pts: THREE.Vector2[] = [];
  const N = 120;
  for (let i = 0; i < N; i++) {
    const [x, z] = shape.outline((i / N) * Math.PI * 2, inflate - bevel);
    pts.push(new THREE.Vector2(x, -z));
  }
  const sh = new THREE.Shape(pts);
  const depth = y1 - y0 - bevel * 2;
  let g: THREE.BufferGeometry = new THREE.ExtrudeGeometry(sh, {
    depth,
    steps: 1,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 2,
    curveSegments: 1,
  });
  g.rotateX(-Math.PI / 2);
  g.translate(0, y0 + bevel, 0);
  g.deleteAttribute('uv');
  g.deleteAttribute('normal');
  g = mergeVertices(g, 1e-5);
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    shape.warp(v);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  // UV: 長さ方向 × (側面は高さ / 上下面は幅)
  const nor = g.getAttribute('normal') as THREE.BufferAttribute;
  const uv: number[] = [];
  const L = shape.a * 2 + 0.2;
  const W = shape.p.halfWidth * 2 + 0.2;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const ny = Math.abs(nor.getY(i));
    const u = (x + L / 2) / L;
    const vv = ny > 0.7 ? (z + W / 2) / W : clamp((y - y0) / (y1 - y0 + 0.15), 0, 1);
    uv.push(u, vv);
  }
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.userData.uvSize = [L * 1.3, Math.max(y1 - y0, 0.4)];
  return g;
}

/** ソール（runner）: 足形の輪郭を押し出し、上面を top(x) に合わせて伸縮する */
function stretchedSole(
  shape: Shape,
  inflate: number,
  y0: number,
  top: (x: number) => number,
  bevel: number,
  bevelSegments: number,
): THREE.BufferGeometry {
  const y1 = 1; // いったん高さ 1 で押し出し、あとで上面を top(x) に合わせて伸縮する
  const pts: THREE.Vector2[] = [];
  const N = 120;
  for (let i = 0; i < N; i++) {
    const [x, z] = shape.outline((i / N) * Math.PI * 2, inflate - bevel);
    pts.push(new THREE.Vector2(x, -z));
  }
  const sh = new THREE.Shape(pts);
  const depth = y1 - y0 - bevel * 2;
  let g: THREE.BufferGeometry = new THREE.ExtrudeGeometry(sh, {
    depth,
    steps: 1,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments,
    curveSegments: 1,
  });
  g.rotateX(-Math.PI / 2);
  g.translate(0, y0 + bevel, 0);
  g.deleteAttribute('uv');
  g.deleteAttribute('normal');
  g = mergeVertices(g, 1e-5);
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const f = (v.y - y0) / (y1 - y0);
    v.y = y0 + f * (top(v.x) - y0);
    shape.rocker(v);
    shape.warp(v);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  let yMax = y0;
  for (let i = 0; i < pos.count; i++) yMax = Math.max(yMax, pos.getY(i));
  // UV: 長さ方向 × (側面は高さ / 上下面は幅)
  const nor = g.getAttribute('normal') as THREE.BufferAttribute;
  const uv: number[] = [];
  const L = shape.a * 2 + 0.2;
  const W = shape.p.halfWidth * 2 + 0.2;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const ny = Math.abs(nor.getY(i));
    const u = (x + L / 2) / L;
    const vv = ny > 0.7 ? (z + W / 2) / W : clamp((y - y0) / (yMax - y0 + 0.15), 0, 1);
    uv.push(u, vv);
  }
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.userData.uvSize = [L * 1.3, Math.max(yMax - y0, 0.4)];
  return g;
}

const TONGUE_END: Record<NonNullable<ShapeOptions['tongue']>, number> = { short: 0.1, standard: 0, long: -0.11 };

function buildTongue(shape: Shape, length: NonNullable<ShapeOptions['tongue']> = 'standard'): THREE.BufferGeometry {
  const p = shape.p;
  const end = (shape.runner ? -0.72 : -0.7) + TONGUE_END[length];
  const throatY = (x: number) => {
    if (x > 0.55) return p.throatHeight - (x - 0.55) * 0.6;
    const t = (0.55 - x) / 1.11;
    if (t <= 1) return p.throatHeight + (p.collarHeight - p.throatHeight) * t ** 0.9;
    return p.collarHeight + (-0.56 - x) * (shape.runner ? 0.9 : 2.2);
  };
  const tp = (t: number, w: number) => {
    const x = lerp(0.68, end, t);
    const halfW = lerp(0.2, 0.3, smooth(0, 0.35, t)) * (1 - 0.12 * smooth(0.85, 1, t));
    const z = w * halfW;
    const y = throatY(x) + 0.04 - 1.3 * z * z;
    return shape.warp(V(x, y, z));
  };
  const nt = 36;
  const nw = 12;
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= nt; i++) {
    const t = i / nt;
    for (let j = 0; j <= nw; j++) {
      const w = lerp(-1, 1, j / nw);
      const pt = tp(t, w);
      const dT = tp(Math.min(t + 1e-3, 1), w).sub(tp(Math.max(t - 1e-3, 0), w));
      const dW = tp(t, Math.min(w + 1e-3, 1)).sub(tp(t, Math.max(w - 1e-3, -1)));
      const n = dW.cross(dT).normalize();
      if (n.y < 0) n.negate();
      pos.push(pt.x, pt.y, pt.z);
      nor.push(n.x, n.y, n.z);
      uv.push(j / nw, i / nt);
    }
  }
  for (let i = 0; i < nt; i++) {
    for (let j = 0; j < nw; j++) {
      const A = i * (nw + 1) + j;
      const B = (i + 1) * (nw + 1) + j;
      idx.push(A, D(A), B, B, D(A), B + 1);
    }
  }
  function D(a: number) {
    return a + 1;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  fixWinding(g);
  g.userData.uvSize = [0.55, 1.6 - 0.6 * TONGUE_END[length]];
  return g;
}

/** かかと上端のプルタブ。履き口うしろの曲面から上へ伸ばした角丸の帯 */
function buildPullTab(shape: Shape, skin: [number, number], len: number): THREE.BufferGeometry {
  const hw = 0.05; // s 方向の半幅（かかと中心 s=0.5 から）
  const h0 = 0.72;
  const nu = 8;
  const nv = 10;
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  const uv1: number[] = [];
  const idx: number[] = [];
  const total = 1 - h0 + 1; // 曲面部分 + 突き出し部分を 0..1 に並べる
  for (let i = 0; i <= nu; i++) {
    const w = lerp(-1, 1, i / nu);
    for (let j = 0; j <= nv; j++) {
      const v = j / nv;
      const k = v * total;
      let pt: THREE.Vector3;
      let n: THREE.Vector3;
      let shrink = 1;
      if (k <= 1 - h0) {
        const h = h0 + k;
        const s = 0.5 + w * hw;
        n = shape.upperN(s, h);
        // 下端はアッパーにほぼ沿わせ（段差の線を出さない）、履き口に向かって浮かせてパッドを越える
        pt = shape.upperP(s, h).addScaledVector(n, lerp(0.005, 0.026, smooth(0, 1, k / (1 - h0))));
        uv1.push(s, h);
      } else {
        const e = (k - (1 - h0)) / 1; // 0..1 突き出し
        shrink = 1 - 0.3 * smooth(0.55, 1, e) ** 2; // 上端の角を丸める
        const s = 0.5 + w * hw * shrink;
        n = shape.upperN(s, 1);
        const up = shape.tangents(s, 1).dh.normalize();
        // 少しうしろに反らせる
        up.addScaledVector(n, 0.35 * e).normalize();
        pt = shape.upperP(s, 1).addScaledVector(n, 0.026).addScaledVector(up, len * e);
        // 履き口から上へ突き出した分だけ、共通座標の h も実寸に合わせて伸ばす
        uv1.push(s, 1 + (len * e) / skin[1]);
      }
      pos.push(pt.x, pt.y, pt.z);
      nor.push(n.x, n.y, n.z);
      uv.push(i / nu, v);
    }
  }
  for (let i = 0; i < nu; i++) {
    for (let j = 0; j < nv; j++) {
      const A = i * (nv + 1) + j;
      const B = (i + 1) * (nv + 1) + j;
      idx.push(A, B, A + 1, B, B + 1, A + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('uv1', new THREE.Float32BufferAttribute(uv1, 2));
  g.setIndex(idx);
  fixWinding(g);
  return g;
}

const EYELET_T = [0.12, 0.25, 0.39, 0.53, 0.67, 0.81, 0.95];

/** ハトメの位置（甲の縁に沿った 0..1）。7 個は従来の位置、それ以外は同じ範囲に等間隔 */
export function eyeletTs(count: number): number[] {
  if (count === EYELET_T.length) return EYELET_T;
  const a = EYELET_T[0];
  const b = EYELET_T[EYELET_T.length - 1];
  return Array.from({ length: count }, (_, i) => a + ((b - a) * i) / (count - 1));
}

function eyeletPoints(shape: Shape, count = 7) {
  const lat: { p: THREE.Vector3; n: THREE.Vector3 }[] = [];
  const med: { p: THREE.Vector3; n: THREE.Vector3 }[] = [];
  for (const t of eyeletTs(count)) {
    for (const [arr, s] of [
      [lat, t * 0.25],
      [med, 1 - t * 0.25],
    ] as const) {
      const n = shape.upperN(s, 0.935);
      arr.push({ p: shape.upperP(s, 0.935).addScaledVector(n, 0.024), n });
    }
  }
  return { lat, med };
}

function buildEyestay(shape: Shape, skin: [number, number], eyelets: number): THREE.BufferGeometry {
  const lo = () => 0.86;
  const hi = () => 1;
  const strip = surface(
    shape,
    [
      { s0: 0.01, s1: 0.262, lo, hi, nu: 48, nv: 4 },
      { s0: 0.738, s1: 0.99, lo, hi, nu: 48, nv: 4 },
    ],
    0.02,
    false,
    skin,
  );
  const { lat, med } = eyeletPoints(shape, eyelets);
  const rings: THREE.BufferGeometry[] = [];
  const zAxis = V(0, 0, 1);
  for (const e of [...lat, ...med]) {
    const t = new THREE.TorusGeometry(0.03, 0.009, 6, 10);
    t.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(zAxis, e.n));
    t.translate(e.p.x, e.p.y, e.p.z);
    // 結合するため uv1 も持たせる（輪の実寸に合わせて縮めた uv）
    const ruv = t.getAttribute('uv').array as Float32Array;
    t.setAttribute('uv1', new THREE.Float32BufferAttribute(ruv.map((v, i) => v * (i % 2 ? 0.04 : 0.03)), 2));
    rings.push(t);
  }
  const g = mergeGeometries([strip, ...rings])!;
  g.userData.uvSize = strip.userData.uvSize;
  g.userData.uv1Size = skin;
  return g;
}

export const LACE_RADIUS: Record<NonNullable<ShapeOptions['laceWidth']>, number> = { thin: 0.014, standard: 0.021, thick: 0.03 };

interface LaceOptions {
  eyelets: number;
  radius: number;
  style: NonNullable<ShapeOptions['laceStyle']>;
  tie: NonNullable<ShapeOptions['laceTie']>;
}

function buildLaces(shape: Shape, o: LaceOptions): THREE.BufferGeometry {
  const { lat, med } = eyeletPoints(shape, o.eyelets);
  const up = V(0, 1, 0);
  const tubes: THREE.BufferGeometry[] = [];
  const R = o.radius;
  // 太いひもほど甲から浮かせる（ひも同士・アッパーへのめり込みを防ぐ）
  const rise = Math.max(0, R - 0.021);
  const tube = (pts: THREE.Vector3[], seg = 16) =>
    tubes.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), seg, R, 6, false));
  const over = (A: THREE.Vector3, B: THREE.Vector3, lift: number) => {
    const mid = A.clone().add(B).multiplyScalar(0.5);
    mid.y = Math.max(A.y, B.y) + 0.06 + lift + rise;
    mid.z = 0;
    const a1 = A.clone().lerp(mid, 0.3).addScaledVector(up, 0.035 + lift * 0.5 + rise);
    const b1 = B.clone().lerp(mid, 0.3).addScaledVector(up, 0.035 + lift * 0.5 + rise);
    tube([A, a1, mid, b1, B]);
  };
  const last = lat.length - 1;
  if (o.style === 'bar') {
    // ストレート（はしご）: 各段を横 1 本でつなぐ
    for (let i = 0; i <= last; i++) over(lat[i].p, med[i].p, 0);
  } else {
    over(lat[0].p, med[0].p, 0);
    for (let i = 0; i < last; i++) {
      over(lat[i].p, med[i + 1].p, 0);
      over(med[i].p, lat[i + 1].p, 0.022 + rise);
    }
  }
  if (o.tie === 'tucked') {
    // 結ばない: 最上段を横につないで端は中へしまう
    if (o.style !== 'bar') over(lat[last].p, med[last].p, 0.044 + rise);
    const g = mergeGeometries(tubes)!;
    g.userData.uvSize = [3, 0.15];
    return g;
  }
  // 蝶結び
  const K = lat[last].p.clone().add(med[last].p).multiplyScalar(0.5);
  K.y += 0.1;
  K.x -= 0.02;
  const off = (x: number, y: number, z: number) => K.clone().add(V(x, y, z));
  tube([lat[last].p, off(0, -0.03, 0.12), K], 10);
  tube([med[last].p, off(0, -0.03, -0.12), K], 10);
  for (const sgn of [1, -1]) {
    tube([K, off(0.06, 0.07, 0.12 * sgn), off(0.02, 0.1, 0.3 * sgn), off(0.12, 0.04, 0.33 * sgn), off(0.1, 0.0, 0.14 * sgn), K], 24);
    tube([K, off(0.1, -0.06, 0.14 * sgn), off(0.2, -0.3, 0.3 * sgn), off(0.26, -0.55, 0.36 * sgn)], 18);
  }
  const g = mergeGeometries(tubes)!;
  g.userData.uvSize = [3, 0.15];
  return g;
}

/** トゥキャップの帯: 中心からの幅（s）と、上端の高さ h（k = 中心からの距離 / 幅） */
const TOE_CAP: Record<NonNullable<ShapeOptions['toeCap']>, { w: number; hi: (k: number) => number }> = {
  standard: { w: 0.15, hi: (k) => 0.6 * Math.max(0, 1 - k * k) ** 0.55 },
  short: { w: 0.12, hi: (k) => 0.4 * Math.max(0, 1 - k * k) ** 0.55 },
  long: { w: 0.19, hi: (k) => 0.74 * Math.max(0, 1 - k * k) ** 0.6 },
  // ストレート: 上端がほぼ水平に回り込む（両端だけ丸める）
  straight: { w: 0.17, hi: (k) => 0.42 * Math.max(0, 1 - k ** 8) ** 0.35 },
};

const HEEL_COUNTER: Record<NonNullable<ShapeOptions['heelCounter']>, { w: number; h: number }> = {
  low: { w: 0.15, h: 0.3 },
  standard: { w: 0.17, h: 0.46 },
  high: { w: 0.2, h: 0.68 },
};

const PULL_TAB: Record<'short' | 'long', number> = { short: 0.12, long: 0.25 };

export function buildSneaker(params: SneakerParams, options: ShapeOptions = {}): PartGeometries {
  const shape = createSneakerShape(params);
  const one = () => 1;
  const zero = () => 0;
  const dist = (s: number, c: number) => {
    const d = Math.abs(wrap01(s) - c);
    return Math.min(d, 1 - d);
  };

  const upper = surface(shape, [{ s0: 0, s1: 1, lo: zero, hi: one, nu: 112, nv: 28 }], 0);
  // アッパーの表面に重ねるパーツ（トゥ・ヒール・サイドパネル・アイステイ）はアッパーと共通の座標で素材を貼る
  const skin = addSkinUV(upper);

  const lining = (() => {
    const inner = surface(shape, [{ s0: 0, s1: 1, lo: () => 0.12, hi: one, nu: 112, nv: 8 }], -0.04, true);
    // 履き口のパッド（外側の縁から内側の縁まで丸くつなぐ）
    const nu = 112;
    const na = 6;
    const pos: number[] = [];
    const nor: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    for (let i = 0; i <= nu; i++) {
      const s = i / nu;
      const P1 = shape.upperP(s, 1);
      const N = shape.upperN(s, 1);
      const tH = shape.tangents(s, 1).dh.normalize();
      const C = P1.clone().addScaledVector(N, -0.02);
      for (let j = 0; j <= na; j++) {
        const al = (j / na) * Math.PI;
        const n = N.clone().multiplyScalar(Math.cos(al)).addScaledVector(tH, Math.sin(al));
        const pt = C.clone().addScaledVector(n, 0.02);
        pos.push(pt.x, pt.y, pt.z);
        nor.push(n.x, n.y, n.z);
        uv.push(s, j / na);
      }
    }
    // 巻き方向チェック
    for (let i = 0; i < nu; i++) {
      for (let j = 0; j < na; j++) {
        const A = i * (na + 1) + j;
        const B = (i + 1) * (na + 1) + j;
        idx.push(A, B, A + 1, B, B + 1, A + 1);
      }
    }
    const rim = new THREE.BufferGeometry();
    rim.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    rim.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    rim.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    rim.setIndex(idx);
    fixWinding(rim);
    const g = mergeGeometries([inner, rim])!;
    g.userData.uvSize = inner.userData.uvSize;
    return g;
  })();

  const toeCap = TOE_CAP[shapeValue(options, 'toeCap')];
  const toeW = toeCap.w;
  const toeBand: Band = { s0: -toeW, s1: toeW, lo: zero, hi: (s) => toeCap.hi(dist(s, 0) / toeW) + 0.002, nu: 44, nv: 14 };
  const toe = surface(shape, [toeBand], 0.012, false, skin);

  const counter = HEEL_COUNTER[shapeValue(options, 'heelCounter')];
  const heelW = counter.w;
  const heelBand: Band = {
    s0: 0.5 - heelW,
    s1: 0.5 + heelW,
    lo: zero,
    hi: (s) => 0.06 + counter.h * Math.max(0, 1 - (dist(s, 0.5) / heelW) ** 2) ** 0.7,
    nu: 44,
    nv: 14,
  };
  const heelOverlay = surface(shape, [heelBand], 0.012, false, skin);

  // サイドパネル: 角を落とした六角形のプレートなど（すべてオリジナル形状）
  const panelKind = shapeValue(options, 'sidePanel');
  const panelBand = (s0: number, s1: number): Band => {
    const tOf = (s: number) => clamp(Math.abs(s - s0) / Math.abs(s1 - s0), 0, 1);
    if (panelKind === 'oval') {
      const r = (s: number) => Math.sqrt(Math.max(0, 1 - (2 * tOf(s) - 1) ** 2));
      return { s0, s1, lo: (s) => 0.4 - 0.19 * r(s), hi: (s) => 0.4 + 0.19 * r(s) + 0.002, nu: 36, nv: 10 };
    }
    if (panelKind === 'diamond') {
      const r = (s: number) => 1 - Math.abs(2 * tOf(s) - 1);
      return { s0, s1, lo: (s) => 0.41 - 0.23 * r(s), hi: (s) => 0.41 + 0.23 * r(s) + 0.002, nu: 36, nv: 10 };
    }
    if (panelKind === 'saddle') {
      // サドル: 土踏まずの上を靴底から甲の縁の手前まで覆う帯（上の角を丸める）
      const corner = (s: number) => Math.max(0, 0.12 - Math.min(tOf(s), 1 - tOf(s))) ** 2 * 9;
      return { s0, s1, lo: zero, hi: (s) => 0.82 - corner(s), nu: 36, nv: 10 };
    }
    const cut = (s: number) => Math.max(0, 0.16 - Math.min(tOf(s), 1 - tOf(s))) * 1.5;
    return { s0, s1, lo: (s) => 0.2 + cut(s) * 0.5, hi: (s) => 0.6 - cut(s) + 0.002, nu: 36, nv: 10 };
  };
  const [pa, pb] = panelKind === 'saddle' ? [0.14, 0.33] : [0.15, 0.335];
  const panelBands = [panelBand(pa, pb), panelBand(1 - pa, 1 - pb)];
  const sidePanel = surface(shape, panelBands, 0.018, false, skin, 0.018);
  // 重ねるパーツの輪郭（アッパーの uv = (s,h) 上）。描画側でアッパーの縁に接地の影を落とすのに使う
  upper.userData.overlayOutlines = [toeBand, heelBand, ...panelBands].map(bandOutline);

  const eyelets = Number(shapeValue(options, 'eyelets'));
  const eyestay = buildEyestay(shape, skin, eyelets);
  const tongue = buildTongue(shape, shapeValue(options, 'tongue'));
  const laces = buildLaces(shape, {
    eyelets,
    radius: LACE_RADIUS[shapeValue(options, 'laceWidth')],
    style: shapeValue(options, 'laceStyle'),
    tie: shapeValue(options, 'laceTie'),
  });
  const p = shape.p;
  const midsole = shape.runner
    ? stretchedSole(shape, 0.045, p.outsoleThickness - 0.015, shape.midsoleTop, 0.06, 3)
    : sole(shape, 0.045, p.outsoleThickness - 0.015, p.soleThickness, 0.022);
  const outsole = shape.runner
    ? stretchedSole(shape, 0.055, 0, () => p.outsoleThickness, 0.02, 1)
    : sole(shape, 0.06, 0, p.outsoleThickness, 0.02);
  const tabOpt = shapeValue(options, 'pullTab');
  const tabLen = tabOpt === 'auto' ? p.pullTab ?? 0 : tabOpt === 'none' ? 0 : PULL_TAB[tabOpt];
  let heel = heelOverlay;
  if (tabLen > 0) {
    heel = mergeGeometries([heelOverlay, buildPullTab(shape, skin, tabLen)])!;
    heel.userData.uvSize = heelOverlay.userData.uvSize;
    heel.userData.uv1Size = skin;
  }

  const parts: PartGeometries = {
    upper,
    toe,
    heel,
    eyestay,
    tongue,
    lining,
    sidePanel,
    midsole,
    outsole,
    laces,
  } satisfies Record<PartId, THREE.BufferGeometry>;
  for (const g of Object.values(parts)) {
    g.computeBoundingBox();
    g.computeBoundingSphere();
  }
  return parts;
}

/** インデックスの巻き方向を頂点法線に合わせる */
function fixWinding(g: THREE.BufferGeometry) {
  const idx = g.getIndex()!;
  const pos = g.getAttribute('position');
  const nor = g.getAttribute('normal');
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const n = new THREE.Vector3();
  for (let i = 0; i < idx.count; i += 3) {
    const ia = idx.getX(i);
    const ib = idx.getX(i + 1);
    const ic = idx.getX(i + 2);
    a.fromBufferAttribute(pos, ia);
    b.fromBufferAttribute(pos, ib);
    c.fromBufferAttribute(pos, ic);
    n.fromBufferAttribute(nor, ia);
    const fn = b.sub(a).cross(c.sub(a));
    if (fn.dot(n) < 0) {
      idx.setX(i + 1, ic);
      idx.setX(i + 2, ib);
    }
  }
  idx.needsUpdate = true;
}

/** 寸法パラメータから型の定義を作る。カメラの注視点と各視点は靴の高さに合わせて決める。 */
export function defineSneaker(
  id: BaseModelId,
  label: string,
  description: string,
  params: SneakerParams,
  /** 自動で決まる注視点・視点を型ごとに上書きしたいとき */
  view: Partial<Pick<BaseModelDef, 'target' | 'defaultCamera' | 'presets'>> = {},
): BaseModelDef {
  const ty = Math.round((0.1 + params.collarBackHeight * 0.425) * 100) / 100;
  const at = (x: number, dy: number, z: number): Vec3 => [x, Math.round((ty + dy) * 100) / 100, z];
  return {
    id,
    key: id,
    label,
    description,
    params: { ...params },
    build: () => buildSneaker(params),
    target: [0, ty, 0],
    defaultCamera: at(3.2, 1.35, 4.6),
    presets: {
      front: at(5.6, 0.45, 0),
      side: at(0, 0.25, 5.6),
      back: at(-5.6, 0.65, 0),
      top: [0.01, 6.0, 0.01],
      threeQuarter: at(3.2, 1.35, 4.6),
    },
    doubleSided: ['toe', 'heel', 'eyestay', 'sidePanel', 'tongue'],
    ...view,
  };
}
