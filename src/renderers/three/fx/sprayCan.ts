/**
 * 3D のスプレー缶。塗っているパーツの「塗りの縁」を追いかけるように動き、ノズルから塗料の粒を吹き付ける。
 * 缶・粒・テクスチャはすべてコードで生成（外部ファイルなし）。粒は CPU で 1 フレームごとに更新する（最大 320 個）。
 */
import * as THREE from 'three';
import { paintRadius } from './processMath';
import { disposeGroup } from './stickerFx';

export interface PartSamples {
  /** 頂点位置（モデル座標）と法線を間引いたもの */
  p: Float32Array;
  n: Float32Array;
  count: number;
}

export interface SprayJob {
  part: string;
  colors: THREE.Color[];
  /** 缶がこのパーツを吹き付けている時間帯（performance.now() の ms） */
  from: number;
  to: number;
  /** 塗り広げの開始時刻（ms）・時間（秒）・覆う半径 */
  spreadStart: number;
  duration: number;
  cover: number;
  origin: THREE.Vector3;
  normal: THREE.Vector3;
  samples: PartSamples;
  /** samples の各点の origin からの距離 */
  dist: Float32Array;
}

const MAX_PARTICLES = 320;

let dotTexture: THREE.Texture | null = null;
function getDotTexture() {
  if (dotTexture) return dotTexture;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.45, 'rgba(255,255,255,0.85)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  dotTexture = new THREE.CanvasTexture(c);
  dotTexture.colorSpace = THREE.SRGBColorSpace;
  return dotTexture;
}

/** 缶のモデル。原点 = ノズルの先、+x = 吹き出す向き、+y = 缶の上 */
function buildCan(): { group: THREE.Group; label: THREE.MeshStandardMaterial; cap: THREE.MeshStandardMaterial } {
  const g = new THREE.Group();
  g.name = 'fx:spray-can';
  const axis = -0.042;
  const metal = new THREE.MeshStandardMaterial({ color: '#2B2B31', metalness: 0.75, roughness: 0.32 });
  const silver = new THREE.MeshStandardMaterial({ color: '#C9CBD1', metalness: 0.9, roughness: 0.25 });
  const label = new THREE.MeshStandardMaterial({ color: '#C6FF00', metalness: 0.15, roughness: 0.45 });
  const cap = new THREE.MeshStandardMaterial({ color: '#C6FF00', metalness: 0, roughness: 0.5 });
  const lime = new THREE.MeshStandardMaterial({ color: '#C6FF00', emissive: '#C6FF00', emissiveIntensity: 0.15, roughness: 0.4 });
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, y: number, x = axis) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, 0);
    m.raycast = () => {};
    g.add(m);
    return m;
  };
  // 押しボタン（アクチュエーター）とノズル
  add(new THREE.CylinderGeometry(0.034, 0.036, 0.05, 20), cap, -0.004);
  const nozzle = add(new THREE.CylinderGeometry(0.009, 0.009, 0.014, 10), new THREE.MeshStandardMaterial({ color: '#111114' }), 0, -0.006);
  nozzle.rotation.z = Math.PI / 2;
  // 肩・胴・ラベル・底
  add(new THREE.CylinderGeometry(0.05, 0.1, 0.07, 28), silver, -0.064);
  add(new THREE.CylinderGeometry(0.1, 0.1, 0.42, 28, 1), metal, -0.31);
  add(new THREE.CylinderGeometry(0.1016, 0.1016, 0.24, 28, 1, true), label, -0.31);
  add(new THREE.CylinderGeometry(0.1022, 0.1022, 0.018, 28, 1, true), lime, -0.18);
  add(new THREE.CylinderGeometry(0.096, 0.09, 0.022, 28), silver, -0.53);
  return { group: g, label, cap };
}

export class SprayRig {
  readonly group = new THREE.Group();
  private readonly can: THREE.Group;
  private readonly labelMat: THREE.MeshStandardMaterial;
  private readonly capMat: THREE.MeshStandardMaterial;
  private readonly points: THREE.Points;
  private readonly pos = new Float32Array(MAX_PARTICLES * 3);
  private readonly col = new Float32Array(MAX_PARTICLES * 3);
  private readonly vel = new Float32Array(MAX_PARTICLES * 3);
  private readonly life = new Float32Array(MAX_PARTICLES);
  private jobs: SprayJob[] = [];
  private current: SprayJob | null = null;
  private readonly nozzle = new THREE.Vector3();
  private readonly aim = new THREE.Vector3();
  private readonly aimN = new THREE.Vector3(0, 0, 1);
  private readonly targetNozzle = new THREE.Vector3();
  private readonly targetAim = new THREE.Vector3();
  private presence = 0;
  private lastNow = 0;
  private aimTimer = 0;
  private alive = 0;
  private placed = false;

