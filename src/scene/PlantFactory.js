import * as THREE from 'three';

/**
 * Procedural PWR concept plant.
 * Purely illustrative geometry — no engineering dimensions or real fuel design.
 */

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const PI = Math.PI;

export class PlantFactory {
  constructor(scene, { quality = 'high', lowPower = false } = {}) {
    this.scene = scene;
    this.quality = quality;
    this.lowPower = lowPower;
    this.root = new THREE.Group();
    this.root.name = 'plant-root';
    this.partsRoot = new THREE.Group();
    this.decorRoot = new THREE.Group();
    this.pipesRoot = new THREE.Group();
    this.decorRoot.add(this.pipesRoot);
    this.root.add(this.partsRoot, this.decorRoot);
    scene.add(this.root);

    this.parts = new Map();
    this.pickMeshes = [];
    this.cutMaterials = [];
    this.cutPlane = new THREE.Plane(V(0, 0, -1), 0.5);
    this.cutDepth = 0.5;
    this.sectionOn = true;
    this.ctx = null;
    this.animations = [];
    this.steamSystems = [];
    this.bladeGroups = [];
    this.statusLights = [];
    this.techRings = [];
    this.highlightId = null;
    this.clock = 0;
    this.octagon = new THREE.CylinderGeometry(1, 1, 1, 8);
    this.concreteMap = makeConcreteTexture(3, 2);
    this.concreteMapFine = makeConcreteTexture(6, 6);

    this.build();
  }

  /* ───────────────────────── helpers ───────────────────────── */

  isHigh() { return this.quality !== 'low'; }

  material(color, opts = {}) {
    const {
      metalness = 0.5, roughness = 0.5, emissive = 0x000000, emissiveIntensity = 0,
      transparent = false, opacity = 1, side = THREE.FrontSide, cut = false,
      flatShading = false, depthWrite = true, envMapIntensity = 1, cutOffset = 0,
      map = null, bumpMap = null, bumpScale = 0,
    } = opts;
    const m = new THREE.MeshStandardMaterial({
      color, metalness, roughness, emissive, emissiveIntensity,
      transparent, opacity, side, flatShading, depthWrite, envMapIntensity, map, bumpMap, bumpScale,
    });
    m.userData.baseOpacity = opacity;
    m.userData.baseTransparent = transparent;
    m.userData.baseDepthWrite = depthWrite;
    if (this.ctx) {
      this.ctx.materials.push(m);
      if (cut) {
        const plane = new THREE.Plane(new THREE.Vector3(0, 0, -1), 0.5 + cutOffset);
        m.userData.cutPlane = plane;
        m.userData.cutOffset = cutOffset;
        m.clippingPlanes = this.sectionOn ? [plane] : null;
        m.clipShadows = true;
        this.cutMaterials.push(m);
        this.ctx.cut = true;
      }
    }
    return m;
  }

  mk(geo, mat, { p = [0, 0, 0], r = [0, 0, 0], s = [1, 1, 1], parent, cast = true, receive = false, pick = true } = {}) {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(...p);
    mesh.rotation.set(...r);
    mesh.scale.set(...s);
    mesh.castShadow = cast && this.isHigh();
    mesh.receiveShadow = receive;
    (parent || this.ctx.group).add(mesh);
    if (pick) this.ctx.meshes.push(mesh);
    return mesh;
  }

  box(w, h, d, mat, opts = {}) { return this.mk(new THREE.BoxGeometry(w, h, d), mat, opts); }
  cyl(rt, rb, h, mat, opts = {}) { return this.mk(new THREE.CylinderGeometry(rt, rb, h, opts.seg || 28), mat, opts); }
  sphere(r, mat, opts = {}) { return this.mk(new THREE.SphereGeometry(r, opts.seg || 32, opts.seg2 || 18), mat, opts); }
  torus(r, tube, mat, opts = {}) { return this.mk(new THREE.TorusGeometry(r, tube, 8, opts.seg || 48), mat, opts); }

  pipe(points, radius, mat, { parent = this.pipesRoot, seg = 60, radial = 8 } = {}) {
    const curve = new THREE.CatmullRomCurve3(points.map((p) => V(...p)));
    const geo = new THREE.TubeGeometry(curve, seg, radius, radial, false);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.userData.decor = true;
    parent.add(mesh);
    return mesh;
  }

  decorMaterial(color, opts = {}) {
    return new THREE.MeshStandardMaterial({ color, metalness: 0.75, roughness: 0.4, ...opts });
  }

