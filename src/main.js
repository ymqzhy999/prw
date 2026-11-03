import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import gsap from 'gsap';
import { PlantFactory } from './scene/PlantFactory.js';
import { PARTS, LAYERS, PART_ORDER, VIEWS, getPartIndex, pad2 } from './data/parts.js';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

const coarse = window.matchMedia('(pointer: coarse)').matches;
const lowPower = coarse && Math.min(window.innerWidth, window.innerHeight) < 900;
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const state = {
  selected: null,
  mode: 'section',
  cutDepth: 0.5,
  labels: true,
  autoRotate: false,
  exploded: false,
  degraded: false,
  transitioning: false,
};

const EXPLODE_OFFSETS = {
  containment: [0, 0, 0],
  turbineHall: [0, 0, -4],
  auxiliary: [0, 0, 7],
  rpv: [0, 7, 0],
  core: [0, 13.5, 0],
  steamGenerator: [-9, 4, 0],
  pressurizer: [8, 7, 8],
  pump: [2, 5, 10],
  turbine: [0, 5.5, 0],
  generator: [11, 5.5, 0],
  coolingTower: [0, 0, -7],
};

let renderer, scene, camera, controls, plant, composer, bloomPass, clock;
let raycaster, pointer;
let cameraTween = null;
let labelsRoot, selectionTag, labelSvg;
const labelLines = new Map();
const LABEL_OFFSETS = {
  containment: [-72, -18], turbineHall: [62, 40], auxiliary: [-86, 18],
  rpv: [-80, 6], core: [-52, 74], steamGenerator: [-96, -6],
  pressurizer: [84, -16], pump: [-82, 48], turbine: [76, -24],
  generator: [86, 12], coolingTower: [62, -42],
};
const labelEls = new Map();
let toastTimer = null;
let firstFrame = false;
const fps = { frames: 0, time: 0, value: 60, lowStreak: 0 };

/* ───────────────────────── boot ───────────────────────── */

boot();

async function boot() {
  const bar = $('#loadBar');
  const status = $('#loadStatus');
  const setLoad = (p, text) => {
    if (bar) bar.style.width = `${p}%`;
    if (status && text) status.textContent = text;
  };

  try {
    setLoad(12, '初始化 WebGL 渲染器…');
    await nextFrame();
    initRenderer();

    setLoad(30, '构建环境光照与材质…');
    await nextFrame();
    initScene();

    setLoad(52, '装配核岛与常规岛几何体…');
    await nextFrame();
    plant = new PlantFactory(scene, { quality: lowPower ? 'low' : 'high', lowPower });
    plant.setDecorVisible(false);

    setLoad(76, '配置交互与结构数据…');
    await nextFrame();
    initPost();
    initUI();
    initLabels();
    bindEvents();
    initTelemetry();
    updateModeUI();
    updateVisibilityUI();

    setLoad(100, '场景就绪');
    await nextFrame();
    animate();

    setTimeout(() => {
      $('#loading').classList.add('done');
      setTimeout(() => hideHint(), 6500);
      if (!state.transitioning) {
        const v = window.innerWidth < 900 ? VIEWS.reactor : VIEWS.overview;
        flyTo(v.pos, v.target, 1.8);
      }
    }, 120);

    setTimeout(() => {
      const loading = $('#loading');
      if (loading) loading.style.display = 'none';
    }, 1000);
  } catch (err) {
    console.error('[Nuclear Reactor 3D] failed to boot:', err);
    $('#loading').classList.add('done');
    $('#webglError').hidden = false;
    const info = $('#webglError p');
    if (info) info.textContent = `初始化失败：${err?.message || String(err)}。请确认浏览器已启用 WebGL 2.0 与硬件加速后重试。`;
  }
}

function nextFrame() {
  return new Promise((resolve) => setTimeout(resolve, 16));
}

/* ───────────────────────── three.js ───────────────────────── */

function initRenderer() {
  const canvas = $('#scene');
  try {
    renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: !lowPower,
      alpha: false,
      powerPreference: 'high-performance',
      stencil: false,
    });
  } catch (err) {
    throw new Error('当前设备或浏览器不支持 WebGL');
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, lowPower ? 1.5 : 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
  renderer.shadowMap.enabled = !lowPower;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.localClippingEnabled = true;
  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    showToast('图形上下文已丢失，正在等待恢复…');
  });
  canvas.addEventListener('webglcontextrestored', () => {
    showToast('图形上下文已恢复');
  });
}