  /** center = 靴の中心（缶を靴の外側へ逃がす向きを決める） */
  constructor(private readonly center = new THREE.Vector3(0, 0.6, 0)) {
    this.group.name = 'fx:spray';
    const { group, label, cap } = buildCan();
    this.can = group;
    this.labelMat = label;
    this.capMat = cap;
    this.can.visible = false;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    this.points = new THREE.Points(
      geo,
      new THREE.PointsMaterial({ size: 0.034, map: getDotTexture(), vertexColors: true, transparent: true, opacity: 0.9, depthWrite: false, sizeAttenuation: true }),
    );
    this.points.frustumCulled = false;
    this.points.raycast = () => {};
    this.points.renderOrder = 30;
    for (let i = 0; i < MAX_PARTICLES; i++) this.pos[i * 3 + 1] = -1000;
    this.group.add(this.can, this.points);
  }

  /** 新しい吹き付けを予約する。先に予約していたものは、新しいものが始まる時点で切り上げる */
  add(job: SprayJob) {
    for (const j of this.jobs) if (j.to > job.from) j.to = job.from;
    this.jobs.push(job);
    this.jobs.sort((a, b) => a.from - b.from);
  }

  /** 吹き付け中に色が変わった（カラーピッカーのドラッグなど） */
  recolor(part: string, colors: THREE.Color[]) {
    for (const j of this.jobs) {
      if (j.part !== part) continue;
      j.colors = colors;
      if (j === this.current) {
        this.labelMat.color.copy(colors[0]);
        this.capMat.color.copy(colors[colors.length > 1 ? 1 : 0]);
      }
    }
  }

  /** 缶が見えている / 吹き付け中か（E2E・デバッグ用） */
  get visible() {
    return this.can.visible;
  }
  get particleCount() {
    return this.alive;
  }

  private pickAim(job: SprayJob, now: number, camera: THREE.Camera) {
    const eye = camera.position;
    const t = (now - job.spreadStart) / 1000;
    const r = Math.max(0, paintRadius(t, job.duration, job.cover) - 0.06);
    const s = job.samples;
    let best = -1;
    let bestScore = Infinity;
    const toEye = new THREE.Vector3();
    for (let k = 0; k < 24; k++) {
      const i = Math.floor(Math.random() * s.count);
      const px = s.p[i * 3];
      const py = s.p[i * 3 + 1];
      const pz = s.p[i * 3 + 2];
      toEye.set(eye.x - px, eye.y - py, eye.z - pz).normalize();
      const facing = s.n[i * 3] * toEye.x + s.n[i * 3 + 1] * toEye.y + s.n[i * 3 + 2] * toEye.z;
      // 縁に近く、こちらを向いている点ほど良い
      const score = Math.abs(job.dist[i] - r) + (facing < 0 ? 0.6 : 0) - facing * 0.15;
      if (score < bestScore) {
        bestScore = score;
        best = i;
      }
    }
    if (best < 0 || r <= 0.02) {
      this.targetAim.copy(job.origin);
      this.aimN.copy(job.normal);
    } else {
      this.targetAim.set(s.p[best * 3], s.p[best * 3 + 1], s.p[best * 3 + 2]);
      this.aimN.set(s.n[best * 3], s.n[best * 3 + 1], s.n[best * 3 + 2]);
      // 起点の向きと混ぜて、缶が裏側へ回り込みすぎないようにする
      if (this.aimN.dot(job.normal) < -0.2) this.aimN.lerp(job.normal, 0.6);
    }
    // 缶は吹き付ける点の真正面（カメラとの間）ではなく、画面の横に少しずらして構える。
    // 靴の中心から見て吹き付ける点がある側へ出すので、缶が靴に重なりにくい
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
    const side = Math.sign(this.targetAim.clone().sub(this.center).dot(right)) || 1;
    const out = this.aimN.clone().normalize().multiplyScalar(0.7).add(toEye.subVectors(eye, this.targetAim).normalize().multiplyScalar(0.3)).normalize();
    this.targetNozzle.copy(this.targetAim).addScaledVector(out, 0.3).addScaledVector(right, side * 0.5).addScaledVector(up, 0.16);
  }