  decorBox(w, h, d, mat, p) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    mesh.position.set(...p);
    mesh.userData.decor = true;
    this.pipesRoot.add(mesh);
    return mesh;
  }

  begin(id) {
    const group = new THREE.Group();
    group.name = `part-${id}`;
    group.userData.partId = id;
    this.partsRoot.add(group);
    this.ctx = { id, group, meshes: [], materials: [], cut: false };
  }

  end() {
    const { id, group, meshes, materials, cut } = this.ctx;
    group.traverse((o) => {
      if (o.isMesh) {
        o.userData.partId = id;
        if (!o.userData.decor) _all(this, o);
      }
    });
    const box = new THREE.Box3().setFromObject(group);
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    this.parts.set(id, { id, group, meshes, materials, cut, box, sphere, visible: true, highlighted: false, basePosition: group.position.clone() });
    this.ctx = null;
  }

  buildPart(id, fn) {
    this.begin(id);
    fn();
    this.end();
  }

  /* ───────────────────────── build ───────────────────────── */

  build() {
    this.buildGround();
    this.buildDecor();
    this.buildContainment();
    this.buildTurbineHall();
    this.buildAuxiliary();
    this.buildRPV();
    this.buildCore();
    this.buildSteamGenerator();
    this.buildPressurizer();
    this.buildPump();
    this.buildTurbine();
    this.buildCoolingTowers();
    this.buildPipes();
    this.buildTechRings();
    this.buildSiteLights();
    this.setSection(this.sectionOn, this.cutDepth);
  }

  buildGround() {
    const groundMat = this.decorMaterial(0x07111c, { roughness: 0.92, metalness: 0.12 });
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(320, 320), groundMat);
    ground.rotation.x = -PI / 2;
    ground.position.y = -0.02;
    ground.receiveShadow = true;
    this.decorRoot.add(ground);

    const padMat = this.decorMaterial(0x3b4a53, { roughness: 0.86, metalness: 0.1, map: this.concreteMapFine });
    const pad1 = new THREE.Mesh(new THREE.CylinderGeometry(12.5, 12.5, 0.28, 64), padMat);
    pad1.position.set(-18, 0, 0);
    pad1.receiveShadow = true;
    const pad2 = new THREE.Mesh(new THREE.BoxGeometry(36, 0.28, 21), padMat);
    pad2.position.set(9, 0, 0);
    pad2.receiveShadow = true;
    const pad3 = new THREE.Mesh(new THREE.BoxGeometry(19, 0.28, 15), padMat);
    pad3.position.set(-18, 0, 20.5);
    pad3.receiveShadow = true;
    this.decorRoot.add(pad1, pad2, pad3);

    const roadMat = new THREE.MeshStandardMaterial({ color: 0x111b22, roughness: 0.9, metalness: 0.1 });
    const road = new THREE.Mesh(new THREE.PlaneGeometry(120, 7), roadMat);
    road.rotation.x = -PI / 2;
    road.position.set(8, 0.035, 17);
    road.receiveShadow = true;
    this.decorRoot.add(road);
    const lineMat = new THREE.MeshBasicMaterial({ color: 0xc9a24a, transparent: true, opacity: 0.4 });
    for (let i = 0; i < 16; i++) {
      const line = new THREE.Mesh(new THREE.PlaneGeometry(4, 0.12), lineMat);
      line.rotation.x = -PI / 2;
      line.position.set(-48 + i * 7.2, 0.04, 17);
      this.decorRoot.add(line);
    }
    const roadSide = new THREE.Mesh(new THREE.PlaneGeometry(120, 0.55), new THREE.MeshBasicMaterial({ color: 0x3b4c57 }));
    roadSide.rotation.x = -PI / 2;
    roadSide.position.set(8, 0.04, 13.4);
    this.decorRoot.add(roadSide);

    const grid = new THREE.GridHelper(300, 100, 0x1a3a4d, 0x0f2231);
    grid.position.y = 0.01;
    grid.material.transparent = true;
    grid.material.opacity = 0.3;
    this.decorRoot.add(grid);

    const ringGeo = new THREE.RingGeometry(57, 57.25, 128);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0x2b8ca8, transparent: true, opacity: 0.35, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = -PI / 2;
    ring.position.y = 0.03;
    this.decorRoot.add(ring);

    for (let i = 0; i < 4; i++) {
      const arc = new THREE.Mesh(new THREE.RingGeometry(44 + i * 3, 44.2 + i * 3, 96, 1, PI * 0.1, PI * 0.28), ringMat.clone());
      arc.rotation.x = -PI / 2;
      arc.position.y = 0.03;
      arc.material.opacity = 0.22 - i * 0.03;
      this.decorRoot.add(arc);
    }

    const stripeGeo = new THREE.BoxGeometry(28, 0.03, 0.24);
    const stripeMat = new THREE.MeshBasicMaterial({ color: 0xff8a3d, transparent: true, opacity: 0.5 });
    for (let i = 0; i < 3; i++) {
      const s = new THREE.Mesh(stripeGeo, stripeMat);
      s.position.set(9, 0.16, 8.5 + i * 0.45);
      this.decorRoot.add(s);
    }
  }

  buildDecor() {
    // Fence / bollards around the reactor island
    const postMat = this.decorMaterial(0x33495a, { metalness: 0.8, roughness: 0.4 });
    const lampMat = new THREE.MeshBasicMaterial({ color: 0x5ad7ff, transparent: true, opacity: 0.75 });
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * PI * 2;
      const r = 43;
      const x = Math.cos(a) * r - 4;
      const z = Math.sin(a) * r - 10;
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 3.2, 6), postMat);
      post.position.set(x, 1.6, z);
      post.castShadow = false;
      this.decorRoot.add(post);
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 6), lampMat);
      lamp.position.set(x, 3.2, z);
      this.decorRoot.add(lamp);
    }

    // transformer / switchyard blocks
    const txMat = this.decorMaterial(0x40505e, { roughness: 0.6 });
    for (let i = 0; i < 3; i++) {
      const tx = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2.6, 2.1), txMat);
      tx.position.set(31 + i * 3.4, 1.3, 12);
      tx.castShadow = this.isHigh();
      this.decorRoot.add(tx);
      for (let j = 0; j < 4; j++) {
        const fin = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.7, 1.7), txMat);
        fin.position.set(30 + i * 3.4 + j * 0.16 - 0.25, 1.5, 12);
        this.decorRoot.add(fin);
      }
    }
    const pylonMat = this.decorMaterial(0x4d616f, { metalness: 0.85, roughness: 0.4 });
    for (let i = 0; i < 2; i++) {
      const x = 40 + i * 8;
      const z = 6;
      for (let k = 0; k < 3; k++) {
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.09, 13, 5), pylonMat);
        leg.position.set(x + (k - 1) * 0.9, 6.5, z);
        leg.rotation.z = (k - 1) * 0.07;
        this.decorRoot.add(leg);
      }
      for (let k = 0; k < 3; k++) {
        const arm = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.09, 0.09), pylonMat);
        arm.position.set(x, 5 + k * 2.6, z);
        this.decorRoot.add(arm);
      }
    }
  }

  buildContainment() {
    this.buildPart('containment', () => {
      // Whole assembly is positioned at the reactor-island origin once.
      this.ctx.group.position.set(-18, 0, 0);
      const concrete = this.material(0xb0b1ab, { roughness: 0.84, metalness: 0.06, cut: true, side: THREE.DoubleSide, envMapIntensity: 0.5, map: this.concreteMap, bumpMap: this.concreteMap, bumpScale: 0.06 });
      const concreteDark = this.material(0x666b6c, { roughness: 0.88, metalness: 0.1, cut: true, side: THREE.DoubleSide, map: this.concreteMap });
      const liner = this.material(0x4d5962, { metalness: 0.8, roughness: 0.4, cut: true, side: THREE.BackSide });
      const trim = this.material(0x8a949a, { metalness: 0.78, roughness: 0.32 });
      const floorMat = this.material(0x3a464e, { metalness: 0.7, roughness: 0.48, cut: true, side: THREE.DoubleSide });
      const railMat = this.material(0xaab7bf, { metalness: 0.92, roughness: 0.24, cut: true });
      const lightMat = this.material(0xffc98c, { emissive: 0xff7a22, emissiveIntensity: 2.4, cut: true });
      const cyanLight = this.material(0x8feaff, { emissive: 0x27c9ff, emissiveIntensity: 2.0, cut: true });
      const craneMat = this.material(0x9d7a31, { metalness: 0.65, roughness: 0.48 });

      // base slab
      this.cyl(15.2, 15.8, 1.0, concreteDark, { p: [0, 0.5, 0], seg: 80, receive: true });
      this.cyl(13.0, 13.0, 20.0, concrete, { p: [0, 11.0, 0], seg: 88, cast: false, receive: true });
      this.cyl(12.62, 12.62, 20.0, liner, { p: [0, 11.0, 0], seg: 80, cast: false });
      const dome = new THREE.SphereGeometry(13.0, 80, 36, 0, PI * 2, 0, PI / 2);
      this.mk(dome, concrete, { p: [0, 21.0, 0], cast: false, receive: true });
      this.torus(13.01, 0.13, trim, { p: [0, 21.0, 0], r: [PI / 2, 0, 0], seg: 96 });

      // vertical ribs and ring beams
      const n = 24;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * PI * 2;
        const rib = this.box(0.42, 19.6, 1.15, concrete, { p: [Math.cos(a) * 13.25, 11.0, Math.sin(a) * 13.25], cast: false });
        rib.rotation.y = -a;
      }
      for (const y of [3.4]) {
        this.torus(13.16, 0.16, trim, { p: [0, y, 0], r: [PI / 2, 0, 0], seg: 84, cast: false });
      }
      // thin architectural seams
      for (let i = 0; i < 48; i++) {
        const a = (i / 48) * PI * 2 + 0.04;
        if (i % 2) continue;
        this.box(0.025, 19.0, 0.05, concreteDark, { p: [Math.cos(a) * 13.06, 11.0, Math.sin(a) * 13.06], cast: false });
      }

      // equipment airlock
      this.box(4.4, 4.6, 1.4, concreteDark, { p: [0, 2.7, 13.45], cast: false });
      this.cyl(1.3, 1.3, 1.7, trim, { p: [0, 2.7, 13.65], r: [PI / 2, 0, 0], seg: 32 });
      this.cyl(1.08, 1.08, 1.9, concreteDark, { p: [0, 2.7, 13.75], r: [PI / 2, 0, 0], seg: 32 });
      this.cyl(1.12, 1.12, 0.18, this.material(0xaebbc5, { metalness: 0.9, roughness: 0.26 }), { p: [0, 2.7, 14.7], r: [PI / 2, 0, 0], seg: 36, cast: false });

      // dome vent and aircraft warning beacon
      this.cyl(0.7, 0.95, 3.8, trim, { p: [6.8, 30.0, 2.2], seg: 22, cast: false });
      this.cyl(0.82, 0.82, 0.38, this.material(0xff8a3d, { emissive: 0xff4a00, emissiveIntensity: 2.2 }), { p: [6.8, 32.0, 2.2], seg: 22, cast: false });
      this.sphere(0.14, this.material(0xff3b1f, { emissive: 0xff2a00, emissiveIntensity: 3 }), { p: [0, 34.1, 0], seg: 10, seg2: 8, cast: false });

      // interior containment floor and equipment pads
      this.cyl(12.5, 12.5, 0.35, this.material(0x39444c, { metalness: 0.35, roughness: 0.7, cut: true }), { p: [0, 1.25, 0], seg: 80, receive: true });
      this.box(8, 0.5, 6.5, concreteDark, { p: [-10, 1.0, 7], cast: false, receive: true });
      this.box(8, 0.5, 6.5, concreteDark, { p: [-10, 1.0, -7], cast: false, receive: true });
      this.box(7, 0.5, 7, concreteDark, { p: [0, 1.0, 0], cast: false, receive: true });

      // ── polar crane ──
      // polar crane rail + trolley
      const craneRail = new THREE.TorusGeometry(11.4, 0.16, 8, 96);
      this.mk(craneRail, craneMat, { p: [0, 22.2, 0], r: [PI / 2, 0, 0], cast: false });
      this.box(3.4, 0.55, 1.1, craneMat, { p: [7.2, 21.95, -5.2], cast: false });
      this.box(1.0, 0.9, 1.4, craneMat, { p: [7.2, 21.3, -5.2], cast: false });



      // ── section rim (visible cut faces / edge glow) ──
      const edgeMat = new THREE.MeshBasicMaterial({ color: 0x3fb7d8, transparent: true, opacity: 0.28, blending: THREE.AdditiveBlending, depthWrite: false });
      const cutGroup = new THREE.Group();
      const wallL = new THREE.Mesh(new THREE.BoxGeometry(0.55, 20.0, 0.6), concreteDark);
      const wallR = wallL.clone();
      const glowL = new THREE.Mesh(new THREE.BoxGeometry(0.05, 20.0, 0.05), edgeMat);
      const glowR = glowL.clone();
      const domeCut = new THREE.Mesh(new THREE.TorusGeometry(1, 0.035, 6, 72, PI), edgeMat);
      const domeBand = new THREE.Mesh(new THREE.TorusGeometry(1, 0.075, 6, 72, PI), concreteDark);
      cutGroup.add(wallL, wallR, glowL, glowR, domeBand, domeCut);
      cutGroup.position.set(0, 0, 0.5);
      cutGroup.visible = true;
      this.ctx.group.add(cutGroup);
      this.containmentCut = { cutGroup, wallL, wallR, glowL, glowR, domeCut, domeBand };

      // exterior pipes
      const pipeMat = this.decorMaterial(0x64727b, { metalness: 0.82, roughness: 0.35 });
      this.pipe([[10.4, 2.2, 10.2], [14.2, 2.2, 10.2], [14.2, 2.2, 15.2]], 0.22, pipeMat, { parent: this.ctx.group, seg: 22 });
      this.pipe([[3.4, 21.5, 11.4], [3.4, 15.5, 11.4], [5.2, 15.5, 13.2]], 0.18, pipeMat, { parent: this.ctx.group, seg: 20 });

      this.animations.push((dt, t) => {
        if (this.containmentCut) {
          this.containmentCut.glowL.material.opacity = 0.2 + Math.sin(t * 2) * 0.06;
          this.containmentCut.glowR.material.opacity = 0.2 + Math.sin(t * 2 + 1) * 0.06;
        }
      });
    });
  }

  buildTurbineHall() {
    this.buildPart('turbineHall', () => {
      const steel = this.material(0x6a7b88, { metalness: 0.82, roughness: 0.38, side: THREE.DoubleSide });
      const steelDark = this.material(0x35434f, { metalness: 0.8, roughness: 0.45 });
      const panel = this.material(0x7a7b76, { metalness: 0.55, roughness: 0.55, side: THREE.DoubleSide });
      const glass = this.material(0x2b6f87, { metalness: 0.25, roughness: 0.15, transparent: true, opacity: 0.26, side: THREE.DoubleSide, depthWrite: false });
      const lightMat = this.material(0x9fe9ff, { emissive: 0x3ed3ff, emissiveIntensity: 1.6 });

      this.box(36, 0.5, 20, steelDark, { p: [9, 0.28, 0], receive: true });
      this.box(34, 0.3, 18, panel, { p: [9, 0.62, 0], receive: true });

      // side columns & roof trusses
      const xs = [-6, -1, 4, 9, 14, 19, 24];
      for (const x of xs) {
        for (const z of [-9.2, 9.2]) {
          this.box(0.55, 12.4, 0.8, steel, { p: [x, 6.8, z], cast: false });
          this.box(1.1, 0.22, 0.8, steelDark, { p: [x, 1.1, z], cast: false });
        }
        this.box(1.0, 0.5, 19, steel, { p: [x, 12.75, 0], cast: false });
      }
      for (const z of [-9.2, 9.2]) {
        this.box(33, 0.45, 0.55, steel, { p: [9, 12.95, z], cast: false });
      }
      for (let i = 0; i < xs.length - 1; i++) {
        const x = (xs[i] + xs[i + 1]) / 2;
        this.box(0.16, 0.16, 18.6, steelDark, { p: [x, 12.15, 0], cast: false, r: [0, 0, 0] });
      }
      // roof glazing strips
      for (let i = 0; i < 5; i++) {
        this.box(32, 0.08, 1.1, glass, { p: [9, 13.15, -5.5 + i * 2.8], cast: false, receive: false });
      }

      // back wall with vertical ribs and lit windows
      this.box(35, 11.4, 0.35, panel, { p: [9, 6.2, -9.35], cast: false });
      for (let i = 0; i < 18; i++) {
        this.box(0.22, 11.2, 0.55, steel, { p: [-7.5 + i * 1.95, 6.2, -9.15], cast: false });
      }
      for (let i = 0; i < 11; i++) {
        this.box(1.45, 0.9, 0.1, lightMat, { p: [-5.6 + i * 2.8, 9.4, -9.12], cast: false });
      }
      // end walls partially open
      this.box(0.35, 10.5, 18.5, panel, { p: [-7.8, 5.9, 0], cast: false });
      this.box(0.35, 7, 18.5, panel, { p: [26.3, 4.2, 0], cast: false });

      // overhead crane
      this.box(0.45, 0.45, 19, steel, { p: [8, 10.8, 0], cast: false });
      this.box(0.45, 0.45, 19, steel, { p: [12, 10.8, 0], cast: false });
      this.box(4.4, 0.55, 1.3, steelDark, { p: [10, 10.45, 2], cast: false });
      this.box(1.2, 1.0, 1.6, this.material(0xc9a227, { metalness: 0.7, roughness: 0.4 }), { p: [10, 9.55, 2] });

      // front facade: low parapet, glazing band, structural mullions
      for (let i = 0; i < 9; i++) {
        const x = -5.5 + i * 3.7;
        this.box(3.5, 3.0, 0.3, panel, { p: [x, 2.05, 9.35], cast: false });
        this.box(3.2, 1.9, 0.1, glass, { p: [x, 4.8, 9.42], cast: false });
      }
      this.box(33, 0.28, 0.55, steelDark, { p: [9, 3.65, 9.35], cast: false });
      this.box(33, 0.24, 0.45, steel, { p: [9, 5.95, 9.35], cast: false });
      for (let i = 0; i < 7; i++) {
        this.box(0.4, 3.4, 0.45, steel, { p: [-6.4 + i * 5.1, 6.0, 9.4], cast: false });
      }
      this.box(31, 0.16, 0.12, lightMat, { p: [9, 12.1, 9.45], cast: false });

      // building identification sign
      const sign = new THREE.Mesh(
        new THREE.PlaneGeometry(9.5, 1.55),
        new THREE.MeshBasicMaterial({ map: makeSignTexture('TURBINE HALL', 'UNIT 01 · 汽轮机房'), transparent: true }),
      );
      sign.position.set(9, 7.0, 9.44);
      this.ctx.group.add(sign);

      // interior foundation blocks handled by turbine part
      this.box(22, 0.35, 6.5, steelDark, { p: [8, 0.9, 0], receive: true });
    });
  }

  buildAuxiliary() {
    this.buildPart('auxiliary', () => {
      this.ctx.group.position.set(-18, 0, -30);
      const wall = this.material(0x8e8e86, { roughness: 0.8, metalness: 0.2 });
      const dark = this.material(0x444b50, { roughness: 0.72, metalness: 0.3 });
      const trim = this.material(0x89959d, { metalness: 0.75, roughness: 0.35 });
      const glow = this.material(0x7fe4ff, { emissive: 0x1ab6ff, emissiveIntensity: 1.4 });

      this.box(18, 8.4, 13, wall, { p: [0, 4.2, 0], receive: true });
      this.box(15, 2.2, 11.5, dark, { p: [0.5, 9.3, 0], receive: false });
      this.box(13, 1.6, 10, trim, { p: [-0.3, 11.1, 0] });
      this.box(9, 1.0, 8, dark, { p: [1, 12.2, 0] });
      for (let i = 0; i < 9; i++) {
        this.box(0.28, 8.2, 0.4, trim, { p: [-8.5 + i * 2.1, 4.2, 6.6], cast: false });
      }
      for (let i = 0; i < 5; i++) {
        this.box(1.6, 0.16, 0.08, glow, { p: [-6 + i * 3, 6.8, 6.7], cast: false });
      }
      // rooftop units
      for (let i = 0; i < 3; i++) {
        this.box(3.2, 1.4, 2.8, dark, { p: [-5 + i * 4.2, 13.4, 0.6], cast: false });
        this.cyl(0.85, 0.85, 0.25, trim, { p: [-5 + i * 4.2, 14.15, 0.6], seg: 20, cast: false });
      }
      // connecting corridor to containment
      this.box(4.2, 3.2, 8.5, wall, { p: [0, 2.2, 10.2], cast: false });
      this.box(3.2, 0.18, 8.2, glow, { p: [0, 3.9, 10.2], cast: false });
      // small vent stack
      this.cyl(0.55, 0.7, 7, trim, { p: [6.8, 15.8, -3], seg: 18 });
      this.cyl(0.66, 0.66, 0.3, this.material(0xff8a3d, { emissive: 0xff4d00, emissiveIntensity: 0.6 }), { p: [6.8, 19.2, -3], seg: 18, cast: false });
    });
  }

  buildRPV() {
    this.buildPart('rpv', () => {
      const steel = this.material(0x9da9b2, { metalness: 0.94, roughness: 0.27, cut: true, side: THREE.DoubleSide });
      const dark = this.material(0x3f4c56, { metalness: 0.9, roughness: 0.36, cut: true, side: THREE.DoubleSide });
      const trim = this.material(0x87949f, { metalness: 0.95, roughness: 0.22 });
      const glow = this.material(0xffb066, { emissive: 0xff5b00, emissiveIntensity: 1.2 });

      this.cyl(3.4, 3.8, 1.6, dark, { p: [-18, 1.0, 0], seg: 48, receive: true });
      this.cyl(2.3, 2.3, 7.8, steel, { p: [-18, 5.9, 0], seg: 48, cast: true });
      const bottom = new THREE.SphereGeometry(2.3, 48, 20, 0, PI * 2, PI / 2, PI / 2);
      this.mk(bottom, steel, { p: [-18, 2.0, 0] });
      const top = new THREE.SphereGeometry(2.3, 48, 20, 0, PI * 2, 0, PI / 2);
      this.mk(top, steel, { p: [-18, 9.8, 0] });

      // flange and nozzles
      this.cyl(2.55, 2.55, 0.55, trim, { p: [-18, 9.85, 0], seg: 48 });
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * PI * 2;
        this.cyl(0.13, 0.13, 0.75, trim, { p: [-18 + Math.cos(a) * 2.35, 10.15, Math.sin(a) * 2.35], seg: 8, cast: false });
      }
      for (const a of [0.45, PI - 0.45, PI + 0.55, PI * 2 - 0.55]) {
        const x = -18 + Math.cos(a) * 2.5;
        const z = Math.sin(a) * 2.5;
        this.cyl(0.38, 0.38, 1.5, trim, { p: [x, 8.4, z], r: [0, 0, PI / 2], seg: 18 });
      }
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * PI * 2;
        this.cyl(0.16, 0.16, 1.8, trim, { p: [-18 + Math.cos(a) * 1.1, 11.1, Math.sin(a) * 1.1], seg: 8, cast: false });
        this.cyl(0.3, 0.3, 0.42, dark, { p: [-18 + Math.cos(a) * 1.1, 12.15, Math.sin(a) * 1.1], seg: 10, cast: false });
      }
      // insulation bands
      for (const y of [3.4, 5.6, 7.8, 9.0]) {
        this.torus(2.34, 0.055, trim, { p: [-18, y, 0], r: [PI / 2, 0, 0], seg: 48, cast: false });
      }
      // section rim around the vessel opening
      const rimMat = new THREE.MeshBasicMaterial({ color: 0x8fe9ff, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false });
      const rimSolid = this.material(0x9aa7b0, { metalness: 0.85, roughness: 0.3 });
      const rV = Math.sqrt(2.3 * 2.3 - 0.5 * 0.5);
      for (const sx of [-1, 1]) {
        this.box(0.07, 7.9, 0.07, rimSolid, { p: [-18 + sx * rV, 5.9, 0.53], cast: false });
        const glow = new THREE.Mesh(new THREE.BoxGeometry(0.025, 7.9, 0.025), rimMat);
        glow.position.set(-18 + sx * rV, 5.9, 0.56);
        this.ctx.group.add(glow);
      }
      for (const [y, rot] of [[9.8, 0], [2.0, PI]]) {
        const arc = new THREE.Mesh(new THREE.TorusGeometry(rV, 0.045, 6, 48, PI), rimSolid);
        arc.position.set(-18, y, 0.53);
        arc.rotation.z = rot;
        this.ctx.group.add(arc);
        const glow = new THREE.Mesh(new THREE.TorusGeometry(rV, 0.018, 6, 48, PI), rimMat);
        glow.position.set(-18, y, 0.56);
        glow.rotation.z = rot;
        this.ctx.group.add(glow);
      }

      // in-core instrumentation glow
      this.cyl(0.05, 0.05, 0.8, glow, { p: [-18, 1.5, 0], seg: 6, cast: false });
    });
  }

  buildCore() {
    this.buildPart('core', () => {
      const barrel = this.material(0x33424f, { metalness: 0.9, roughness: 0.32, side: THREE.DoubleSide, cut: true });
      const plate = this.material(0x62717e, { metalness: 0.9, roughness: 0.34 });
      const rodMat = this.material(0x3a2a1e, { metalness: 0.85, roughness: 0.28, emissive: 0xff5b00, emissiveIntensity: 0.32 });
      const rodTop = this.material(0x8a99a6, { metalness: 0.95, roughness: 0.22 });
      const control = this.material(0xc3d0da, { metalness: 1.0, roughness: 0.18, emissive: 0x2bd3ff, emissiveIntensity: 0.16 });

      this.cyl(1.92, 1.92, 3.5, barrel, { p: [-18, 6.15, 0], seg: 48, cast: false });
      this.cyl(2.02, 2.02, 0.28, plate, { p: [-18, 4.45, 0], seg: 48, cast: false });
      this.cyl(2.02, 2.02, 0.28, plate, { p: [-18, 7.9, 0], seg: 48, cast: false });
      this.torus(1.96, 0.045, plate, { p: [-18, 6.6, 0], r: [PI / 2, 0, 0], seg: 48, cast: false });
      this.cyl(1.98, 1.98, 0.12, this.material(0x7f8d99, { metalness: 0.9, roughness: 0.3 }), { p: [-18, 4.3, 0], seg: 48, cast: false });

      // fuel rod bundle — instanced for performance
      const n = this.lowPower ? 7 : 11;
      const pitch = 0.29;
      const rodGeo = new THREE.CylinderGeometry(0.062, 0.062, 3.0, 6);
      const count = n * n;
      const rods = new THREE.InstancedMesh(rodGeo, rodMat, count);
      const m4 = new THREE.Matrix4();
      let idx = 0;
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
          m4.makeTranslation(-18 + (i - (n - 1) / 2) * pitch, 6.15, (j - (n - 1) / 2) * pitch);
          rods.setMatrixAt(idx++, m4);
        }
      }
      rods.castShadow = false;
      rods.receiveShadow = false;
      this.ctx.group.add(rods);

      // control rod cluster
      for (let i = -1; i <= 1; i++) {
        for (let j = -1; j <= 1; j++) {
          if (i === 0 && j === 0) continue;
          this.cyl(0.045, 0.045, 2.6, control, { p: [-18 + i * 0.62, 8.25, j * 0.62], seg: 6, cast: false });
          this.cyl(0.11, 0.11, 0.16, rodTop, { p: [-18 + i * 0.62, 9.58, j * 0.62], seg: 8, cast: false });
        }
      }
      this.cyl(0.06, 0.06, 3.0, control, { p: [-18, 9.9, 0], seg: 6, cast: false });

      const coreRim = new THREE.MeshBasicMaterial({ color: 0xa7efff, transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false });
      const rB = Math.sqrt(1.92 * 1.92 - 0.5 * 0.5);
      for (const sx of [-1, 1]) {
        const g = new THREE.Mesh(new THREE.BoxGeometry(0.02, 3.5, 0.02), coreRim);
        g.position.set(-18 + sx * rB, 6.15, 0.53);
        this.ctx.group.add(g);
      }
      for (const y of [7.9, 4.45]) {
        const g = new THREE.Mesh(new THREE.TorusGeometry(rB, 0.012, 5, 40, PI), coreRim);
        g.position.set(-18, y, 0.53);
        g.rotation.z = y > 6 ? 0 : PI;
        this.ctx.group.add(g);
      }

      // core glow: light + sprite
      const light = new THREE.PointLight(0xff6a00, 160, 22, 2);
      light.position.set(-18, 6.4, 0);
      this.ctx.group.add(light);
      this.coreLight = light;
      const glowTex = makeGlowTexture();
      const glowMat = new THREE.SpriteMaterial({ map: glowTex, color: 0xff7a22, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false });
      const sprite = new THREE.Sprite(glowMat);
      sprite.scale.set(8, 8, 1);
      sprite.position.set(-18, 6.3, 0);
      this.ctx.group.add(sprite);
      this.coreGlow = sprite;

      this.animations.push((dt, t) => {
        const p = 0.9 + Math.sin(t * 1.6) * 0.1;
        rodMat.emissiveIntensity = 0.8 + p * 0.35;
        light.intensity = 140 + p * 50;
        sprite.material.opacity = 0.6 + p * 0.18;
        sprite.scale.setScalar(7.8 + p * 0.5);
      });
    });
  }

  buildSteamGenerator() {
    this.buildPart('steamGenerator', () => {
      const trim = this.material(0x8d9daa, { metalness: 0.9, roughness: 0.3 });
      const tubeMat = this.material(0xb07642, { metalness: 0.92, roughness: 0.32 });
      const hot = this.material(0xff9b57, { emissive: 0xff4f00, emissiveIntensity: 0.9 });
      for (const z of [-7, 7]) {
        const shell = this.material(0x52728d, { metalness: 0.9, roughness: 0.32, cut: true, side: THREE.DoubleSide, cutOffset: z });
        const shellDark = this.material(0x354b5e, { metalness: 0.88, roughness: 0.38, cut: true, side: THREE.DoubleSide, cutOffset: z });
        this.cyl(3.3, 3.5, 1.1, shellDark, { p: [-28, 0.75, z], seg: 40, receive: true });
        this.cyl(2.45, 2.45, 9.0, shell, { p: [-28, 5.8, z], seg: 48 });
        const bottom = new THREE.SphereGeometry(2.45, 40, 16, 0, PI * 2, PI / 2, PI / 2);
        this.mk(bottom, shell, { p: [-28, 2.3, z] });
        const top = new THREE.SphereGeometry(2.45, 40, 16, 0, PI * 2, 0, PI / 2);
        this.mk(top, shell, { p: [-28, 10.3, z] });
        this.cyl(1.65, 2.42, 2.0, shell, { p: [-28, 11.75, z], seg: 40 });
        this.cyl(1.65, 1.65, 1.6, shellDark, { p: [-28, 13.5, z], seg: 40 });
        this.cyl(1.82, 1.82, 0.32, trim, { p: [-28, 11.65, z], seg: 40 });
        for (const y of [4.0, 6.2, 8.4]) {
          this.torus(2.47, 0.075, trim, { p: [-28, y, z], r: [PI / 2, 0, 0], seg: 44, cast: false });
        }
        this.cyl(1.1, 1.1, 0.4, hot, { p: [-28, 12.55, z], seg: 32, cast: false });
        // U-tube bundle hint inside
        for (let i = 0; i < (this.lowPower ? 12 : 26); i++) {
          const a = (i / (this.lowPower ? 12 : 26)) * PI * 2;
          const r = 1.1 + (i % 4) * 0.28;
          this.cyl(0.055, 0.055, 6.6, tubeMat, { p: [-28 + Math.cos(a) * r, 6.0, z + Math.sin(a) * r], seg: 5, cast: false });
        }
        // steam nozzle + feedwater nozzle
        this.cyl(0.48, 0.48, 2.2, trim, { p: [-28, 14.6, z], seg: 18 });
        this.cyl(0.7, 0.7, 0.28, hot, { p: [-28, 15.6, z], seg: 18, cast: false });
        this.cyl(0.32, 0.32, 2.0, trim, { p: [-26.0, 8.8, z], r: [0, 0, PI / 2], seg: 14 });
        this.cyl(0.42, 0.42, 0.2, trim, { p: [-25.0, 8.8, z], r: [0, 0, PI / 2], seg: 14, cast: false });
      }
    });
  }

  buildPressurizer() {
    this.buildPart('pressurizer', () => {
      const shell = this.material(0x5a7a96, { metalness: 0.92, roughness: 0.3, cut: true, side: THREE.DoubleSide, cutOffset: 7 });
      const trim = this.material(0x8294a1, { metalness: 0.92, roughness: 0.3 });
      const heater = this.material(0xff9a4d, { emissive: 0xff4a00, emissiveIntensity: 1.5 });
      const water = this.material(0x1d9fd0, { metalness: 0.1, roughness: 0.15, transparent: true, opacity: 0.35, side: THREE.DoubleSide });
      this.cyl(1.9, 2.1, 1.0, trim, { p: [-8, 0.7, 7], seg: 36, receive: true });
      this.cyl(1.15, 1.15, 5.4, shell, { p: [-8, 4.2, 7], seg: 40 });
      const bottom = new THREE.SphereGeometry(1.15, 32, 14, 0, PI * 2, PI / 2, PI / 2);
      this.mk(bottom, shell, { p: [-8, 1.5, 7] });
      const top = new THREE.SphereGeometry(1.15, 32, 14, 0, PI * 2, 0, PI / 2);
      this.mk(top, shell, { p: [-8, 6.9, 7] });
      this.cyl(1.32, 1.32, 0.28, trim, { p: [-8, 6.9, 7], seg: 36 });
      this.cyl(0.34, 0.34, 1.1, trim, { p: [-8, 8.1, 7], seg: 18 });
      this.cyl(0.52, 0.52, 0.16, trim, { p: [-8, 8.65, 7], seg: 18, cast: false });
      for (let i = 0; i < 4; i++) {
        this.torus(1.17, 0.06, heater, { p: [-8, 2.5 + i * 0.62, 7], r: [PI / 2, 0, 0], seg: 36, cast: false });
      }
      this.cyl(0.98, 0.98, 2.2, water, { p: [-8, 2.7, 7], seg: 32, cast: false });
      this.cyl(0.18, 0.18, 2.0, trim, { p: [-6.2, 5.6, 7], r: [0, 0, PI / 2], seg: 12 });
      this.torus(1.18, 0.04, trim, { p: [-8, 5.4, 7], r: [PI / 2, 0, 0], seg: 36, cast: false });
    });
  }

  buildPump() {
    this.buildPart('pump', () => {
      const body = this.material(0x4d6d8a, { metalness: 0.9, roughness: 0.32 });
      const dark = this.material(0x33424e, { metalness: 0.85, roughness: 0.4 });
      const trim = this.material(0x9aabba, { metalness: 0.95, roughness: 0.22 });
      const glow = this.material(0x4fe4ff, { emissive: 0x18c8ff, emissiveIntensity: 1.8 });
      for (const z of [-9.5, 9.5]) {
        this.box(3.6, 0.8, 3.6, dark, { p: [-21, 0.6, z], receive: true });
        this.cyl(1.35, 1.6, 1.2, body, { p: [-21, 1.6, z], seg: 28 });
        this.cyl(0.95, 0.95, 1.9, body, { p: [-21, 3.2, z], seg: 28 });
        this.cyl(0.72, 0.72, 0.32, trim, { p: [-21, 4.3, z], seg: 24 });
        this.cyl(0.78, 0.78, 2.1, dark, { p: [-21, 5.0, z], seg: 28 });
        for (let i = 0; i < 4; i++) {
          this.torus(0.8, 0.045, trim, { p: [-21, 4.2 + i * 0.48, z], r: [PI / 2, 0, 0], seg: 28, cast: false });
        }
        this.cyl(0.5, 0.5, 0.18, glow, { p: [-21, 6.12, z], seg: 20, cast: false });
        this.cyl(0.4, 0.4, 1.4, trim, { p: [-22.8, 2.1, z], r: [0, 0, PI / 2], seg: 18 });
        this.torus(0.55, 0.12, body, { p: [-23.5, 2.1, z], r: [0, PI / 2, 0], seg: 20, cast: false });
      }
    });
  }

  buildTurbine() {
    this.buildPart('turbine', () => {
      const casing = this.material(0x5a7387, { metalness: 0.9, roughness: 0.3, cut: true, side: THREE.DoubleSide });
      const casing2 = this.material(0x6d879b, { metalness: 0.93, roughness: 0.26, cut: true, side: THREE.DoubleSide });
      const dark = this.material(0x323f49, { metalness: 0.85, roughness: 0.4 });
      const trim = this.material(0x99a8b3, { metalness: 0.96, roughness: 0.2 });
      const hot = this.material(0xff8a3d, { emissive: 0xff4a00, emissiveIntensity: 0.95 });
      const shaft = this.material(0xb8c6d2, { metalness: 0.98, roughness: 0.16 });

      this.box(26, 1.0, 7.2, dark, { p: [9, 1.0, 0], receive: true });
      this.box(24, 0.35, 6.2, trim, { p: [9, 1.65, 0], receive: true });

      const spin = new THREE.Group();
      spin.position.set(0, 5.05, 0);
      this.ctx.group.add(spin);
      this.bladeGroups.push(spin);

      const shaftMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 27.5, 18), shaft);
      shaftMesh.rotation.z = PI / 2;
      shaftMesh.position.set(8.5, 0, 0);
      spin.add(shaftMesh);

      // HP and LP casings
      const hp = new THREE.Mesh(new THREE.CylinderGeometry(1.55, 1.75, 5.2, 40), casing);
      hp.rotation.z = PI / 2;
      hp.position.set(2.0, 0, 0);
      spin.add(hp);
      const lp = new THREE.Mesh(new THREE.CylinderGeometry(2.3, 2.5, 7.4, 44), casing2);
      lp.rotation.z = PI / 2;
      lp.position.set(9.0, 0, 0);
      spin.add(lp);
      // casing rings
      for (let i = 0; i < 5; i++) {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(1.72, 0.07, 8, 40), trim);
        ring.rotation.y = PI / 2;
        ring.position.set(-0.4 + i * 1.2, 0, 0);
        spin.add(ring);
      }
      for (let i = 0; i < 6; i++) {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(2.4, 0.08, 8, 44), trim);
        ring.rotation.y = PI / 2;
        ring.position.set(5.9 + i * 1.25, 0, 0);
        spin.add(ring);
      }
      // blade stages — one instanced mesh, animated rotation
      const bladeGeo = new THREE.BoxGeometry(0.1, 0.55, 1.5);
      const bladeMat = this.material(0xc7d5df, { metalness: 0.9, roughness: 0.25, emissive: 0xff6a1e, emissiveIntensity: 0.12 });
      const stages = [
        { x: 0.4, r: 1.3, n: 22 }, { x: 1.6, r: 1.45, n: 24 }, { x: 2.8, r: 1.55, n: 26 },
        { x: 6.2, r: 1.9, n: 28 }, { x: 7.9, r: 2.05, n: 30 }, { x: 9.6, r: 2.15, n: 30 }, { x: 11.3, r: 2.25, n: 32 },
      ];
      let total = 0;
      stages.forEach((s) => { total += s.n; });
      const blades = new THREE.InstancedMesh(bladeGeo, bladeMat, total);
      const m4 = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      const pos = new THREE.Vector3();
      const scl = new THREE.Vector3(1, 1, 1);
      let idx = 0;
      for (const s of stages) {
        for (let i = 0; i < s.n; i++) {
          const a = (i / s.n) * PI * 2;
          pos.set(s.x, Math.sin(a) * s.r, Math.cos(a) * s.r);
          q.setFromEuler(new THREE.Euler(-a, 0, 0));
          m4.compose(pos, q, scl);
          blades.setMatrixAt(idx++, m4);
        }
      }
      blades.castShadow = false;
      spin.add(blades);
      // heat glow bands inside casing
      for (const x of [2.0, 9.0]) {
        const g = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 0.18, 24), hot);
        g.rotation.z = PI / 2;
        g.position.set(x, 0, 0);
        spin.add(g);
      }

      // generator
      const gen = new THREE.Group();
      gen.position.set(20.5, 5.05, 0);
      this.ctx.group.add(gen);
      const genBody = new THREE.Mesh(new THREE.CylinderGeometry(2.45, 2.45, 7.0, 44), casing2);
      genBody.rotation.z = PI / 2;
      genBody.castShadow = this.isHigh();
      gen.add(genBody);
      for (let i = 0; i < 9; i++) {
        const fin = new THREE.Mesh(new THREE.TorusGeometry(2.48, 0.07, 6, 44), trim);
        fin.rotation.y = PI / 2;
        fin.position.x = -2.8 + i * 0.7;
        gen.add(fin);
      }
      for (const x of [-3.6, 3.6]) {
        const cap = new THREE.Mesh(new THREE.CylinderGeometry(1.7, 1.7, 0.5, 36), trim);
        cap.rotation.z = PI / 2;
        cap.position.x = x;
        gen.add(cap);
      }
      const exciter = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.15, 1.8, 28), dark);
      exciter.rotation.z = PI / 2;
      exciter.position.x = 4.5;
      gen.add(exciter);
      const endGlow = new THREE.Mesh(new THREE.TorusGeometry(1.4, 0.08, 6, 32), this.material(0x4fe4ff, { emissive: 0x1cc8ff, emissiveIntensity: 2.0 }));
      endGlow.rotation.y = PI / 2;
      endGlow.position.x = -3.85;
      gen.add(endGlow);

      // condenser beneath
      this.box(9.5, 2.4, 5.4, dark, { p: [8.5, 2.4, 0], receive: true });
      this.box(8.7, 0.4, 4.7, this.material(0x2c7f9e, { metalness: 0.4, roughness: 0.3, transparent: true, opacity: 0.55 }), { p: [8.5, 3.2, 0], cast: false });
      for (let i = 0; i < 7; i++) {
        this.cyl(0.12, 0.12, 8.2, trim, { p: [8.5, 3.25, -2.2 + i * 0.72], r: [0, 0, PI / 2], seg: 8, cast: false });
      }
      // turbine deck rail
      for (const z of [-3.5, 3.5]) {
        this.box(23, 0.08, 0.08, trim, { p: [9, 3.2, z], cast: false });
        for (let x = -2; x <= 20; x += 2) {
          this.box(0.06, 1.0, 0.06, trim, { p: [x, 2.7, z], cast: false });
        }
      }

      this.animations.push((dt) => {
        spin.rotation.x += dt * 0.55;
      });
    });
  }

  buildCoolingTowers() {
    this.buildPart('coolingTower', () => {
      this.buildCoolingTower(2, -39, 0);
      this.buildCoolingTower(32, -38, 1);
    });
  }

  buildCoolingTower(x, z, seed) {
    const concrete = this.material(0x7b858a, { roughness: 0.88, metalness: 0.1, side: THREE.DoubleSide, envMapIntensity: 0.4 });
      const dark = this.material(0x3b474e, { roughness: 0.8, metalness: 0.25 });
      const water = this.material(0x0f6a8a, { roughness: 0.2, metalness: 0.4, transparent: true, opacity: 0.5 });
      const rim = this.material(0x9eafbb, { roughness: 0.8, metalness: 0.3 });

      const pts = [];
      const H = 31;
      for (let i = 0; i <= 34; i++) {
        const y = (i / 34) * H;
        const r = 4.7 * Math.sqrt(1 + Math.pow((y - 21) / 13.5, 2));
        pts.push(new THREE.Vector2(r, y));
      }
      pts.push(new THREE.Vector2(4.4, H));
      const shell = new THREE.LatheGeometry(pts, 64);
      const tower = new THREE.Mesh(shell, concrete);
      tower.position.set(x, 0, z);
      tower.castShadow = this.isHigh();
      tower.receiveShadow = true;
      this.ctx.group.add(tower);
      this.ctx.meshes.push(tower);

      this.cyl(10.2, 10.6, 0.4, dark, { p: [x, 0.2, z], seg: 56, receive: true });
      this.cyl(9.2, 9.2, 0.18, water, { p: [x, 0.44, z], seg: 56, cast: false });
      this.cyl(10.2, 10.2, 0.5, rim, { p: [x, 0.5, z], seg: 56, cast: false, r: [0, 0, 0] });
      this.torus(5.35, 0.14, rim, { p: [x, 31, z], r: [PI / 2, 0, 0], seg: 56, cast: false });

      // base supports
      for (let i = 0; i < 24; i++) {
        const a = (i / 24) * PI * 2;
        const leg = this.box(0.28, 2.2, 0.7, dark, {
          p: [x + Math.cos(a) * 8.9, 1.1, z + Math.sin(a) * 8.9], r: [0, -a, 0], cast: false,
        });
        leg.rotation.y = -a;
      }
      // steam plume
    this.createSteam(x, 30.5, z, this.lowPower ? 42 : 110, seed);
  }

  createSteam(x, y, z, count, seed) {
    const positions = new Float32Array(count * 3);
    const alphas = new Float32Array(count);
    const sizes = new Float32Array(count);
    const data = [];
    for (let i = 0; i < count; i++) {
      const a = Math.random() * PI * 2;
      const r = Math.random() * 4.6;
      positions[i * 3] = Math.cos(a) * r;
      positions[i * 3 + 1] = Math.random() * 20;
      positions[i * 3 + 2] = Math.sin(a) * r;
      const life = Math.random();
      positions[i * 3] = Math.cos(a) * (r + life * 3);
      positions[i * 3 + 1] = life * 20;
      positions[i * 3 + 2] = Math.sin(a) * (r + life * 3);
      alphas[i] = Math.sin(life * PI) * 0.42;
      sizes[i] = 20 + Math.random() * 34;
      data.push({ a, r, speed: 1.1 + Math.random() * 1.4, phase: Math.random(), rise: life * 20, drift: (Math.random() - 0.5) * 0.3 });
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(alphas, 1));
    geo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uMap: { value: makeGlowTexture(true) },
        uColor: { value: new THREE.Color(0xa9d7e8) },
        uOpacity: { value: 0.34 },
      },
      vertexShader: `
        attribute float aAlpha;
        attribute float aSize;
        varying float vA;
        void main() {
          vA = aAlpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * (1.0 / -mv.z) * 22.0;
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: `
        uniform sampler2D uMap;
        uniform vec3 uColor;
        uniform float uOpacity;
        varying float vA;
        void main() {
          vec4 t = texture2D(uMap, gl_PointCoord);
          gl_FragColor = vec4(uColor, t.a * vA * uOpacity);
          if (gl_FragColor.a < 0.004) discard;
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const points = new THREE.Points(geo, mat);
    points.position.set(x, y, z);
    points.frustumCulled = false;
    this.ctx.group.add(points);
    this.steamSystems.push({ points, data, count, seed });
    this.animations.push((dt, t) => {
      const arr = geo.attributes.position.array;
      const alpha = geo.attributes.aAlpha.array;
      for (let i = 0; i < count; i++) {
        const d = data[i];
        d.rise += dt * d.speed;
        if (d.rise > 22) d.rise -= 22;
        const a = d.a + t * 0.12 + d.rise * 0.02;
        const r = d.r + d.rise * 0.16;
        arr[i * 3] = Math.cos(a) * r;
        arr[i * 3 + 1] = d.rise;
        arr[i * 3 + 2] = Math.sin(a) * r;
        const life = d.rise / 22;
        alpha[i] = Math.sin(life * PI) * 0.55 * (1 - life * 0.4);
      }
      geo.attributes.position.needsUpdate = true;
      geo.attributes.aAlpha.needsUpdate = true;
    });
  }

  buildPipes() {
    const hotPipe = this.decorMaterial(0xc2602f, { metalness: 0.85, roughness: 0.3, emissive: 0x5a1a00, emissiveIntensity: 0.25 });
    const coldPipe = this.decorMaterial(0x2f6f9e, { metalness: 0.88, roughness: 0.28 });
    const steamPipe = this.decorMaterial(0xaeb8be, { metalness: 0.82, roughness: 0.26, emissive: 0x3d1500, emissiveIntensity: 0.18 });
    const waterPipe = this.decorMaterial(0x21627d, { metalness: 0.7, roughness: 0.3 });
    const supports = this.decorMaterial(0x3d4e5c, { metalness: 0.8, roughness: 0.45 });

    for (const s of [-1, 1]) {
      this.pipe([[-18 + s * 1.6, 9.2, 1.2], [-21, 9.6, s * 3.2], [-24.4, 9.2, s * 5.6], [-28, 8.8, s * 6.8]], 0.18, hotPipe, { seg: 40 });
      this.pipe([[-28, 3.5, s * 6.9], [-26.2, 2.9, s * 8.2], [-22.6, 2.9, s * 8.8], [-20.2, 3.2, s * 8.6], [-19.6, 3.4, s * 2.6]], 0.17, coldPipe, { seg: 48 });
      this.pipe([[-27.4, 15.4, s * 7], [-25.5, 17.4, s * 7], [-18, 17.4, s * 6.4], [-4, 16.8, s * 4.6], [3.0, 13.8, s * 2.6], [4.2, 7.2, s * 1.6]], 0.22, steamPipe, { seg: 70 });
      this.pipe([[17.5, 2.1, s * 5.6], [8, 2.1, s * 8.4], [-8, 2.1, s * 9.6], [-24, 2.6, s * 8.4], [-26.2, 5.5, s * 7.8]], 0.13, coldPipe, { seg: 70 });
      this.pipe([[30, 0.6, -8], [28, 0.6, -18], [20, 0.6, -27], [14, 0.6, -30]], 0.4, waterPipe, { parent: this.decorRoot, seg: 40 });
    }
    // pressurizer surge line
    this.pipe([[-18, 4.0, 1.7], [-14, 3.4, 3.4], [-10.6, 3.4, 5.6], [-8.4, 3.4, 6.9]], 0.16, hotPipe, { seg: 32 });
    // letdown / makeup line
    this.pipe([[-17.6, 2.4, -1.8], [-12, 1.4, -4.2], [-4, 1.4, -6.4], [2, 1.4, -8.8]], 0.16, coldPipe, { seg: 40 });
    // condenser hotwell to tower
    this.pipe([[10, 1.4, -5.4], [12, 1.2, -12], [9, 1.2, -22], [9.4, 1.1, -29]], 0.38, waterPipe, { seg: 40 });
    // steam relief lines from pressurizer
    this.pipe([[-8, 8.7, 7], [-8, 11, 7], [-10.4, 13.2, 7], [-14, 15.4, 7]], 0.13, steamPipe, { seg: 30 });
  }

  buildTechRings() {
    const ringMat = new THREE.MeshBasicMaterial({ color: 0x3ed3ff, transparent: true, opacity: 0.28, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false });
    for (const [r, y, speed, op] of [[13.2, 0.6, 0.06, 0.3], [14.6, 0.65, -0.04, 0.18], [17.2, 0.7, 0.025, 0.12]]) {
      const geo = new THREE.RingGeometry(r, r + 0.06, 128, 1, 0, PI * 1.55);
      const m = new THREE.Mesh(geo, ringMat.clone());
      m.material.opacity = op;
      m.rotation.x = -PI / 2;
      m.position.set(-18, y, 0);
      m.userData.speed = speed;
      this.decorRoot.add(m);
      this.techRings.push(m);
    }
    const inner = new THREE.Mesh(new THREE.RingGeometry(2.9, 3.0, 96, 1, 0, PI * 1.3), ringMat.clone());
    inner.material.opacity = 0.4;
    inner.rotation.x = -PI / 2;
    inner.position.set(-18, 0.58, 0);
    inner.userData.speed = -0.2;
    this.decorRoot.add(inner);
    this.techRings.push(inner);
    this.animations.push((dt) => {
      for (const r of this.techRings) r.rotation.z += dt * r.userData.speed;
    });
  }

  buildSiteLights() {
    const mat = new THREE.MeshBasicMaterial({ color: 0xffb46b });
    const cyan = new THREE.MeshBasicMaterial({ color: 0x6fe6ff });
    const spots = [
      [-27, 1.2, 14, mat], [-9, 1.2, 15, mat], [3, 1.2, 11, mat], [22, 1.2, 11, mat],
      [-30, 1.2, -12, cyan], [-5, 1.2, -14, cyan], [24, 1.2, -12, cyan], [38, 1.2, 8, cyan],
    ];
    for (const [x, y, z, m] of spots) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 3.4, 6), this.decorMaterial(0x31414e));
      pole.position.set(x, 1.7, z);
      this.decorRoot.add(pole);
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 6), m);
      lamp.position.set(x, 3.45, z);
      this.decorRoot.add(lamp);
      // one warm and one cool fill are enough; emissive lamps carry the rest
      if (this.isHigh() && ((x === -27 && z === 14) || (x === 38 && z === 8))) {
        const l = new THREE.PointLight(m === mat ? 0xff9a4d : 0x4fd8ff, 16, 18, 2);
        l.position.set(x, 3.4, z);
        this.decorRoot.add(l);
      }
    }
  }

  /* ───────────────────────── API ───────────────────────── */

  getPart(id) { return this.parts.get(id); }

  setPartVisible(id, visible) {
    const part = this.parts.get(id);
    if (!part) return;
    part.group.visible = visible;
    part.visible = visible;
  }

  setSection(on, depth = this.cutDepth) {
    this.sectionOn = on;
    this.cutDepth = depth;
    if (this.containmentCut) this.containmentCut.cutGroup.visible = on;
    this.updateContainmentCut(depth);
    this.cutPlane.constant = depth;
    for (const m of this.cutMaterials) {
      const plane = m.userData.cutPlane;
      if (plane) plane.constant = depth + (m.userData.cutOffset || 0);
      m.clippingPlanes = on ? [plane] : null;
      m.needsUpdate = true;
    }
  }

  setCutDepth(depth) {
    this.cutDepth = depth;
    this.cutPlane.constant = depth;
    this.updateContainmentCut(depth);
    for (const m of this.cutMaterials) {
      if (m.userData.cutPlane) m.userData.cutPlane.constant = depth + (m.userData.cutOffset || 0);
    }
  }

  updateContainmentCut(depth) {
    const c = this.containmentCut;
    if (!c) return;
    const z = Math.max(-12.85, Math.min(12.85, depth));
    const r = Math.sqrt(13 * 13 - z * z);
    c.cutGroup.position.z = z;
    c.wallL.position.set(-r, 11, 0);
    c.wallR.position.set(r, 11, 0);
    c.glowL.position.set(-r, 11, 0.34);
    c.glowR.position.set(r, 11, 0.34);
    c.domeBand.position.set(0, 21, 0.04);
    c.domeBand.scale.set(r, r, 1);
    c.domeCut.position.set(0, 21, 0.06);
    c.domeCut.scale.set(r, r, 1);
  }

  setShellTranslucency(mode) {
    if (this.containmentCut) this.containmentCut.cutGroup.visible = this.sectionOn;
    const xray = mode === 'xray' || mode === 'explode';
    for (const m of this.cutMaterials) {
      const base = m.userData;
      if (xray) {
        m.transparent = true;
        m.opacity = mode === 'explode' ? 0.16 : 0.19;
        m.depthWrite = false;
        m.side = THREE.DoubleSide;
      } else {
        m.transparent = base.baseTransparent;
        m.opacity = base.baseOpacity;
        m.depthWrite = base.baseDepthWrite;
      }
      m.needsUpdate = true;
    }
  }

  setHighlight(id, on = true) {
    if (this.highlightId && this.highlightId !== id) this.setHighlight(this.highlightId, false);
    const part = this.parts.get(id);
    if (part) {
      for (const m of part.materials) {
        if (m.userData._baseEmissive === undefined) {
          m.userData._baseEmissive = m.emissive.getHex();
          m.userData._baseEmissiveIntensity = m.emissiveIntensity;
        }
        if (on) {
          m.emissive.setHex(0x25c8ff);
          m.emissiveIntensity = Math.max(0.45, m.userData._baseEmissiveIntensity || 0);
        } else {
          m.emissive.setHex(m.userData._baseEmissive);
          m.emissiveIntensity = m.userData._baseEmissiveIntensity;
        }
      }
      part.highlighted = on;
    }
    this.highlightId = on ? id : null;
  }

  setDecorVisible(v) { this.pipesRoot.visible = v; }

  update(dt, elapsed) {
    this.clock = elapsed;
    for (const fn of this.animations) fn(dt, elapsed);
    if (this.highlightId) {
      const p = this.parts.get(this.highlightId);
      if (p) {
        const pulse = 0.45 + (Math.sin(elapsed * 4.5) * 0.5 + 0.5) * 0.55;
        for (const m of p.materials) m.emissiveIntensity = pulse;
      }
    }
  }

  dispose() {
    this.root.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose());
        else o.material.dispose();
      }
    });
    this.scene.remove(this.root);
  }
}