function initScene() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x02070d);
  scene.fog = new THREE.Fog(0x02070d, 135, 330);

  camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.5, 600);
  camera.position.set(92, 62, 118);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(-2, 10, -8);
  controls.enableDamping = true;
  controls.dampingFactor = 0.055;
  controls.rotateSpeed = 0.68;
  controls.zoomSpeed = 0.85;
  controls.panSpeed = 0.8;
  controls.screenSpacePanning = true;
  controls.minDistance = 11;
  controls.maxDistance = 240;
  controls.minPolarAngle = 0.08;
  controls.maxPolarAngle = Math.PI * 0.492;
  controls.autoRotateSpeed = 0.55;
  controls.touches.ONE = THREE.TOUCH.ROTATE;
  controls.touches.TWO = THREE.TOUCH.DOLLY_PAN;
  controls.update();

  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  const envScene = new RoomEnvironment();
  const env = pmrem.fromScene(envScene, 0.03).texture;
  scene.environment = env;
  scene.environmentIntensity = lowPower ? 0.5 : 0.62;
  envScene.dispose?.();
  pmrem.dispose();

  addSkyDome();

  const hemi = new THREE.HemisphereLight(0x8dbde0, 0x221a14, 0.72);
  scene.add(hemi);

  const key = new THREE.DirectionalLight(0xffd8b4, 3.1);
  key.position.set(52, 70, 58);
  key.castShadow = !lowPower;
  if (!lowPower) {
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.left = -72;
    key.shadow.camera.right = 72;
    key.shadow.camera.top = 78;
    key.shadow.camera.bottom = -58;
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 240;
    key.shadow.bias = -0.00035;
    key.shadow.normalBias = 0.025;
  }
  scene.add(key);

  const rim = new THREE.DirectionalLight(0x2f7fff, 2.3);
  rim.position.set(-70, 46, -58);
  scene.add(rim);

  const warm = new THREE.DirectionalLight(0xff7a3a, 0.5);
  warm.position.set(-16, 18, 52);
  scene.add(warm);

  const fill = new THREE.PointLight(0x2b9fd8, 42, 90, 2);
  fill.position.set(22, 28, 28);
  scene.add(fill);

  if (!lowPower) {
    const coreFill = new THREE.PointLight(0xff7a2e, 140, 32, 2);
    coreFill.position.set(-18, 14, 9);
    scene.add(coreFill);
    const domeFill = new THREE.PointLight(0x8fd8ff, 80, 24, 2);
    domeFill.position.set(-18, 19, -6);
    scene.add(domeFill);
    const vesselFill = new THREE.PointLight(0xffd2a0, 70, 18, 2);
    vesselFill.position.set(-18, 9, 2);
    scene.add(vesselFill);
    const hallFill = new THREE.PointLight(0xffb066, 60, 34, 2);
    hallFill.position.set(9, 9, 2);
    scene.add(hallFill);
  }

  raycaster = new THREE.Raycaster();
  pointer = new THREE.Vector2();
  clock = new THREE.Clock();
}

function addSkyDome() {
  const geo = new THREE.SphereGeometry(430, 32, 18);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {},
    vertexShader: `varying vec3 vPos; void main() { vPos = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `
      varying vec3 vPos;
      void main() {
        vec3 d = normalize(vPos);
        float h = clamp(d.y * 0.5 + 0.5, 0.0, 1.0);
        vec3 top = vec3(0.004, 0.014, 0.028);
        vec3 horizon = vec3(0.018, 0.065, 0.105);
        vec3 bottom = vec3(0.006, 0.016, 0.028);
        vec3 col = mix(bottom, horizon, smoothstep(0.35, 0.52, h));
        col = mix(col, top, smoothstep(0.52, 1.0, h));
        float glow = pow(max(0.0, 1.0 - abs(h - 0.49) * 5.0), 7.0) * 0.10;
        col += vec3(0.08, 0.30, 0.45) * glow;
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const sky = new THREE.Mesh(geo, mat);
  sky.frustumCulled = false;
  scene.add(sky);
}

function initPost() {
  if (lowPower) return;
  composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  bloomPass = new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight),
    0.6,
    0.55,
    0.68,
  );
  composer.addPass(bloomPass);
  composer.addPass(new OutputPass());
  composer.setSize(window.innerWidth, window.innerHeight);
}