  /** 1 フレーム進める。まだ動きが残っていれば true */
  tick(now: number, camera: THREE.Camera): boolean {
    const eye = camera.position;
    const dt = this.lastNow ? Math.min(0.05, Math.max(0, (now - this.lastNow) / 1000)) : 1 / 60;
    this.lastNow = now;
    this.jobs = this.jobs.filter((j) => now <= j.to);
    const job = this.jobs.find((j) => now >= j.from) ?? null;
    const pending = this.jobs.length > 0;
    if (!job && !pending && this.presence <= 0 && this.alive === 0) {
      // 何もしていないときは粒の更新（GPU への転送）もしない
      this.can.visible = false;
      this.points.visible = false;
      return false;
    }
    this.points.visible = true;

    if (job) {
      this.aimTimer -= dt;
      if (job !== this.current || this.aimTimer <= 0) {
        this.aimTimer = 0.1 + Math.random() * 0.05;
        if (job !== this.current) {
          this.labelMat.color.copy(job.colors[0]);
          this.capMat.color.copy(job.colors[job.colors.length > 1 ? 1 : 0]);
        }
        this.pickAim(job, now, camera);
        if (!this.placed || this.presence < 0.05) {
          this.nozzle.copy(this.targetNozzle).addScaledVector(this.aimN, 0.35);
          this.aim.copy(this.targetAim);
          this.placed = true;
        }
        this.current = job;
      }
      this.presence = Math.min(1, this.presence + dt * 7);
    } else if (!pending) {
      this.presence = Math.max(0, this.presence - dt * 4.5);
      if (this.presence === 0) {
        this.placed = false;
        this.current = null;
      }
    }

    // 缶の移動（なめらかに追従）と向き
    this.nozzle.lerp(this.targetNozzle, 1 - Math.exp(-dt * 9));
    this.aim.lerp(this.targetAim, 1 - Math.exp(-dt * 12));
    const x = this.aim.clone().sub(this.nozzle);
    if (x.lengthSq() < 1e-6) x.set(1, 0, 0);
    x.normalize();
    const y = new THREE.Vector3(0, 1, 0).addScaledVector(x, -x.y);
    if (y.lengthSq() < 0.05) y.subVectors(eye, this.nozzle).addScaledVector(x, -x.dot(new THREE.Vector3().subVectors(eye, this.nozzle)));
    y.normalize();
    const z = new THREE.Vector3().crossVectors(x, y);
    this.can.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
    // 吹き付け中は細かく揺れる（手持ちの感じ）
    const wob = job ? Math.sin(now * 0.045) * 0.006 : 0;
    this.can.position.copy(this.nozzle).addScaledVector(y, wob);
    const k = 1 - (1 - this.presence) ** 3;
    this.can.scale.setScalar(Math.max(0.0001, k));
    this.can.visible = this.presence > 0.01;

    // 塗料の粒
    const emitting = !!job && this.presence > 0.6;
    let toEmit = emitting ? Math.round(dt * 520) : 0;
    const side = new THREE.Vector3();
    const up2 = new THREE.Vector3();
    if (toEmit) {
      side.crossVectors(this.aimN, Math.abs(this.aimN.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0)).normalize();
      up2.crossVectors(this.aimN, side).normalize();
    }
    this.alive = 0;
    for (let i = 0; i < MAX_PARTICLES; i++) {
      const o = i * 3;
      if (this.life[i] > 0) {
        this.life[i] -= dt;
        if (this.life[i] <= 0) {
          this.pos[o + 1] = -1000;
        } else {
          this.pos[o] += this.vel[o] * dt;
          this.pos[o + 1] += this.vel[o + 1] * dt;
          this.pos[o + 2] += this.vel[o + 2] * dt;
          this.alive++;
          continue;
        }
      }
      if (toEmit > 0 && job) {
        toEmit--;
        const life = 0.13 + Math.random() * 0.12;
        const a = Math.random() * Math.PI * 2;
        const rr = Math.sqrt(Math.random()) * 0.085;
        const tx = this.aim.x + side.x * Math.cos(a) * rr + up2.x * Math.sin(a) * rr;
        const ty = this.aim.y + side.y * Math.cos(a) * rr + up2.y * Math.sin(a) * rr;
        const tz = this.aim.z + side.z * Math.cos(a) * rr + up2.z * Math.sin(a) * rr;
        this.pos[o] = this.nozzle.x + x.x * 0.01;
        this.pos[o + 1] = this.nozzle.y + x.y * 0.01;
        this.pos[o + 2] = this.nozzle.z + x.z * 0.01;
        this.vel[o] = (tx - this.pos[o]) / life;
        this.vel[o + 1] = (ty - this.pos[o + 1]) / life;
        this.vel[o + 2] = (tz - this.pos[o + 2]) / life;
        this.life[i] = life;
        const c = job.colors[Math.floor(Math.random() * job.colors.length)];
        const l = 0.85 + Math.random() * 0.3;
        this.col[o] = c.r * l;
        this.col[o + 1] = c.g * l;
        this.col[o + 2] = c.b * l;
        this.alive++;
      }
    }
    const g = this.points.geometry;
    g.getAttribute('position').needsUpdate = true;
    g.getAttribute('color').needsUpdate = true;
    return this.presence > 0 || this.alive > 0 || pending;
  }

  dispose() {
    disposeGroup(this.can);
    this.points.geometry.dispose();
    (this.points.material as THREE.Material).dispose();
  }
}