/* shared helpers */
function _all(plant, mesh) {
  plant.pickMeshes.push(mesh);
}

function makeConcreteTexture(rx = 3, ry = 2) {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#b7b7b2';
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 1600; i++) {
    const v = 150 + Math.random() * 70;
    ctx.fillStyle = `rgba(${v},${v},${v - 2},${0.08 + Math.random() * 0.15})`;
    const s = Math.random() * 2.2 + 0.4;
    ctx.fillRect(Math.random() * size, Math.random() * size, s, s);
  }
  ctx.strokeStyle = 'rgba(90, 92, 90, 0.28)';
  ctx.lineWidth = 1.4;
  for (let x = 0; x <= size; x += 128) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, size); ctx.stroke();
  }
  for (let y = 0; y <= size; y += 64) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(size, y); ctx.stroke();
  }
  ctx.fillStyle = 'rgba(60, 62, 60, 0.12)';
  for (let i = 0; i < 18; i++) {
    ctx.beginPath();
    ctx.ellipse(Math.random() * size, Math.random() * size, 8 + Math.random() * 30, 3 + Math.random() * 9, Math.random(), 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(rx, ry);
  tex.anisotropy = 4;
  return tex;
}

function makeSignTexture(title, subtitle) {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 168;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, c.width, c.height);
  ctx.fillStyle = 'rgba(5, 15, 24, 0.72)';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.strokeStyle = 'rgba(62, 211, 255, 0.55)';
  ctx.lineWidth = 4;
  ctx.strokeRect(10, 10, c.width - 20, c.height - 20);
  ctx.fillStyle = '#8fe8ff';
  ctx.font = '700 62px "Rajdhani", "Arial", sans-serif';
  ctx.fillText(title, 42, 82);
  ctx.fillStyle = 'rgba(173, 210, 228, 0.75)';
  ctx.font = '500 24px "Arial", sans-serif';
  ctx.fillText(subtitle, 44, 122);
  ctx.fillStyle = '#ff8a3d';
  ctx.fillRect(42, 98, 120, 5);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function makeGlowTexture(soft = false) {
  const s = 128;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  if (soft) {
    g.addColorStop(0, 'rgba(255,255,255,0.8)');
    g.addColorStop(0.35, 'rgba(255,255,255,0.35)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
  } else {
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.2, 'rgba(255,255,255,0.7)');
    g.addColorStop(0.55, 'rgba(255,255,255,0.2)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
  }
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