/* ───────────────────────── UI construction ───────────────────────── */

const EYE_OPEN = '<svg viewBox="0 0 24 24"><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z"/><circle cx="12" cy="12" r="2.5"/></svg>';
const EYE_OFF = '<svg viewBox="0 0 24 24"><path d="M3 3l18 18"/><path d="M10.6 6.2A10 10 0 0 1 12 6c6.5 0 10 6 10 6a16 16 0 0 1-3.4 3.9M6.1 7.8A16.5 16.5 0 0 0 2 12s3.5 6 10 6a10 10 0 0 0 3.5-.6"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>';

function initUI() {
  labelsRoot = $('#labels');
  selectionTag = $('#selectionTag');
  buildTree();
  buildChips();
  buildQuickViews();
  updateModeUI();
}

function buildTree() {
  const root = $('#treeRoot');
  root.innerHTML = '';
  for (const layer of LAYERS) {
    const group = document.createElement('div');
    group.className = 'tree-group open';
    group.dataset.layer = layer.id;
    const head = document.createElement('div');
    head.className = 'tree-group-head';
    head.innerHTML = `
      <button class="group-toggle" aria-expanded="true">
        <span class="group-caret"></span>
        <span class="group-index">${layer.index}</span>
        <span class="group-name">${layer.name}</span>
        <span class="group-count">${layer.parts.length}</span>
      </button>
      <button class="eye" data-layer="${layer.id}" title="显示/隐藏整层">${EYE_OPEN}</button>`;
    const wrap = document.createElement('div');
    wrap.className = 'tree-items';
    for (const id of layer.parts) {
      const part = PARTS[id];
      const item = document.createElement('div');
      item.className = 'tree-item';
      item.dataset.part = id;
      item.setAttribute('role', 'button');
      item.setAttribute('tabindex', '0');
      item.innerHTML = `
        <span class="item-dot"></span>
        <span class="item-name">${part.name}</span>
        <span class="item-en">${part.en}</span>
        <button class="eye" data-part="${id}" title="显示/隐藏部件">${EYE_OPEN}</button>`;
      wrap.appendChild(item);
    }
    group.append(head, wrap);
    root.appendChild(group);
  }

  root.addEventListener('click', (e) => {
    const eye = e.target.closest('.eye');
    if (eye) {
      e.stopPropagation();
      if (eye.dataset.part) togglePart(eye.dataset.part);
      else if (eye.dataset.layer) toggleLayer(eye.dataset.layer);
      return;
    }
    const toggle = e.target.closest('.group-toggle');
    if (toggle) {
      const group = toggle.closest('.tree-group');
      const open = group.classList.toggle('open');
      toggle.setAttribute('aria-expanded', String(open));
      return;
    }
    const item = e.target.closest('.tree-item');
    if (item) selectPart(item.dataset.part);
  });

  root.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const item = e.target.closest('.tree-item');
    if (item) {
      e.preventDefault();
      selectPart(item.dataset.part);
    }
  });
}

function buildChips() {
  const box = $('#layerChips');
  box.innerHTML = '';
  for (const layer of LAYERS) {
    const btn = document.createElement('button');
    btn.className = 'chip';
    btn.dataset.layer = layer.id;
    btn.innerHTML = `<i class="chip-dot"></i><span class="chip-full">${layer.name}</span><span class="chip-short">${layer.short}</span>`;
    btn.addEventListener('click', () => toggleLayer(layer.id));
    box.appendChild(btn);
  }
}

function buildQuickViews() {
  const box = $('#quickViews');
  box.innerHTML = '';
  let i = 0;
  for (const [key, v] of Object.entries(VIEWS)) {
    i++;
    const btn = document.createElement('button');
    btn.className = 'quick-view';
    btn.dataset.view = key;
    btn.innerHTML = `<span>${v.name}</span><i>0${i}</i>`;
    btn.addEventListener('click', () => applyView(key));
    box.appendChild(btn);
  }
}

function initLabels() {
  labelsRoot.innerHTML = '';
  labelEls.clear();
  labelSvg = $('#labelLines');
  if (labelSvg) labelSvg.innerHTML = '';
  labelLines.clear();
  for (const id of PART_ORDER) {
    const part = PARTS[id];
    const el = document.createElement('button');
    el.className = 'map-label';
    el.dataset.part = id;
    el.innerHTML = `<span class="lbl-cn">${part.name}</span><span class="lbl-en">${part.en}</span>`;
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      selectPart(id);
    });
    labelsRoot.appendChild(el);
    labelEls.set(id, el);
    if (labelSvg) {
      const ns = 'http://www.w3.org/2000/svg';
      const line = document.createElementNS(ns, 'line');
      const dot = document.createElementNS(ns, 'circle');
      dot.setAttribute('r', '2.4');
      labelSvg.append(line, dot);
      labelLines.set(id, { line, dot });
    }
  }
}

