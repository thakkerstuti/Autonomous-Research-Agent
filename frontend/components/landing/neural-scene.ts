import * as THREE from "three";

/**
 * NeuralScene — the landing page's 3D story, one WebGL context.
 *
 * Stage (0 → 5) is driven by scroll:
 *   0 hero      the neuron at rest
 *   1 ask       a question travels into the core
 *   2 plan      the core splits the question into four hypotheses
 *   3 search    sources stream in from far away and attach to hypotheses
 *   4 verify    evidence is checked: supporting, refuting, context
 *   5 report    everything resolves into a cited report page
 */

type V3 = THREE.Vector3;

const clamp = (x: number, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const sm = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

function mulberry32(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const COLORS = {
  dendrite: new THREE.Color(0.16, 0.38, 1.0),
  mote: [new THREE.Color(0.25, 0.88, 0.78), new THREE.Color(0.36, 0.77, 1.0)],
  impulse: [
    new THREE.Color(0.91, 0.66, 0.84), // mauve
    new THREE.Color(1.0, 0.77, 0.46), // gold
    new THREE.Color(0.66, 0.55, 1.0), // violet
    new THREE.Color(1.0, 0.59, 0.36), // ember
  ],
  hypothesis: new THREE.Color(0.93, 0.7, 0.87),
  source: new THREE.Color(0.55, 0.68, 0.95),
  supports: new THREE.Color(0.56, 0.86, 0.66),
  refutes: new THREE.Color(0.96, 0.54, 0.54),
  mixed: new THREE.Color(0.93, 0.78, 0.49),
  neutral: new THREE.Color(0.62, 0.62, 0.66),
};

/* ───────── shaders ───────── */

const POINTS_VERT = /* glsl */ `
  attribute float aSize;
  attribute float aAlpha;
  attribute vec3 aColor;
  attribute float aTwinkle;
  uniform float uScale;
  uniform float uTime;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = aSize * uScale / max(0.1, -mv.z);
    float tw = aTwinkle > 0.0 ? 0.55 + 0.45 * sin(uTime * 1.25 + aTwinkle * 40.0) : 1.0;
    vColor = aColor;
    vAlpha = aAlpha * tw;
  }
`;
const POINTS_FRAG = /* glsl */ `
  uniform sampler2D uMap;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vec4 t = texture2D(uMap, gl_PointCoord);
    gl_FragColor = vec4(vColor * t.rgb, t.a * vAlpha);
  }
`;
const CORE_VERT = /* glsl */ `
  varying vec3 vN;
  varying vec3 vV;
  void main() {
    vN = normalize(normalMatrix * normal);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vV = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`;
const CORE_FRAG = /* glsl */ `
  uniform float uGlow;
  varying vec3 vN;
  varying vec3 vV;
  void main() {
    float facing = max(dot(normalize(vN), normalize(vV)), 0.0);
    float rim = pow(1.0 - facing, 2.2);
    vec3 deep = vec3(0.10, 0.30, 0.95);
    vec3 light = vec3(0.58, 0.82, 1.0);
    vec3 c = mix(deep, light, rim) + vec3(0.85, 0.95, 1.0) * pow(facing, 7.0) * 0.55 * uGlow;
    gl_FragColor = vec4(c * (0.75 + 0.35 * uGlow), 1.0);
  }
`;

function glowTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.14, "rgba(255,255,255,0.9)");
  grad.addColorStop(0.4, "rgba(255,255,255,0.22)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/* The report page the evidence lands on. Slots are in UV space (0..1, top-left origin). */
const PAGE_W = 3.0;
const PAGE_H = 3.8;
const VERDICT_SLOTS = [0.2, 0.4, 0.6, 0.8].map((u) => ({ u, v: 0.235 }));
function sourceSlot(i: number) {
  const cols = 7;
  const r = Math.floor(i / cols);
  const c = i % cols;
  return { u: 0.14 + c * 0.12, v: 0.73 + r * 0.06 };
}

function pageTexture(sourceCount: number) {
  const W = 600, H = 760;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const g = c.getContext("2d")!;
  const r = 34;
  g.beginPath();
  g.moveTo(r, 0); g.arcTo(W, 0, W, H, r); g.arcTo(W, H, 0, H, r); g.arcTo(0, H, 0, 0, r); g.arcTo(0, 0, W, 0, r);
  g.closePath();
  g.fillStyle = "rgba(18,18,20,0.94)";
  g.fill();
  g.strokeStyle = "rgba(255,255,255,0.14)";
  g.lineWidth = 2;
  g.stroke();

  const bar = (x: number, y: number, w: number, h: number, color: string) => {
    g.fillStyle = color;
    g.beginPath();
    g.roundRect(x, y, w, h, h / 2);
    g.fill();
  };
  // Title
  bar(54, 58, 330, 22, "rgba(243,241,238,0.88)");
  bar(54, 96, 210, 12, "rgba(243,241,238,0.30)");
  // Verdict row: four outlined slots
  VERDICT_SLOTS.forEach((s) => {
    g.strokeStyle = "rgba(255,255,255,0.20)";
    g.lineWidth = 2;
    g.beginPath();
    g.arc(s.u * W, s.v * H, 15, 0, Math.PI * 2);
    g.stroke();
  });
  // Body text with citation chips
  const rand = mulberry32(7);
  for (let i = 0; i < 9; i++) {
    const y = 250 + i * 30;
    const w = i % 4 === 3 ? 280 : 420 + rand() * 70;
    bar(54, y, w, 9, "rgba(243,241,238,0.22)");
    if (i % 2 === 0) bar(54 + w + 10, y - 2, 24, 13, "rgba(215,162,198,0.75)");
  }
  // Sources list: outlined slots the source nodes land in
  g.fillStyle = "rgba(243,241,238,0.30)";
  bar(54, 525, 120, 10, "rgba(243,241,238,0.40)");
  for (let i = 0; i < sourceCount; i++) {
    const s = sourceSlot(i);
    g.strokeStyle = "rgba(255,255,255,0.13)";
    g.beginPath();
    g.arc(s.u * W, s.v * H, 9, 0, Math.PI * 2);
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function makePoints(count: number, map: THREE.Texture, uniforms: Record<string, THREE.IUniform>) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  geo.setAttribute("aColor", new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  geo.setAttribute("aSize", new THREE.BufferAttribute(new Float32Array(count), 1));
  geo.setAttribute("aAlpha", new THREE.BufferAttribute(new Float32Array(count), 1));
  geo.setAttribute("aTwinkle", new THREE.BufferAttribute(new Float32Array(count), 1));
  const mat = new THREE.ShaderMaterial({
    vertexShader: POINTS_VERT,
    fragmentShader: POINTS_FRAG,
    uniforms: { ...uniforms, uMap: { value: map } },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  return pts;
}

interface Branch { pts: V3[]; cum: number[]; len: number; depth: number }

export class NeuralScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private world = new THREE.Group();
  private spin = new THREE.Group();
  private graph = new THREE.Group();
  private shared = { uScale: { value: 1 }, uTime: { value: 0 } };
  private glow = glowTexture();

  private core: THREE.Mesh;
  private coreMat: THREE.ShaderMaterial;
  private halo: THREE.Points;
  private rings: THREE.Mesh[] = [];
  private dendrites: THREE.LineSegments;
  private branches: Branch[] = [];
  private impulses: THREE.Points;
  private impulseState: { b: number; t: number; speed: number; color: THREE.Color; size: number }[] = [];
  private motes: THREE.Points;

  private nodes: THREE.Points; // question + hypotheses + sources + pulses
  private links: THREE.LineSegments;
  private page: THREE.Mesh;
  private pageMat: THREE.MeshBasicMaterial;

  private S: number;
  private P = 36;
  private hypHome: V3[] = [];
  private srcHome: V3[] = [];
  private srcFar: V3[] = [];
  private srcHyp: number[] = [];
  private srcDelay: number[] = [];
  private srcStance: ("supports" | "refutes" | "neutral")[] = [];
  private hypVerdict = [COLORS.supports, COLORS.supports, COLORS.refutes, COLORS.mixed];

  private target = 0;
  private stage = 0;
  private pointer = new THREE.Vector2();
  private pointerSmooth = new THREE.Vector2();
  private flash = 0;
  private arrived = false;
  private time = 0;
  private last = 0;
  private raf = 0;
  private running = false;
  private narrow = false;
  private reduced: boolean;
  private centered = false;
  private tmp = new THREE.Vector3();
  private tmp2 = new THREE.Vector3();

  constructor(private canvas: HTMLCanvasElement, opts: { mobile: boolean; reduced: boolean; centered?: boolean }) {
    this.reduced = opts.reduced;
    this.centered = !!opts.centered;
    this.S = opts.mobile ? 21 : 28;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: "high-performance" });
    // Opaque ground so additive light only ever brightens (a transparent canvas lets dim lines darken the page)
    this.renderer.setClearColor(0x080809, 1);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, opts.mobile ? 1.5 : 2));
    this.camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
    this.camera.position.set(0, 0, 9);

    this.scene.add(this.world);
    this.world.add(this.spin);
    this.world.add(this.graph);

    const rand = mulberry32(11);
    const randUnit = () => {
      const u = rand() * 2 - 1;
      const a = rand() * Math.PI * 2;
      const s = Math.sqrt(1 - u * u);
      return new THREE.Vector3(s * Math.cos(a), u, s * Math.sin(a));
    };

    /* Core */
    this.coreMat = new THREE.ShaderMaterial({ vertexShader: CORE_VERT, fragmentShader: CORE_FRAG, uniforms: { uGlow: { value: 1 } } });
    this.core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.62, 5), this.coreMat);
    this.spin.add(this.core);
    for (let i = 0; i < 3; i++) {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(0.36 + i * 0.05, 0.007, 8, 120),
        new THREE.MeshBasicMaterial({ color: new THREE.Color(0.85, 0.95, 1), transparent: true, opacity: 0.75 - i * 0.18, blending: THREE.AdditiveBlending, depthWrite: false })
      );
      ring.rotation.set(rand() * Math.PI, rand() * Math.PI, 0);
      this.core.add(ring);
      this.rings.push(ring);
    }
    this.halo = makePoints(1, this.glow, this.shared);
    {
      const g = this.halo.geometry;
      (g.getAttribute("aColor") as THREE.BufferAttribute).setXYZ(0, 0.22, 0.48, 1.0);
      (g.getAttribute("aSize") as THREE.BufferAttribute).setX(0, 6.2);
      (g.getAttribute("aAlpha") as THREE.BufferAttribute).setX(0, 0.85);
    }
    this.spin.add(this.halo);
    const nebula = makePoints(2, this.glow, this.shared);
    {
      const g = nebula.geometry;
      const pos = g.getAttribute("position") as THREE.BufferAttribute;
      pos.setXYZ(0, 0, 0, -3);
      pos.setXYZ(1, 2.5, 3.5, -6);
      (g.getAttribute("aColor") as THREE.BufferAttribute).setXYZ(0, 0.07, 0.14, 0.42);
      (g.getAttribute("aColor") as THREE.BufferAttribute).setXYZ(1, 0.3, 0.12, 0.26);
      (g.getAttribute("aSize") as THREE.BufferAttribute).setX(0, 26);
      (g.getAttribute("aSize") as THREE.BufferAttribute).setX(1, 16);
      (g.getAttribute("aAlpha") as THREE.BufferAttribute).setX(0, 0.9);
      (g.getAttribute("aAlpha") as THREE.BufferAttribute).setX(1, 0.6);
    }
    nebula.renderOrder = -1;
    this.world.add(nebula);

    /* Dendrites — 3D random walks from the core */
    const segs: number[] = [];
    const cols: number[] = [];
    const grow = (start: V3, dir: V3, len: number, depth: number) => {
      const steps = Math.max(6, Math.round(len * 4));
      const pts = [start.clone()];
      const p = start.clone();
      const d = dir.clone().normalize();
      for (let s = 1; s <= steps; s++) {
        d.add(randUnit().multiplyScalar(0.28)).normalize();
        p.addScaledVector(d, len / steps);
        pts.push(p.clone());
      }
      const cum = [0];
      for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + pts[i].distanceTo(pts[i - 1]));
      this.branches.push({ pts, cum, len: cum[cum.length - 1], depth });
      for (let i = 1; i < pts.length; i++) {
        const k = i / pts.length;
        const a = (1 - k * 0.75) * (depth === 0 ? 1 : 0.6);
        segs.push(pts[i - 1].x, pts[i - 1].y, pts[i - 1].z, pts[i].x, pts[i].y, pts[i].z);
        const c = COLORS.dendrite;
        cols.push(c.r * a, c.g * a, c.b * a, c.r * a * 0.9, c.g * a * 0.9, c.b * a * 0.9);
      }
      if (depth < 2) {
        const kids = depth === 0 ? 2 : 1 + Math.floor(rand() * 2);
        for (let k = 0; k < kids; k++) {
          const idx = Math.floor(steps * (0.3 + rand() * 0.55));
          const nd = d.clone().add(randUnit().multiplyScalar(0.9)).normalize();
          grow(pts[idx], nd, len * (0.35 + rand() * 0.25), depth + 1);
        }
      }
    };
    const primaries = opts.mobile ? 16 : 24;
    for (let i = 0; i < primaries; i++) {
      const d = randUnit();
      grow(d.clone().multiplyScalar(0.55), d, 4 + rand() * 4.5, 0);
    }
    const dGeo = new THREE.BufferGeometry();
    dGeo.setAttribute("position", new THREE.Float32BufferAttribute(segs, 3));
    dGeo.setAttribute("color", new THREE.Float32BufferAttribute(cols, 3));
    this.dendrites = new THREE.LineSegments(
      dGeo,
      new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    this.spin.add(this.dendrites);

    /* Impulses travelling inward along dendrites */
    const IMP = opts.mobile ? 34 : 70;
    this.impulses = makePoints(IMP, this.glow, this.shared);
    for (let i = 0; i < IMP; i++) this.impulseState.push(this.newImpulse(rand, true));
    this.spin.add(this.impulses);

    /* Motes */
    const M = opts.mobile ? 500 : 1300;
    this.motes = makePoints(M, this.glow, this.shared);
    {
      const g = this.motes.geometry;
      const pos = g.getAttribute("position") as THREE.BufferAttribute;
      const col = g.getAttribute("aColor") as THREE.BufferAttribute;
      const size = g.getAttribute("aSize") as THREE.BufferAttribute;
      const alpha = g.getAttribute("aAlpha") as THREE.BufferAttribute;
      const tw = g.getAttribute("aTwinkle") as THREE.BufferAttribute;
      for (let i = 0; i < M; i++) {
        const p = randUnit().multiplyScalar(2.5 + Math.pow(rand(), 0.6) * 13);
        pos.setXYZ(i, p.x, p.y, p.z);
        const c = COLORS.mote[rand() < 0.6 ? 0 : 1];
        col.setXYZ(i, c.r, c.g, c.b);
        size.setX(i, 0.05 + rand() * 0.12);
        alpha.setX(i, 0.35 + rand() * 0.55);
        tw.setX(i, 0.01 + rand());
      }
    }
    this.spin.add(this.motes);

    /* Story graph */
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + 0.55;
      this.hypHome.push(new THREE.Vector3(Math.cos(a) * 2.45, Math.sin(a) * 1.55, Math.sin(a + 1.1) * 1.1));
    }
    const stances: ("supports" | "refutes" | "neutral")[] = [];
    for (let i = 0; i < this.S; i++) {
      const h = i % 4;
      this.srcHyp.push(h);
      this.srcHome.push(this.hypHome[h].clone().add(randUnit().multiplyScalar(0.85 + rand() * 0.75)));
      this.srcFar.push(randUnit().multiplyScalar(10 + rand() * 4));
      this.srcDelay.push(rand());
      const r = rand();
      stances.push(r < 0.6 ? "supports" : r < 0.82 ? "refutes" : "neutral");
    }
    this.srcStance = stances;

    this.nodes = makePoints(1 + 4 + this.S + this.P, this.glow, this.shared);
    this.nodes.renderOrder = 3;
    this.graph.add(this.nodes);

    const linkCount = 4 + this.S;
    const lGeo = new THREE.BufferGeometry();
    lGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(linkCount * 6), 3));
    lGeo.setAttribute("color", new THREE.BufferAttribute(new Float32Array(linkCount * 6), 3));
    this.links = new THREE.LineSegments(
      lGeo,
      new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    this.links.frustumCulled = false;
    this.links.renderOrder = 2;
    this.graph.add(this.links);

    this.pageMat = new THREE.MeshBasicMaterial({ map: pageTexture(this.S), transparent: true, opacity: 0, depthWrite: false });
    this.page = new THREE.Mesh(new THREE.PlaneGeometry(PAGE_W, PAGE_H), this.pageMat);
    this.page.position.set(0, 0, 1.2);
    this.page.renderOrder = 1;
    this.graph.add(this.page);

    this.onVis = this.onVis.bind(this);
    document.addEventListener("visibilitychange", this.onVis);
  }

  private newImpulse(rand: () => number, scatter = false) {
    let b = Math.floor(rand() * this.branches.length);
    if (this.branches[b].depth > 0 && rand() < 0.5) b = Math.floor(rand() * this.branches.length);
    return {
      b,
      t: scatter ? rand() : 1,
      speed: 0.6 + rand() * 1.1,
      color: COLORS.impulse[Math.floor(rand() * COLORS.impulse.length)],
      size: 0.16 + rand() * 0.16,
    };
  }

  private pointOn(b: Branch, t: number, out: V3) {
    const target = t * b.len;
    let i = 1;
    while (i < b.cum.length - 1 && b.cum[i] < target) i++;
    const seg = b.cum[i] - b.cum[i - 1] || 1;
    return out.copy(b.pts[i - 1]).lerp(b.pts[i], clamp((target - b.cum[i - 1]) / seg));
  }

  private pageToWorld(u: number, v: number, out: V3) {
    const k = this.page.scale.x;
    return out.set((u - 0.5) * PAGE_W * k, (0.5 - v) * PAGE_H * k, this.page.position.z + 0.05);
  }

  setProgress(stage: number) {
    this.target = clamp(stage, 0, 5.2);
    if (this.reduced) {
      this.stage = this.target;
      this.render();
    }
  }

  setPointer(x: number, y: number) {
    this.pointer.set(x, y);
  }

  resize(w: number, h: number) {
    this.narrow = w < 900;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
    const pr = this.renderer.getPixelRatio();
    this.shared.uScale.value = (h * pr * 0.5) / Math.tan(THREE.MathUtils.degToRad(this.camera.fov * 0.5));
    if (!this.running) this.render();
  }

  start() {
    if (this.running || this.reduced) {
      this.render();
      return;
    }
    this.running = true;
    this.last = performance.now();
    const loop = (now: number) => {
      if (!this.running) return;
      const dt = Math.min(0.05, (now - this.last) / 1000);
      this.last = now;
      this.update(dt);
      this.render();
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  private onVis() {
    if (document.hidden) this.stop();
  }

  private update(dt: number) {
    this.time += dt;
    this.shared.uTime.value = this.time;
    // Damped toward the scroll target: smooth, and interruptible in either direction
    this.stage += (this.target - this.stage) * Math.min(1, dt * 3.2);
    this.pointerSmooth.lerp(this.pointer, Math.min(1, dt * 2.5));
  }

  private render() {
    const st = this.stage;
    const t = this.time;
    const rand = Math.random;

    const askT = sm(0.2, 1.0, st);
    const qVis = sm(0.12, 0.35, st) * (1 - sm(0.95, 1.2, st));
    const hypT = sm(1.15, 1.95, st);
    const verT = sm(3.3, 4.0, st);
    const repT = sm(4.2, 5.0, st);

    if (askT > 0.97 && !this.arrived) {
      this.arrived = true;
      this.flash = 1;
    }
    if (askT < 0.5) this.arrived = false;
    this.flash *= this.reduced ? 0 : Math.exp(-0.06);

    /* World placement: right of the copy on wide screens, centred on narrow ones */
    const wx = this.centered || this.narrow ? 0 : lerp(2.35, 1.9, sm(0.5, 1.5, st));
    // On narrow screens the copy sits low, so the neuron takes the open space above it
    const wy = this.centered ? 0 : this.narrow ? 1.75 : 0;
    this.world.position.set(wx, wy, 0);
    this.world.scale.setScalar(this.centered ? (this.narrow ? 0.75 : 1.08) : this.narrow ? 0.6 : 1);
    this.world.rotation.y = this.pointerSmooth.x * 0.18;
    this.world.rotation.x = -this.pointerSmooth.y * 0.1;
    this.camera.position.z = lerp(9, 8.4, repT);

    /* Neuron */
    this.spin.rotation.y = t * 0.045;
    this.spin.rotation.x = Math.sin(t * 0.07) * 0.08;
    const coreScale = (1 - 0.5 * repT) * (1 + Math.sin(t * 1.6) * 0.012 + this.flash * 0.12);
    this.core.scale.setScalar(coreScale);
    this.coreMat.uniforms.uGlow.value = 1 + this.flash * 1.4 + 0.4 * hypT * (1 - repT);
    this.rings.forEach((r, i) => {
      r.rotation.x += 0.004 * (i + 1);
      r.rotation.y += 0.003 * (2 - i);
    });
    (this.halo.geometry.getAttribute("aSize") as THREE.BufferAttribute).setX(0, (6.2 + this.flash * 2.5) * (1 - 0.55 * repT));
    this.halo.geometry.getAttribute("aSize").needsUpdate = true;
    (this.dendrites.material as THREE.LineBasicMaterial).opacity = lerp(0.85, 0.32, sm(0.8, 1.8, st)) * (1 - 0.6 * repT);

    // Impulses
    {
      const g = this.impulses.geometry;
      const pos = g.getAttribute("position") as THREE.BufferAttribute;
      const col = g.getAttribute("aColor") as THREE.BufferAttribute;
      const size = g.getAttribute("aSize") as THREE.BufferAttribute;
      const alpha = g.getAttribute("aAlpha") as THREE.BufferAttribute;
      const energy = (1 - 0.7 * sm(1.5, 2.5, st)) * (1 - repT);
      this.impulseState.forEach((imp, i) => {
        const b = this.branches[imp.b];
        if (!this.reduced) imp.t -= (imp.speed * 0.016 * 3.2) / b.len;
        if (imp.t <= 0) Object.assign(imp, this.newImpulse(rand));
        this.pointOn(b, imp.t, this.tmp);
        pos.setXYZ(i, this.tmp.x, this.tmp.y, this.tmp.z);
        col.setXYZ(i, imp.color.r, imp.color.g, imp.color.b);
        size.setX(i, imp.size);
        alpha.setX(i, Math.min(1, (1 - imp.t) * 5) * energy);
      });
      pos.needsUpdate = col.needsUpdate = size.needsUpdate = alpha.needsUpdate = true;
    }

    /* Story graph */
    this.graph.rotation.y = Math.sin(t * 0.16) * 0.45 * (1 - repT);
    this.graph.rotation.x = Math.sin(t * 0.11) * 0.08 * (1 - repT);

    const g = this.nodes.geometry;
    const pos = g.getAttribute("position") as THREE.BufferAttribute;
    const col = g.getAttribute("aColor") as THREE.BufferAttribute;
    const size = g.getAttribute("aSize") as THREE.BufferAttribute;
    const alpha = g.getAttribute("aAlpha") as THREE.BufferAttribute;
    const lpos = this.links.geometry.getAttribute("position") as THREE.BufferAttribute;
    const lcol = this.links.geometry.getAttribute("color") as THREE.BufferAttribute;
    const c = new THREE.Color();

    // Question
    {
      const start = this.tmp2.set(-4.6, 1.4, 3.4);
      this.tmp.copy(start).lerp(new THREE.Vector3(0, 0, 0), askT);
      pos.setXYZ(0, this.tmp.x, this.tmp.y, this.tmp.z);
      col.setXYZ(0, 1, 0.92, 0.98);
      size.setX(0, 0.55);
      alpha.setX(0, qVis);
    }

    // Hypotheses
    const hypPos: V3[] = [];
    for (let k = 0; k < 4; k++) {
      const p = this.hypHome[k].clone().multiplyScalar(hypT);
      const slot = VERDICT_SLOTS[k];
      p.lerp(this.pageToWorld(slot.u, slot.v, this.tmp), repT);
      hypPos.push(p);
      pos.setXYZ(1 + k, p.x, p.y, p.z);
      c.copy(COLORS.hypothesis).lerp(this.hypVerdict[k], verT);
      col.setXYZ(1 + k, c.r, c.g, c.b);
      size.setX(1 + k, lerp(0.5, 0.62, verT) * (1 - 0.35 * repT) + Math.sin(t * 2 + k) * 0.02);
      alpha.setX(1 + k, hypT);

      // core → hypothesis link
      lpos.setXYZ(k * 2, 0, 0, 0);
      lpos.setXYZ(k * 2 + 1, p.x, p.y, p.z);
      const la = hypT * (1 - repT) * 0.55;
      lcol.setXYZ(k * 2, 0.3 * la, 0.5 * la, 1 * la);
      lcol.setXYZ(k * 2 + 1, c.r * la, c.g * la, c.b * la);
    }

    // Sources
    const srcPos: V3[] = [];
    for (let i = 0; i < this.S; i++) {
      const d = this.srcDelay[i];
      const inT = sm(2.15 + d * 0.55, 2.85 + d * 0.55, st);
      const p = this.srcFar[i].clone().lerp(this.srcHome[i], inT);
      // follow the hypothesis while it is still forming
      const slot = sourceSlot(i);
      p.lerp(this.pageToWorld(slot.u, slot.v, this.tmp), repT);
      srcPos.push(p);
      const idx = 5 + i;
      pos.setXYZ(idx, p.x, p.y, p.z);
      const stance = this.srcStance[i];
      const verdict = stance === "supports" ? COLORS.supports : stance === "refutes" ? COLORS.refutes : COLORS.neutral;
      c.copy(COLORS.source).lerp(verdict, verT);
      col.setXYZ(idx, c.r, c.g, c.b);
      size.setX(idx, lerp(0.24, stance === "neutral" ? 0.2 : 0.3, verT) * (1 - 0.3 * repT));
      alpha.setX(idx, inT);

      const h = hypPos[this.srcHyp[i]];
      const li = (4 + i) * 2;
      lpos.setXYZ(li, p.x, p.y, p.z);
      lpos.setXYZ(li + 1, h.x, h.y, h.z);
      const la = sm(0.85, 1, inT) * (0.22 + 0.25 * verT) * (1 - repT);
      lcol.setXYZ(li, c.r * la, c.g * la, c.b * la);
      lcol.setXYZ(li + 1, c.r * la * 0.6, c.g * la * 0.6, c.b * la * 0.6);
    }

    // Verification pulses travelling from sources to their hypotheses
    for (let k = 0; k < this.P; k++) {
      const i = (k * 7) % this.S;
      const f = (t * 0.55 + k * 0.371) % 1;
      const a = srcPos[i];
      const b = hypPos[this.srcHyp[i]];
      this.tmp.copy(a).lerp(b, f);
      const idx = 5 + this.S + k;
      pos.setXYZ(idx, this.tmp.x, this.tmp.y, this.tmp.z);
      const stance = this.srcStance[i];
      const v = stance === "supports" ? COLORS.supports : stance === "refutes" ? COLORS.refutes : COLORS.neutral;
      col.setXYZ(idx, v.r, v.g, v.b);
      size.setX(idx, 0.14);
      alpha.setX(idx, sm(3.2, 3.8, st) * (1 - repT) * Math.sin(f * Math.PI) * (this.reduced ? 0 : 1));
    }

    pos.needsUpdate = col.needsUpdate = size.needsUpdate = alpha.needsUpdate = true;
    lpos.needsUpdate = lcol.needsUpdate = true;

    // Report page
    this.pageMat.opacity = repT;
    this.page.visible = repT > 0.001;
    this.page.scale.setScalar(0.8 + 0.06 * repT);

    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.stop();
    document.removeEventListener("visibilitychange", this.onVis);
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose?.();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else mat?.dispose?.();
    });
    this.glow.dispose();
    this.pageMat.map?.dispose();
    this.renderer.dispose();
  }
}