/* ───────────────────────── interaction ───────────────────────── */

function bindEvents() {
  const canvas = renderer.domElement;
  let down = null;

  canvas.addEventListener('pointerdown', (e) => {
    down = { x: e.clientX, y: e.clientY, t: performance.now() };
    $('#hint')?.classList.add('fade');
  });

  canvas.addEventListener('pointerup', (e) => {
    if (!down) return;
    const dist = Math.hypot(e.clientX - down.x, e.clientY - down.y);
    const dt = performance.now() - down.t;
    down = null;
    if (dist > 7 || dt > 650) return;
    const id = pick(e.clientX, e.clientY);
    if (id) {
      selectPart(id);
      return;
    }
    if (state.selected) clearSelection();
    closeMobilePanels();
  });

  canvas.addEventListener('dblclick', (e) => {
    const id = pick(e.clientX, e.clientY);
    if (id) {
      selectPart(id);
      focusPart(id);
    }
  });

  $('#btnRotate').addEventListener('click', toggleAutoRotate);
  $('#btnLabels').addEventListener('click', toggleLabels);
  $('#btnReset').addEventListener('click', resetScene);
  $('#btnFullscreen').addEventListener('click', toggleFullscreen);
  $('#btnHelp').addEventListener('click', openHelp);
  $('#btnCloseHelp').addEventListener('click', closeHelp);
  $('#helpModal').addEventListener('click', (e) => {
    if (e.target.id === 'helpModal') closeHelp();
  });

  $('#btnCloseSel').addEventListener('click', () => clearSelection());
  $('#btnFocus').addEventListener('click', () => state.selected && focusPart(state.selected));
  $('#btnTogglePart').addEventListener('click', () => state.selected && togglePart(state.selected));
  $('#btnPrevPart').addEventListener('click', () => cyclePart(-1));
  $('#btnNextPart').addEventListener('click', () => cyclePart(1));

  for (const btn of $$('#modeSwitch button')) {
    btn.addEventListener('click', () => setMode(btn.dataset.mode));
  }
  $('#cutRange').addEventListener('input', (e) => {
    const value = parseFloat(e.target.value);
    state.cutDepth = value;
    $('#cutValue').textContent = value.toFixed(1);
    plant.setCutDepth(value);
  });

  $('#btnTreeMobile').addEventListener('click', () => {
    const panel = $('#treePanel');
    const open = panel.classList.toggle('open');
    $('#infoPanel').classList.remove('open');
    $('#btnTreeMobile').classList.toggle('active', open);
    $('#btnInfoMobile').classList.remove('active');
  });
  $('#btnInfoMobile').addEventListener('click', () => {
    const panel = $('#infoPanel');
    const open = panel.classList.toggle('open');
    $('#treePanel').classList.remove('open');
    $('#btnInfoMobile').classList.toggle('active', open);
    $('#btnTreeMobile').classList.remove('active');
  });

  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', () => setTimeout(onResize, 120));

  window.addEventListener('keydown', (e) => {
    if (e.target.matches('input, textarea')) return;
    const k = e.key.toLowerCase();
    if (k === 'r') toggleAutoRotate();
    else if (k === 'l') toggleLabels();
    else if (k === 'f') toggleFullscreen();
    else if (k === '0') resetScene();
    else if (k === 'escape') {
      closeHelp();
      clearSelection();
      closeMobilePanels();
    } else if (['1', '2', '3', '4', '5'].includes(k)) {
      const key = Object.keys(VIEWS)[Number(k) - 1];
      if (key) applyView(key);
    } else if (k === 'h' || k === '?') openHelp();
  });

  document.addEventListener('fullscreenchange', () => {
    $('#btnFullscreen').setAttribute('aria-pressed', String(Boolean(document.fullscreenElement)));
  });
}

function pick(clientX, clientY) {
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(plant.pickMeshes, false);
  for (const hit of hits) {
    const p = plant.getPart(hit.object.userData.partId);
    if (p && p.visible && isChainVisible(hit.object)) return p.id;
  }
  return null;
}

function isChainVisible(obj) {
  let o = obj;
  while (o) {
    if (!o.visible) return false;
    o = o.parent;
  }
  return true;
}

/* ───────────────────────── selection & info ───────────────────────── */

function selectPart(id, opts = {}) {
  const part = plant.getPart(id);
  if (!part) return;
  if (!part.visible) {
    plant.setPartVisible(id, true);
    part.visible = true;
    updateVisibilityUI();
  }
  state.selected = id;
  plant.setHighlight(id, true);
  renderSelected(id);
  $('#infoDefault').hidden = true;
  $('#infoSelected').hidden = false;

  for (const el of $$('.tree-item')) el.classList.toggle('active', el.dataset.part === id);
  for (const [key, el] of labelEls) el.classList.toggle('active', key === id);

  const idx = getPartIndex(id);
  selectionTag.hidden = false;
  selectionTag.textContent = `${pad2(idx)} · ${PARTS[id].en}`;

  const activeItem = $(`.tree-item[data-part="${id}"]`);
  activeItem?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });

  if (window.innerWidth <= 860) {
    $('#infoPanel').classList.add('open');
    $('#treePanel').classList.remove('open');
    $('#btnInfoMobile').classList.add('active');
    $('#btnTreeMobile').classList.remove('active');
  }

  if (opts.focus) focusPart(id);
}

function renderSelected(id) {
  const data = PARTS[id];
  const idx = getPartIndex(id);
  const layer = LAYERS.find((l) => l.id === data.layer);
  $('#selCategory').textContent = `${layer?.en || data.category} / ${pad2(idx)}`;
  $('#selName').textContent = data.name;
  $('#selEn').textContent = data.en;
  $('#selDesc').textContent = data.desc;
  $('#selSpecs').innerHTML = data.specs.map(([k, v]) => `
    <div class="spec-cell"><span>${k}</span><b>${v}</b></div>`).join('');
  $('#selHeatBar').style.width = `${data.heat}%`;
  $('#selHeatVal').textContent = `${data.heat}%`;
  $('#selIndex').textContent = `${pad2(idx)} / ${pad2(PART_ORDER.length)}`;
  const toggleLabel = $('#btnTogglePart span');
  if (toggleLabel) toggleLabel.textContent = plant.getPart(id)?.visible ? '隐藏' : '显示';
}

function clearSelection() {
  if (!state.selected) return;
  plant.setHighlight(null);
  state.selected = null;
  $('#infoSelected').hidden = true;
  $('#infoDefault').hidden = false;
  for (const el of $$('.tree-item')) el.classList.remove('active');
  for (const el of labelEls.values()) el.classList.remove('active');
  selectionTag.hidden = true;
}

function cyclePart(direction) {
  const current = state.selected || PART_ORDER[0];
  const i = PART_ORDER.indexOf(current);
  const next = PART_ORDER[(i + direction + PART_ORDER.length) % PART_ORDER.length];
  selectPart(next);
}

function focusPart(id) {
  const data = PARTS[id];
  if (!data) return;
  const p = plant.getPart(id);
  const off = p ? p.group.position.clone().sub(p.basePosition) : new THREE.Vector3();
  const pos = data.focus.pos.map((v, i) => v + (i === 0 ? off.x : i === 1 ? off.y : off.z));
  const target = data.focus.target.map((v, i) => v + (i === 0 ? off.x : i === 1 ? off.y : off.z));
  if (data.focus.cut && state.mode !== 'section') setMode('section');
  flyTo(pos, target, 1.25);
  showToast(`视角已聚焦：${data.name}`);
}

function flyTo(pos, target, duration = 1.3) {
  if (!pos || !target) return;
  if (cameraTween) cameraTween.kill();
  const from = {
    px: camera.position.x, py: camera.position.y, pz: camera.position.z,
    tx: controls.target.x, ty: controls.target.y, tz: controls.target.z,
  };
  const to = {
    px: pos[0], py: pos[1], pz: pos[2],
    tx: target[0], ty: target[1], tz: target[2],
  };
  const wasAuto = controls.autoRotate;
  controls.enabled = false;
  controls.autoRotate = false;
  state.transitioning = true;
  cameraTween = gsap.to(from, {
    ...to,
    duration: reducedMotion ? 0.15 : duration,
    ease: 'power3.inOut',
    overwrite: true,
    onUpdate: () => {
      camera.position.set(from.px, from.py, from.pz);
      controls.target.set(from.tx, from.ty, from.tz);
      controls.update();
    },
    onComplete: () => {
      controls.enabled = true;
      controls.autoRotate = wasAuto;
      state.transitioning = false;
      cameraTween = null;
    },
  });
}

/* ───────────────────────── visibility ───────────────────────── */

function togglePart(id) {
  const part = plant.getPart(id);
  if (!part) return;
  const next = !part.visible;
  plant.setPartVisible(id, next);
  part.visible = next;
  updateVisibilityUI();
  if (state.selected === id) renderSelected(id);
  showToast(`${PARTS[id].name} 已${next ? '显示' : '隐藏'}`);
}

function toggleLayer(layerId) {
  const layer = LAYERS.find((l) => l.id === layerId);
  if (!layer) return;
  const anyVisible = layer.parts.some((id) => plant.getPart(id)?.visible);
  for (const id of layer.parts) {
    const p = plant.getPart(id);
    if (!p) continue;
    p.visible = !anyVisible;
    p.group.visible = !anyVisible;
  }
  updateVisibilityUI();
  if (state.selected && !plant.getPart(state.selected)?.visible) {
    showToast(`已隐藏 ${PARTS[state.selected].name} 所属部件`);
  } else {
    showToast(`${layer.name} 已${anyVisible ? '隐藏' : '显示'}`);
  }
}

function updateVisibilityUI() {
  for (const el of $$('.tree-item')) {
    const id = el.dataset.part;
    const visible = Boolean(plant.getPart(id)?.visible);
    const eye = el.querySelector('.eye');
    if (eye) {
      eye.innerHTML = visible ? EYE_OPEN : EYE_OFF;
      eye.classList.toggle('off', !visible);
    }
    el.classList.toggle('dim', !visible);
  }
  for (const el of $$('.eye[data-layer]')) {
    const layer = LAYERS.find((l) => l.id === el.dataset.layer);
    const any = layer?.parts.some((id) => plant.getPart(id)?.visible);
    el.innerHTML = any ? EYE_OPEN : EYE_OFF;
    el.classList.toggle('off', !any);
  }
  for (const chip of $$('.chip')) {
    const layer = LAYERS.find((l) => l.id === chip.dataset.layer);
    const any = layer?.parts.some((id) => plant.getPart(id)?.visible);
    chip.classList.toggle('off', !any);
    chip.classList.toggle('active', Boolean(any));
  }
  if (state.selected) renderSelected(state.selected);
}

/* ───────────────────────── modes & views ───────────────────────── */

function updateModeUI() {
  for (const btn of $$('#modeSwitch button')) {
    btn.classList.toggle('active', btn.dataset.mode === state.mode);
  }
  const wrap = $('#cutSliderWrap');
  wrap?.classList.toggle('enabled', state.mode === 'section');
  $('#cutRange').disabled = state.mode !== 'section';
  $('#cutValue').textContent = state.cutDepth.toFixed(1);
  $('#cutRange').value = String(state.cutDepth);
}

function setMode(mode) {
  if (!['solid', 'section', 'explode', 'xray'].includes(mode)) return;
  if (state.mode === mode && mode !== 'explode') return;
  state.mode = mode;
  updateModeUI();
  const target = mode === 'section';
  plant.setSection(target, state.cutDepth);
  plant.setShellTranslucency(mode);
  animateExplode(mode === 'explode');
  plant.setDecorVisible(mode !== 'section' && mode !== 'explode');

  const labels = { solid: '实体模式', section: '整体剖切', explode: '分层拆解', xray: '透视模式' };
  showToast(labels[mode]);
}

function animateExplode(on) {
  state.exploded = on;
  for (const id of PART_ORDER) {
    const p = plant.getPart(id);
    if (!p) continue;
    const dest = on ? EXPLODE_OFFSETS[id] : [0, 0, 0];
    const base = p.basePosition;
    gsap.to(p.group.position, {
      x: base.x + dest[0], y: base.y + dest[1], z: base.z + dest[2],
      duration: reducedMotion ? 0.01 : 0.95,
      ease: 'power3.inOut',
      overwrite: true,
    });
  }
}

function applyView(key) {
  const view = VIEWS[key];
  if (!view) return;
  if (view.cut && state.mode !== 'section') setMode('section');
  flyTo(view.pos, view.target, 1.35);
  closeMobilePanels(false);
  showToast(`预设视角：${view.name}`);
}

/* ───────────────────────── top actions ───────────────────────── */

function toggleAutoRotate() {
  state.autoRotate = !state.autoRotate;
  controls.autoRotate = state.autoRotate;
  $('#btnRotate').setAttribute('aria-pressed', String(state.autoRotate));
  showToast(state.autoRotate ? '自动旋转已开启' : '自动旋转已关闭');
}

function toggleLabels() {
  state.labels = !state.labels;
  labelsRoot.style.display = state.labels ? 'block' : 'none';
  if (labelSvg) labelSvg.style.display = state.labels ? 'block' : 'none';
  $('#btnLabels').setAttribute('aria-pressed', String(state.labels));
  showToast(state.labels ? '部件标注已开启' : '部件标注已关闭');
}

function resetScene() {
  clearSelection();
  for (const id of PART_ORDER) {
    plant.setPartVisible(id, true);
    const p = plant.getPart(id);
    if (p) p.visible = true;
  }
  gsap.killTweensOf(plant.partsRoot.children.map((c) => c.position));
  if (state.mode === 'explode') animateExplode(false);
  state.cutDepth = 0.5;
  setMode('section');
  plant.setCutDepth(state.cutDepth);
  updateVisibilityUI();
  updateModeUI();
  state.autoRotate = false;
  controls.autoRotate = false;
  $('#btnRotate').setAttribute('aria-pressed', 'false');
  state.labels = true;
  labelsRoot.style.display = 'block';
  if (labelSvg) labelSvg.style.display = 'block';
  $('#btnLabels').setAttribute('aria-pressed', 'true');
  flyTo(VIEWS.overview.pos, VIEWS.overview.target, 1.3);
  closeMobilePanels(false);
  showToast('场景已重置');
}

async function toggleFullscreen() {
  const btn = $('#btnFullscreen');
  try {
    if (!document.fullscreenElement) {
      await document.documentElement.requestFullscreen?.();
      btn.setAttribute('aria-pressed', 'true');
      showToast('已进入全屏展示');
    } else {
      await document.exitFullscreen?.();
      btn.setAttribute('aria-pressed', 'false');
      showToast('已退出全屏');
    }
  } catch (err) {
    if (window.Capacitor?.isNativePlatform?.()) {
      showToast('应用已启用沉浸式全屏');
    } else {
      showToast('当前浏览器不支持全屏接口');
    }
  }
}

function openHelp() {
  $('#helpModal').hidden = false;
}
function closeHelp() {
  $('#helpModal').hidden = true;
}

function closeMobilePanels(clearActive = true) {
  if (window.innerWidth > 860) return;
  $('#treePanel').classList.remove('open');
  $('#infoPanel').classList.remove('open');
  if (clearActive) {
    $('#btnTreeMobile').classList.remove('active');
    $('#btnInfoMobile').classList.remove('active');
  }
}

/* ───────────────────────── labels ───────────────────────── */

function updateLabels() {
  if (!labelsRoot) return;
  const w = window.innerWidth;
  const h = window.innerHeight;
  const v = new THREE.Vector3();
  const placed = [];
  const order = state.selected ? [state.selected, ...PART_ORDER.filter((id) => id !== state.selected)] : PART_ORDER;

  for (const id of PART_ORDER) {
    const el = labelEls.get(id);
    if (el) el.style.display = 'none';
  }

  const compact = w < 860;
  for (const id of order) {
    const el = labelEls.get(id);
    const part = plant.getPart(id);
    const guide = labelLines.get(id);
    if (!el || !part || !part.visible) {
      if (guide) { guide.line.style.display = 'none'; guide.dot.style.display = 'none'; }
      continue;
    }
    const anchor = PARTS[id].anchor;
    v.set(anchor[0], anchor[1], anchor[2]).add(part.group.position);
    v.project(camera);
    if (v.z > 1 || Math.abs(v.x) > 1.2 || Math.abs(v.y) > 1.2) {
      if (guide) { guide.line.style.display = 'none'; guide.dot.style.display = 'none'; }
      continue;
    }
    const ax = (v.x * 0.5 + 0.5) * w;
    const ay = (-v.y * 0.5 + 0.5) * h;
    if (placed.some((p) => Math.hypot(p.x - ax, p.y - ay) < (compact ? 42 : 54))) {
      if (guide) { guide.line.style.display = 'none'; guide.dot.style.display = 'none'; }
      continue;
    }
    const off = LABEL_OFFSETS[id] || [40, 0];
    const scale = compact ? 0.7 : 1;
    const marginX = compact ? 58 : 90;
    const x = Math.max(marginX, Math.min(w - marginX, ax + off[0] * scale));
    const y = Math.max(70, Math.min(h - (compact ? 190 : 160), ay + off[1] * scale));
    placed.push({ x: ax, y: ay });
    el.style.display = 'block';
    el.style.transform = `translate(-50%, -50%) translate(${x}px, ${y}px)`;
    if (guide) {
      guide.line.style.display = 'block';
      guide.dot.style.display = 'block';
      guide.line.setAttribute('x1', ax.toFixed(1));
      guide.line.setAttribute('y1', ay.toFixed(1));
      guide.line.setAttribute('x2', x.toFixed(1));
      guide.line.setAttribute('y2', y.toFixed(1));
      guide.dot.setAttribute('cx', ax.toFixed(1));
      guide.dot.setAttribute('cy', ay.toFixed(1));
    }
  }
}

function updateSelectionTag() {
  if (!state.selected || selectionTag.hidden) return;
  const part = plant.getPart(state.selected);
  if (!part || !part.visible) {
    selectionTag.hidden = true;
    return;
  }
  const anchor = PARTS[state.selected].anchor;
  const v = new THREE.Vector3(anchor[0], anchor[1] + 1.5, anchor[2]).add(part.group.position);
  v.project(camera);
  if (v.z > 1) {
    selectionTag.hidden = true;
    return;
  }
  const x = (v.x * 0.5 + 0.5) * window.innerWidth;
  const y = (-v.y * 0.5 + 0.5) * window.innerHeight;
  selectionTag.style.transform = `translate(-50%, -100%) translate(${x}px, ${y}px)`;
}

/* ───────────────────────── telemetry / toast ───────────────────────── */

function initTelemetry() {
  const temp = $('#telTemp');
  const flow = $('#telFlow');
  const power = $('#telPower');
  const tempBar = $('#telTempBar');
  const flowBar = $('#telFlowBar');
  const powerBar = $('#telPowerBar');
  let t = 0;
  const tick = () => {
    t += 1;
    const tempV = 316 + Math.sin(t * 0.7) * 3.2;
    const flowV = 97.8 + Math.sin(t * 0.42 + 1) * 1.1;
    const powerV = 1006 + Math.sin(t * 0.35 + 2) * 8;
    if (temp) temp.textContent = tempV.toFixed(0);
    if (flow) flow.textContent = flowV.toFixed(1);
    if (power) power.textContent = powerV.toFixed(0);
    if (tempBar) tempBar.style.width = `${(tempV / 350) * 100}%`;
    if (flowBar) flowBar.style.width = `${flowV}%`;
    if (powerBar) powerBar.style.width = `${(powerV / 1200) * 100}%`;
  };
  tick();
  setInterval(tick, 2400);
}

function showToast(msg) {
  const el = $('#toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}

function hideHint() {
  $('#hint')?.classList.add('fade');
}

/* ───────────────────────── resize / loop ───────────────────────── */

function onResize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  if (composer) composer.setSize(w, h);
  if (bloomPass) bloomPass.resolution.set(w, h);
  if (w > 860) closeMobilePanels();
}

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  const elapsed = clock.elapsedTime;

  controls.update();
  plant.update(dt, elapsed);
  updateLabels();
  updateSelectionTag();

  if (composer && !state.degraded) composer.render();
  else renderer.render(scene, camera);

  if (!firstFrame) {
    firstFrame = true;
    document.body.classList.add('ready');
  }

  fps.frames++;
  fps.time += dt;
  if (fps.time >= 1) {
    fps.value = Math.round(fps.frames / fps.time);
    fps.frames = 0;
    fps.time = 0;
    const label = $('#fpsLabel');
    if (label) label.textContent = `${fps.value} FPS`;
    if (fps.value < 30) fps.lowStreak++;
    else fps.lowStreak = 0;
    if (fps.lowStreak >= 4 && !state.degraded && !lowPower) {
      degradeQuality();
    }
  }
}

function degradeQuality() {
  state.degraded = true;
  renderer.setPixelRatio(1);
  if (bloomPass) bloomPass.strength = 0.22;
  showToast('帧率偏低，已自动降低渲染分辨率');
}
