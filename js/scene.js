/**
 * scene.js
 *
 * OPENING RULES
 *   - Each opening owns its own style (op.style).
 *   - Openings on the same wall cannot overlap (MIN_BETWEEN_GAP clearance enforced).
 *   - Placement is blocked if no non-overlapping position exists.
 *   - Dragging snaps to the nearest gap that fits; if none, the handle won't move.
 */

// ─── RENDERER ──────────────────────────────────────────────────────────────────

const canvas = document.getElementById('canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type    = THREE.PCFSoftShadowMap;
// sRGBEncoding is deprecated in r152+; outputColorSpace is the modern equivalent
renderer.outputColorSpace   = THREE.SRGBColorSpace;
// ACES filmic tone mapping: prevents highlight blowout, gives rich shadows,
// and makes the whole scene feel more photographic
renderer.toneMapping        = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const scene  = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(20, 1, 0.1, 100);

// ─── DIRTY FLAG — hoisted so the whole file can call markDirty() ─────────────
let _dirty = true;
let _dirtyFrames = 0;
function markDirty(frames = 2) {
  _dirty = true;
  _dirtyFrames = Math.max(_dirtyFrames, frames);
}

// texLoader hoisted here — used by setGroundType and makeWallMat before their call sites
const texLoader = new THREE.TextureLoader();

// ─── Admin-uploaded asset store (IndexedDB) ───────────────────────────────────
// Files uploaded via the admin panel are stored in IDB under key 'file_{item_key}'.
// On startup we pre-populate _adminFileUrls so texture/model loading can do a
// synchronous check before falling back to disk paths.
const _adminFileUrls = {};   // item_key → blob URL

const _sceneDB = (() => {
  let _db = null;
  function open() {
    if (_db) return Promise.resolve(_db);
    return new Promise((res, rej) => {
      const req = indexedDB.open('gardenroom_assets', 1);
      req.onupgradeneeded = e => e.target.result.createObjectStore('files');
      req.onsuccess = e => { _db = e.target.result; res(_db); };
      req.onerror = rej;
    });
  }
  return {
    getAll() {
      return open().then(db => new Promise((res, rej) => {
        const results = {};
        const req = db.transaction('files').objectStore('files').openCursor();
        req.onsuccess = e => {
          const cursor = e.target.result;
          if (cursor) { results[cursor.key] = cursor.value; cursor.continue(); }
          else res(results);
        };
        req.onerror = rej;
      }));
    },
  };
})();

// Pre-load all admin-uploaded files into blob URLs before first render.
// After populating _adminFileUrls, re-process floor textures so admin uploads take effect.
_sceneDB.getAll().then(files => {
  Object.entries(files).forEach(([idbKey, blob]) => {
    if (!idbKey.startsWith('file_')) return;
    const itemKey = idbKey.slice(5);
    _adminFileUrls[itemKey] = URL.createObjectURL(blob);
  });
  if (Object.keys(_adminFileUrls).length) {
    // Re-apply floor textures for any key that now has an admin upload
    Object.entries(FLOOR_TEXTURE_DEFS).forEach(([key]) => {
      const adminUrl = _adminFileUrls[key];
      if (adminUrl) _loadFloorTex(key, adminUrl);
    });
    markDirty();
  }
}).catch(() => {});

// Returns the admin-uploaded URL for an item key, or null if not present.
function adminFileUrl(itemKey) { return _adminFileUrls[itemKey] || null; }

// ── Architectural flat lighting ───────────────────────────────────────────────
// Strong hemisphere fills all shadows; one soft key light adds just enough
// directionality to read depth without harsh contrast.
const hemiLight = new THREE.HemisphereLight(0xcce0f5, 0xb8c9a0, 2.0);
scene.add(hemiLight);

const sunLight = new THREE.DirectionalLight(0xfff5e8, 0.85);
sunLight.position.set(10, 18, 8);
sunLight.castShadow = true;
sunLight.shadow.mapSize.set(2048, 2048);
sunLight.shadow.camera.left   = -16;
sunLight.shadow.camera.right  =  16;
sunLight.shadow.camera.top    =  16;
sunLight.shadow.camera.bottom = -16;
sunLight.shadow.bias = -0.0003;
scene.add(sunLight);
scene.add(sunLight.target);

// Fill from opposite side — brightens shadowed faces to near-ambient level
const fillLight = new THREE.DirectionalLight(0xdce8ff, 0.55);
fillLight.position.set(-10, 8, -6);
scene.add(fillLight);

// Rear fill so back wall is never dark
const backLight = new THREE.DirectionalLight(0xf0ecff, 0.40);
backLight.position.set(0, 6, -12);
scene.add(backLight);

// ── Time-of-day lighting ──────────────────────────────────────────────────────
let _todEnabled = false;

function setTodEnabled(on) {
  _todEnabled = on;
  const row = document.getElementById('todSliderRow');
  if (row) row.style.display = on ? 'flex' : 'none';
  if (on) {
    const slider = document.getElementById('todSlider');
    setTimeOfDay(slider ? parseFloat(slider.value) : 10);
  } else {
    // Restore flat architectural lighting
    hemiLight.color.setHex(0xcce0f5);
    hemiLight.groundColor.setHex(0xb8c9a0);
    hemiLight.intensity = 2.0;
    sunLight.color.setHex(0xfff5e8);
    sunLight.intensity = 0.85;
    sunLight.position.set(10, 18, 8);
    fillLight.color.setHex(0xdce8ff); fillLight.intensity = 0.55;
    backLight.color.setHex(0xf0ecff); backLight.intensity = 0.40;
    skyDome.material.uniforms.uTop.value.setHex(0xb8ccd8);
    skyDome.material.uniforms.uHorizon.value.setHex(0xdde8ec);
    scene.fog.color.setHex(0xdde8ec);
    markDirty(3);
  }
}

function setTimeOfDay(hour) {
  // hour: 0–24. Sun arc: rises at 6, sets at 20, peaks at 13.
  const t = (hour - 6) / 14;            // 0 at sunrise, 1 at sunset
  const sunUp = t > 0 && t < 1;

  // Sun angle: sweeps from east (+X) over south (-Z) to west (-X)
  const angle  = t * Math.PI;           // 0=east, π/2=south, π=west
  const elev   = Math.max(0, Math.sin(angle));  // elevation 0→1→0
  const sunX   = -Math.cos(angle) * 20;
  const sunY   = elev * 18 + 0.5;
  const sunZ   = -Math.abs(Math.sin(angle)) * 8;

  // Sun colour: deep orange at low angles, pale yellow at zenith
  const warm   = Math.max(0, 1 - elev * 2);     // 1 at horizon, 0 past 30°
  const sunR   = 1.0;
  const sunG   = 0.55 + elev * 0.40;
  const sunB   = 0.15 + elev * 0.80;
  sunLight.color.setRGB(sunR, sunG, sunB);
  sunLight.intensity = sunUp ? 0.15 + elev * 1.8 : 0;
  sunLight.position.set(sunX, sunY, sunZ);

  // Night / day sky blend
  const nightT = sunUp ? 0 : (hour < 6 ? 1 - hour / 6 : (hour - 20) / 4);
  const dayT   = sunUp ? elev : 0;

  // Sky: horizon glow at sunrise/set, deep blue at night, pale blue midday
  const horizR = 0.47 + warm * 0.53 - nightT * 0.35;
  const horizG = 0.65 + warm * 0.10 - nightT * 0.50;
  const horizB = 0.78 - warm * 0.55 - nightT * 0.60;
  const topR   = 0.05 + dayT * 0.37;
  const topG   = 0.08 + dayT * 0.55;
  const topB   = 0.18 + dayT * 0.60;
  skyDome.material.uniforms.uHorizon.value.setRGB(Math.max(0,horizR), Math.max(0,horizG), Math.max(0,horizB));
  skyDome.material.uniforms.uTop.value.setRGB(Math.max(0,topR), Math.max(0,topG), Math.max(0,topB));
  scene.fog.color.setRGB(Math.max(0,horizR), Math.max(0,horizG), Math.max(0,horizB));

  // Hemisphere: sky blue on top, warm ground bounce at golden hour
  hemiLight.color.setRGB(Math.max(0,topR+0.15), Math.max(0,topG+0.1), Math.max(0,topB+0.05));
  hemiLight.groundColor.setRGB(0.35 + warm*0.25, 0.28 + dayT*0.15, 0.18);
  hemiLight.intensity = 0.3 + elev * 1.1 + nightT * 0;

  // Fills stay at a constant low level for legibility
  fillLight.intensity = 0.15 + elev * 0.25;
  backLight.intensity = 0.10 + elev * 0.20;

  // Update UI label and icon
  const hh = Math.floor(hour), mm = Math.round((hour % 1) * 60);
  const label = document.getElementById('todVal');
  if (label) label.textContent = `${String(hh).padStart(2,'0')}:${String(mm).padStart(2,'0')}`;
  const icon = document.getElementById('todIcon');
  if (icon) icon.textContent = hour < 6 || hour >= 20 ? '🌙' : hour < 8 || hour >= 18 ? '🌅' : '☀️';

  markDirty(3);
}

// ─── GROUND ──────────────────────────────────────────────────────────────────

const GROUND_PRESETS = {
  grass:  { tex: 'assets/ground_grass.jpg',  color: 0x4a9a2a, roughness: 0.95, fog: 0xd5e6d0, grassColor: 0x5aaa38 },
  patio:  { tex: 'assets/ground_patio.jpg',  color: 0x9a9080, roughness: 0.88, fog: 0xd0ccc4, grassColor: 0x9a9080 },
  gravel: { tex: 'assets/ground_gravel.jpg', color: 0x8a8478, roughness: 0.96, fog: 0xccc8c0, grassColor: 0x8a8478 },
  sand:   { tex: 'assets/ground_sand.jpg',   color: 0xc4ae6c, roughness: 0.92, fog: 0xe0d8c8, grassColor: 0xc4ae6c },
};

// Textured ground — receives shadows, shows the chosen finish across the whole plane.
const groundMat = new THREE.MeshStandardMaterial({ color: 0x4a9a2a, roughness: 0.95, metalness: 0.0 });
const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), groundMat);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

// Load a tiling ground texture
function loadGroundTex(url, onLoad) {
  texLoader.load(url, tex => {
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(100, 100);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    onLoad(tex);
  }, undefined, () => onLoad(null));
}

// ─── GRASS GLOW DISC ──────────────────────────────────────────────────────────
// A semi-transparent overlay that adds a soft radial brightening around the
// building — fades from opaque at centre to transparent at edges.
// Because it sits OVER the textured ground (not over transparent sky), there is
// no visible hard edge: at alpha=0 you simply see the ground texture below.
const grassGlowMat = new THREE.ShaderMaterial({
  transparent: true,
  depthWrite:  false,
  uniforms: {
    uColor:  { value: new THREE.Color(0x5aaa38).convertSRGBToLinear() },
    uInner:  { value: 5.0  },
    uOuter:  { value: 20.0 },
    uAlpha:  { value: 0.72 },
  },
  vertexShader: `
    varying vec3 vWorldPos;
    void main() {
      vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform vec3  uColor;
    uniform float uInner;
    uniform float uOuter;
    uniform float uAlpha;
    varying vec3  vWorldPos;
    void main() {
      float dist  = length(vWorldPos.xz);
      float t     = smoothstep(uInner, uOuter, dist);
      float alpha = uAlpha * (1.0 - t * t);
      gl_FragColor = vec4(uColor, alpha);
    }
  `,
});
// PlaneGeometry matches the ground square exactly — a CircleGeometry would
// extend beyond the square ground plane and show a circular rim against the sky.
const grassGlow = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), grassGlowMat);
grassGlow.rotation.x  = -Math.PI / 2;
grassGlow.position.y  =  0.003;
grassGlow.renderOrder =  1;
scene.add(grassGlow);

// ─── FOG CYLINDER ─────────────────────────────────────────────────────────────
// A large backface-rendered cylinder that hides the hard edge of the ground
// plane. Radius 60m safely contains the 80×80m ground including its corners
// (max 56.6m diagonal). Fog is applied so it dissolves naturally into the sky.
const fogCylMat = new THREE.MeshBasicMaterial({
  color: 0xd5e6d0,   // initialised to grass fog colour; updated in setGroundType
  side: THREE.BackSide,
  fog: true,
});
const fogCyl = new THREE.Mesh(
  new THREE.CylinderGeometry(60, 60, 70, 64, 1, true),
  fogCylMat
);
fogCyl.position.y = 30;   // centres the 70m-tall cylinder so base is at y=-5
scene.add(fogCyl);

function setGroundType(type) {
  state.groundType = type;
  const p = GROUND_PRESETS[type] || GROUND_PRESETS.grass;
  groundMat.roughness = p.roughness;
  loadGroundTex(p.tex, tex => {
    if (tex) {
      groundMat.map = tex;
      groundMat.color.set(0xffffff);
    } else {
      groundMat.map = null;
      groundMat.color.setHex(p.color);
    }
    groundMat.needsUpdate = true;
    markDirty();
  });
  grassGlowMat.uniforms.uColor.value.setHex(p.grassColor).convertSRGBToLinear();
  scene.fog = new THREE.FogExp2(p.fog, 0.022);
  skyDome.material.uniforms.uHorizon.value.setHex(p.fog);
  fogCylMat.color.setHex(p.fog);
  markDirty();
}


const grid = new THREE.GridHelper(300, 300, 0x5a9a50, 0x5a9a50);
grid.material.opacity = 0.08; grid.material.transparent = true;
grid.position.y = 0.002;  // slight lift to prevent z-fighting with ground plane
scene.add(grid);

const buildingGroup = new THREE.Group();  // walls + floor
const roofGroup     = new THREE.Group();  // roof panels + guttering
const deckingGroup  = new THREE.Group();  // decking
const handlesGroup  = new THREE.Group();
const edgeHandleGroup = new THREE.Group();
scene.add(buildingGroup, roofGroup, deckingGroup, handlesGroup, edgeHandleGroup);
const partitionHandleGroup = new THREE.Group();
scene.add(partitionHandleGroup);
const presetRoomHandleGroup = new THREE.Group();
scene.add(presetRoomHandleGroup);
const interiorDoorHandleGroup = new THREE.Group();
scene.add(interiorDoorHandleGroup);

// ─── DRAG-DROP GHOST GROUP ────────────────────────────────────────────────────
const _ddGhost = new THREE.Group();
_ddGhost.visible = false;
scene.add(_ddGhost);
let _ddState = null;

// ── Dirty flags — which subsystems need rebuilding on next buildRoom() call ──
const _buildDirty = { walls: true, roof: true, decking: true };
function _dirtyAll() { _buildDirty.walls = true; _buildDirty.roof = true; _buildDirty.decking = true; }
function _disposeGroup(grp) {
  grp.traverse(obj => {
    if (!obj.isMesh) return;
    if (obj.geometry) obj.geometry.dispose();
    if (obj.material) {
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      const cached = new Set(_matCache.values());
      mats.forEach(m => {
        if (cached.has(m)) return;
        ['map','normalMap','roughnessMap','metalnessMap','emissiveMap','aoMap'].forEach(s => { if (m[s]) m[s].dispose(); });
        m.dispose();
      });
    }
  });
  while (grp.children.length) grp.remove(grp.children[0]);
}

// Exterior wall meshes collected during buildWallFace so interior view can
// update their opacity each frame based on camera position.
const wallMeshes = { front: [], back: [], left: [], right: [] };
// Corner post meshes collected during buildRoom — avoids per-frame traverse.
const cornerPostMeshes = [];

// Outward normals for each wall — used to determine which walls face the camera.
const WALL_NORMALS = {
  front: new THREE.Vector3( 0, 0,  1),
  back:  new THREE.Vector3( 0, 0, -1),
  left:  new THREE.Vector3(-1, 0,  0),
  right: new THREE.Vector3( 1, 0,  0),
};

// Build generation — incremented at the start of every buildRoom() call.
// Each async GLB callback captures its own generation and bails out if it no
// longer matches, preventing stale models from a previous build from being
// injected into a freshly rebuilt scene (e.g. when sliders are dragged fast).
let _buildGen = 0;

// ─── SKY DOME ──────────────────────────────────────────────────────────────────
// Simple gradient sky — no sun disc, matches the flat architectural lighting.
const skyDome = new THREE.Mesh(
  new THREE.SphereGeometry(80, 32, 16),
  new THREE.ShaderMaterial({
    uniforms: {
      uTop:     { value: new THREE.Color(0xb8ccd8) },
      uHorizon: { value: new THREE.Color(0xdde8ec) },
    },
    vertexShader: `
      varying vec3 vWorldPos;
      void main() {
        vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 uTop;
      uniform vec3 uHorizon;
      varying vec3 vWorldPos;
      void main() {
        vec3 dir = normalize(vWorldPos);
        float t = clamp((dir.y + 0.25) / 1.25, 0.0, 1.0);
        gl_FragColor = vec4(mix(uHorizon, uTop, pow(t, 0.6)), 1.0);
      }
    `,
    side: THREE.BackSide,
    depthWrite: false,
  })
);
scene.add(skyDome);
scene.fog = new THREE.FogExp2(0xdde8ec, 0.018);

// Initialise ground
setGroundType('grass');

// ─── WALL DIMENSION ARROWS ────────────────────────────────────────────────────
const wallArrowGroup = new THREE.Group();
scene.add(wallArrowGroup);
const wallLabels = {};

// ─── MATERIALS ─────────────────────────────────────────────────────────────────

// ── Cladding config ────────────────────────────────────────────────────────────
// tilesX / tilesY = tiles per metre in each UV axis.
// rotated = true applies a 90° texture rotation so timber boards run horizontally.
// In rotated mode the pre-rotation UV-x covers worldH and UV-y covers worldW,
// so tilesX scales with height and tilesY scales with width.
const CLADDING_CFG = {
  // ── TIMBER (shiplap / T&G / loglap style boards) ────────────────────────────
  // Use rotated: true so boards run horizontally by default.
  vertical_shiplap_cladding:               { texFile: 'assets/tex_timber.jpg', roughness: 0.88, rotated: false, tilesX: 0.6, tilesY: 0.5 },
  shiplap_horizontal_cladding:             { texFile: 'assets/tex_timber.jpg', roughness: 0.88, rotated: true,  tilesX: 0.6, tilesY: 0.5 },
  shiplap_black_cladding:                  { texFile: 'assets/tex_timber.jpg', roughness: 0.88, rotated: true,  tilesX: 0.6, tilesY: 0.5 },
  loglap_horizontal_cladding:              { texFile: 'assets/tex_timber.jpg', roughness: 0.90, rotated: true,  tilesX: 0.5, tilesY: 0.4 },
  vertical_loglap_cladding:                { texFile: 'assets/tex_timber.jpg', roughness: 0.90, rotated: false, tilesX: 0.5, tilesY: 0.4 },
  vertical_logroll_treated_cladding:       { texFile: 'assets/tex_timber.jpg', roughness: 0.92, rotated: false, tilesX: 0.5, tilesY: 0.4 },
  vertical_tongue_and_groove_cladding:     { texFile: 'assets/tex_timber.jpg', roughness: 0.88, rotated: false, tilesX: 0.7, tilesY: 0.5 },
  vertical_tongue_and_groove_treated_cladding: { texFile: 'assets/tex_timber.jpg', roughness: 0.88, rotated: false, tilesX: 0.7, tilesY: 0.5 },

  // ── CEDAR (natural grain — cedar, oak, larch, teak, walnut, iro) ─────────────
  vertical_cedar_cladding:                 { texFile: 'assets/tex_cedar.jpg', roughness: 0.85, rotated: false, tilesX: 0.6, tilesY: 0.5 },
  cedar_shingles_cladding:                 { texFile: 'assets/tex_cedar.jpg', roughness: 0.86, rotated: false, tilesX: 0.8, tilesY: 0.6 },
  charred_grey_thermowood_cladding:        { texFile: 'assets/tex_cedar.jpg', roughness: 0.92, rotated: false, tilesX: 0.6, tilesY: 0.5 },
  vertical_larch_cladding:                 { texFile: 'assets/tex_cedar.jpg', roughness: 0.85, rotated: false, tilesX: 0.6, tilesY: 0.5 },
  vertical_iro_cladding:                   { texFile: 'assets/tex_cedar.jpg', roughness: 0.82, rotated: false, tilesX: 0.6, tilesY: 0.5 },
  vertical_thermopine_cladding:            { texFile: 'assets/tex_cedar.jpg', roughness: 0.85, rotated: false, tilesX: 0.6, tilesY: 0.5 },
  oak_planks_cladding:                     { texFile: 'assets/tex_cedar.jpg', roughness: 0.83, rotated: false, tilesX: 0.6, tilesY: 0.5 },
  vertical_light_oak_cladding:             { texFile: 'assets/tex_cedar.jpg', roughness: 0.83, rotated: false, tilesX: 0.6, tilesY: 0.5 },
  horizontal_light_oak_cladding:           { texFile: 'assets/tex_cedar.jpg', roughness: 0.83, rotated: true,  tilesX: 0.6, tilesY: 0.5 },
  horizontal_teak_cladding:               { texFile: 'assets/tex_cedar.jpg', roughness: 0.82, rotated: true,  tilesX: 0.6, tilesY: 0.5 },
  horizontal_walnut_cladding:              { texFile: 'assets/tex_cedar.jpg', roughness: 0.84, rotated: true,  tilesX: 0.6, tilesY: 0.5 },

  // ── COMPOSITE (dark/charcoal/metallic panels) ───────────────────────────────
  horizontal_midnight_charcoal_cladding:   { texFile: 'assets/tex_composite.jpg', roughness: 0.70, rotated: true,  tilesX: 1.2, tilesY: 0.8 },
  vertical_midnight_charcoal_cladding:     { texFile: 'assets/tex_composite.jpg', roughness: 0.70, rotated: false, tilesX: 1.2, tilesY: 0.8 },
  vertical_charcoal_cladding:              { texFile: 'assets/tex_composite.jpg', roughness: 0.68, rotated: false, tilesX: 1.2, tilesY: 0.8 },
  vertical_midnight_cladding:              { texFile: 'assets/tex_composite.jpg', roughness: 0.70, rotated: false, tilesX: 1.2, tilesY: 0.8 },
  vertical_flint_cladding:                 { texFile: 'assets/tex_composite.jpg', roughness: 0.72, rotated: false, tilesX: 1.2, tilesY: 0.8 },
  vertical_havana_cladding:                { texFile: 'assets/tex_composite.jpg', roughness: 0.72, rotated: false, tilesX: 1.2, tilesY: 0.8 },
  horizontal_silver_grey_cladding:         { texFile: 'assets/tex_composite.jpg', roughness: 0.65, rotated: true,  tilesX: 1.2, tilesY: 0.8 },
  vertical_corrugated_sheet_cladding:      { texFile: 'assets/tex_composite.jpg', roughness: 0.60, rotated: false, tilesX: 1.5, tilesY: 1.0 },

  // ── RENDER / STONE (masonry, brick, stucco) ──────────────────────────────────
  stone_01_cladding:                       { texFile: 'assets/tex_render.jpg',   roughness: 0.95, rotated: false, tilesX: 0.5, tilesY: 0.5 },
  red_brick_wall_02_cladding:              { texFile: 'assets/tex_red_brick.jpg', roughness: 0.96, rotated: false, tilesX: 1.0, tilesY: 0.8 },
  red_brick_wall_01_cladding:              { texFile: 'assets/tex_red_brick.jpg', roughness: 0.96, rotated: false, tilesX: 1.0, tilesY: 0.8 },
  london_stone_cladding:                   { texFile: 'assets/tex_render.jpg',   roughness: 0.96, rotated: false, tilesX: 0.6, tilesY: 0.6 },

  // ── HORIZONTAL CEDAR ─────────────────────────────────────────────────────────
  horizontal_cedar_cladding:               { texFile: 'assets/tex_horizontal_cedar.jpg', roughness: 0.85, rotated: true,  tilesX: 0.6, tilesY: 0.5 },

  // ── CHARRED / THERMOWOOD ─────────────────────────────────────────────────────
  charred_thermowood_cladding:             { texFile: 'assets/tex_charred_thermowood.jpg', roughness: 0.92, rotated: false, tilesX: 0.6, tilesY: 0.5 },
  charred_black_thermowood_cladding:       { texFile: 'assets/tex_charred_black.jpg',      roughness: 0.94, rotated: false, tilesX: 0.6, tilesY: 0.5 },

  // ── COMPOSITE / ENGINEERED PANELS ────────────────────────────────────────────
  strongcore_cladding:                               { texFile: 'assets/tex_strongcore.jpg',         roughness: 0.75, rotated: false, tilesX: 1.0, tilesY: 0.8 },
  neotimber_classic_plank_charcoal_vertical_cladding:{ texFile: 'assets/tex_neotimber_charcoal.jpg', roughness: 0.72, rotated: false, tilesX: 1.2, tilesY: 0.8 },
  neotimber_classic_plank_grey_vertical_cladding:    { texFile: 'assets/tex_neotimber_grey.jpg',     roughness: 0.72, rotated: false, tilesX: 1.2, tilesY: 0.8 },

  // ── METAL ─────────────────────────────────────────────────────────────────────
  anthracite_vertical_metal_cladding:      { texFile: 'assets/tex_metal_anthracite.jpg', roughness: 0.55, metalness: 0.30, rotated: false, tilesX: 1.5, tilesY: 1.0 },
  black_vertical_metal_cladding:           { texFile: 'assets/tex_metal_black.jpg',      roughness: 0.55, metalness: 0.30, rotated: false, tilesX: 1.5, tilesY: 1.0 },
  corten_cladding:                         { texFile: 'assets/tex_corten.jpg',           roughness: 0.90, metalness: 0.10, rotated: false, tilesX: 0.5, tilesY: 0.5 },
};

// ── Roof-finish tiling densities (tiles per metre) and roughness ───────────────
const ROOF_FINISH_CFG = {
  epdm_black_roofing:           { tilesPerMeter: 0.4, roughness: 0.96 },
  green_roof:                   { tilesPerMeter: 0.5, roughness: 0.98 },
  cedar_roofing:                { tilesPerMeter: 1.0, roughness: 0.84 },
  pebbles_roof:                 { tilesPerMeter: 1.2, roughness: 0.90 },
  shingles_square_red_roofing:  { tilesPerMeter: 1.5, roughness: 0.82 },
  shingles_square_black_roofing:{ tilesPerMeter: 1.5, roughness: 0.82 },
  corrugated_roofing:           { tilesPerMeter: 1.5, roughness: 0.78 },
  coated_tile_roofing:          { tilesPerMeter: 1.2, roughness: 0.80 },
  copper_roofing:               { tilesPerMeter: 0.4, roughness: 0.60 },
  sip_roof:                     { tilesPerMeter: 0.4, roughness: 0.96 },
};

/**
 * Universal tiled-texture material factory.
 *
 * Every textured surface in the scene routes through here so that texture
 * density is always expressed in world-space units (tiles per metre) rather
 * than raw UV repeat values.  This prevents squish/stretch whenever a surface
 * dimension changes.
 *
 * @param {object} opts
 *   texFile        — asset path
 *   worldW/worldH  — actual surface size in metres
 *   tilesX/tilesY  — tiles per metre per axis (default 1.0 each)
 *   tilesPerMeter  — shorthand that sets both axes when tilesX/tilesY are omitted
 *   offsetX/offsetY — world-space start position (keeps texture continuous
 *                     across adjacent panels on the same wall)
 *   rotated        — true for timber/cedar (boards run horizontally)
 *   roughness, metalness, tint
 */
function makeTiledMat({
  texFile, worldW, worldH,
  tilesPerMeter = 1.0, tilesX, tilesY,
  offsetX = 0, offsetY = 0,
  rotated = false,
  roughness = 0.8, metalness = 0.0,
  tint = null,
}) {
  const tx = tilesX ?? tilesPerMeter;
  const ty = tilesY ?? tilesPerMeter;

  const tex = texLoader.load(texFile);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();

  if (rotated) {
    tex.rotation = Math.PI / 2;
    tex.center.set(0.5, 0.5);
    // Pre-rotation: UV-x covers worldH, UV-y covers worldW
    tex.repeat.set(worldH * tx, worldW * ty);
    tex.offset.set(offsetY * tx, offsetX * ty);
  } else {
    tex.repeat.set(worldW * tx, worldH * ty);
    tex.offset.set(offsetX * tx, offsetY * ty);
  }

  const mat = new THREE.MeshStandardMaterial({ map: tex, roughness, metalness });
  if (tint) mat.color.set(tint);
  return mat;
}

// ── Wall materials ─────────────────────────────────────────────────────────────

const _CLADDING_FALLBACK = CLADDING_CFG['vertical_cedar_cladding'];

// Resolve the effective cladding key for a given wall, respecting per-wall overrides.
function _claddingKey(wallId) {
  if (wallId && state.claddingPerWall && state.claddingPerWall[wallId]) {
    return state.claddingPerWall[wallId];
  }
  return state.cladding;
}

// Full-wall material (used for gable ends and tilt wedges — no cutouts).
// offsetY: world-space Y start position for texture continuity (e.g. on wedge above rect wall).
function makeWallMat(w, h, wallId, offsetY = 0) {
  const cfg = CLADDING_CFG[_claddingKey(wallId)] || _CLADDING_FALLBACK;
  return makeTiledMat({ ...cfg, worldW: w, worldH: h, offsetY, tint: state.claddingTint });
}

// Returns cladding config for use by makePanelMat (per-wall aware).
function makeWallTexInfo(wallId) {
  return CLADDING_CFG[_claddingKey(wallId)] || _CLADDING_FALLBACK;
}

// Per-panel wall material: repeat and offset are derived from the panel's actual
// size and position so the texture is continuous and unstretched across cutouts.
function makePanelMat(texInfo, panelW, panelH, panelX0, panelY0) {
  return makeTiledMat({
    ...texInfo,
    worldW: panelW, worldH: panelH,
    offsetX: panelX0, offsetY: panelY0,
    tint: state.claddingTint,
  });
}

// ── Roof material ──────────────────────────────────────────────────────────────

// w / d = actual panel dimensions in metres so tile density stays consistent
// regardless of room size.
function makeRoofMat(w, d) {
  const finish = state.roofFinish;
  const texFile = {
    epdm_black_roofing:          'assets/roof_epdm.jpg',
    green_roof:                  'assets/roof_grass.jpg',
    cedar_roofing:               'assets/roof_cedar.jpg',
    pebbles_roof:                'assets/roof_pebbles.jpg',
    shingles_square_red_roofing: 'assets/roof_shingle_red.jpg',
    corrugated_roofing:          'assets/roof_shingle_grey.jpg',
    shingles_square_black_roofing:'assets/roof_shingle_grey.jpg',
    coated_tile_roofing:         'assets/roof_shingle_grey.jpg',
    copper_roofing:              'assets/roof_epdm.jpg',
    sip_roof:                    'assets/roof_epdm.jpg',
  }[finish] || 'assets/roof_epdm.jpg';
  const cfg = ROOF_FINISH_CFG[finish] || { tilesPerMeter: 0.5, roughness: 0.90 };
  return _cachedMat(`roof_${finish}_${w.toFixed(2)}_${d.toFixed(2)}`, () =>
    makeTiledMat({ texFile, worldW: w, worldH: d, tilesPerMeter: cfg.tilesPerMeter, roughness: cfg.roughness })
  );
}

// Glass: physically-based, slightly reflective
const glassMat = new THREE.MeshStandardMaterial({
  color: 0xa8d8ea, transparent: true, opacity: 0.18,
  roughness: 0.05, metalness: 0.1,
  side: THREE.DoubleSide, depthWrite: false,
});
// Frame: aluminium-style — slightly metallic (singleton — colour updated in place)
let frameMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.45, metalness: 0.55 });
function getFrameMat() {
  frameMat.color.set(state.frameColour || '#1a1a1a');
  return frameMat;
}
function applyFrameColour() {
  frameMat.color.set(state.frameColour || '#1a1a1a');
  markDirty();
}
// Gutter: singleton — colour updated in place, no rebuild needed
const gutMat = new THREE.MeshLambertMaterial({ color: 0x1a1a1a });
function applyGutterColour() {
  gutMat.color.set(state.gutterColour ?? '#1a1a1a');
  markDirty();
}
// Concrete slab
const slabMat  = new THREE.MeshStandardMaterial({ color: 0xccccbb, roughness: 0.92, metalness: 0.0 });
// Interior floor base colour (overridden per finish below)
const floorMat = new THREE.MeshStandardMaterial({ color: 0xc8a87a, roughness: 0.65, metalness: 0.0 });
// Decking
const deckMat  = new THREE.MeshStandardMaterial({ color: 0x7a5210, roughness: 0.80, metalness: 0.0 });
const boardMat = new THREE.MeshStandardMaterial({ color: 0x6b4810, roughness: 0.85, metalness: 0.0 });

// Interior floor texture map — keyed by state.interiorFloor value (catalogue keys)
// tilesPerMeter: how many texture repeats fit in 1 metre of floor
const _T = (file, tilesPerMeter, roughness) => ({ file, tilesPerMeter, roughness });
const _OAK = f => _T('assets/int_floor_oak.jpg',               f ?? 0.50, 0.70);
const _FARM = f => _T('assets/int_floor_farm_oak.jpg',         f ?? 0.40, 0.72);
const _WALT = f => _T('assets/int_floor_walnut.jpg',           f ?? 0.50, 0.65);
const _TILE = f => _T('assets/int_floor_tiles.jpg',            f ?? 1.00, 0.40);
const _CONC = f => _T('assets/int_floor_polished_concrete.jpg',f ?? 0.25, 0.30);
const _GYM  = f => _T('assets/int_floor_gym_black.jpg',        f ?? 1.00, 0.60);
const _RUBB = f => _T('assets/int_floor_rubber.jpg',           f ?? 1.00, 0.85);
const _MARB = f => _T('assets/int_floor_marble.jpg',           f ?? 0.30, 0.25);

const FLOOR_TEXTURE_DEFS = {
  // ── Oak / light wood ─────────────────────────────────────────────────────
  oak_flooring:                              _OAK(),
  natural_oak_flooring:                      _OAK(),
  oak_parquet_flooring:                      _OAK(),
  oxford_oak_flooring:                       _OAK(),
  victorian_oak_flooring:                    _OAK(),
  wiltshire_english_oak_flooring:            _OAK(),
  westchester_oak_flooring:                  _OAK(),
  aster_staggered_oak_flooring:              _OAK(),
  rhino_oak_flooring:                        _OAK(),
  beech_flooring:                            _OAK(),
  sawn_flooring:                             _OAK(),
  kentucky_oak_beige_flooring:               _OAK(),
  aspen_oak_flooring:                        _OAK(),
  sicilia_oak_flooring:                      _OAK(),
  tongue_and_groove_flooring:                _OAK(),
  honey_oak_flooring:                        _OAK(),
  liguiria_oak_flooring:                     _OAK(),
  // ── Farm / wide-board oak ────────────────────────────────────────────────
  farm_house_light_oak_flooring:             _FARM(),
  farm_house_dark_oak_flooring:              _FARM(),
  farm_oak_flooring:                         _FARM(),
  // ── Dark oak / walnut ────────────────────────────────────────────────────
  phantom_oak_flooring:                      _WALT(),
  loft_dark_grey_oak_flooring:               _WALT(),
  loft_midnight_oak_flooring:                _WALT(),
  dark_oak_parquet_flooring:                 _WALT(),
  wiltshire_weathered_grey_parquet_flooring: _WALT(),
  walnut_flooring:                           _WALT(),
  // ── Tiles / stone ────────────────────────────────────────────────────────
  tiles_flooring:                            _TILE(),
  stone_porcelain_ocre_tiles:                _TILE(),
  stone_porcelain_gris_tiles:                _TILE(),
  grey_stone_flooring:                       _TILE(),
  beige_stone_flooring:                      _TILE(),
  white_tiles_flooring:                      _TILE(),
  hadley_tiles_flooring:                     _TILE(),
  // ── Polished concrete / SIP ──────────────────────────────────────────────
  sip_floor:                                 _CONC(),
  // ── Gym ─────────────────────────────────────────────────────────────────
  black_gym_flooring:                        _GYM(),
  // ── Rubber (all colour variants share the same texture) ──────────────────
  light_grey_rubber_flooring:                _RUBB(),
  light_green_rubber_flooring:               _RUBB(),
  black_rubber_flooring:                     _RUBB(),
  orange_rubber_flooring:                    _RUBB(),
  green_rubber_flooring:                     _RUBB(),
  red_rubber_flooring:                       _RUBB(),
  dark_grey_rubber_flooring:                 _RUBB(),
  beige_rubber_flooring:                     _RUBB(),
  dark_blue_rubber_flooring:                 _RUBB(),
  mid_blue_rubber_flooring:                  _RUBB(),
  light_blue_rubber_flooring:                _RUBB(),
  // ── Marble ───────────────────────────────────────────────────────────────
  white_marble_flooring:                     _MARB(),
  // ── No texture (exterior product, no interior texture) ──────────────────
  // decking_flooring → exterior product, no interior texture
};
// Pre-load all floor textures at startup.
// Priority: admin-uploaded file (IDB blob URL) > shared file cache > disk path.
const _floorTexCache = {};   // key → THREE.Texture
const _floorTexByFile = {};  // disk file path → THREE.Texture (deduplicate disk loads)

function _loadFloorTex(key, url) {
  texLoader.load(url, tex => {
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    _floorTexCache[key] = tex;
    markDirty();
  });
}

Object.entries(FLOOR_TEXTURE_DEFS).forEach(([key, def]) => {
  // 1. Admin-uploaded file for this exact item key takes top priority
  const adminUrl = adminFileUrl(key);
  if (adminUrl) { _loadFloorTex(key, adminUrl); return; }
  // 2. Reuse already-loaded texture for the same disk file
  if (_floorTexByFile[def.file]) { _floorTexCache[key] = _floorTexByFile[def.file]; return; }
  // 3. Load from disk, share result with all keys that reference the same file
  texLoader.load(def.file, tex => {
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    _floorTexByFile[def.file] = tex;
    // Apply to all keys sharing this file that don't already have an admin override
    Object.entries(FLOOR_TEXTURE_DEFS).forEach(([k2, d2]) => {
      if (d2.file === def.file && !_floorTexCache[k2]) _floorTexCache[k2] = tex;
    });
    markDirty();
  });
});

// Interior colour maps
const INTERIOR_FLOOR_COLORS = {
  oak: 0xc8a87a, walnut: 0x5c3a21, farm_oak: 0xb89a65, tiles: 0xd0cfc8,
  polished_concrete: 0x9e9e9e, gym_black: 0x2a2a2a, white_marble: 0xe8e4de, rubber: 0x3a3a3a,
  // full state-key names
  oak_flooring: 0x8b5e3c, farm_house_light_oak_flooring: 0xb89a65, farm_house_dark_oak_flooring: 0x6b4226,
  aster_staggered_oak_flooring: 0x9e7045, phantom_oak_flooring: 0x5a4030, loft_dark_grey_oak_flooring: 0x4a4440,
  decking_flooring: 0x7a5c3a, sip_floor: 0x8a8a8a, victorian_oak_flooring: 0x7a4e28,
  rhino_oak_flooring: 0x6b5040, wiltshire_english_oak_flooring: 0xa07850, loft_midnight_oak_flooring: 0x2e2a28,
  beech_flooring: 0xc8a87a, sawn_flooring: 0x8c7050, westchester_oak_flooring: 0x9a6840,
  natural_oak_flooring: 0xb8935a, oak_parquet_flooring: 0xa07845, oxford_oak_flooring: 0x7a5230,
};
const INTERIOR_WALL_COLORS = {
  // Short legacy keys (kept for backwards compat)
  white: 0xf5f5f5, charcoal: 0x3a3a3a, plywood: 0xc4a46a, oak: 0xb48a52, tongue_groove: 0xd4b87a,
  // Actual catalogue keys used by index.html
  white_finished_walls:          0xf5f5f5,
  charcoal_grey_finished_walls:  0x3a3a3a,
  plywood_finished_walls:        0xc4a46a,
  oak_panels_finished_walls:     0xb48a52,
  tongue_and_groove_finished_walls: 0xd4b87a,
  alder_wood_finished_walls:     0xc8a870,
  studs_membrane_finished_walls: 0xe8e4dc,
  studs_osb_finished_walls:      0xc8b48a,
  studs_insulation_finished_walls: 0xe0dcd4,
  melamine_boards_finished_walls: 0xf0ede8,
  light_yellow_finished_walls:   0xf5f0d8,
  light_blue_finished_walls:     0xd8ecf5,
  light_green_finished_walls:    0xd8eadc,
  pine_walls:                    0xd4b87a,  // fallback for old state
  // Preset/save keys
  plywood_walls:                 0xc4a46a,
  tongue_and_groove_walls:       0xd4b87a,
};

// Texture paths for interior wall finishes (takes priority over flat colour)
const INTERIOR_WALL_TEXTURES = {
  white_finished_walls:              'assets/int_wall_white.jpg',
  charcoal_grey_finished_walls:      'assets/int_wall_charcoal.jpg',
  plywood_finished_walls:            'assets/int_wall_plywood.jpg',
  plywood_walls:                     'assets/int_wall_plywood.jpg',
  oak_panels_finished_walls:         'assets/int_wall_oak.jpg',
  alder_wood_finished_walls:         'assets/int_wall_alder.jpg',
  tongue_and_groove_finished_walls:  'assets/int_wall_tongue_groove.jpg',
  tongue_and_groove_walls:           'assets/int_wall_tongue_groove.jpg',
  studs_membrane_finished_walls:     'assets/int_wall_membrane.jpg',
  melamine_boards_finished_walls:    'assets/int_wall_melamine.jpg',
  light_yellow_finished_walls:       'assets/int_wall_yellow.jpg',
  light_blue_finished_walls:         'assets/int_wall_blue.jpg',
  light_green_finished_walls:        'assets/int_wall_green.jpg',
};

const _iwTexCache = {};
function _getIwTex(key) {
  const path = INTERIOR_WALL_TEXTURES[key];
  if (!path) return null;
  if (!_iwTexCache[path]) {
    const t = texLoader.load(path);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(2, 2);
    _iwTexCache[path] = t;
  }
  return _iwTexCache[path];
}

function makeIwMat(key) {
  const tex = _getIwTex(key);
  const col = INTERIOR_WALL_COLORS[key] ?? 0xf5f5f5;
  return new THREE.MeshStandardMaterial({
    map: tex || null,
    color: tex ? 0xffffff : col,
    roughness: 0.85, metalness: 0,
    side: THREE.FrontSide,
  });
}

const HANDLE_DOOR_COLOR  = 0xf59e0b;
const HANDLE_WIN_COLOR   = 0x38bdf8;
const HANDLE_HOVER_COLOR = 0xffffff;
const HANDLE_SEL_COLOR   = 0xef4444;

// ─── GLB LOADER ────────────────────────────────────────────────────────────────

const gltfLoader = new THREE.GLTFLoader();
const modelCache = {};
function loadModel(file) {
  // Derive item key from filename: 'assets/door_french.glb' → 'door_french'
  const itemKey = file.replace(/^.*\//, '').replace(/\.[^.]+$/, '');
  const adminUrl = adminFileUrl(itemKey);
  const resolvedFile = adminUrl || file;
  return new Promise(resolve => {
    if (!adminUrl && modelCache[file]) { resolve(modelCache[file].clone()); return; }
    gltfLoader.load(resolvedFile, gltf => {
      if (!adminUrl) modelCache[file] = gltf.scene;
      resolve(gltf.scene.clone());
    }, undefined, err => { console.warn('GLB:', resolvedFile, err); resolve(null); });
  });
}

// ─── MODEL SPECS ───────────────────────────────────────────────────────────────

const DOOR_MODEL = {
  single:  { file: 'assets/door_french.glb',  naturalW: 1.6 },
  double:  { file: 'assets/door_french.glb',  naturalW: 1.6 },
  bifold:  { file: 'assets/door_bifold.glb',  naturalW: 2.4 },
  sliding: { file: 'assets/door_sliding.glb', naturalW: 2.4 },
};
// Door actual widths in metres (after scaling) — used for wall segmentation
const DOOR = {
  single:  { widthM: 0.9  },
  double:  { widthM: 1.8  },
  bifold:  { widthM: 2.4  },
  sliding: { widthM: 2.4  },
};
const WINDOW_MODEL = {
  tilt:  { file: 'assets/win_tilt.glb',  naturalW: 0.90,  naturalH: 1.20, sill: 0.90 },
  long:  { file: 'assets/win_long.glb',  naturalW: 0.971, naturalH: 2.10, sill: 0.05 },
  vert:  { file: 'assets/win_vert.glb',  naturalW: 0.40,  naturalH: 1.20, sill: 0.90 },
  horiz: { file: 'assets/win_horiz.glb', naturalW: 1.20,  naturalH: 0.40, sill: 1.30 },
};

const DOOR_H       = 2.1;
const TK           = 0.14;          // wall thickness (140mm — typical SIP/timber-frame garden room)
const MIN_EDGE_GAP = 0.12;          // opening to wall corner
const MIN_BETWEEN  = 0.10;          // gap between adjacent openings

// ─── GEOMETRY HELPER ───────────────────────────────────────────────────────────

function box(W, H, D, x, y, z, mat) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(W, H, D), mat);
  m.position.set(x, y, z); m.castShadow = m.receiveShadow = true;
  buildingGroup.add(m); return m;
}

// ─── COORDINATE TRANSFORMS ─────────────────────────────────────────────────────

function localToWorld(wallId, localX, localY, hw, hd) {
  const y = 0.18 + localY;
  switch (wallId) {
    case 'front': return { x: -hw + localX, y, z:  hd };
    case 'back':  return { x:  hw - localX, y, z: -hd };
    case 'left':  return { x: -hw,          y, z:  hd - localX };
    case 'right': return { x:  hw,          y, z: -hd + localX };
  }
}
function worldToLocalX(wallId, worldPt, hw, hd) {
  switch (wallId) {
    case 'front': return worldPt.x + hw;
    case 'back':  return hw - worldPt.x;
    case 'left':  return hd - worldPt.z;
    case 'right': return worldPt.z + hd;
  }
}
function wallWidth(wallId) {
  return (wallId === 'left' || wallId === 'right') ? state.depth : state.width;
}

// ─── OPENING GEOMETRY FROM STATE ───────────────────────────────────────────────

// Maps full catalogue keys (from the pricing system) to the scene model keys.
// If no match, falls back to a sensible default by inspecting the key string.
function resolveModelKey(type, styleKey) {
  if (type === 'door') {
    const explicit = {
      single_door:          'single',
      single_french_door:   'single',
      double_door:          'double',
      double_french_door:   'double',
      bifold_door:          'bifold',
      bi_fold_door:         'bifold',
      sliding_door:         'sliding',
      sliding_2_part_door:  'sliding',
      sliding_patio_door:   'sliding',
    };
    if (explicit[styleKey]) return explicit[styleKey];
    if (DOOR[styleKey])     return styleKey; // already a model key
    // Heuristic fallback
    if (/bifold|bi.fold/i.test(styleKey))   return 'bifold';
    if (/sliding|patio/i.test(styleKey))    return 'sliding';
    if (/double/i.test(styleKey))           return 'double';
    return 'single';
  } else {
    const explicit = {
      fixed_window:        'tilt',
      tilt_n_turn_window:  'tilt',
      tilt_turn_window:    'tilt',
      long_panel_window:   'long',
      narrow_vert_window:  'vert',
      narrow_horiz_window: 'horiz',
    };
    if (explicit[styleKey]) return explicit[styleKey];
    if (WINDOW_MODEL[styleKey]) return styleKey; // already a model key
    // Heuristic fallback
    if (/long/i.test(styleKey))            return 'long';
    if (/vert/i.test(styleKey))            return 'vert';
    if (/horiz/i.test(styleKey))           return 'horiz';
    return 'tilt';
  }
}

function openingW(op) {
  if (op.type === 'door') {
    const k = resolveModelKey('door', op.style);
    return DOOR[k]?.widthM ?? 0.9;
  }
  const k = resolveModelKey('window', op.style);
  return WINDOW_MODEL[k]?.naturalW ?? 0.9;
}
function openingH(op) {
  if (op.type === 'door') return DOOR_H;
  const k = resolveModelKey('window', op.style);
  return WINDOW_MODEL[k]?.naturalH ?? 1.2;
}
function openingSill(op) {
  if (op.type === 'door') return 0;
  const k = resolveModelKey('window', op.style);
  return (WINDOW_MODEL[k]?.sill ?? 0.9) + (state.windowSillAdjust ?? 0);
}

function clampOffset(offset, wallW, ow) {
  const max = wallW / 2 - ow / 2 - MIN_EDGE_GAP;
  return max <= 0 ? 0 : Math.max(-max, Math.min(max, offset));
}

// LocalCx of an opening given its current offset
function opLocalCx(op) {
  const ww = wallWidth(op.wall);
  return ww / 2 + clampOffset(op.offset, ww, openingW(op));
}

// Convert op to descriptor for wall builder
function opToDescriptor(op) {
  const ww = wallWidth(op.wall);
  const ow = openingW(op);
  const localCx = ww / 2 + clampOffset(op.offset, ww, ow);
  const oh = openingH(op);
  const sill = openingSill(op);
  return {
    localCx,
    localCy: sill + oh / 2,
    w: ow, h: oh,
    isDoor: op.type === 'door',
    style: op.style,
    opId: op.id,
  };
}

// ─── OVERLAP DETECTION ─────────────────────────────────────────────────────────

/**
 * Given an opening (type, style, wall) at a candidate localCx,
 * does it overlap any other opening on the same wall?
 * excludeId: opening to skip (for drag — don't collide with yourself)
 */
function wouldOverlap(type, style, wallId, candidateLocalCx, excludeId = -1) {
  const mk_ = resolveModelKey(type, style); const ow = type === 'door' ? (DOOR[mk_]?.widthM ?? 0.9) : (WINDOW_MODEL[mk_]?.naturalW ?? 0.9);
  const left  = candidateLocalCx - ow / 2;
  const right = candidateLocalCx + ow / 2;

  for (const op of state.openings) {
    if (op.id === excludeId) continue;
    if (op.wall !== wallId) continue;
    const oow   = openingW(op);
    const ocx   = opLocalCx(op);
    const oleft  = ocx - oow / 2 - MIN_BETWEEN;
    const oright = ocx + oow / 2 + MIN_BETWEEN;
    if (left < oright && right > oleft) return true;
  }
  return false;
}

/**
 * Find the closest valid localCx to `targetLocalCx` on a wall where
 * (type, style) doesn't overlap any other opening (excluding excludeId).
 * Returns null if the wall has no room at all.
 */
function findValidPosition(type, style, wallId, targetLocalCx, excludeId = -1) {
  const ww  = wallWidth(wallId);
  const mk2_ = resolveModelKey(type, style); const ow = type === 'door' ? (DOOR[mk2_]?.widthM ?? 0.9) : (WINDOW_MODEL[mk2_]?.naturalW ?? 0.9);
  const min = ow / 2 + MIN_EDGE_GAP;
  const max = ww - ow / 2 - MIN_EDGE_GAP;
  if (min > max) return null;

  // Build list of blocked ranges from other openings on same wall
  const blocked = state.openings
    .filter(o => o.id !== excludeId && o.wall === wallId)
    .map(o => {
      const oow = openingW(o);
      const ocx = opLocalCx(o);
      return { left: ocx - oow / 2 - MIN_BETWEEN - ow / 2, right: ocx + oow / 2 + MIN_BETWEEN + ow / 2 };
    })
    .sort((a, b) => a.left - b.left);

  // Build free intervals
  const free = [];
  let cursor = min;
  for (const b of blocked) {
    if (b.left > cursor) free.push({ from: cursor, to: Math.min(max, b.left) });
    cursor = Math.max(cursor, b.right);
  }
  if (cursor <= max) free.push({ from: cursor, to: max });
  if (!free.length) return null;

  // Pick interval whose clamped point is closest to target
  let bestPos = null, bestDist = Infinity;
  for (const seg of free) {
    const clamped = Math.max(seg.from, Math.min(seg.to, targetLocalCx));
    const dist = Math.abs(clamped - targetLocalCx);
    if (dist < bestDist) { bestDist = dist; bestPos = clamped; }
  }
  return bestPos;
}

// ─── WALL SEGMENTATION ─────────────────────────────────────────────────────────

function getWallPanels(wallW, wallH, descriptors) {
  if (!descriptors.length) return [{ cx: wallW / 2, cy: wallH / 2, w: wallW, h: wallH }];

  const ops = descriptors
    .map(o => ({ ...o, x0: o.localCx - o.w / 2, x1: o.localCx + o.w / 2 }))
    .sort((a, b) => a.x0 - b.x0);

  const xPts = [0];
  ops.forEach(o => xPts.push(o.x0, o.x1));
  xPts.push(wallW);
  const xs = [...new Set(xPts.map(v => Math.round(v * 1000) / 1000))].sort((a, b) => a - b);

  const panels = [];
  for (let i = 0; i < xs.length - 1; i++) {
    const x0 = xs[i], x1 = xs[i + 1];
    if (x1 - x0 < 0.005) continue;
    const cx = (x0 + x1) / 2, sw = x1 - x0;
    const inStrip = ops.filter(o => o.x0 <= x0 + 0.002 && o.x1 >= x1 - 0.002);
    if (!inStrip.length) {
      panels.push({ cx, cy: wallH / 2, w: sw, h: wallH });
    } else {
      let y = 0;
      for (const op of inStrip.sort((a, b) => (a.localCy - a.h / 2) - (b.localCy - b.h / 2))) {
        const y0 = op.localCy - op.h / 2, y1 = op.localCy + op.h / 2;
        if (y0 - y > 0.005) panels.push({ cx, cy: y + (y0 - y) / 2, w: sw, h: y0 - y });
        y = y1;
      }
      if (wallH - y > 0.005) panels.push({ cx, cy: y + (wallH - y) / 2, w: sw, h: wallH - y });
    }
  }
  return panels;
}

// ─── SIDE WALL FULL-HEIGHT POLYGON ─────────────────────────────────────────────
// Builds a left or right wall as a single flat polygon covering the full shape
// (trapezoid for flat/tilted roof, pentagon for apex roof). No seams, no two-piece split.
// pts: flat [x,y,z, x,y,z, ...] for the wall outline (all share the same x).
// worldW/worldH: used for texture tiling density.
// Uses THREE.Shape with holes punched for each opening so windows stay see-through.
function buildSideWallFull(wallId, pts, worldW, worldH, descriptors, hw, hd, gen) {
  const wallX = wallId === 'left' ? -hw : hw;

  // ── Build 2D outline in (z, y) space ──────────────────────────────────────
  const nv = pts.length / 3;
  const shape = new THREE.Shape();
  shape.moveTo(pts[2], pts[1]);  // z, y of first vertex
  for (let i = 1; i < nv; i++) shape.lineTo(pts[i * 3 + 2], pts[i * 3 + 1]);
  shape.closePath();

  // Punch holes for every opening (windows and doors)
  descriptors.forEach(desc => {
    const wc = localToWorld(wallId, desc.localCx, desc.localCy, hw, hd);
    const halfW = desc.w / 2, halfH = desc.h / 2;
    const zC = wc.z, yTop = wc.y + halfH;
    const yBot = desc.isDoor ? 0.17 : wc.y - halfH;  // doors open to floor
    const hole = new THREE.Path();
    hole.moveTo(zC - halfW, yBot);
    hole.lineTo(zC + halfW, yBot);
    hole.lineTo(zC + halfW, yTop);
    hole.lineTo(zC - halfW, yTop);
    hole.closePath();
    shape.holes.push(hole);
  });

  // ── Helper: build one face (exterior or interior) ─────────────────────────
  function buildFace(xPos, mat, extra = null) {
    const geo = new THREE.ShapeGeometry(shape, 2);

    // ShapeGeometry puts the shape in XY plane: shape-X = scene-Z, shape-Y = scene-Y.
    // Remap each vertex so x = xPos (constant wall plane).
    const pos = geo.attributes.position;
    const uv  = geo.attributes.uv;
    for (let i = 0; i < pos.count; i++) {
      const sz = pos.getX(i);   // shape-X holds scene-Z
      const sy = pos.getY(i);   // shape-Y holds scene-Y
      pos.setXYZ(i, xPos, sy, sz);
      // Remap UVs to [0,1] across the full wall surface for consistent tiling
      uv.setXY(i, (sz + hd) / worldW, (sy - 0.18) / worldH);
    }
    pos.needsUpdate = true;
    uv.needsUpdate  = true;
    geo.computeVertexNormals();

    const m = new THREE.Mesh(geo, mat);
    m.castShadow = m.receiveShadow = true;
    m.userData.wallId = wallId;
    if (extra) Object.assign(m.userData, extra);
    buildingGroup.add(m);
    wallMeshes[wallId].push(m);
  }

  // Exterior cladding face (DoubleSide so it reads correctly from both angles)
  const cfg    = makeWallTexInfo(wallId);
  const extMat = makeTiledMat({ ...cfg, worldW, worldH, tint: state.claddingTint });
  extMat.side  = THREE.DoubleSide;
  buildFace(wallX, extMat, { claddingSide: { wallId, worldW, worldH } });

  // Interior face — inset by wall thickness, plain interior colour
  const iwMat = makeIwMat(state.interiorWalls); iwMat.side = THREE.DoubleSide;
  const inset = wallId === 'left' ? TK : -TK;
  buildFace(wallX + inset, iwMat);

  // ── Place opening models ───────────────────────────────────────────────────
  // Offset windows/doors inward by half the wall thickness so they sit visibly
  // set into the wall rather than flush with the exterior face.
  const xInset = wallId === 'left' ? TK / 2 : -TK / 2;
  descriptors.forEach(desc => {
    const wc = localToWorld(wallId, desc.localCx, desc.localCy, hw, hd);
    if (desc.isDoor) {
      placeDoorGLB(wallId, wc, desc.w, desc.style, hw, hd, gen);
    } else {
      const pane = new THREE.Mesh(new THREE.BoxGeometry(0.015, desc.h, desc.w), glassMat);
      pane.position.set(wc.x + xInset, wc.y, wc.z);
      pane.userData.wallId = wallId;
      buildingGroup.add(pane);
      wallMeshes[wallId].push(pane);
      placeWindowGLB(wallId, wc, desc.h, desc.w, desc.style, hw, hd, gen);
    }
  });
}

function buildWallFace(wallId, wallW, wallH, descriptors, hw, hd, gen) {
  const isLR = wallId === 'left' || wallId === 'right';
  const wallTexInfo = makeWallTexInfo(wallId);  // per-wall cladding override support

  // Interior wall material (passed via closure from buildRoom)
  const iwMat = makeIwMat(state.interiorWalls);

  getWallPanels(wallW, wallH, descriptors).forEach(({ cx, cy, w, h }) => {
    // Each panel gets its own material with repeat/offset matched to its actual
    // size and position, so the texture tiles at a consistent world-space scale.
    const panelMat = makePanelMat(wallTexInfo, w, h, cx - w / 2, cy - h / 2);
    const { x, y, z } = localToWorld(wallId, cx, cy, hw, hd);
    // Exterior face
    const geo = isLR ? new THREE.BoxGeometry(TK, h, w) : new THREE.BoxGeometry(w, h, TK);
    const m = new THREE.Mesh(geo, panelMat);
    m.position.set(x, y, z); m.castShadow = m.receiveShadow = true;
    m.userData.wallId = wallId;
    m.userData.claddingPanel = { wallId, panelW: w, panelH: h, panelX0: cx - w / 2, panelY0: cy - h / 2 };
    buildingGroup.add(m);
    wallMeshes[wallId].push(m);
    // Interior face (thin panel offset inward)
    const iTK = 0.01;
    const iGeo = isLR ? new THREE.BoxGeometry(iTK, h, w) : new THREE.BoxGeometry(w, h, iTK);
    const im = new THREE.Mesh(iGeo, iwMat);
    const inset = TK/2 + iTK/2;
    if (wallId === 'front')      im.position.set(x, y, z - inset);
    else if (wallId === 'back')  im.position.set(x, y, z + inset);
    else if (wallId === 'left')  im.position.set(x + inset, y, z);
    else                         im.position.set(x - inset, y, z);
    im.userData.isInterior = true;
    im.userData.wallId = wallId;
    buildingGroup.add(im);
    wallMeshes[wallId].push(im);
  });

  descriptors.forEach(desc => {
    const wc = localToWorld(wallId, desc.localCx, desc.localCy, hw, hd);
    if (desc.isDoor) {
      placeDoorGLB(wallId, wc, desc.w, desc.style, hw, hd, gen);
    } else {
      const pane = new THREE.Mesh(
        isLR ? new THREE.BoxGeometry(0.015, desc.h, desc.w) : new THREE.BoxGeometry(desc.w, desc.h, 0.015),
        glassMat
      );
      pane.position.set(wc.x, wc.y, wc.z);
      pane.userData.wallId = wallId;
      buildingGroup.add(pane);
      wallMeshes[wallId].push(pane);
      placeWindowGLB(wallId, wc, desc.h, desc.w, desc.style, hw, hd, gen);
    }
  });
}

// ─── GLB PLACEMENT (use op.style) ──────────────────────────────────────────────

function placeDoorGLB(wallId, worldCentre, doorW, style, hw, hd, gen) {
  const mk = resolveModelKey('door', style);
  const dm = DOOR_MODEL[mk] || DOOR_MODEL.single;
  loadModel(dm.file).then(model => {
    if (!model || gen !== _buildGen) return;  // stale build — discard
    model.scale.set(doorW / dm.naturalW, 1, 1);
    model.traverse(c => { if (c.isMesh) { c.castShadow = c.receiveShadow = true; } });
    const { x, z } = worldCentre;
    // GLB origin is bottom-left corner, natural width in local +X.
    // rotation.y determines which direction local +X maps to in world space,
    // and the origin offset centres the door on the opening.
    switch (wallId) {
      case 'front': model.rotation.y =  Math.PI;       model.position.set(x + doorW / 2, 0.18,  hd); break;
      case 'back':  model.rotation.y =  0;             model.position.set(x - doorW / 2, 0.18, -hd); break;
      case 'left':  model.rotation.y =  Math.PI / 2;  model.position.set(-hw, 0.18, z + doorW / 2); break;
      case 'right': model.rotation.y = -Math.PI / 2;  model.position.set( hw, 0.18, z - doorW / 2); break;
    }
    model.userData.wallId = wallId;
    buildingGroup.add(model);
    wallMeshes[wallId].push(model);
  });
}

function placeWindowGLB(wallId, worldCentre, oh, _ow, style, hw, hd, gen) {
  const mk = resolveModelKey('window', style);
  const wm = WINDOW_MODEL[mk] || WINDOW_MODEL.tilt;
  loadModel(wm.file).then(model => {
    if (!model || gen !== _buildGen) return;  // stale build — discard
    model.traverse(c => { if (c.isMesh) { c.castShadow = c.receiveShadow = true; } });
    const { x, y, z } = worldCentre;
    const yB = y - oh / 2;
    switch (wallId) {
      case 'front': model.rotation.y = Math.PI;     model.position.set(x + wm.naturalW/2, yB,  hd); break;
      case 'back':  model.rotation.y = 0;           model.position.set(x - wm.naturalW/2, yB, -hd); break;
      case 'left':  model.rotation.y = Math.PI/2;   model.position.set(-hw + TK/2, yB, z + wm.naturalW/2); break;
      case 'right': model.rotation.y = -Math.PI/2;  model.position.set( hw - TK/2, yB, z - wm.naturalW/2); break;
    }
    model.userData.wallId = wallId;
    buildingGroup.add(model);
    wallMeshes[wallId].push(model);
  });
}

// ─── ROOF ──────────────────────────────────────────────────────────────────────

function buildRoof(w, d, h, hw, hd) {
  const roofY = 0.18 + h, ov = 0.3, panelD = d + ov * 2, pT = 0.1;
  // rMat is set per-branch below with the correct panel dimensions.
  let rMat;
  const rp = (W, D, x, y, z, rz=0) => { const m = new THREE.Mesh(new THREE.BoxGeometry(W, pT, D), rMat); m.position.set(x,y,z); m.rotation.z=rz; m.castShadow=true; m.userData.isRoof=true; roofGroup.add(m); };
  const fa = (W, H, D, x, y, z)    => { const m = new THREE.Mesh(new THREE.BoxGeometry(W, H, D), getFrameMat()); m.position.set(x,y,z); m.userData.isRoof=true; roofGroup.add(m); };

  if (state.roof === 'flat') {
    rMat = makeRoofMat(w + ov * 2, panelD);
    const tiltRad = ((state.roofTilt || 0) * Math.PI) / 180;
    // Panel: tilted along X axis so front edge is higher (back-to-front drainage)
    const panelM = new THREE.Mesh(new THREE.BoxGeometry(w+ov*2, pT, panelD), rMat);
    panelM.position.set(0, roofY+pT/2, 0);
    panelM.rotation.x = -tiltRad;  // negative: front(+Z) is HIGH, back(-Z) is LOW
    panelM.castShadow = true;
    panelM.userData.isRoof = true;
    roofGroup.add(panelM);
    // Soffit — covers the underside of the roof panel so the finish texture isn't
    // visible when looking up from outside. Sits just below the panel, same tilt.
    const soffitM = new THREE.Mesh(new THREE.BoxGeometry(w+ov*2, 0.005, panelD), getFrameMat());
    soffitM.position.set(0, roofY - 0.003, 0);
    soffitM.rotation.x = -tiltRad;
    soffitM.userData.isRoof = true;
    roofGroup.add(soffitM);
    // Fascia heights adjust with tilt: front is higher, back lower
    const tiltRise = Math.tan(tiltRad) * (hd + ov);
    // fH sized to cover the roof panel edge (pT=0.1 thick): top aligns with roof top, bottom 6cm below underside.
    const fH = 0.16;
    // Front fascia (higher side)
    const fYFront = roofY + tiltRise - fH/2 + pT;
    fa(w+ov*2+0.05, fH, 0.06, 0, fYFront, hd+ov);
    // Back fascia (lower side)
    const fYBack = roofY - tiltRise - fH/2 + pT;
    fa(w+ov*2+0.05, fH, 0.06, 0, fYBack, -(hd+ov));
    // Side fascia: positioned at midpoint height (tilted roof edge visible from side)
    // We replace with a slanted trim that follows the tilt
    [-hw-ov, hw+ov].forEach(xPos => {
      // Build a thin quad matching the slant: back at roofY-tiltRise, front at roofY+tiltRise
      const geo = new THREE.BufferGeometry();
      const sZ = hd + ov, fD = 0.06, yB = roofY - tiltRise - fH/2 + pT, yF = roofY + tiltRise - fH/2 + pT;
      const v = new Float32Array([
        xPos-fD/2, yB,    -sZ,  xPos+fD/2, yB,    -sZ,
        xPos-fD/2, yB+fH, -sZ,  xPos+fD/2, yB+fH, -sZ,
        xPos-fD/2, yF,     sZ,  xPos+fD/2, yF,     sZ,
        xPos-fD/2, yF+fH,  sZ,  xPos+fD/2, yF+fH,  sZ,
      ]);
      geo.setAttribute('position', new THREE.BufferAttribute(v, 3));
      geo.setIndex([
        0,2,1, 1,2,3,     // back face
        4,5,6, 5,7,6,     // front face
        0,1,5, 0,5,4,     // bottom
        2,6,7, 2,7,3,     // top
        0,4,6, 0,6,2,     // left side
        1,3,7, 1,7,5,     // right side
      ]);
      geo.computeVertexNormals();
      const m = new THREE.Mesh(geo, getFrameMat()); m.castShadow=true; m.userData.isRoof=true; roofGroup.add(m);
    });
    if (state.extras.lantern) {
      const lw=w*0.38,ld=d*0.38,ly=roofY+pT;
      rp(lw+0.1,ld+0.1,0,ly+0.08,0);
      const lg=new THREE.Mesh(new THREE.BoxGeometry(lw,0.55,ld),new THREE.MeshPhongMaterial({color:0xd0ecff,transparent:true,opacity:0.45,shininess:120}));
      lg.position.set(0,ly+0.435,0); lg.userData.isRoof=true; roofGroup.add(lg);
      rp(lw+0.08,ld+0.08,0,ly+0.72,0);
    }
  } else if (state.roof === 'apex') {
    // Ridge runs along X axis; slopes pitch toward front (+Z) and back (-Z)
    const rh=state.apexPitch??1.0, spanZ=hd+ov, spanW=w+ov*2;
    const slopeLen=Math.sqrt(spanZ*spanZ+rh*rh), angle=Math.atan2(rh,spanZ);
    rMat = makeRoofMat(spanW, slopeLen);

    // ── Front slope panel ──
    const fp=new THREE.Mesh(new THREE.BoxGeometry(spanW,pT,slopeLen),rMat);
    fp.position.set(0,roofY+rh/2,spanZ/2); fp.rotation.x=angle; fp.castShadow=true; fp.userData.isRoof=true; roofGroup.add(fp);

    // ── Back slope panel ──
    const bp=new THREE.Mesh(new THREE.BoxGeometry(spanW,pT,slopeLen),rMat);
    bp.position.set(0,roofY+rh/2,-spanZ/2); bp.rotation.x=-angle; bp.castShadow=true; bp.userData.isRoof=true; roofGroup.add(bp);

    // ── Ridge beam ──
    const ridge=new THREE.Mesh(new THREE.BoxGeometry(spanW+0.1,0.10,0.10),getFrameMat());
    ridge.position.set(0,roofY+rh+pT/2,0); ridge.userData.isRoof=true; roofGroup.add(ridge);

    // Gable end fills are now handled by buildSideWallFull (pentagon polygon) in buildRoom.

    // ── Front & back eave fascia boards ──
    // fH sized to cover the roof panel edge: top flush with roof surface, bottom ~6cm below underside.
    const fH=0.16, eY=roofY;
    fa(spanW+0.06,fH,0.07, 0,eY-fH/2+0.02, +(hd+ov));
    fa(spanW+0.06,fH,0.07, 0,eY-fH/2+0.02, -(hd+ov));

    // ── Rake boards — diagonal trim following the slope at each gable end ──
    // (No horizontal side eave fascia on a gable roof — gable ends have only rake boards)
    // Each rake board is a thin BoxGeometry rotated to match the pitch angle,
    // sitting proud of the gable face, running from eave to ridge on each slope.
    const rakeFD = 0.07;   // face depth (thickness)
    const rakeH  = 0.14;   // cross-section height
    // The rake runs from z=±(hd+ov) at eave height (roofY) to z=0 at ridge (roofY+rh).
    // Length along the slope surface:
    const rakeLen = slopeLen + 0.05;
    // Rotation matches the roof panel angle
    [-hw-ov, hw+ov].forEach(xPos => {
      // Front-facing slope rake (+Z half)
      const frRake = new THREE.Mesh(new THREE.BoxGeometry(rakeFD, rakeH, rakeLen), getFrameMat());
      frRake.position.set(xPos, roofY + rh/2, spanZ/2);
      frRake.rotation.x = angle;
      frRake.castShadow = true;
      frRake.userData.isRoof = true;
      roofGroup.add(frRake);
      // Back-facing slope rake (-Z half)
      const bkRake = new THREE.Mesh(new THREE.BoxGeometry(rakeFD, rakeH, rakeLen), getFrameMat());
      bkRake.position.set(xPos, roofY + rh/2, -spanZ/2);
      bkRake.rotation.x = -angle;
      bkRake.castShadow = true;
      bkRake.userData.isRoof = true;
      roofGroup.add(bkRake);
    });

  }

  // ── Guttering ──────────────────────────────────────────────────────────────
  buildGuttering(w, d, h, hw, hd, ov);
}

function buildGuttering(w, _d, h, hw, hd, ov) {
  gutMat.color.set(state.gutterColour ?? '#1a1a1a');  // update singleton colour

  // ── Gutter cross-section: U-channel made of 3 thin plates ───────────────────
  const tP  = 0.013;  // plate thickness
  const bkH = 0.085;  // back-plate height
  const chW = 0.110;  // channel width (depth outward from wall)
  const fpH = 0.045;  // front-lip height (lower than back = classic profile)

  // ── Square-section downpipe (65 mm, standard UK) ─────────────────────────────
  const dpS = 0.065;

  const fscD = 0.07;                       // fascia depth (must match buildRoof)
  const roofY       = 0.18 + h;
  const eaveEdge    = hd + ov;
  const fasciaFaceR = eaveEdge + fscD / 2; // Z of back-eave fascia outer face

  // Build the U-channel along the back eave only.
  // gutTopY = eave height where the roof slope meets the wall — gutter catches
  // water running straight off the slope.
  function gutterRun(gutTopY) {
    const span  = w + ov * 2 + 0.04;
    const faceZ = -fasciaFaceR;   // back eave is in the -Z direction

    // Back plate — flat against the fascia outer face
    const bk = new THREE.Mesh(new THREE.BoxGeometry(span, bkH, tP), gutMat);
    bk.position.set(0, gutTopY - bkH / 2, faceZ - tP / 2);
    bk.castShadow = true; bk.userData.isGutter = true; roofGroup.add(bk);

    // Bottom plate — horizontal, projects outward (-Z) from base of back plate
    const bt = new THREE.Mesh(new THREE.BoxGeometry(span, tP, chW), gutMat);
    bt.position.set(0, gutTopY - bkH - tP / 2, faceZ - tP - chW / 2);
    bt.castShadow = true; bt.userData.isGutter = true; roofGroup.add(bt);

    // Front lip — shorter upstand at the outer edge
    const fp = new THREE.Mesh(new THREE.BoxGeometry(span, fpH, tP), gutMat);
    fp.position.set(0, gutTopY - bkH + fpH / 2, faceZ - tP - chW + tP / 2);
    fp.castShadow = true; fp.userData.isGutter = true; roofGroup.add(fp);
  }

  // Single square-section downpipe at the right-hand back corner.
  function downpipe(gutTopY) {
    const dpZ = -(fasciaFaceR + dpS / 2);
    const botY = 0.18;
    const topY = gutTopY - bkH;
    const dpH  = Math.max(0.05, topY - botY);
    const m = new THREE.Mesh(new THREE.BoxGeometry(dpS, dpH, dpS), gutMat);
    m.position.set(hw, botY + dpH / 2, dpZ);
    m.castShadow = true; m.userData.isGutter = true; roofGroup.add(m);
  }

  if (state.roof === 'apex') {
    // Gutter top at eave height — water leaves the back slope and drops straight in.
    gutterRun(roofY);
    downpipe(roofY);

  } else if (state.roof === 'flat') {
    // Back eave is the low/drain end. Gutter top at that eave height.
    const tiltRad  = ((state.roofTilt || 0) * Math.PI) / 180;
    const tiltRise = Math.tan(tiltRad) * (hd + ov);
    const gutTopY  = roofY - tiltRise;
    gutterRun(gutTopY);
    downpipe(gutTopY);
  }
}

// ─── MAIN BUILD ────────────────────────────────────────────────────────────────

let _intFloorMesh = null; // tracked so rebuildFloor() can swap material without full rebuild

// Material cache — must be declared before _disposeBuildingGroup uses it
const _matCache = new Map();
function _cachedMat(key, factory) {
  if (!_matCache.has(key)) _matCache.set(key, factory());
  return _matCache.get(key);
}
function _invalidateMat(prefix) {
  for (const k of _matCache.keys()) { if (k.startsWith(prefix)) _matCache.delete(k); }
}

function _disposeBuildingGroup() {
  const cached = new Set(_matCache.values());
  buildingGroup.traverse(obj => {
    if (!obj.isMesh) return;
    if (obj.geometry) obj.geometry.dispose();
    if (obj.material) {
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      mats.forEach(m => {
        if (cached.has(m)) return; // never dispose cached materials
        ['map','normalMap','roughnessMap','metalnessMap','emissiveMap','aoMap'].forEach(slot => {
          if (m[slot]) m[slot].dispose();
        });
        m.dispose();
      });
    }
  });
}

function buildDecking(w, hd) {
  _disposeGroup(deckingGroup);
  if (!state.extras.decking || !(state.deckingArea > 0)) return;
  const da = state.deckingArea;
  const dw = Math.min(w * 1.5, Math.sqrt(da * (w / Math.max(w, 3)) * 2));
  const dd = da / dw;
  const deckCol = { softwood: 0x7a5210, hardwood: 0x5a3a10, composite: 0x6b6055 }[state.deckingMaterial] || 0x7a5210;
  const deckRough = { softwood: 0.82, hardwood: 0.78, composite: 0.65 }[state.deckingMaterial] ?? 0.82;
  const dMat = new THREE.MeshStandardMaterial({ color: deckCol, roughness: deckRough, metalness: 0.0 });
  const dBoardMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(deckCol).multiplyScalar(0.85), roughness: deckRough + 0.05, metalness: 0.0 });
  const dbox = (W, H, D, x, y, z, mat) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(W, H, D), mat);
    m.position.set(x, y, z); m.castShadow = true; deckingGroup.add(m); return m;
  };
  dbox(dw, 0.07, dd, 0, 0.18, hd + dd/2 + 0.02, dMat);
  const plankW = 0.12, gap = 0.02;
  for (let i = 0; i < Math.floor(dd / (plankW + gap)); i++) {
    dbox(dw, 0.015, plankW, 0, 0.22, hd + i * (plankW + gap) + plankW/2 + 0.04, dBoardMat);
  }
  const bType = state.deckingBalustrade;
  if (bType && bType !== 'none') {
    const postH = 0.9, railY = 0.18 + postH;
    const fMat = getFrameMat();
    const deckZ0 = hd + 0.02, deckZ1 = hd + dd + 0.02;
    const deckX0 = -dw/2, deckX1 = dw/2;
    const postPositions = [];
    for (let x = deckX0; x <= deckX1 + 0.01; x += Math.min(1.0, dw)) postPositions.push([x, deckZ1]);
    for (let z = deckZ0 + 1.0; z < deckZ1; z += 1.0) { postPositions.push([deckX0, z]); postPositions.push([deckX1, z]); }
    postPositions.forEach(([px, pz]) => dbox(0.05, postH, 0.05, px, 0.18 + postH/2, pz, fMat));
    dbox(dw, 0.04, 0.05, 0, railY, deckZ1, fMat);
    dbox(0.05, 0.04, dd, deckX0, railY, hd + dd/2 + 0.02, fMat);
    dbox(0.05, 0.04, dd, deckX1, railY, hd + dd/2 + 0.02, fMat);
    if (bType === 'glass' || bType === 'frameless') {
      const gMat = new THREE.MeshStandardMaterial({ color: 0xa8d8ea, transparent: true, opacity: 0.22, roughness: 0.05, metalness: 0.1, side: THREE.DoubleSide, depthWrite: false });
      dbox(dw, postH * 0.8, 0.01, 0, 0.18 + postH * 0.45, deckZ1, gMat);
      dbox(0.01, postH * 0.8, dd, deckX0, 0.18 + postH * 0.45, hd + dd/2 + 0.02, gMat);
      dbox(0.01, postH * 0.8, dd, deckX1, 0.18 + postH * 0.45, hd + dd/2 + 0.02, gMat);
    } else if (bType === 'picket') {
      for (let x = deckX0 + 0.1; x < deckX1; x += 0.1) dbox(0.025, postH * 0.75, 0.025, x, 0.18 + postH * 0.4, deckZ1, fMat);
      for (let z = deckZ0 + 0.1; z < deckZ1; z += 0.1) {
        dbox(0.025, postH * 0.75, 0.025, deckX0, 0.18 + postH * 0.4, z, fMat);
        dbox(0.025, postH * 0.75, 0.025, deckX1, 0.18 + postH * 0.4, z, fMat);
      }
    }
  }
}

function buildRoom() {
  const gen = ++_buildGen;   // any async GLB that captures this will bail if gen no longer matches
  markDirty(8);  // GLBs load async — keep rendering for a few frames
  _disposeBuildingGroup();
  while (buildingGroup.children.length) buildingGroup.remove(buildingGroup.children[0]);
  _disposeGroup(roofGroup);
  // Clear wall mesh registry so interior-view opacity is applied to fresh meshes.
  Object.keys(wallMeshes).forEach(k => { wallMeshes[k] = []; });
  cornerPostMeshes.length = 0;
  const w=state.width, d=state.depth, h=state.height, hw=w/2, hd=d/2;

  // Tighten shadow camera to the actual building footprint + small margin so the
  // full 2048px shadow map is concentrated on the building rather than empty ground.
  const shadowR = Math.max(w, d) / 2 + 5;
  sunLight.shadow.camera.left   = -shadowR;
  sunLight.shadow.camera.right  =  shadowR;
  sunLight.shadow.camera.top    =  shadowR;
  sunLight.shadow.camera.bottom = -shadowR;
  sunLight.shadow.camera.updateProjectionMatrix();

  // Scale the grass glow to always sit naturally around the current building size.
  const glowInner = Math.max(w, d) * 0.7 + 1.5;
  const glowOuter = glowInner + 10.0;   // keep within the 28m geometry radius
  grassGlowMat.uniforms.uInner.value = glowInner;
  grassGlowMat.uniforms.uOuter.value = glowOuter;

  box(w+0.3,0.12,d+0.3,0,0.06,0,slabMat); box(w,0.06,d,0,0.15,0,floorMat);

  // Interior floor surface — textured when a texture is loaded, otherwise solid colour
  const floorTexDef = FLOOR_TEXTURE_DEFS[state.interiorFloor];
  const floorTex    = floorTexDef ? _floorTexCache[state.interiorFloor] : null;
  let intFloorMat;
  if (floorTex) {
    // Update repeat to match current room size (1 texture tile = 1/tilesPerMeter metres)
    floorTex.repeat.set(w * floorTexDef.tilesPerMeter, d * floorTexDef.tilesPerMeter);
    floorTex.needsUpdate = true;
    intFloorMat = new THREE.MeshStandardMaterial({ map: floorTex, roughness: floorTexDef.roughness, metalness: 0.0 });
  } else {
    const intFloorCol = INTERIOR_FLOOR_COLORS[state.interiorFloor] ?? 0xc8a87a;
    const floorRoughMap = { oak:0.70, walnut:0.65, farm_oak:0.72, tiles:0.40, polished_concrete:0.30, gym_black:0.60, white_marble:0.25, rubber:0.85 };
    intFloorMat = _cachedMat(`intFloor_${state.interiorFloor}`, () =>
      new THREE.MeshStandardMaterial({ color: intFloorCol, roughness: floorRoughMap[state.interiorFloor] ?? 0.70, metalness: 0.0 })
    );
  }
  _intFloorMesh = box(w-0.02, 0.005, d-0.02, 0, 0.185, 0, intFloorMat);

  const wallOps = { front:[], back:[], left:[], right:[] };
  state.openings.forEach(op => wallOps[op.wall].push(opToDescriptor(op)));

  // Wall height variations by roof type
  let frontH = h, backH = h;
  if (state.roof === 'flat') {
    const flatTiltRad  = ((state.roofTilt||0)*Math.PI/180);
    const wallTiltRise = Math.tan(flatTiltRad) * hd;
    frontH = h + wallTiltRise;
    backH  = h - wallTiltRise;
  }

  buildWallFace('front', w, frontH, wallOps.front, hw, hd, gen);
  buildWallFace('back',  w, backH,  wallOps.back,  hw, hd, gen);

  // ── Side walls: single full-height polygon per side ──────────────────────────
  // For flat/tilted roof: trapezoid (slanted top edge matching tilt).
  // For apex roof: pentagon (rectangle + triangle to the ridge).
  // Vertices ordered CCW when viewed from outside (right-hand rule gives correct normal).
  // UV: U=0 at z=-hd (back), U=1 at z=+hd (front); V=1 at bottom, V=0 at top.
  ['left', 'right'].forEach(wallId => {
    const x = wallId === 'left' ? -hw : hw;
    if (state.roof === 'apex') {
      const rh = state.apexPitch ?? 1.0;
      const totalH = h + rh;
      // Pentagon: bottom-back → bottom-front → shoulder-front → apex → shoulder-back
      // CCW from outside for right wall; left wall is mirrored so same order works with DoubleSide
      const pts = [
        x, 0.18,         -hd,   // 0  bottom back
        x, 0.18,          hd,   // 1  bottom front
        x, 0.18 + h,      hd,   // 2  shoulder front
        x, 0.18 + totalH, 0,    // 3  apex
        x, 0.18 + h,     -hd,   // 4  shoulder back
      ];
      buildSideWallFull(wallId, pts, d, totalH, wallOps[wallId], hw, hd, gen);
    } else {
      // Flat / tilted roof: trapezoid
      const fH = frontH, bH = backH, maxH = Math.max(fH, bH);
      const pts = [
        x, 0.18,        -hd,   // 0  bottom back
        x, 0.18,         hd,   // 1  bottom front
        x, 0.18 + fH,    hd,   // 2  top front
        x, 0.18 + bH,   -hd,   // 3  top back
      ];
      buildSideWallFull(wallId, pts, d, maxH, wallOps[wallId], hw, hd, gen);
    }
  });

  // Corner posts — variable height per corner
  [
    { x: -hw, z: -hd, ph: backH,  walls: ['left',  'back']  },
    { x:  hw, z: -hd, ph: backH,  walls: ['right', 'back']  },
    { x: -hw, z:  hd, ph: frontH, walls: ['left',  'front'] },
    { x:  hw, z:  hd, ph: frontH, walls: ['right', 'front'] },
  ].forEach(({ x, z, ph, walls }) => {
    const m = box(0.1, ph, 0.1, x, 0.18 + ph / 2, z, getFrameMat());
    if (m) { m.userData.isCornerPost = walls; cornerPostMeshes.push({ mesh: m, walls }); }
  });

  buildRoof(w,d,h,hw,hd);
  buildDecking(w, hd);

  // Veranda / canopy — enabled when veranda qty > 0
  if ((state.roofPorchItems?.veranda ?? 0) > 0) {
    const vd = state.veranda.depth ?? 2.0;
    const verandaH = Math.min(frontH, backH);
    const vRoofY = 0.18 + verandaH - 0.05; // slightly below eave
    const vMat = getFrameMat();

    // Posts at front corners
    box(0.1, verandaH, 0.1, -hw, 0.18 + verandaH/2, hd + vd, vMat);
    box(0.1, verandaH, 0.1,  hw, 0.18 + verandaH/2, hd + vd, vMat);
    // Intermediate posts every ~2m
    const postSpacing = 2.0;
    for (let x = -hw + postSpacing; x < hw - 0.1; x += postSpacing) {
      box(0.1, verandaH, 0.1, x, 0.18 + verandaH/2, hd + vd, vMat);
    }
    // Front beam
    box(w + 0.2, 0.12, 0.12, 0, vRoofY + 0.06, hd + vd, vMat);
    // Side beams
    box(0.1, 0.12, vd, -hw, vRoofY + 0.06, hd + vd/2, vMat);
    box(0.1, 0.12, vd,  hw, vRoofY + 0.06, hd + vd/2, vMat);
    // Roof panel (slight downward tilt for drainage)
    const vRoofMat = makeRoofMat(w + 0.4, vd + 0.3);
    const vrp = new THREE.Mesh(new THREE.BoxGeometry(w + 0.4, 0.06, vd + 0.3), vRoofMat);
    vrp.position.set(0, vRoofY + 0.12, hd + vd/2);
    vrp.rotation.x = 0.03; // slight tilt for drainage
    vrp.castShadow = true;
    vrp.userData.isRoof = true;
    roofGroup.add(vrp);
  }

  rebuildHandles();
  rebuildWallArrows();
  rebuildEdgeHandles();
  buildPartitions();
  buildPresetRooms();
  buildFurniture();
  buildElectrics();
  if (interiorViewMode) applyInteriorView();
  if (floorplanViewMode) {
    [buildingGroup, roofGroup].forEach(grp => grp.traverse(child => {
      if (child.isMesh && child.userData.isRoof) {
        child.userData._fpSavedVis = child.visible;
        child.visible = false;
      }
    }));
    skyDome.visible = false;
  }
}

// ─── PARTIAL REBUILD FAST PATHS ─────────────────────────────────────────────────
// These bypass the full buildRoom() for changes that only affect materials, not geometry.

function rebuildFloor() {
  if (!_intFloorMesh) return;
  const w = state.width, d = state.depth;
  const floorTexDef = FLOOR_TEXTURE_DEFS[state.interiorFloor];
  const floorTex    = floorTexDef ? _floorTexCache[state.interiorFloor] : null;
  if (floorTex) {
    floorTex.repeat.set(w * floorTexDef.tilesPerMeter, d * floorTexDef.tilesPerMeter);
    floorTex.needsUpdate = true;
    _intFloorMesh.material = new THREE.MeshStandardMaterial({ map: floorTex, roughness: floorTexDef.roughness, metalness: 0.0 });
  } else {
    const col = INTERIOR_FLOOR_COLORS[state.interiorFloor] ?? 0xc8a87a;
    const roughMap = { oak:0.70, walnut:0.65, farm_oak:0.72, tiles:0.40, polished_concrete:0.30, gym_black:0.60, white_marble:0.25, rubber:0.85 };
    _intFloorMesh.material = new THREE.MeshStandardMaterial({ color: col, roughness: roughMap[state.interiorFloor] ?? 0.70, metalness: 0.0 });
  }
  markDirty();
}

function rebuildCladdingMats() {
  buildingGroup.traverse(obj => {
    if (!obj.isMesh) return;
    const cp = obj.userData.claddingPanel;
    if (cp) {
      const texInfo = makeWallTexInfo(cp.wallId);
      obj.material = makePanelMat(texInfo, cp.panelW, cp.panelH, cp.panelX0, cp.panelY0);
      return;
    }
    const cs = obj.userData.claddingSide;
    if (cs) {
      const cfg = makeWallTexInfo(cs.wallId);
      const mat = makeTiledMat({ ...cfg, worldW: cs.worldW, worldH: cs.worldH, tint: state.claddingTint });
      mat.side = THREE.DoubleSide;
      obj.material = mat;
    }
  });
  markDirty();
}

function rebuildInteriorMats() {
  const newMat = makeIwMat(state.interiorWalls);
  newMat.side = THREE.DoubleSide;
  // Update exterior wall interior face meshes in-place
  ['front', 'back', 'left', 'right'].forEach(wid => {
    wallMeshes[wid].forEach(m => { if (m.userData.isInterior) m.material = newMat; });
  });
  // Partitions and preset rooms have their own geometry per wall finish — rebuild those subsystems only
  buildPartitions();
  buildPresetRooms();
  markDirty();
}

// ─── INTERIOR VIEW MODE ─────────────────────────────────────────────────────────

let interiorViewMode = false;

function toggleInteriorView() {
  interiorViewMode = !interiorViewMode;
  const btn = document.getElementById('tbInterior');
  if (btn) btn.classList.toggle('active', interiorViewMode);
  if (interiorViewMode) {
    applyInteriorView();
  } else {
    restoreExteriorView();
  }
}

function applyInteriorView() {
  [buildingGroup, roofGroup].forEach(grp => grp.traverse(child => {
    if (child.isMesh && (child.userData.isRoof || child.userData.isGutter)) child.visible = false;
  }));
  // Wider FOV feels more natural inside a room — avoids the compressed
  // telephoto look and makes the space feel correctly proportioned.
  camera.fov = 20;
  camera.updateProjectionMatrix();
  updateWallVisibility();
  markDirty(2);
}

function restoreExteriorView() {
  // Reset cache so next interior view entry re-applies all ghost states cleanly
  for (const k of Object.keys(_prevGhosted)) _prevGhosted[k] = null;
  [buildingGroup, roofGroup].forEach(grp => grp.traverse(child => {
    if (child.isMesh && (child.userData.isRoof || child.userData.isGutter)) child.visible = true;
  }));
  for (const meshes of Object.values(wallMeshes)) {
    for (const m of meshes) {
      if (!m.isMesh || !m.material) continue;
      m.material.transparent = false;
      m.material.opacity = 1.0;
      m.material.needsUpdate = true;
    }
  }
  for (const { mesh } of cornerPostMeshes) {
    mesh.material.transparent = false;
    mesh.material.opacity = 1.0;
    mesh.material.needsUpdate = true;
  }
  // Restore the default telephoto FOV used for exterior presentation.
  camera.fov = 20;
  camera.updateProjectionMatrix();
  markDirty(2);
}

// Called every render frame while in interior view.
// Walls whose outward normal points toward the camera are hidden (cutaway);
// walls facing away remain visible so the room structure is clear.
const GHOST_OPACITY = 0.12;
// Cache last ghosted state so we only touch materials when something changes,
// preventing needsUpdate from triggering shader recompilation every frame.
const _prevGhosted = { front: null, back: null, left: null, right: null };

function _applyGhost(mat, g) {
  if (!mat) return;
  mat.transparent = g;
  mat.opacity = g ? GHOST_OPACITY : 1.0;
  mat.needsUpdate = true;
}

function updateWallVisibility() {
  const hw = state.width / 2;
  const hd = state.depth / 2;
  const WALL_OFFSETS = {
    front:  new THREE.Vector3(0,   0,  hd),
    back:   new THREE.Vector3(0,   0, -hd),
    left:   new THREE.Vector3(-hw, 0,  0),
    right:  new THREE.Vector3(hw,  0,  0),
  };

  // Determine which walls face the camera (should be ghosted)
  const ghosted = {};
  for (const wallId of Object.keys(WALL_OFFSETS)) {
    const camRelative = camera.position.clone().sub(WALL_OFFSETS[wallId]);
    ghosted[wallId] = WALL_NORMALS[wallId].dot(camRelative) > 0;
  }

  // Detect which walls changed, update wall meshes, then commit state
  const changed = {};
  for (const wallId of Object.keys(ghosted)) {
    changed[wallId] = ghosted[wallId] !== _prevGhosted[wallId];
  }

  for (const [wallId, meshes] of Object.entries(wallMeshes)) {
    if (!changed[wallId]) continue;
    for (const m of meshes) {
      if (m.isMesh) {
        _applyGhost(m.material, ghosted[wallId]);
      }
      // GLB groups (doors/windows) are intentionally left opaque
    }
  }

  // Corner posts — ghost when either adjacent wall is ghosted
  for (const { mesh, walls } of cornerPostMeshes) {
    if (!walls.some(w => changed[w])) continue;
    _applyGhost(mesh.material, walls.some(w => ghosted[w]));
  }

  for (const wallId of Object.keys(ghosted)) _prevGhosted[wallId] = ghosted[wallId];
}

// ─── HANDLES ───────────────────────────────────────────────────────────────────

const HANDLE_PROXIMITY = 90;  // px proximity threshold for handle fade-in

function rebuildHandles() {
  while (handlesGroup.children.length) handlesGroup.remove(handlesGroup.children[0]);
  const hw=state.width/2, hd=state.depth/2;
  state.openings.forEach(op => {
    const desc = opToDescriptor(op);
    const wc   = localToWorld(op.wall, desc.localCx, desc.localCy, hw, hd);
    const color = op.type==='door' ? HANDLE_DOOR_COLOR : HANDLE_WIN_COLOR;
    const mat = new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0, depthTest: false, side: THREE.DoubleSide
    });
    // Rectangular face matching the opening dimensions
    const geo = op.wall === 'left' || op.wall === 'right'
      ? (() => { const g = new THREE.PlaneGeometry(desc.h, desc.w); g.rotateZ(Math.PI/2); g.rotateY(Math.PI/2); return g; })()
      : new THREE.PlaneGeometry(desc.w, desc.h);
    const handle = new THREE.Mesh(geo, mat);
    handle.userData = { openingId: op.id, baseColor: color };
    const proud = 0.06;
    handle.position.set(wc.x, wc.y, wc.z);
    switch(op.wall){
      case 'front': handle.position.z += proud; break;
      case 'back':  handle.position.z -= proud; break;
      case 'left':  handle.position.x -= proud; break;
      case 'right': handle.position.x += proud; break;
    }
    handlesGroup.add(handle);
  });
  refreshHandleColors();
}

function updateHandleVisibility(mouseX, mouseY) {
  const vp = document.querySelector('.viewport');
  if (!vp) return;
  const vr = vp.getBoundingClientRect();
  handlesGroup.children.forEach(handle => {
    const id = handle.userData.openingId;
    const op = state.openings.find(o => o.id === id);
    // Never show handles on walls the camera can't see
    if (op && !wallFacesCamera(op.wall)) { handle.material.opacity = 0; return; }
    if (id === selectedHandleId) { handle.material.opacity = 0.55; markDirty(); return; }
    const v = handle.position.clone().project(camera);
    if (v.z >= 1) { handle.material.opacity = 0; return; }
    const sx = (v.x * 0.5 + 0.5) * vr.width;
    const sy = (-v.y * 0.5 + 0.5) * vr.height;
    const ddx = mouseX - vr.left - sx;
    const ddy = mouseY - vr.top  - sy;
    const dist = Math.sqrt(ddx * ddx + ddy * ddy);
    const target = dist < HANDLE_PROXIMITY ? Math.max(0.08, 0.55 * (1 - dist / HANDLE_PROXIMITY)) : 0;
    handle.material.opacity += (target - handle.material.opacity) * 0.25;
    if (Math.abs(target - handle.material.opacity) > 0.005) markDirty();
  });
}

// ─── WALL DIMENSION ARROWS (architectural style) ──────────────────────────────

function ensureWallLabels() {
  if (wallLabels.width) return;
  const vp = document.querySelector('.viewport');
  if (!vp) return;
  ['width','depth','height'].forEach(dim => {
    const d = document.createElement('div');
    d.style.cssText = [
      'position:absolute', 'pointer-events:none',
      'color:#fff',
      'font-size:11px',
      'font-weight:500',
      'font-family:DM Sans,sans-serif',
      'white-space:nowrap',
      'letter-spacing:0.06em',
      'text-shadow:0 1px 4px rgba(0,0,0,1),0 0 8px rgba(0,0,0,0.8)',
      'display:none',
    ].join(';');
    vp.appendChild(d);
    wallLabels[dim] = d;
  });
}

// ── GROUND DIMENSION INDICATORS ──────────────────────────────────────────────
// Flat 2D arrows painted on the ground plane. Cosmetic only — no interaction.

const DIM_MAT = new THREE.MeshBasicMaterial({
  color: 0x1565c0, transparent: true, opacity: 0.82,
  side: THREE.DoubleSide, depthTest: true,
});

/**
 * Build a flat ground-plane dimension indicator for a span of `length` metres.
 * The indicator sits along the local +X axis, centred at the origin, at Y = yGnd.
 * It consists of:
 *   • A thin centre line the full span
 *   • Two filled arrowheads pointing inward at each end
 *   • Two short perpendicular end-caps
 */
function makeDimIndicator(length) {
  const g = new THREE.Group();
  const half  = length / 2;
  const lineW = 0.04;       // line thickness
  const capH  = 0.35;       // end-cap perpendicular height
  const arrowL = 0.45;      // arrowhead length (along main axis)
  const arrowW = 0.22;      // arrowhead width (perpendicular)
  const yGnd  = 0.012;      // just above the grass glow (y=0.003)

  // ── Centre line (minus arrowhead zones) ──
  const innerLen = Math.max(0.01, length - arrowL * 2);
  const lineGeo = new THREE.PlaneGeometry(innerLen, lineW);
  lineGeo.rotateX(-Math.PI / 2);
  const line = new THREE.Mesh(lineGeo, DIM_MAT);
  line.position.y = yGnd;
  g.add(line);

  // ── Arrowheads — filled triangles pointing inward ──
  // Left arrowhead points in +X direction (toward centre), right points in -X
  [{ side: -1, dir: 1 }, { side: 1, dir: -1 }].forEach(({ side, dir }) => {
    const tip   = side * half;                   // tip of arrow (at wall end)
    const base  = tip + dir * arrowL;            // base of arrow (toward centre)
    const verts = new Float32Array([
      tip,  yGnd,  0,                            // tip
      base, yGnd, -arrowW / 2,                   // base left
      base, yGnd,  arrowW / 2,                   // base right
    ]);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
    // One triangle: winding such that normal = +Y (visible from above)
    geo.setIndex(side < 0 ? [0, 2, 1] : [0, 1, 2]);
    geo.computeVertexNormals();
    g.add(new THREE.Mesh(geo, DIM_MAT));
  });

  // ── End caps (perpendicular ticks at each wall) ──
  [-half, half].forEach(x => {
    const capGeo = new THREE.PlaneGeometry(lineW, capH);
    capGeo.rotateX(-Math.PI / 2);
    const cap = new THREE.Mesh(capGeo, DIM_MAT);
    cap.position.set(x, yGnd, 0);
    g.add(cap);
  });

  return g;
}

/**
 * Build a vertical dimension indicator (standing upright along Y).
 * Used for the building height annotation on the left-front edge.
 */
function makeDimIndicatorV(length) {
  const g    = new THREE.Group();
  const lw   = 0.04;
  const capW = 0.35;
  const arrH = 0.45;
  const arrW = 0.22;
  const half = length / 2;

  // Centre shaft
  const shaftGeo = new THREE.BoxGeometry(lw, Math.max(0.01, length - arrH * 2), lw);
  g.add(new THREE.Mesh(shaftGeo, DIM_MAT));

  // Arrowheads — triangles in XY plane, pointing inward
  [{ side: -1, dir: 1 }, { side: 1, dir: -1 }].forEach(({ side, dir }) => {
    const tip  = side * half;
    const base = tip + dir * arrH;
    const verts = new Float32Array([
       0,         tip,  0,
      -arrW / 2,  base, 0,
       arrW / 2,  base, 0,
    ]);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
    geo.setIndex(side < 0 ? [0, 1, 2] : [0, 2, 1]);
    geo.computeVertexNormals();
    const mat = DIM_MAT.clone();
    mat.side = THREE.DoubleSide;
    g.add(new THREE.Mesh(geo, mat));
  });

  // Horizontal end-caps
  [-half, half].forEach(y => {
    const cap = new THREE.Mesh(new THREE.BoxGeometry(capW, lw, lw), DIM_MAT);
    cap.position.y = y;
    g.add(cap);
  });

  return g;
}

function rebuildWallArrows() {
  while (wallArrowGroup.children.length) wallArrowGroup.remove(wallArrowGroup.children[0]);
  ensureWallLabels();
  const hw = state.width / 2, hd = state.depth / 2;
  const off = 1.1;   // distance from wall face to indicator centre line

  // ── Width indicators — front (+Z) and back (-Z) ──
  const wFront = makeDimIndicator(state.width);
  wFront.position.set(0, 0, hd + off);
  wallArrowGroup.add(wFront);

  const wBack = makeDimIndicator(state.width);
  wBack.position.set(0, 0, -(hd + off));
  wallArrowGroup.add(wBack);

  // ── Depth indicators — right (+X) and left (-X) ──
  const dRight = makeDimIndicator(state.depth);
  dRight.rotation.y = Math.PI / 2;
  dRight.position.set(hw + off, 0, 0);
  wallArrowGroup.add(dRight);

  const dLeft = makeDimIndicator(state.depth);
  dLeft.rotation.y = Math.PI / 2;
  dLeft.position.set(-(hw + off), 0, 0);
  wallArrowGroup.add(dLeft);

  // ── Height indicator — left-front corner ──
  const wallH = state.height;
  const hInd = makeDimIndicatorV(wallH);
  hInd.position.set(-(hw + off), 0.18 + wallH / 2, hd);
  wallArrowGroup.add(hInd);
}

// ─── FURNITURE ───────────────────────────────────────────────────────────────

const FURNITURE_CATALOG = {
  // ── Living ──────────────────────────────────────────────────────────────────
  sofa_2:        { label: 'Sofa (2-seat)',    w: 1.56, d: 0.84, h: 0.64, color: 0x6B7B8D, category: 'Living',  model: 'assets/white_couch.glb'    },
  sofa_3:        { label: 'Sofa (3-seat)',    w: 1.85, d: 0.90, h: 0.64, color: 0x6B7B8D, category: 'Living',  model: 'assets/couch4.glb'         },
  sofa_4:        { label: 'Sofa (large)',     w: 2.10, d: 0.92, h: 0.68, color: 0x6B7B8D, category: 'Living',  model: 'assets/couch3.glb'         },
  chaise_lounge: { label: 'Chaise Lounge',    w: 1.80, d: 0.80, h: 0.62, color: 0x7B8D9A, category: 'Living',  model: 'assets/chouch2.glb'        },
  corner_sofa:   { label: 'Corner Sofa',      w: 3.24, d: 2.56, h: 0.62, color: 0x6B7B8D, category: 'Living',  model: 'assets/corner_sofa.glb'    },
  armchair:      { label: 'Armchair',         w: 0.92, d: 0.90, h: 0.62, color: 0x7B8D9A, category: 'Living',  model: 'assets/grey_armchair.glb'  },
  armchair_2:    { label: 'Armchair (2)',     w: 0.88, d: 0.85, h: 0.65, color: 0x8B7A6A, category: 'Living',  model: 'assets/armchair3.glb'      },
  armchair_3:    { label: 'Armchair (3)',     w: 0.88, d: 0.85, h: 0.65, color: 0xCC7733, category: 'Living',  model: 'assets/armchair4.glb'      },
  armchair_orange:{ label: 'Armchair (Orange)',w: 0.86, d: 0.84, h: 0.68, color: 0xDD6622, category: 'Living', model: 'assets/orange_armchair.glb' },
  coffee_table:  { label: 'Coffee Table',     w: 1.28, d: 1.28, h: 0.59, color: 0x8B6234, category: 'Living',  model: 'assets/circular_table.glb' },
  tv_unit:       { label: 'TV Unit',          w: 1.31, d: 0.35, h: 0.59, color: 0x222222, category: 'Living',  model: 'assets/tv_unit.glb',        wallHug: true },
  bench:         { label: 'Bench',            w: 1.57, d: 0.68, h: 0.88, color: 0x8B6914, category: 'Living',  model: 'assets/bench.glb'          },
  poof:          { label: 'Poof / Ottoman',   w: 0.35, d: 0.35, h: 0.34, color: 0x7B8D9A, category: 'Living',  model: 'assets/poof.glb'           },
  // ── Dining ──────────────────────────────────────────────────────────────────
  dining_table:  { label: 'Dining Table',     w: 1.45, d: 0.84, h: 0.60, color: 0x8B6914, category: 'Dining', model: 'assets/table.glb'          },
  dining_chair:  { label: 'Dining Chair',     w: 0.40, d: 0.46, h: 0.75, color: 0x555544, category: 'Dining', model: 'assets/dining_chair.glb'   },
  dining_chair_2:{ label: 'Dining Chair (2)', w: 0.42, d: 0.48, h: 0.82, color: 0x4A4A3A, category: 'Dining', model: 'assets/dining_chair2.glb'  },
  stool:         { label: 'Stool',            w: 0.34, d: 0.34, h: 0.35, color: 0x8B6914, category: 'Dining', model: 'assets/stool.glb'          },
  stool_fancy:   { label: 'Bar Stool',        w: 0.34, d: 0.34, h: 0.75, color: 0x8B6914, category: 'Dining', model: 'assets/stool_fancy.glb'    },
  // ── Office ──────────────────────────────────────────────────────────────────
  desk:          { label: 'Desk',             w: 1.33, d: 0.56, h: 1.02, color: 0xC8A878, category: 'Office', model: 'assets/computer_desk.glb',  wallHug: true },
  desk_2:        { label: 'Desk (2)',         w: 1.20, d: 0.60, h: 0.75, color: 0xC8A878, category: 'Office', model: 'assets/desk2.glb',          wallHug: true },
  desk_3:        { label: 'Desk (3)',         w: 1.40, d: 0.65, h: 0.78, color: 0xD4B896, category: 'Office', model: 'assets/desk3.glb',          wallHug: true },
  desk_large:    { label: 'Desk (large)',     w: 1.60, d: 0.70, h: 0.76, color: 0xB8966A, category: 'Office', model: 'assets/Desk.glb',           wallHug: true },
  desk_old:      { label: 'Antique Desk',     w: 1.30, d: 0.65, h: 0.78, color: 0x7A5030, category: 'Office', model: 'assets/old_desk.glb',       wallHug: true },
  office_chair:  { label: 'Office Chair',     w: 0.51, d: 0.60, h: 0.99, color: 0x333333, category: 'Office', model: 'assets/office_chair.glb'   },
  office_chair_2:{ label: 'Office Chair (2)', w: 0.54, d: 0.60, h: 1.02, color: 0x222222, category: 'Office', model: 'assets/officechair2.glb'   },
  bookshelf:     { label: 'Bookshelf',        w: 0.76, d: 0.37, h: 1.40, color: 0x7B5E3A, category: 'Office', model: 'assets/shelf_unit.glb',     wallHug: true },
  water_cooler:  { label: 'Water Cooler',     w: 0.26, d: 0.26, h: 1.03, color: 0xCCDDEE, category: 'Office', model: 'assets/watercooler.glb'    },
  // ── Bedroom ─────────────────────────────────────────────────────────────────
  single_bed:    { label: 'Single Bed',       w: 0.90, d: 1.79, h: 0.50, color: 0xDDCCBB, category: 'Bedroom', model: 'assets/bed_single.glb'                },
  double_bed:    { label: 'Double Bed',       w: 1.26, d: 1.50, h: 0.61, color: 0xDDCCBB, category: 'Bedroom', model: 'assets/bed_double.glb'                },
  queen_bed:     { label: 'Queen Bed',        w: 2.44, d: 1.83, h: 0.72, color: 0xDDCCBB, category: 'Bedroom', model: 'assets/bed_queen.glb'                 },
  bunk_bed:      { label: 'Bunk Bed',         w: 1.38, d: 0.82, h: 1.29, color: 0xDDCCBB, category: 'Bedroom', model: 'assets/bed_bunk.glb'                  },
  wardrobe:      { label: 'Wardrobe',         w: 1.76, d: 0.39, h: 1.78, color: 0xA0936A, category: 'Bedroom', model: 'assets/cabinet_fancy.glb',  wallHug: true },
  cabinet_brown: { label: 'Cabinet (Brown)',  w: 1.00, d: 0.40, h: 0.75, color: 0x7A5030, category: 'Bedroom', model: 'assets/cabinet_brown.glb',  wallHug: true },
  cabinet_white: { label: 'Cabinet (White)',  w: 1.00, d: 0.40, h: 0.75, color: 0xEEEEEE, category: 'Bedroom', model: 'assets/cabinet_white.glb',  wallHug: true },
  corner_cabinet:{ label: 'Corner Cabinet',   w: 0.90, d: 0.90, h: 1.80, color: 0x8A7050, category: 'Bedroom', model: 'assets/corner_cabinet.glb', wallHug: true },
  bedside:       { label: 'Bedside Table',    w: 0.46, d: 0.45, h: 0.40, color: 0x8B6914, category: 'Bedroom', model: 'assets/side_table.glb'                },
  // ── Bathroom ────────────────────────────────────────────────────────────────
  toilet:        { label: 'Toilet',           w: 0.35, d: 0.60, h: 0.68, color: 0xF2F0EE, category: 'Bathroom', model: 'assets/toilet.glb',            wallHug: true, modelRotY: Math.PI / 2 },
  bathtub:       { label: 'Bathtub',          w: 1.96, d: 0.93, h: 0.65, color: 0xF2F0EE, category: 'Bathroom', model: 'assets/bathtub.glb',           wallHug: true },
  shower:        { label: 'Shower',           w: 0.99, d: 1.06, h: 2.00, color: 0xDDEEFF, category: 'Bathroom', model: 'assets/shower.glb',            wallHug: true, modelScale: 0.004910 },
  basin:         { label: 'Basin',            w: 0.65, d: 0.64, h: 0.85, color: 0xF2F0EE, category: 'Bathroom', model: 'assets/wash_basin_stand.glb',  wallHug: true, modelScale: 0.001350 },
  // ── Entertainment ───────────────────────────────────────────────────────────
  pool_table:    { label: 'Pool Table',       w: 1.99, d: 1.17, h: 0.55, color: 0x2A6A2A, category: 'Entertainment', model: 'assets/pool_table.glb'     },
  grand_piano:   { label: 'Grand Piano',      w: 1.40, d: 2.09, h: 1.45, color: 0x111111, category: 'Entertainment', model: 'assets/grand_piano.glb'    },
  arcade_machine:{ label: 'Arcade Machine',   w: 0.70, d: 0.75, h: 1.78, color: 0x222244, category: 'Entertainment', model: 'assets/arcade_machine.glb' },
  speaker:       { label: 'Speaker',          w: 0.27, d: 0.30, h: 0.44, color: 0x222222, category: 'Entertainment', model: 'assets/speaker.glb'        },
  // ── Kitchen / Utility ───────────────────────────────────────────────────────
  fridge:         { label: 'Fridge',          w: 0.58, d: 0.60, h: 1.61, color: 0xDDDDDD, category: 'Utility', model: 'assets/fridge.glb',         wallHug: true },
  oven:           { label: 'Oven',            w: 0.52, d: 0.56, h: 0.66, color: 0x888888, category: 'Utility', model: 'assets/oven.glb',            wallHug: true },
  microwave:      { label: 'Microwave',       w: 0.43, d: 0.34, h: 0.22, color: 0x888888, category: 'Utility', model: 'assets/microwave.glb',       wallHug: true },
  washing_machine:{ label: 'Washing Machine', w: 0.50, d: 0.44, h: 0.72, color: 0xDDDDDD, category: 'Utility', model: 'assets/washingmachine.glb',  wallHug: true },
  radiator:       { label: 'Radiator',        w: 1.42, d: 0.18, h: 0.87, color: 0xDDDDDD, category: 'Utility', model: 'assets/bedroom_heater_radiator.glb', wallHug: true },
  // ── Misc ────────────────────────────────────────────────────────────────────
  ironing_board: { label: 'Ironing Board',    w: 1.20, d: 0.38, h: 0.90, color: 0xDDDDCC, category: 'Misc', model: 'assets/ironing_board.glb' },
  bin:           { label: 'Bin',              w: 0.28, d: 0.28, h: 0.55, color: 0x888888, category: 'Misc', model: 'assets/little_bin.glb'    },
  plant:         { label: 'Plant',            w: 0.57, d: 0.69, h: 1.36, color: 0x3A7A3A, category: 'Misc', model: 'assets/plant.glb'         },
  table_lamp:    { label: 'Table Lamp',       w: 0.52, d: 0.52, h: 1.51, color: 0xDDCC88, category: 'Misc', model: 'assets/table_lamp.glb'    },
  floor_lamp:    { label: 'Floor Lamp',       w: 0.59, d: 0.57, h: 1.55, color: 0xDDCC88, category: 'Misc', model: 'assets/tall_lamp.glb'     },
  easel:         { label: 'Easel / Canvas',   w: 0.96, d: 0.57, h: 2.30, color: 0xC8A878, category: 'Misc', model: 'assets/easel_canvas.glb'  },
  rug:           { label: 'Rug',              w: 1.50, d: 2.00, h: 0.02, color: 0xAA8855, category: 'Misc'                                    },
};

// ─── ELECTRICS CATALOG ───────────────────────────────────────────────────────
// mountHeight = default Y height of the centre of the backplate from floor level.
// w/h = face dimensions; d = protrusion from wall (kept very thin).
const ELECTRICS_CATALOG = {
  double_socket_3d:  { label: 'Double Socket',    w: 0.145, h: 0.085, d: 0.035, mountHeight: 0.30, color: 0xF5F5F0 },
  single_socket_3d:  { label: 'Single Socket',    w: 0.086, h: 0.086, d: 0.035, mountHeight: 0.30, color: 0xF5F5F0 },
  usb_socket_3d:     { label: 'USB Socket',        w: 0.086, h: 0.086, d: 0.035, mountHeight: 0.30, color: 0xF5F5F0 },
  light_switch_3d:   { label: 'Light Switch',      w: 0.086, h: 0.086, d: 0.035, mountHeight: 1.00, color: 0xF5F5F0 },
  double_switch_3d:  { label: 'Double Switch',     w: 0.145, h: 0.086, d: 0.035, mountHeight: 1.00, color: 0xF5F5F0 },
  dimmer_3d:         { label: 'Dimmer Switch',     w: 0.086, h: 0.086, d: 0.035, mountHeight: 1.00, color: 0xF5F5F0 },
  consumer_box_3d:   { label: 'Consumer Unit',     w: 0.25,  h: 0.35,  d: 0.10,  mountHeight: 1.30, color: 0xE0E0E0 },
  spotlight_3d:      { label: 'Spotlight (ceil.)', w: 0.10,  h: 0.10,  d: 0.05,  mountHeight: -1,   color: 0xDDDDCC }, // -1 = ceiling-mounted
  extractor_fan_3d:  { label: 'Extractor Fan',     w: 0.20,  h: 0.20,  d: 0.10,  mountHeight: -1,   color: 0xDDDDDD }, // -1 = ceiling-mounted
  tv_point_3d:       { label: 'TV Point',          w: 0.086, h: 0.086, d: 0.035, mountHeight: 0.45, color: 0xF5F5F0 },
};

const furnitureMeshes = [];
const furnitureGroups = {};   // id → THREE.Group, for __preset__ furniture
let furnitureDragState = null;        // { id, groundAnchor }
let electricDragState  = null;        // { id }

// Maps ELECTRICS_CATALOG key → electricalItems state key (for pricing sync)
const ELECTRIC_PRICING_KEY = {
  double_socket_3d:  'double_socket',
  single_socket_3d:  'single_socket',
  usb_socket_3d:     'usb_socket',
  light_switch_3d:   'light_switch',
  double_switch_3d:  'double_light_switch',
  dimmer_3d:         'dimmer_switch',
  consumer_box_3d:   'consumer_box',
  spotlight_3d:      'ceiling_light',
  extractor_fan_3d:  'extractor_fan',
  tv_point_3d:       'tv_socket',
};

// Collect every snappable wall face in world space as { perpAxis:'x'|'z', pos }.
// Includes exterior walls, partition walls, and preset room boundary walls.
function _gatherWallFaces() {
  const hw = state.width / 2, hd = state.depth / 2;
  const faces = [
    { perpAxis: 'x', pos: -hw }, { perpAxis: 'x', pos:  hw },
    { perpAxis: 'z', pos: -hd }, { perpAxis: 'z', pos:  hd },
  ];
  state.partitions.forEach(p => {
    // p.axis = axis wall runs ALONG; perpAxis is perpendicular
    faces.push({ perpAxis: p.axis === 'x' ? 'z' : 'x', pos: p.pos });
  });
  state.presetRooms.forEach(r => {
    const frame = _prFrame(r);
    if (!frame) return;
    const { alongAxis, wallPos, depthSign } = frame;
    const innerCoord = wallPos + depthSign * r.depth;
    if (alongAxis === 'x') {
      faces.push({ perpAxis: 'z', pos: innerCoord });                  // inner wall
      faces.push({ perpAxis: 'x', pos: r.offset - r.width / 2 });     // left side
      faces.push({ perpAxis: 'x', pos: r.offset + r.width / 2 });     // right side
    } else {
      faces.push({ perpAxis: 'x', pos: innerCoord });                  // inner wall
      faces.push({ perpAxis: 'z', pos: r.offset - r.width / 2 });     // left side
      faces.push({ perpAxis: 'z', pos: r.offset + r.width / 2 });     // right side
    }
  });
  return faces;
}

// Snap piece to the nearest wall face, returning { x, z, rotY }.
// The cursor position (px, pz) determines which wall is nearest and which side to face.
// fw = piece width (X extent at rotY=0), fd = piece depth (Z extent at rotY=0).
// hw/hd = room half-extents used for lateral boundary clamping.
function _snapToNearestWallFace(px, pz, fw, fd, wallFaces, hw, hd) {
  const M = 0.02;
  let nearestDist = Infinity, nearest = null;
  wallFaces.forEach(w => {
    const dist = w.perpAxis === 'x' ? Math.abs(px - w.pos) : Math.abs(pz - w.pos);
    if (dist < nearestDist) { nearestDist = dist; nearest = w; }
  });
  if (nearest.perpAxis === 'x') {
    const onRight = px >= nearest.pos;
    return {
      x: onRight ? nearest.pos + fd/2 + M : nearest.pos - fd/2 - M,
      z: Math.max(-hd + fw/2 + M, Math.min(hd - fw/2 - M, pz)),
      rotY: onRight ? Math.PI / 2 : -Math.PI / 2,
    };
  } else {
    const onFront = pz >= nearest.pos;
    return {
      x: Math.max(-hw + fw/2 + M, Math.min(hw - fw/2 - M, px)),
      z: onFront ? nearest.pos + fd/2 + M : nearest.pos - fd/2 - M,
      rotY: onFront ? 0 : Math.PI,
    };
  }
}

// Rectangular snap for use inside a preset room's local space (4 walls only).
function _wallHugSnapLocal(px, pz, fw, fd, hw, hd) {
  const faces = [
    { perpAxis: 'x', pos: -hw }, { perpAxis: 'x', pos: hw },
    { perpAxis: 'z', pos: -hd }, { perpAxis: 'z', pos: hd },
  ];
  return _snapToNearestWallFace(px, pz, fw, fd, faces, hw, hd);
}

// ─── Furniture hover state ────────────────────────────────────────────────────
let _hoveredFurnitureId = null;
let _hoverBoxHelper = null;
const _hoverMaterialBackups = [];   // [{mesh, mat}]

function _setFurnitureHover(fid) {
  if (fid === _hoveredFurnitureId) return;
  // Restore originals
  _hoverMaterialBackups.forEach(({ mesh, mat }) => { mesh.material = mat; });
  _hoverMaterialBackups.length = 0;
  if (_hoverBoxHelper) { buildingGroup.remove(_hoverBoxHelper); _hoverBoxHelper = null; }
  _hoveredFurnitureId = fid;
  if (fid != null) {
    furnitureMeshes.filter(m => m.userData.furnitureId === fid).forEach(m => {
      _hoverMaterialBackups.push({ mesh: m, mat: m.material });
      const mat = m.material.clone();
      if (mat.emissive) { mat.emissive.setHex(0x2244aa); mat.emissiveIntensity = 0.45; }
      m.material = mat;
    });
    const grp = furnitureGroups[fid] || furnitureMeshes.find(m => m.userData.furnitureId === fid);
    if (grp) { _hoverBoxHelper = new THREE.BoxHelper(grp, 0x4499ff); buildingGroup.add(_hoverBoxHelper); }
  }
  markDirty();
}

function buildFurniture() {
  // Clear hover + selection helpers (meshes/groups are about to be destroyed)
  _hoverMaterialBackups.length = 0;
  if (_hoverBoxHelper)      { buildingGroup.remove(_hoverBoxHelper);      _hoverBoxHelper      = null; }
  if (_furnitureBoxHelper)  { buildingGroup.remove(_furnitureBoxHelper);  _furnitureBoxHelper  = null; }
  _hoveredFurnitureId = null;

  // Remove preset groups
  Object.values(furnitureGroups).forEach(g => buildingGroup.remove(g));
  for (const k in furnitureGroups) delete furnitureGroups[k];

  furnitureMeshes.forEach(m => {
    buildingGroup.remove(m);
    m.geometry?.dispose();
    if (m.material && !Array.isArray(m.material)) m.material.dispose();
  });
  furnitureMeshes.length = 0;

  const floorY = 0.18;
  state.furniture.forEach(f => {
    if (f.type === '__preset__') {
      if (!f.dims) return;
      // Normalise dims to {w,h,d} if stored as legacy array
      if (Array.isArray(f.dims)) f.dims = { w: f.dims[0], h: f.dims[1], d: f.dims[2] };

      if (f.model) {
        // GLB model for this preset piece
        const fid = f.id, gen = _buildGen;
        loadModel(f.model).then(scene => {
          if (_buildGen !== gen || !scene) return;
          if (f.modelScale) scene.scale.setScalar(f.modelScale);
          scene.rotation.y = f.modelRotY ?? 0;
          const box = new THREE.Box3().setFromObject(scene);
          const centre = new THREE.Vector3(); box.getCenter(centre);
          scene.position.set(-centre.x, -box.min.y, -centre.z);
          scene.traverse(child => { if (child.isMesh) { child.castShadow = true; child.userData.furnitureId = fid; furnitureMeshes.push(child); } });
          const group = new THREE.Group();
          group.position.set(f.x, floorY, f.z);
          group.rotation.y = f.rotY ?? 0;
          group.add(scene);
          buildingGroup.add(group);
          furnitureGroups[fid] = group;
          markDirty();
        });
        return;
      }

      const group = new THREE.Group();
      group.position.set(f.x, floorY, f.z);
      group.rotation.y = f.rotY ?? 0;

      (f.subParts || []).forEach(sp => {
        const mat = new THREE.MeshStandardMaterial({ color: sp.color ?? 0xcccccc, roughness: sp.roughness ?? 0.65, metalness: 0.0 });
        const geo = new THREE.BoxGeometry(sp.dims[0], sp.dims[1], sp.dims[2]);
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(sp.pos[0], sp.pos[1], sp.pos[2]);
        mesh.castShadow = true;
        mesh.userData.furnitureId = f.id;
        group.add(mesh);
        furnitureMeshes.push(mesh);
      });

      buildingGroup.add(group);
      furnitureGroups[f.id] = group;
      return;
    }
    const def = FURNITURE_CATALOG[f.type];
    if (!def) return;

    if (def.model) {
      const fid = f.id, gen = _buildGen;
      loadModel(def.model).then(scene => {
        if (_buildGen !== gen || !scene) return;
        if (def.modelScale) scene.scale.setScalar(def.modelScale);
        scene.rotation.y = def.modelRotY ?? 0;
        const box = new THREE.Box3().setFromObject(scene);
        const centre = new THREE.Vector3(); box.getCenter(centre);
        scene.position.set(-centre.x, -box.min.y, -centre.z);
        scene.traverse(child => { if (child.isMesh) { child.castShadow = true; child.userData.furnitureId = fid; furnitureMeshes.push(child); } });
        const group = new THREE.Group();
        group.position.set(f.x, floorY, f.z);
        group.rotation.y = f.rotY ?? 0;
        group.add(scene);
        buildingGroup.add(group);
        furnitureGroups[fid] = group;
        markDirty();
      });
      return;
    }

    // Fallback: plain coloured box
    const mat = new THREE.MeshStandardMaterial({ color: def.color, roughness: 0.65, metalness: 0.05 });
    const geo = new THREE.BoxGeometry(def.w, def.h, def.d);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(f.x, floorY + def.h / 2, f.z);
    mesh.rotation.y = f.rotY ?? 0;
    mesh.castShadow = true;
    mesh.userData.furnitureId = f.id;
    buildingGroup.add(mesh);
    furnitureMeshes.push(mesh);
  });

  // Restore selection BoxHelper after rebuild
  if (_selectedFurnitureId !== null) {
    const grp = furnitureGroups[_selectedFurnitureId];
    const msh = furnitureMeshes.find(m => m.userData.furnitureId === _selectedFurnitureId);
    const target = grp || msh;
    if (target) { _furnitureBoxHelper = new THREE.BoxHelper(target, 0xffcc00); buildingGroup.add(_furnitureBoxHelper); }
  }
}

// ─── PLACED ELECTRICS ────────────────────────────────────────────────────────

const electricMeshes = [];   // { id, group }
let _selectedElectricId  = null;
let _electricBoxHelper   = null;

let _selectedFurnitureId = null;
let _furnitureBoxHelper  = null;

// Snap depth so the group origin (= socket back face) lands on the interior wall face.
// _snapToNearestWallFace places the origin at fd/2+M from the exterior face.
// Interior face is at TK from exterior → fd = 2*(TK - M).
const ELEC_SNAP_M = 0.02;
const ELEC_FD = 2 * (TK - ELEC_SNAP_M);   // 0.24 m
function _elecFd(_def) { return ELEC_FD; }

function buildElectrics() {
  // Remove old BoxHelper
  if (_electricBoxHelper) { buildingGroup.remove(_electricBoxHelper); _electricBoxHelper = null; }

  electricMeshes.forEach(({ group }) => {
    buildingGroup.remove(group);
    group.traverse(obj => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) obj.material.dispose();
    });
  });
  electricMeshes.length = 0;

  (state.electrics || []).forEach(el => {
    const def = ELECTRICS_CATALOG[el.type];
    if (!def) return;

    const group = new THREE.Group();
    group.userData.electricId = el.id;

    // Geometry protrudes in local +z from z=0 (wall face).
    // Backplate: back face at local z=0 (wall face), front at z=def.d*0.4
    const bpD   = def.d * 0.40;
    const bpGeo = new THREE.BoxGeometry(def.w, def.h, bpD);
    const bpMat = new THREE.MeshStandardMaterial({ color: 0xE8E8E4, roughness: 0.55, metalness: 0.05 });
    const bp    = new THREE.Mesh(bpGeo, bpMat);
    bp.position.z = bpD / 2;   // back face at z=0
    bp.castShadow = true;
    group.add(bp);

    // Faceplate: sits on top of backplate, protrudes further
    const fpW = def.w * 0.85, fpH = def.h * 0.85, fpD = def.d * 0.55;
    const fpGeo = new THREE.BoxGeometry(fpW, fpH, fpD);
    const fpMat = new THREE.MeshStandardMaterial({ color: 0xF8F8F4, roughness: 0.40, metalness: 0.08 });
    const fp    = new THREE.Mesh(fpGeo, fpMat);
    fp.position.z = bpD + fpD / 2;   // stacked on backplate
    fp.castShadow = true;
    group.add(fp);

    // Group origin = wall interior face; rotate so local +z faces into room
    group.position.set(el.x, el.mountY, el.z);
    group.rotation.y = el.rotY ?? 0;

    buildingGroup.add(group);
    electricMeshes.push({ id: el.id, group });
  });

  // Restore selection BoxHelper
  if (_selectedElectricId !== null) {
    const em = electricMeshes.find(m => m.id === _selectedElectricId);
    if (em) {
      _electricBoxHelper = new THREE.BoxHelper(em.group, 0xffcc00);
      buildingGroup.add(_electricBoxHelper);
    } else {
      _selectedElectricId = null;  // item was deleted
    }
  }
}

function selectElectric(id) {
  _selectedElectricId = (id === _selectedElectricId) ? null : id;
  // Update BoxHelper
  if (_electricBoxHelper) { buildingGroup.remove(_electricBoxHelper); _electricBoxHelper = null; }
  if (_selectedElectricId !== null) {
    const em = electricMeshes.find(m => m.id === _selectedElectricId);
    if (em) { _electricBoxHelper = new THREE.BoxHelper(em.group, 0xffcc00); buildingGroup.add(_electricBoxHelper); }
  }
  markDirty();
  if (typeof renderElectricsList === 'function') renderElectricsList();
}

// ─── INTERIOR PARTITIONS ─────────────────────────────────────────────────────

const partitionMeshes = [];

function buildPartitions() {
  partitionMeshes.forEach(({ mesh }) => {
    buildingGroup.remove(mesh);
    if (mesh.geometry) mesh.geometry.dispose();
    if (mesh.material) mesh.material.dispose();
  });
  partitionMeshes.length = 0;

  const floorY = 0.18, wallH = state.height;

  const DOOR_W = 0.9;   // interior door width (m)
  const DOOR_H = 2.05;  // interior door height (m)

  // Pre-compute preset room bounding boxes for overlap clipping
  const hw0 = state.width / 2, hd0 = state.depth / 2;
  const _roomBBoxes = state.presetRooms.map(r => {
    const halfW = r.width / 2;
    switch (r.wall) {
      case 'back':  return { xMin: r.offset - halfW, xMax: r.offset + halfW, zMin: -hd0,          zMax: -hd0 + r.depth };
      case 'front': return { xMin: r.offset - halfW, xMax: r.offset + halfW, zMin:  hd0 - r.depth, zMax:  hd0 };
      case 'left':  return { xMin: -hw0,              xMax: -hw0 + r.depth,   zMin: r.offset - halfW, zMax: r.offset + halfW };
      case 'right': return { xMin:  hw0 - r.depth,    xMax:  hw0,             zMin: r.offset - halfW, zMax: r.offset + halfW };
      default: return null;
    }
  }).filter(Boolean);

  state.partitions.forEach(p => {
    // Trim rendered ends that abut an exterior wall
    const hw = state.width / 2, hd = state.depth / 2;
    const wallLimit = p.axis === 'x' ? hw : hd;
    // x-axis partitions abut left/right walls (ShapeGeometry, interior face at hw-TK) → trim TK.
    // z-axis partitions abut front/back walls (BoxGeometry centred at hd, interior face at hd-TK/2) → trim TK/2.
    const trimAmt = p.axis === 'x' ? TK : TK / 2;
    let trimStart = Math.abs(p.start + wallLimit) < 0.01 ? trimAmt : 0;
    let trimEnd   = Math.abs(p.end   - wallLimit) < 0.01 ? trimAmt : 0;

    const rStart = p.start + trimStart;
    const rEnd   = p.end   - trimEnd;
    if (rEnd - rStart <= 0) return;

    // Compute blocked ranges — doors AND preset-room footprints
    const doors = (p.doors || []).map(d => ({
      lo: d.offset - DOOR_W / 2,
      hi: d.offset + DOOR_W / 2,
      isDoor: true,
      offset: d.offset,
    }));

    // Preset room blocked zones: where the partition line passes through a room's interior
    const roomBlocks = _roomBBoxes.map(bb => {
      if (p.axis === 'x') {
        // Partition runs along X at z=p.pos — blocked in X range where room footprint covers it
        if (p.pos > bb.zMin && p.pos < bb.zMax) return { lo: bb.xMin, hi: bb.xMax, isDoor: false };
      } else {
        // Partition runs along Z at x=p.pos
        if (p.pos > bb.xMin && p.pos < bb.xMax) return { lo: bb.zMin, hi: bb.zMax, isDoor: false };
      }
      return null;
    }).filter(Boolean);

    // Perpendicular partition cross-blocks: skip geometry where another partition's body
    // occupies p's path. Covers both T-junctions (p ends at q) and cross-junctions (p passes
    // fully through q). The gap in p is filled visually by q's own geometry.
    const crossBlocks = state.partitions.filter(q => {
      if (q.id === p.id || q.axis === p.axis) return false;
      return p.pos >= Math.min(q.start, q.end) - TK / 2 && p.pos <= Math.max(q.start, q.end) + TK / 2;
    }).map(q => ({ lo: q.pos - TK / 2, hi: q.pos + TK / 2, isDoor: false }));

    // Merge all blocked ranges and sort by lo
    const allBlocks = [...doors, ...roomBlocks, ...crossBlocks].sort((a, b) => a.lo - b.lo);

    // Slice the wall into segments around each blocked zone
    const segments = [];
    let cursor = rStart;
    allBlocks.forEach(({ lo, hi, isDoor }) => {
      const segStart = cursor;
      const segEnd   = Math.max(cursor, Math.min(lo, rEnd));
      if (segEnd - segStart > 0.01) segments.push({ start: segStart, end: segEnd, isDoor: false });
      if (hi > rStart && lo < rEnd) {
        if (isDoor) segments.push({ start: Math.max(lo, rStart), end: Math.min(hi, rEnd), isDoor: true, offset: lo + (hi - lo) / 2 });
        // Room blocks are simply skipped — no geometry rendered in that zone
      }
      cursor = Math.min(Math.max(hi, cursor), rEnd);
    });
    if (rEnd - cursor > 0.01) segments.push({ start: cursor, end: rEnd, isDoor: false });

    const frameMat = _cachedMat('partFrame', () =>
      new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.4, metalness: 0.5 })
    );
    const doorLeafMat = _cachedMat('partDoorLeaf', () =>
      new THREE.MeshStandardMaterial({ color: 0xf0ede8, roughness: 0.6, metalness: 0.0 })
    );

    segments.forEach(seg => {
      const len = seg.end - seg.start;
      if (len <= 0) return;
      const W = p.axis === 'x' ? len : TK;
      const D = p.axis === 'x' ? TK  : len;
      const midAlongWall = (seg.start + seg.end) / 2;
      const cx = p.axis === 'x' ? midAlongWall : p.pos;
      const cz = p.axis === 'x' ? p.pos : midAlongWall;

      if (!seg.isDoor) {
        // Normal wall segment
        const mat = makeIwMat(state.interiorWalls);
        mat.side = THREE.DoubleSide;
        mat.polygonOffset = true; mat.polygonOffsetFactor = -1; mat.polygonOffsetUnits = -1;
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(W, wallH, D), mat);
        mesh.position.set(cx, floorY + wallH / 2, cz);
        mesh.castShadow = mesh.receiveShadow = true;
        mesh.userData.partitionId = p.id;
        buildingGroup.add(mesh);
        partitionMeshes.push({ id: p.id, mesh });
      } else {
        // Door gap — head panel above, frame sides, swinging leaf placeholder
        const headH = wallH - DOOR_H;

        // Head panel (wall above door)
        if (headH > 0.02) {
          const mat = makeIwMat(state.interiorWalls); mat.side = THREE.DoubleSide;
          const hm = new THREE.Mesh(new THREE.BoxGeometry(W, headH, D), mat);
          hm.position.set(cx, floorY + DOOR_H + headH / 2, cz);
          hm.castShadow = true; hm.userData.partitionId = p.id;
          buildingGroup.add(hm); partitionMeshes.push({ id: p.id, mesh: hm });
        }

        // Door frame — two side jambs + head
        const jW = 0.06, jD = TK + 0.02;
        const jH  = DOOR_H + 0.04;
        // Side jambs
        [[seg.start - jW / 2, seg.start + jW / 2], [seg.end - jW / 2, seg.end + jW / 2]].forEach(([lo2, hi2]) => {
          const jCx = p.axis === 'x' ? (lo2 + hi2) / 2 : p.pos;
          const jCz = p.axis === 'x' ? p.pos : (lo2 + hi2) / 2;
          const jm = new THREE.Mesh(new THREE.BoxGeometry(
            p.axis === 'x' ? jW : jD,
            jH,
            p.axis === 'x' ? jD : jW,
          ), frameMat);
          jm.position.set(jCx, floorY + jH / 2, jCz);
          buildingGroup.add(jm); partitionMeshes.push({ id: p.id, mesh: jm });
        });
        // Head jamb
        const headJm = new THREE.Mesh(new THREE.BoxGeometry(W + jW * 2, jW, jD), frameMat);
        headJm.position.set(cx, floorY + DOOR_H + jW / 2, cz);
        buildingGroup.add(headJm); partitionMeshes.push({ id: p.id, mesh: headJm });

        // Door leaf (placeholder — flat panel, hinged at start side, open ~30°)
        const leafGeo = new THREE.BoxGeometry(DOOR_W - 0.02, DOOR_H - 0.04, 0.04);
        const leaf = new THREE.Mesh(leafGeo, doorLeafMat);
        // Pivot at hinge edge — offset so rotation works from hinge
        const pivotCx = p.axis === 'x' ? seg.start : p.pos;
        const pivotCz = p.axis === 'x' ? p.pos : seg.start;
        const pivot = new THREE.Group();
        pivot.position.set(pivotCx, floorY + DOOR_H / 2, pivotCz);
        const openAngle = 30 * Math.PI / 180;
        if (p.axis === 'x') {
          leaf.position.set(DOOR_W / 2, 0, 0);
          pivot.rotation.y = -openAngle;
        } else {
          leaf.position.set(0, 0, DOOR_W / 2);
          pivot.rotation.y = Math.PI / 2 - openAngle;
        }
        pivot.add(leaf);
        pivot.userData.partitionId = p.id;
        buildingGroup.add(pivot);
        partitionMeshes.push({ id: p.id, mesh: pivot });
      }
    });
  });

  rebuildPartitionHandles();
  if (typeof rebuildInteriorDoorHandles === 'function') rebuildInteriorDoorHandles();
}

const PARTITION_MOVE_MAT = new THREE.MeshStandardMaterial({
  color: 0x22c55e, transparent: true, opacity: 0,
  roughness: 0.3, metalness: 0.1, depthWrite: false,
});
const PARTITION_END_MAT = new THREE.MeshStandardMaterial({
  color: 0xf59e0b, transparent: true, opacity: 0,
  roughness: 0.3, metalness: 0.1, depthWrite: false,
});
const PARTITION_HANDLE_RADIUS = 80;
const partitionHandles = [];   // { id, role:'move'|'start'|'end', axis, mesh }

function _partitionHandlePos(p) {
  const topH = 0.18 + state.height + 0.05; // just above wall top
  const cx = p.axis === 'x' ? (p.start + p.end) / 2 : p.pos;
  const cz = p.axis === 'x' ? p.pos : (p.start + p.end) / 2;
  const sx = p.axis === 'x' ? p.start : p.pos;
  const sz = p.axis === 'x' ? p.pos   : p.start;
  const ex = p.axis === 'x' ? p.end   : p.pos;
  const ez = p.axis === 'x' ? p.pos   : p.end;
  return {
    move:  new THREE.Vector3(cx, topH, cz),
    start: new THREE.Vector3(sx, topH, sz),
    end:   new THREE.Vector3(ex, topH, ez),
  };
}

// Reusable handle geometries — created once, never disposed
const _PART_GEO_MOVE  = new THREE.CylinderGeometry(0.18, 0.18, 0.06, 20);
const _PART_GEO_END   = new THREE.CylinderGeometry(0.14, 0.14, 0.06, 16);

function rebuildPartitionHandles() {
  // Dispose only the cloned materials, not the shared geometries
  partitionHandleGroup.children.forEach(c => { if (c.material) c.material.dispose(); });
  while (partitionHandleGroup.children.length) partitionHandleGroup.remove(partitionHandleGroup.children[0]);
  partitionHandles.length = 0;

  state.partitions.forEach(p => {
    const pos = _partitionHandlePos(p);
    [
      { role: 'move',  mat: PARTITION_MOVE_MAT, geo: _PART_GEO_MOVE, p: pos.move  },
      { role: 'start', mat: PARTITION_END_MAT,  geo: _PART_GEO_END,  p: pos.start },
      { role: 'end',   mat: PARTITION_END_MAT,  geo: _PART_GEO_END,  p: pos.end   },
    ].forEach(({ role, mat, geo, p: hpos }) => {
      const mesh = new THREE.Mesh(geo, mat.clone());
      mesh.position.copy(hpos);
      mesh.userData.partitionId = p.id;
      mesh.userData.partitionRole = role;
      mesh.userData.partitionAxis = p.axis;
      partitionHandleGroup.add(mesh);
      partitionHandles.push({ id: p.id, role, axis: p.axis, mesh });
    });
  });
}

function updatePartitionHandleVisibility(mouseX, mouseY) {
  const vp = document.querySelector('.viewport');
  if (!vp) return;
  const vr = vp.getBoundingClientRect();
  partitionHandles.forEach(({ mesh }) => {
    const v = mesh.position.clone().project(camera);
    if (v.z >= 1) { mesh.material.opacity = 0; return; }
    const sx = (v.x * 0.5 + 0.5) * vr.width;
    const sy = (-v.y * 0.5 + 0.5) * vr.height;
    const ddx = mouseX - vr.left - sx;
    const ddy = mouseY - vr.top  - sy;
    const dist = Math.sqrt(ddx * ddx + ddy * ddy);
    const target = dist < PARTITION_HANDLE_RADIUS ? Math.max(0.15, 1 - dist / PARTITION_HANDLE_RADIUS) : 0;
    mesh.material.opacity += (target - mesh.material.opacity) * 0.25;
    if (Math.abs(target - mesh.material.opacity) > 0.005) markDirty();
  });
}

function raycastPartitionHandle(e) {
  raycaster.setFromCamera(getMouseNDC(e), camera);
  const hits = raycaster.intersectObjects(partitionHandleGroup.children, false);
  if (!hits.length) return null;
  return hits[0].object.material.opacity > 0.05 ? hits[0].object : null;
}

// ─── PRESET ROOMS ────────────────────────────────────────────────────────────

const PR_MIN_W = 1.2;   // minimum room width (m)
const PR_MIN_D = 1.0;   // minimum room depth (m)

// Materials for preset room handles (created once)
const PR_MOVE_MAT  = new THREE.MeshStandardMaterial({ color: 0x8b5cf6, transparent: true, opacity: 0, roughness: 0.3, metalness: 0.1, depthWrite: false });
const PR_SIDE_MAT  = new THREE.MeshStandardMaterial({ color: 0xf59e0b, transparent: true, opacity: 0, roughness: 0.3, metalness: 0.1, depthWrite: false });
const PR_DEPTH_MAT = new THREE.MeshStandardMaterial({ color: 0x0ea5e9, transparent: true, opacity: 0, roughness: 0.3, metalness: 0.1, depthWrite: false });
const _PR_GEO_MOVE  = new THREE.CylinderGeometry(0.20, 0.20, 0.06, 20);
const _PR_GEO_SIDE  = new THREE.CylinderGeometry(0.14, 0.14, 0.06, 16);
const _PR_GEO_DEPTH = new THREE.CylinderGeometry(0.16, 0.16, 0.06, 16);

const presetRoomHandles = [];  // { id, role, mesh }

// Returns { wallPos, alongAxis:'x'|'z', depthSign, limit }
// wallPos: world coordinate of the exterior wall face
// alongAxis: 'x' means room runs in X direction; 'z' means runs in Z
// depthSign: +1 or -1 → which direction depth goes into the building
function _prFrame(r) {
  const hw = state.width / 2, hd = state.depth / 2;
  switch (r.wall) {
    case 'back':  return { wallPos: -hd, alongAxis: 'x', depthSign:  1, limit: hw };
    case 'front': return { wallPos:  hd, alongAxis: 'x', depthSign: -1, limit: hw };
    case 'left':  return { wallPos: -hw, alongAxis: 'z', depthSign:  1, limit: hd };
    case 'right': return { wallPos:  hw, alongAxis: 'z', depthSign: -1, limit: hd };
  }
}

// Furniture definition in local room space.
// Local space: origin at room centre, +X = along wall, +Z = toward interior.
// Returns array of LOGICAL PIECES — each piece has:
//   { label, localX, localZ, dims:{w,h,d}, parts:[{dims:[W,H,D], pos:[dx,dy,dz], color, roughness}] }
// localX/localZ: piece centre in room-local space.
// parts[].pos: offset from piece centre (x,z) with y = height from floor.
function _prFurnitureDefs(type, width, depth) {
  const hw = width / 2, hd = depth / 2;
  const C = 0.13;  // clearance from wall face

  switch (type) {
    case 'bathroom': {
      // Shower: back-left corner, facing door
      const shX  = -hw + C + 0.99 / 2;
      const shZ  = -hd + C + 1.06 / 2;
      // Toilet: back-right corner — modelRotY=π/2 swaps visual w/d, so offset by d/2 from right wall
      const toX  =  hw - C - 0.60 / 2;
      const toZ  = -hd + C + 0.35 / 2;
      // Basin: right wall, forward of toilet (rotY=-π/2 → back against right wall)
      const basX =  hw - C - 0.64 / 2;
      const basZ =  0.3;
      return [
        { label:'Shower', localX:shX,  localZ:shZ,  localRotY:0,           modelRotY:0,         modelScale:0.004910, dims:{w:0.99,h:2.00,d:1.06}, model:'assets/shower.glb'          },
        { label:'Toilet', localX:toX,  localZ:toZ,  localRotY:0,           modelRotY:Math.PI/2,                      dims:{w:0.35,h:0.68,d:0.60}, model:'assets/toilet.glb'          },
        { label:'Basin',  localX:basX, localZ:basZ, localRotY:-Math.PI/2,  modelRotY:0,         modelScale:0.001350, dims:{w:0.65,h:0.85,d:0.64}, model:'assets/wash_basin_stand.glb'},
      ];
    }
    case 'bedroom': {
      // Use double bed if room is wide enough, single otherwise
      const useDbl = width >= 2.5;
      const bedW   = useDbl ? 1.26 : 0.90;
      const bedD   = useDbl ? 1.50 : 1.79;
      // Bed: centred, against back wall
      const bedZ   = -hd + C + bedD / 2;
      // Bedside tables: tight to each side of bed
      const bsX    = bedW / 2 + 0.05 + 0.46 / 2;
      // Wardrobe: front wall, right side (leaves left side clear for door)
      const wardX  =  hw - C - 1.76 / 2;
      const wardZ  =  hd - C - 0.39 / 2;
      // Dresser: left wall, middle of room (rotY=π/2 → back against left wall)
      const dresX  = -hw + C + 0.52 / 2;
      const dresZ  =  0.2;
      return [
        { label:'Bed',       localX:0,      localZ:bedZ,  localRotY:0,          dims:{w:bedW, h:useDbl?0.61:0.50, d:bedD}, model:useDbl?'assets/bed_double.glb':'assets/bed_single.glb' },
        { label:'Bedside L', localX:-bsX,   localZ:bedZ,  localRotY:0,          dims:{w:0.46,h:0.40,d:0.45}, model:'assets/side_table.glb'    },
        { label:'Bedside R', localX: bsX,   localZ:bedZ,  localRotY:0,          dims:{w:0.46,h:0.40,d:0.45}, model:'assets/side_table.glb'    },
        { label:'Wardrobe',  localX:wardX,  localZ:wardZ, localRotY:Math.PI,    dims:{w:1.76,h:1.78,d:0.39}, model:'assets/cabinet_fancy.glb' },
        { label:'Dresser',   localX:dresX,  localZ:dresZ, localRotY:Math.PI/2,  dims:{w:0.46,h:0.89,d:0.52}, model:'assets/cabinet_brown.glb' },
      ];
    }
    case 'office': {
      // Desk: back-right corner, facing into room
      const deskX  =  hw - C - 1.33 / 2;
      const deskZ  = -hd + C + 0.56 / 2;
      // Chair: pulled out from desk so it can be sat in
      const chairZ =  deskZ + 0.56 / 2 + 0.20 + 0.60 / 2;
      // Bookshelf: left wall, back half (rotY=π/2 → back against left wall)
      const shelfX = -hw + C + 0.37 / 2;
      const shelfZ = -hd + C + 0.76 / 2;
      // Water cooler: front-left corner, out of the way
      const wcX    = -hw + C + 0.26 / 2;
      const wcZ    =  hd - C - 0.26 / 2;
      return [
        { label:'Desk',         localX:deskX,  localZ:deskZ,  localRotY:0,          dims:{w:1.33,h:1.02,d:0.56}, model:'assets/computer_desk.glb' },
        { label:'Office Chair', localX:deskX,  localZ:chairZ, localRotY:0,          dims:{w:0.51,h:0.99,d:0.60}, model:'assets/office_chair.glb'  },
        { label:'Bookshelf',    localX:shelfX, localZ:shelfZ, localRotY:Math.PI/2,  dims:{w:0.76,h:1.40,d:0.37}, model:'assets/shelf_unit.glb'    },
        { label:'Water Cooler', localX:wcX,    localZ:wcZ,    localRotY:0,          dims:{w:0.26,h:1.03,d:0.26}, model:'assets/watercooler.glb'   },
      ];
    }
    default: return [];
  }
}

const presetRoomMeshes = [];   // { id, meshes: [mesh, ...] }

// Populate state.furniture with __preset__ entries for room r (if not already done).
// groupX/groupZ/groupRotY: world transform of the room's local coordinate origin.
function _syncPresetRoomFurniture(r, groupX, groupZ, groupRotY) {
  const cos = Math.cos(groupRotY), sin = Math.sin(groupRotY);
  const existing = state.furniture.filter(f => f.presetRoomId === r.id);
  if (existing.length > 0) {
    // Room moved — recalculate world position from stored local coords
    existing.forEach(f => {
      f.x    = groupX + cos * f.localX + sin * f.localZ;
      f.z    = groupZ - sin * f.localX + cos * f.localZ;
      f.rotY = groupRotY + (f.localRotY ?? 0);
    });
    return;
  }
  // First time — create one state entry per logical furniture piece
  const defs = _prFurnitureDefs(r.type, r.width, r.depth);
  defs.forEach(def => {
    const lx = def.localX, lz = def.localZ;
    const lr = def.localRotY ?? 0;
    state.furniture.push({
      id: state.nextFurnitureId++,
      type: '__preset__',
      x: groupX + cos * lx + sin * lz,
      z: groupZ - sin * lx + cos * lz,
      rotY: groupRotY + lr,
      localX: lx, localZ: lz,
      localRotY: lr,
      dims: def.dims,
      model: def.model,
      modelRotY: def.modelRotY ?? 0,
      modelScale: def.modelScale,
      label: def.label,
      presetRoomId: r.id,
    });
  });
}

function buildPresetRooms() {
  // Dispose old preset room meshes
  presetRoomMeshes.forEach(({ meshes }) => {
    meshes.forEach(m => {
      buildingGroup.remove(m);
      if (m.geometry) m.geometry.dispose();
      if (m.material && !Array.isArray(m.material)) m.material.dispose();
    });
  });
  presetRoomMeshes.length = 0;

  const wallH = state.height, floorY = 0.18;

  state.presetRooms.forEach(r => {
    const meshes = [];
    const frame = _prFrame(r);
    if (!frame) return;
    const { wallPos, alongAxis, depthSign } = frame;

    // Clamp room so it never extends beyond the exterior walls
    const perpLimit = alongAxis === 'x' ? state.width / 2 : state.depth / 2;
    const depthLimit = (alongAxis === 'x' ? state.depth / 2 : state.width / 2) - TK;
    const halfW = r.width / 2;
    r.offset = Math.max(-perpLimit + halfW + TK, Math.min(perpLimit - halfW - TK, r.offset));
    r.depth  = Math.max(0.5, Math.min(r.depth, depthLimit));

    const innerWallCoord = wallPos + depthSign * r.depth;
    const sideLen = Math.max(0.05, r.depth - TK);
    const sideCentre = wallPos + depthSign * (TK / 2 + sideLen / 2);
    const cy = floorY + wallH / 2;
    const h = wallH;

    function addWallBox(W, H, D, cx, cz, userData) {
      const mat = makeIwMat(state.interiorWalls); mat.side = THREE.DoubleSide;
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(W, H, D), mat);
      mesh.position.set(cx, cy, cz);
      mesh.castShadow = mesh.receiveShadow = true;
      Object.assign(mesh.userData, userData, { presetRoomId: r.id });
      buildingGroup.add(mesh);
      meshes.push(mesh);
    }

    // Side wall merging: if a room edge is within TK of a perpendicular exterior wall,
    // that exterior wall already closes the room — don't render a redundant side wall.
    const leftEdge  = r.offset - halfW;
    const rightEdge = r.offset + halfW;
    const mergeL = Math.abs(leftEdge  + perpLimit) < TK * 1.1;
    const mergeR = Math.abs(rightEdge - perpLimit) < TK * 1.1;

    // Inner wall with door — door centre can be offset via r.doorOffset
    const PR_DOOR_W = 0.9;
    const PR_DOOR_H = 2.05;
    const doorCentre = r.offset + (r.doorOffset || 0);
    // Clamp so door stays fully within wall extents (halfW declared above)
    const doorCentreClamped = Math.max(r.offset - halfW + PR_DOOR_W / 2 + 0.06,
                                       Math.min(r.offset + halfW - PR_DOOR_W / 2 - 0.06, doorCentre));
    const doorLo = doorCentreClamped - PR_DOOR_W / 2;
    const doorHi = doorCentreClamped + PR_DOOR_W / 2;
    const wallLeft  = r.offset - halfW - TK / 2;
    const wallRight = r.offset + halfW + TK / 2;

    function addInnerWallWithDoor(isX) {
      // Wall material & frame/leaf materials (reuse partition style)
      const wMat = makeIwMat(state.interiorWalls); wMat.side = THREE.DoubleSide;
      const fMat = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.4, metalness: 0.5 });
      const lMat = new THREE.MeshStandardMaterial({ color: 0xf0ede8, roughness: 0.6 });
      const headH = Math.max(0, wallH - PR_DOOR_H);

      // Two wall segments either side of door
      [[wallLeft, doorLo], [doorHi, wallRight]].forEach(([lo, hi]) => {
        const len = hi - lo;
        if (len < 0.01) return;
        const cx = isX ? (lo + hi) / 2 : innerWallCoord;
        const cz = isX ? innerWallCoord : (lo + hi) / 2;
        const W  = isX ? len : TK;
        const D  = isX ? TK  : len;
        const m  = new THREE.Mesh(new THREE.BoxGeometry(W, wallH, D), wMat.clone());
        m.position.set(cx, floorY + wallH / 2, cz);
        m.castShadow = m.receiveShadow = true;
        Object.assign(m.userData, { isPresetInner: true, presetRoomId: r.id });
        buildingGroup.add(m); meshes.push(m);
      });

      // Head panel above door opening
      if (headH > 0.02) {
        const cx = isX ? doorCentreClamped : innerWallCoord;
        const cz = isX ? innerWallCoord : doorCentreClamped;
        const W  = isX ? PR_DOOR_W : TK;
        const D  = isX ? TK : PR_DOOR_W;
        const hm = new THREE.Mesh(new THREE.BoxGeometry(W, headH, D), wMat.clone());
        hm.position.set(cx, floorY + PR_DOOR_H + headH / 2, cz);
        hm.castShadow = true;
        Object.assign(hm.userData, { isPresetInner: true, presetRoomId: r.id });
        buildingGroup.add(hm); meshes.push(hm);
      }

      // Door frame jambs
      const jW = 0.06, jD = TK + 0.02, jH = PR_DOOR_H + 0.04;
      [doorLo, doorHi].forEach(edge => {
        const cx = isX ? edge : innerWallCoord;
        const cz = isX ? innerWallCoord : edge;
        const jm = new THREE.Mesh(new THREE.BoxGeometry(
          isX ? jW : jD, jH, isX ? jD : jW,
        ), fMat);
        jm.position.set(cx, floorY + jH / 2, cz);
        buildingGroup.add(jm); meshes.push(jm);
      });
      // Head jamb
      const hcx = isX ? doorCentreClamped : innerWallCoord;
      const hcz = isX ? innerWallCoord : doorCentreClamped;
      const hjm = new THREE.Mesh(new THREE.BoxGeometry(
        isX ? PR_DOOR_W + jW * 2 : jD, jW, isX ? jD : PR_DOOR_W + jW * 2,
      ), fMat);
      hjm.position.set(hcx, floorY + PR_DOOR_H + jW / 2, hcz);
      buildingGroup.add(hjm); meshes.push(hjm);

      // Door leaf (hinged at doorLo side, open ~30° into room)
      const leafGeo = new THREE.BoxGeometry(
        isX ? PR_DOOR_W - 0.02 : 0.04,
        PR_DOOR_H - 0.04,
        isX ? 0.04 : PR_DOOR_W - 0.02,
      );
      const leaf = new THREE.Mesh(leafGeo, lMat);
      const pivot = new THREE.Group();
      const pcx = isX ? doorLo : innerWallCoord;
      const pcz = isX ? innerWallCoord : doorLo;
      pivot.position.set(pcx, floorY + PR_DOOR_H / 2, pcz);
      const openAngle = 30 * Math.PI / 180;
      if (isX) {
        leaf.position.set(PR_DOOR_W / 2, 0, 0);
        pivot.rotation.y = -openAngle;
      } else {
        leaf.position.set(0, 0, PR_DOOR_W / 2);
        pivot.rotation.y = Math.PI / 2 - openAngle;
      }
      pivot.add(leaf);
      Object.assign(pivot.userData, { isPresetInner: true, presetRoomId: r.id });
      buildingGroup.add(pivot); meshes.push(pivot);
    }

    if (alongAxis === 'x') {
      if (!mergeL) addWallBox(TK, h, sideLen, leftEdge,  sideCentre, { isPresetSideL: true });
      if (!mergeR) addWallBox(TK, h, sideLen, rightEdge, sideCentre, { isPresetSideR: true });
      addInnerWallWithDoor(true);
    } else {
      if (!mergeL) addWallBox(sideLen, h, TK, sideCentre, leftEdge,  { isPresetSideL: true });
      if (!mergeR) addWallBox(sideLen, h, TK, sideCentre, rightEdge, { isPresetSideR: true });
      addInnerWallWithDoor(false);
    }

    // ── Furniture ── (synced into state.furniture as __preset__ entries)
    let groupX, groupZ, groupRotY;
    if (alongAxis === 'x') {
      groupX = r.offset;
      groupZ = wallPos + depthSign * r.depth / 2;
      groupRotY = depthSign === 1 ? 0 : Math.PI;
    } else {
      groupX = wallPos + depthSign * r.depth / 2;
      groupZ = r.offset;
      groupRotY = depthSign === 1 ? Math.PI / 2 : -Math.PI / 2;
    }
    _syncPresetRoomFurniture(r, groupX, groupZ, groupRotY);

    presetRoomMeshes.push({ id: r.id, meshes });
  });

  rebuildPresetRoomHandles();
  rebuildInteriorDoorHandles();

  // Update list UI
  const listEl = document.getElementById('presetRoomsList');
  if (listEl) {
    if (state.presetRooms.length === 0) {
      listEl.innerHTML = '<div style="color:var(--muted);font-size:12px;padding:2px 0">No preset rooms added</div>';
    } else {
      listEl.innerHTML = state.presetRooms.map(r =>
        `<div style="display:flex;align-items:center;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--border);font-size:12px">
          <span>${r.type.charAt(0).toUpperCase()+r.type.slice(1)} · ${r.wall} wall · ${r.width.toFixed(1)}m×${r.depth.toFixed(1)}m</span>
          <button onclick="state.furniture=state.furniture.filter(f=>f.presetRoomId!==${r.id});state.presetRooms=state.presetRooms.filter(x=>x.id!==${r.id});stateHistory.push();buildRoom()" style="border:none;background:none;color:var(--warn);cursor:pointer;font-size:14px;padding:0 4px">✕</button>
        </div>`
      ).join('');
    }
  }
}

function rebuildPresetRoomHandles() {
  presetRoomHandles.forEach(h => { if (h.mesh.material) h.mesh.material.dispose(); });
  while (presetRoomHandleGroup.children.length) presetRoomHandleGroup.remove(presetRoomHandleGroup.children[0]);
  presetRoomHandles.length = 0;

  const topH = 0.18 + state.height + 0.08;

  state.presetRooms.forEach(r => {
    const frame = _prFrame(r);
    if (!frame) return;
    const { wallPos, alongAxis, depthSign } = frame;
    const halfW = r.width / 2;
    const innerCoord = wallPos + depthSign * r.depth;

    // move: inner wall centre (offset only)
    // depth: room interior centre (depth only — visually sits inside the room)
    // sideL/sideR: inner wall ends (width)
    let iCx, iCz, dCx, dCz, slCx, slCz, srCx, srCz;
    if (alongAxis === 'x') {
      iCx  = r.offset;         iCz  = innerCoord;
      dCx  = r.offset;         dCz  = wallPos + depthSign * r.depth / 2;
      slCx = r.offset - halfW; slCz = innerCoord;
      srCx = r.offset + halfW; srCz = innerCoord;
    } else {
      iCx  = innerCoord;       iCz  = r.offset;
      dCx  = wallPos + depthSign * r.depth / 2; dCz = r.offset;
      slCx = innerCoord;       slCz = r.offset - halfW;
      srCx = innerCoord;       srCz = r.offset + halfW;
    }

    [
      { role: 'move',  mat: PR_MOVE_MAT,  geo: _PR_GEO_MOVE,  cx: iCx,  cz: iCz  },
      { role: 'depth', mat: PR_DEPTH_MAT, geo: _PR_GEO_DEPTH, cx: dCx,  cz: dCz  },
      { role: 'sideL', mat: PR_SIDE_MAT,  geo: _PR_GEO_SIDE,  cx: slCx, cz: slCz },
      { role: 'sideR', mat: PR_SIDE_MAT,  geo: _PR_GEO_SIDE,  cx: srCx, cz: srCz },
    ].forEach(({ role, mat, geo, cx, cz }) => {
      const mesh = new THREE.Mesh(geo, mat.clone());
      mesh.position.set(cx, topH, cz);
      mesh.userData.presetRoomId = r.id;
      mesh.userData.presetRoomRole = role;
      presetRoomHandleGroup.add(mesh);
      presetRoomHandles.push({ id: r.id, role, mesh });
    });
  });
}

// ─── INTERIOR DOOR HANDLES ───────────────────────────────────────────────────
// Small disc handles placed at the centre-top of each interior door opening.
// Dragging one slides the door along its wall.

const _DOOR_HANDLE_GEO = new THREE.CylinderGeometry(0.14, 0.14, 0.05, 16);
const _DOOR_HANDLE_MAT = new THREE.MeshStandardMaterial({ color: 0x22c55e, transparent: true, opacity: 0, roughness: 0.3, metalness: 0.2, depthWrite: false });

const interiorDoorHandles = [];  // { type:'partition'|'preset', partitionId?, doorIndex?, presetRoomId?, mesh }
let   interiorDoorDragState = null; // { type, partitionId?, doorIndex?, presetRoomId?, axis, groundAnchorAlong }

function rebuildInteriorDoorHandles() {
  interiorDoorHandles.forEach(h => { if (h.mesh.material) h.mesh.material.dispose(); });
  while (interiorDoorHandleGroup.children.length) interiorDoorHandleGroup.remove(interiorDoorHandleGroup.children[0]);
  interiorDoorHandles.length = 0;

  const floorY = 0.18;
  const DOOR_H = 2.05;
  const handleY = floorY + DOOR_H + 0.14;  // just above door head

  // Partition wall doors
  state.partitions.forEach(p => {
    (p.doors || []).forEach((d, i) => {
      const doorCx = p.axis === 'x' ? p.start + d.offset : p.pos;
      const doorCz = p.axis === 'x' ? p.pos : p.start + d.offset;
      const mesh = new THREE.Mesh(_DOOR_HANDLE_GEO, _DOOR_HANDLE_MAT.clone());
      mesh.position.set(doorCx, handleY, doorCz);
      mesh.userData.interiorDoor = true;
      mesh.userData.doorType = 'partition';
      mesh.userData.partitionId = p.id;
      mesh.userData.doorIndex = i;
      interiorDoorHandleGroup.add(mesh);
      interiorDoorHandles.push({ type: 'partition', partitionId: p.id, doorIndex: i, mesh });
    });
  });

  // Preset room inner wall doors
  state.presetRooms.forEach(r => {
    const frame = _prFrame(r);
    if (!frame) return;
    const { wallPos, alongAxis, depthSign } = frame;
    const innerCoord = wallPos + depthSign * r.depth;
    const dc = r.offset + (r.doorOffset || 0);
    const doorCx = alongAxis === 'x' ? dc : innerCoord;
    const doorCz = alongAxis === 'x' ? innerCoord : dc;
    const mesh = new THREE.Mesh(_DOOR_HANDLE_GEO, _DOOR_HANDLE_MAT.clone());
    mesh.position.set(doorCx, handleY, doorCz);
    mesh.userData.interiorDoor = true;
    mesh.userData.doorType = 'preset';
    mesh.userData.presetRoomId = r.id;
    interiorDoorHandleGroup.add(mesh);
    interiorDoorHandles.push({ type: 'preset', presetRoomId: r.id, mesh });
  });
}

function raycastInteriorDoorHandle(e) {
  raycaster.setFromCamera(getMouseNDC(e), camera);
  const hits = raycaster.intersectObjects(interiorDoorHandleGroup.children, false);
  if (!hits.length) return null;
  return hits[0].object.material.opacity > 0.05 ? hits[0].object : null;
}

function updateInteriorDoorHandleVisibility(mx, my) {
  const HOVER_R = 80;
  const vr = canvas.getBoundingClientRect();
  interiorDoorHandles.forEach(h => {
    const sv = h.mesh.position.clone().project(camera);
    const sx = (sv.x * 0.5 + 0.5) * vr.width;
    const sy = (-sv.y * 0.5 + 0.5) * vr.height;
    const dist = Math.sqrt((mx - vr.left - sx) ** 2 + (my - vr.top - sy) ** 2);
    const target = dist < HOVER_R ? Math.max(0.15, 1 - dist / HOVER_R) : 0;
    h.mesh.material.opacity += (target - h.mesh.material.opacity) * 0.25;
    if (Math.abs(target - h.mesh.material.opacity) > 0.005) markDirty();
  });
}

function updatePresetRoomHandleVisibility(mx, my) {
  const PR_HOVER_RADIUS = 100;
  const vr = canvas.getBoundingClientRect();
  presetRoomHandles.forEach(h => {
    const sv = h.mesh.position.clone().project(camera);
    const sx = (sv.x * 0.5 + 0.5) * vr.width;
    const sy = (-sv.y * 0.5 + 0.5) * vr.height;
    const d = Math.hypot(mx - sx, my - sy);
    const target = d < PR_HOVER_RADIUS ? 0.85 : 0;
    h.mesh.material.opacity += (target - h.mesh.material.opacity) * 0.25;
    if (Math.abs(h.mesh.material.opacity - target) > 0.005) markDirty();
  });
}

function raycastPresetRoomHandle(e) {
  raycaster.setFromCamera(getMouseNDC(e), camera);
  const hits = raycaster.intersectObjects(presetRoomHandleGroup.children, false);
  if (!hits.length) return null;
  return hits[0].object.material.opacity > 0.05 ? hits[0].object : null;
}

let presetRoomDragState = null;

const _GRID = 0.25;  // snap grid resolution (metres)
function _snapToGrid(v) { return Math.round(v / _GRID) * _GRID; }
let _snapEnabled = true;
function toggleSnapGrid() {
  _snapEnabled = !_snapEnabled;
  const btn = document.getElementById('tbSnap');
  if (btn) btn.classList.toggle('active', _snapEnabled);
}

function _snapPos(axis, raw) {
  // Snap perpendicular position — wall face first, then 0.25m grid
  const hw = state.width / 2, hd = state.depth / 2, snap = 0.35;
  const limit = axis === 'x' ? hd : hw;
  if (Math.abs(raw - limit) < snap)  return  limit;
  if (Math.abs(raw + limit) < snap)  return -limit;
  return Math.max(-limit, Math.min(limit, _snapToGrid(raw)));
}

function _snapEnd(axis, raw) {
  // Snap an endpoint — wall face first, then 0.25m grid
  const hw = state.width / 2, hd = state.depth / 2, snap = 0.35;
  const limit = axis === 'x' ? hw : hd;
  if (Math.abs(raw - limit) < snap)  return  limit;
  if (Math.abs(raw + limit) < snap)  return -limit;
  return Math.max(-limit, Math.min(limit, _snapToGrid(raw)));
}

// Ghost mesh shown while dragging a new partition from the UI
let _partitionGhost = null;

function _removePartitionGhost() {
  if (_partitionGhost) { scene.remove(_partitionGhost); _partitionGhost = null; markDirty(2); }
}

function _partitionDragGhostAt(axis, clientX, clientY) {
  // Convert screen coords to a synthetic mouse event for raycasting
  const fakeE = { clientX, clientY };
  const gp = raycastGround(fakeE);
  if (!gp) { _removePartitionGhost(); return; }
  const hw = state.width / 2, hd = state.depth / 2;
  const cx = Math.max(-hw, Math.min(hw, gp.x));
  const cz = Math.max(-hd, Math.min(hd, gp.z));
  _updatePartitionGhost(axis, cx, cz);
}

function _partitionDropAt(axis, clientX, clientY) {
  const fakeE = { clientX, clientY };
  const gp = raycastGround(fakeE);
  if (!gp) return;
  if (typeof placePartitionAtPos === 'function') placePartitionAtPos(axis, gp.x, gp.z);
}

function _updatePartitionGhost(axis, cx, cz) {
  const wallH = state.height;
  const W = axis === 'x' ? 2.0 : TK;
  const D = axis === 'x' ? TK  : 2.0;
  if (!_partitionGhost) {
    const mat = new THREE.MeshLambertMaterial({ color: 0x22c55e, transparent: true, opacity: 0.35, side: THREE.DoubleSide });
    _partitionGhost = new THREE.Mesh(new THREE.BoxGeometry(W, wallH, D), mat);
    scene.add(_partitionGhost);
  } else {
    _partitionGhost.geometry.dispose();
    _partitionGhost.geometry = new THREE.BoxGeometry(W, wallH, D);
  }
  _partitionGhost.position.set(cx, 0.18 + wallH / 2, cz);
  markDirty(2);
}

// ── EDGE DRAG HANDLES (blue spheres) ─────────────────────────────────────────
// One sphere per wall face, sitting just outside the building at mid-wall height.
// They are invisible until the cursor is within EDGE_HANDLE_RADIUS screen pixels,
// then fade in. Dragging one adjusts the corresponding dimension.

const EDGE_HANDLE_RADIUS = 80;   // px proximity threshold for fade-in
const EDGE_HANDLE_MAT = new THREE.MeshStandardMaterial({
  color: 0x1565c0, roughness: 0.3, metalness: 0.1,
  transparent: true, opacity: 0,
});

// Each entry: { wall, mesh, worldPos() }
const edgeHandles = [];

function rebuildEdgeHandles() {
  while (edgeHandleGroup.children.length) edgeHandleGroup.remove(edgeHandleGroup.children[0]);
  edgeHandles.length = 0;
  const hw = state.width / 2, hd = state.depth / 2;
  const sphY = 0.55;   // near-ground height — doesn't float at mid-wall
  const proud = 0.35;   // how far outside the wall face the sphere sits

  const defs = [
    { wall: 'front', pos: new THREE.Vector3(0,       sphY,  hd + proud) },
    { wall: 'back',  pos: new THREE.Vector3(0,       sphY, -hd - proud) },
    { wall: 'right', pos: new THREE.Vector3( hw + proud, sphY, 0) },
    { wall: 'left',  pos: new THREE.Vector3(-hw - proud, sphY, 0) },
  ];

  defs.forEach(({ wall, pos }) => {
    // Each sphere gets its own material instance so opacity can be set individually
    const mat = EDGE_HANDLE_MAT.clone();
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.18, 16, 12), mat);
    mesh.position.copy(pos);
    mesh.userData.edgeWall = wall;
    edgeHandleGroup.add(mesh);
    edgeHandles.push({ wall, mesh });
  });
}

function updateEdgeHandleVisibility(mouseX, mouseY) {
  const vp = document.querySelector('.viewport');
  if (!vp) return;
  const vr = vp.getBoundingClientRect();
  edgeHandles.forEach(({ mesh }) => {
    const v = mesh.position.clone().project(camera);
    if (v.z >= 1) { mesh.material.opacity = 0; return; }
    const sx = (v.x * 0.5 + 0.5) * vr.width;
    const sy = (-v.y * 0.5 + 0.5) * vr.height;
    const dx = mouseX - vr.left - sx;
    const dy = mouseY - vr.top  - sy;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const target = dist < EDGE_HANDLE_RADIUS ? Math.max(0.15, 1 - dist / EDGE_HANDLE_RADIUS) : 0;
    mesh.material.opacity += (target - mesh.material.opacity) * 0.25;
    markDirty();
  });
}

function raycastEdgeHandle(e) {
  raycaster.setFromCamera(getMouseNDC(e), camera);
  const hits = raycaster.intersectObjects(edgeHandleGroup.children, false);
  if (!hits.length) return null;
  return hits[0].object;
}

const _groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const _groundTarget = new THREE.Vector3();
function raycastGround(e) {
  raycaster.setFromCamera(getMouseNDC(e), camera);
  return raycaster.ray.intersectPlane(_groundPlane, _groundTarget)
    ? _groundTarget.clone()
    : null;
}

// Pool of partition label divs so we don't create/destroy them every frame
const _partitionLabelPool = [];
let   _partitionLabelCount = 0;

// Pool of interior dimension labels (preset rooms + partition segments)
const _interiorLabelPool = [];
let   _interiorLabelCount = 0;

function _getInteriorLabel(vp) {
  if (_interiorLabelCount < _interiorLabelPool.length) {
    const el = _interiorLabelPool[_interiorLabelCount++];
    el.style.display = 'block';
    return el;
  }
  const el = document.createElement('div');
  el.style.cssText = [
    'position:absolute', 'pointer-events:none',
    'color:#111',
    'font-size:10px',
    'font-weight:500',
    'font-family:DM Sans,sans-serif',
    'white-space:nowrap',
    'letter-spacing:0.04em',
    'text-shadow:0 0 4px rgba(255,255,255,0.9),0 0 2px rgba(255,255,255,1)',
  ].join(';');
  vp.appendChild(el);
  _interiorLabelPool.push(el);
  _interiorLabelCount++;
  return el;
}

function _getPartitionLabel(vp) {
  if (_partitionLabelCount < _partitionLabelPool.length) {
    const el = _partitionLabelPool[_partitionLabelCount++];
    el.style.display = 'block';
    return el;
  }
  const el = document.createElement('div');
  el.style.cssText = [
    'position:absolute', 'pointer-events:none',
    'padding:2px 7px',
    'background:rgba(21,101,192,0.85)',
    'color:#fff',
    'border-radius:4px',
    'font-size:11px',
    'font-weight:600',
    'font-family:DM Sans,sans-serif',
    'white-space:nowrap',
    'transform:translate(-50%,-50%)',
    'letter-spacing:0.02em',
  ].join(';');
  vp.appendChild(el);
  _partitionLabelPool.push(el);
  _partitionLabelCount++;
  return el;
}

function updateWallLabels() {
  if (!wallLabels.width) return;
  const vp = document.querySelector('.viewport');
  if (!vp) return;
  const vr = vp.getBoundingClientRect();
  const hw = state.width / 2, hd = state.depth / 2;
  const off = 1.1;   // must match rebuildWallArrows
  const floorY = 0.05;  // just above ground for ground-plane labels

  // Project a world point → screen {x, y, behind}
  function toScreen(wx, wy, wz) {
    const v = new THREE.Vector3(wx, wy, wz).project(camera);
    return { x: (v.x * 0.5 + 0.5) * vr.width, y: (-v.y * 0.5 + 0.5) * vr.height, behind: v.z >= 1 };
  }

  // Each entry: two endpoint world coords that define the line, plus the label text.
  // The label is placed at the midpoint, rotated to match the line angle in screen space.
  const wallH = state.height;
  const dimLines = [
    { key: 'width',  text: fmtDim(state.width),
      p1: toScreen(-hw, floorY,  hd + off), p2: toScreen( hw, floorY,  hd + off) },
    { key: 'depth',  text: fmtDim(state.depth),
      p1: toScreen( hw + off, floorY, -hd), p2: toScreen( hw + off, floorY,  hd) },
    { key: 'height', text: fmtDim(state.height),
      p1: toScreen(-(hw + off), 0.18,         hd),
      p2: toScreen(-(hw + off), 0.18 + wallH, hd) },
  ];

  dimLines.forEach(({ key, text, p1, p2 }) => {
    const div = wallLabels[key];
    if (!div) return;
    if (p1.behind && p2.behind) { div.style.display = 'none'; return; }
    const mx = (p1.x + p2.x) / 2;
    const my = (p1.y + p2.y) / 2;
    // Angle of the line in screen space; keep text readable (flip if upside-down)
    let angle = Math.atan2(p2.y - p1.y, p2.x - p1.x);
    if (angle > Math.PI / 2)  angle -= Math.PI;
    if (angle < -Math.PI / 2) angle += Math.PI;
    div.style.display   = 'block';
    div.style.left      = mx + 'px';
    div.style.top       = my + 'px';
    div.style.transform = `translate(-50%,-50%) rotate(${angle.toFixed(3)}rad)`;
    div.textContent     = text;
  });

  // Hide all pooled partition labels, then re-show the active ones
  _partitionLabelCount = 0;
  _partitionLabelPool.forEach(el => { el.style.display = 'none'; });

  state.partitions.forEach(p => {
    const len = p.end - p.start;
    if (len <= 0) return;
    const labelH = 0.18 + state.height;
    const cx = p.axis === 'x' ? (p.start + p.end) / 2 : p.pos;
    const cz = p.axis === 'x' ? p.pos : (p.start + p.end) / 2;
    const world = new THREE.Vector3(cx, labelH, cz);
    const v = world.project(camera);
    if (v.z >= 1) return;
    const el = _getPartitionLabel(vp);
    el.style.left = ((v.x*0.5+0.5)*vr.width)+'px';
    el.style.top  = ((-v.y*0.5+0.5)*vr.height)+'px';
    el.textContent = fmtDim(len);
  });

  // ── Interior dimension labels: preset rooms (width + depth) ──
  _interiorLabelCount = 0;
  _interiorLabelPool.forEach(el => { el.style.display = 'none'; });

  const labelY = 0.18 + state.height;  // top face of wall

  // Helper: project a world point to screen {x,y,behind}
  function toScreenI(wx, wy, wz) {
    const v = new THREE.Vector3(wx, wy, wz).project(camera);
    return { x: (v.x*0.5+0.5)*vr.width, y: (-v.y*0.5+0.5)*vr.height, behind: v.z >= 1 };
  }

  // Helper: show one inline label along the line p1→p2
  function showInteriorLabel(text, p1, p2) {
    if (p1.behind && p2.behind) return;
    const mx = (p1.x + p2.x) / 2, my = (p1.y + p2.y) / 2;
    let angle = Math.atan2(p2.y - p1.y, p2.x - p1.x);
    if (angle >  Math.PI / 2) angle -= Math.PI;
    if (angle < -Math.PI / 2) angle += Math.PI;
    const el = _getInteriorLabel(vp);
    el.style.left      = mx + 'px';
    el.style.top       = my + 'px';
    el.style.transform = `translate(-50%,-50%) rotate(${angle.toFixed(3)}rad)`;
    el.textContent     = text;
  }

  if (floorplanViewMode || interiorViewMode) {
    state.presetRooms.forEach(r => {
      const frame = _prFrame(r);
      if (!frame) return;
      const { wallPos, alongAxis, depthSign } = frame;
      const halfW = r.width / 2;
      const innerCoord = wallPos + depthSign * r.depth;

      if (alongAxis === 'x') {
        // Width label along inner wall (at innerCoord in z)
        showInteriorLabel(fmtDim(r.width),
          toScreenI(r.offset - halfW, labelY, innerCoord),
          toScreenI(r.offset + halfW, labelY, innerCoord));
        // Depth label along the right side wall
        showInteriorLabel(fmtDim(r.depth),
          toScreenI(r.offset + halfW, labelY, wallPos),
          toScreenI(r.offset + halfW, labelY, innerCoord));
      } else {
        // Width label along inner wall (at innerCoord in x)
        showInteriorLabel(fmtDim(r.width),
          toScreenI(innerCoord, labelY, r.offset - halfW),
          toScreenI(innerCoord, labelY, r.offset + halfW));
        // Depth label along the right side wall
        showInteriorLabel(fmtDim(r.depth),
          toScreenI(wallPos,      labelY, r.offset + halfW),
          toScreenI(innerCoord,   labelY, r.offset + halfW));
      }
    });
  }
}

// ─── RAYCASTING ────────────────────────────────────────────────────────────────

const raycaster = new THREE.Raycaster();

function getMouseNDC(e) {
  const r=canvas.getBoundingClientRect();
  return new THREE.Vector2(((e.clientX-r.left)/r.width)*2-1, ((e.clientY-r.top)/r.height)*-2+1);
}

function wallFacesCamera(wallId) {
  const hw = state.width / 2, hd = state.depth / 2;
  const WALL_OFFSETS = { front: new THREE.Vector3(0,0,hd), back: new THREE.Vector3(0,0,-hd),
                         left: new THREE.Vector3(-hw,0,0), right: new THREE.Vector3(hw,0,0) };
  return WALL_NORMALS[wallId].dot(camera.position.clone().sub(WALL_OFFSETS[wallId])) > 0;
}

function raycastHandles(e) {
  raycaster.setFromCamera(getMouseNDC(e), camera);
  const hits = raycaster.intersectObjects(handlesGroup.children, true);
  if (!hits.length) return null;
  let obj=hits[0].object;
  while(obj && !obj.userData.openingId) obj=obj.parent;
  if (!obj) return null;
  // Reject handles on walls that aren't facing the camera — prevents clicking through walls
  const op = state.openings.find(o => o.id === obj.userData.openingId);
  if (op && !wallFacesCamera(op.wall)) return null;
  return { openingId: obj.userData.openingId, handleMesh: obj };
}

function raycastWall(e) {
  const w=state.width,d=state.depth,h=state.height,hw=w/2,hd=d/2;
  raycaster.setFromCamera(getMouseNDC(e), camera);
  const ray=raycaster.ray;
  const walls=[
    {id:'front',normal:new THREE.Vector3(0,0,1),dist:hd,wallW:w},
    {id:'back', normal:new THREE.Vector3(0,0,-1),dist:hd,wallW:w},
    {id:'left', normal:new THREE.Vector3(-1,0,0),dist:hw,wallW:d},
    {id:'right',normal:new THREE.Vector3(1,0,0), dist:hw,wallW:d},
  ];
  let best=null,bestDist=Infinity;
  walls.forEach(({id,normal,dist,wallW})=>{
    if(ray.direction.dot(normal)>=0) return;
    const plane=new THREE.Plane(normal,-dist);
    const target=new THREE.Vector3();
    if(!ray.intersectPlane(plane,target)) return;
    const inBounds=(id==='left'||id==='right')
      ?(Math.abs(target.z)<=hd+0.01 && target.y>=0.17 && target.y<=0.18+h+0.01)
      :(Math.abs(target.x)<=hw+0.01 && target.y>=0.17 && target.y<=0.18+h+0.01);
    if(!inBounds) return;
    const d2=ray.origin.distanceTo(target);
    if(d2<bestDist){bestDist=d2;best={wallId:id,localX:worldToLocalX(id,target,hw,hd),wallW};}
  });
  return best;
}

// ─── INTERACTION STATE ─────────────────────────────────────────────────────────

let activePaletteType = null;
let dragState         = null;
let hoveredHandleId   = null;
let selectedHandleId  = null;

function refreshHandleColors() {
  handlesGroup.children.forEach(handle => {
    const id=handle.userData.openingId;
    let color=handle.userData.baseColor;
    if(id===selectedHandleId) { color=HANDLE_SEL_COLOR; handle.material.opacity=0.55; }
    else if(id===hoveredHandleId) color=HANDLE_HOVER_COLOR;
    handle.material.color.setHex(color);
    handle.material.needsUpdate = true;
  });
}

function setActivePalette(type) {
  activePaletteType = type;
  canvas.style.cursor = type ? 'crosshair' : 'default';
  selectedHandleId = null;
  refreshHandleColors();
  if (typeof updatePaletteUI === 'function') updatePaletteUI();
  if (typeof renderSelectedOpening === 'function') renderSelectedOpening();
  const banner = document.getElementById('placementBanner');
  if (banner) {
    banner.style.display = type ? 'flex' : 'none';
    const label = document.getElementById('placementBannerLabel');
    if (label) label.textContent = type === 'door' ? 'Click a wall to place door' : 'Click a wall to place window';
  }
}

function selectFurniture(id) {
  _selectedFurnitureId = id;
  if (_furnitureBoxHelper) { buildingGroup.remove(_furnitureBoxHelper); _furnitureBoxHelper = null; }
  if (id !== null) {
    const grp = furnitureGroups[id];
    const msh = furnitureMeshes.find(m => m.userData.furnitureId === id);
    const target = grp || msh;
    if (target) { _furnitureBoxHelper = new THREE.BoxHelper(target, 0xffcc00); buildingGroup.add(_furnitureBoxHelper); }
  }
  markDirty();
}

function deselectAll() {
  if (_selectedFurnitureId !== null) {
    _selectedFurnitureId = null;
    if (_furnitureBoxHelper) { buildingGroup.remove(_furnitureBoxHelper); _furnitureBoxHelper = null; }
  }
  if (_selectedElectricId !== null) {
    _selectedElectricId = null;
    if (_electricBoxHelper) { buildingGroup.remove(_electricBoxHelper); _electricBoxHelper = null; }
    if (typeof renderElectricsList === 'function') renderElectricsList();
  }
  if (selectedHandleId !== null) {
    selectedHandleId = null;
    refreshHandleColors();
    if (typeof renderSelectedOpening === 'function') renderSelectedOpening();
  }
  markDirty();
}

function selectHandle(id) {
  setActivePalette(null);   // clears selectedHandleId internally — must come first
  selectedHandleId = id;    // re-apply after palette clear so it persists
  refreshHandleColors();
  if (typeof renderSelectedOpening === 'function') renderSelectedOpening();
}

// ─── PLACEMENT & DELETION ──────────────────────────────────────────────────────

function placeOpening(type, wallId, localX) {
  const style = type === 'door' ? state.defaultDoor : state.defaultWindow;
  const ww    = wallWidth(wallId);
  const mk_ = resolveModelKey(type, style); const ow = type === 'door' ? (DOOR[mk_]?.widthM ?? 0.9) : (WINDOW_MODEL[mk_]?.naturalW ?? 0.9);

  // Clamp to wall edges first
  const clampedCx = Math.max(ow/2 + MIN_EDGE_GAP, Math.min(ww - ow/2 - MIN_EDGE_GAP, localX));

  // Find a non-overlapping position near cursor
  const validCx = findValidPosition(type, style, wallId, clampedCx);
  if (validCx === null) {
    showPlacementError('Not enough space on that wall.');
    return;
  }

  const offset = validCx - ww / 2;
  const id = state.nextOpeningId++;
  state.openings.push({ id, type, wall: wallId, offset, style });
  selectHandle(id);
  buildRoom();
  updatePriceDisplay();
  renderOpeningsList();
}

function deleteOpening(id) {
  state.openings = state.openings.filter(o => o.id !== id);
  if (selectedHandleId === id) { selectedHandleId = null; if(typeof renderSelectedOpening==='function') renderSelectedOpening(); }
  if (hoveredHandleId  === id) hoveredHandleId = null;
  buildRoom();
  updatePriceDisplay();
  renderOpeningsList();
  if(typeof updatePaletteUI==='function') updatePaletteUI();
}

function changeOpeningStyle(id, newStyle) {
  const op = state.openings.find(o => o.id === id);
  if (!op) return;
  op.style = newStyle;
  // Re-clamp offset for the new size
  const ww = wallWidth(op.wall);
  const ow = openingW(op);
  op.offset = clampOffset(op.offset, ww, ow);
  // Check that new size doesn't now overlap something
  const newCx = ww/2 + op.offset;
  if (wouldOverlap(op.type, newStyle, op.wall, newCx, id)) {
    const validCx = findValidPosition(op.type, newStyle, op.wall, newCx, id);
    if (validCx !== null) op.offset = validCx - ww/2;
  }
  buildRoom();
  updatePriceDisplay();
  renderOpeningsList();
}

function showPlacementError(msg) {
  const el = document.getElementById('placementError');
  if (!el) return;
  el.textContent = msg;
  el.style.display = 'block';
  clearTimeout(el._timer);
  el._timer = setTimeout(() => { el.style.display='none'; }, 2500);
}

// ─── MOUSE EVENTS ──────────────────────────────────────────────────────────────

let orbitActive=false, panActive=false, prevMouseX=0, prevMouseY=0;
let panAnchor = null;  // world point grabbed at pan start
let rightDragged = false;  // true if right-click turned into a pan drag (suppresses delete-on-right-click)
let rightDownX = 0, rightDownY = 0;  // screen coords at right-click mousedown
let edgeDragState = null;  // { wall, axis ('x'|'z'), sign (1|-1) } while dragging an edge handle
let partitionDragState = null;  // { id, axis, groundAnchor }

// ── Camera state: current values (what's rendered) and target values (where we're going)
let orbitTheta=0.343, orbitPhi=1.350, orbitRadius=22.11;
const _isMobile = window.innerWidth < 769;
let targetTheta=0.343, targetPhi=1.350, targetRadius=_isMobile ? 30 : 22.11;
const orbitTarget  = new THREE.Vector3(0, 1.5, 0);
const targetOrigin = new THREE.Vector3(0, 1.5, 0);

// Damping factor used only for animated transitions (mode switch, reset view).
// Drag input bypasses this entirely for immediate 1:1 response.
const CAM_DAMP = 0.20;

function updateCamera() {
  markDirty();
  camera.position.set(
    orbitTarget.x + orbitRadius * Math.sin(orbitPhi) * Math.sin(orbitTheta),
    orbitTarget.y + orbitRadius * Math.cos(orbitPhi),
    orbitTarget.z + orbitRadius * Math.sin(orbitPhi) * Math.cos(orbitTheta)
  );
  camera.lookAt(orbitTarget);
}

// Smooth camera tick — called every frame from the render loop.
// Lerps current values toward targets and triggers a render if anything moved.
function tickCamera() {
  const eps = 0.0001;
  let moved = false;

  const dTheta  = targetTheta  - orbitTheta;
  const dPhi    = targetPhi    - orbitPhi;
  const dRadius = targetRadius - orbitRadius;
  const dOx = targetOrigin.x - orbitTarget.x;
  const dOy = targetOrigin.y - orbitTarget.y;
  const dOz = targetOrigin.z - orbitTarget.z;

  if (Math.abs(dTheta)  > eps) { orbitTheta  += dTheta  * CAM_DAMP; moved = true; }
  if (Math.abs(dPhi)    > eps) { orbitPhi    += dPhi    * CAM_DAMP; moved = true; }
  if (Math.abs(dRadius) > eps) { orbitRadius += dRadius * CAM_DAMP; moved = true; }
  if (Math.abs(dOx) + Math.abs(dOy) + Math.abs(dOz) > eps) {
    orbitTarget.x += dOx * CAM_DAMP;
    orbitTarget.y += dOy * CAM_DAMP;
    orbitTarget.z += dOz * CAM_DAMP;
    moved = true;
  }

  if (moved) updateCamera();
}

canvas.addEventListener('mousedown', e => {
  e.preventDefault();

  // 0. Edge sphere handle → wall resize drag
  const eHit = raycastEdgeHandle(e);
  if (eHit && eHit.material.opacity > 0.05) {
    const wall = eHit.userData.edgeWall;
    const axis = (wall === 'front' || wall === 'back') ? 'z' : 'x';
    const sign = (wall === 'front' || wall === 'right') ? 1 : -1;
    const gp = raycastGround(e);
    edgeDragState = { wall, axis, sign, groundAnchor: gp };
    canvas.style.cursor = 'grab';
    eHit.material.opacity = 1;
    return;
  }

  // 0a. Interior door handle → drag door along wall
  if (e.button === 0) {
    const dh = raycastInteriorDoorHandle(e);
    if (dh) {
      const gp = raycastGround(e);
      if (gp) {
        const dt = dh.userData.doorType;
        if (dt === 'partition') {
          const p = state.partitions.find(p => p.id === dh.userData.partitionId);
          if (p) {
            const along = p.axis === 'x' ? gp.x : gp.z;
            interiorDoorDragState = { type: 'partition', partitionId: p.id, doorIndex: dh.userData.doorIndex, axis: p.axis, groundAnchorAlong: along };
            canvas.style.cursor = 'ew-resize';
            return;
          }
        } else if (dt === 'preset') {
          const r = state.presetRooms.find(r => r.id === dh.userData.presetRoomId);
          if (r) {
            const frame = _prFrame(r);
            const along = frame.alongAxis === 'x' ? gp.x : gp.z;
            interiorDoorDragState = { type: 'preset', presetRoomId: r.id, groundAnchorAlong: along };
            canvas.style.cursor = 'ew-resize';
            return;
          }
        }
      }
    }
  }

  // 0b-pre. Preset room handle → drag
  const prHit = raycastPresetRoomHandle(e);
  if (prHit) {
    const id   = prHit.userData.presetRoomId;
    const role = prHit.userData.presetRoomRole;
    const gp   = raycastGround(e);
    const r    = state.presetRooms.find(r => r.id === id);
    presetRoomDragState = {
      id, role, groundAnchor: gp,
      rawOffset: r ? r.offset : 0,
      rawDepth:  r ? r.depth  : 0,
      rawSideL:  r ? r.offset - r.width / 2 : 0,
      rawSideR:  r ? r.offset + r.width / 2 : 0,
      prevWall:  null,
    };
    canvas.style.cursor = 'grab';
    return;
  }

  // 0c. Furniture item → drag (free-standing or preset-room, both in furnitureMeshes)
  if (e.button === 0) {
    raycaster.setFromCamera(getMouseNDC(e), camera);

    // Placed electric → select on first click, drag on second
    const elecGroups0 = electricMeshes.map(em => em.group);
    const elecHits0 = raycaster.intersectObjects(elecGroups0, true);
    if (elecHits0.length) {
      let hitObj0 = elecHits0[0].object;
      while (hitObj0 && !hitObj0.userData.electricId) hitObj0 = hitObj0.parent;
      if (hitObj0?.userData.electricId != null) {
        const eid0 = hitObj0.userData.electricId;
        if (_selectedElectricId === eid0) {
          electricDragState = { id: eid0 };
        } else {
          deselectAll();
          selectElectric(eid0);
        }
        canvas.style.cursor = 'grab';
        return;
      }
    }

    // Furniture → select on first click, drag on second
    const fHits = raycaster.intersectObjects(furnitureMeshes, false);
    if (fHits.length) {
      const fid = fHits[0].object.userData.furnitureId;
      if (fid != null) {
        if (_selectedFurnitureId === fid) {
          const gp0 = raycastGround(e);
          const f0 = state.furniture.find(f => f.id === fid);
          furnitureDragState = { id: fid, groundAnchor: gp0, rawX: f0 ? f0.x : 0, rawZ: f0 ? f0.z : 0 };
        } else {
          deselectAll();
          selectFurniture(fid);
        }
        canvas.style.cursor = 'grab';
        return;
      }
    }
  }

  // 0b. Partition handle → drag
  const pHit = raycastPartitionHandle(e);
  if (pHit) {
    const id   = pHit.userData.partitionId;
    const role = pHit.userData.partitionRole;
    const axis = pHit.userData.partitionAxis;
    const gp   = raycastGround(e);
    const p0 = state.partitions.find(p => p.id === id);
    partitionDragState = {
      id, role, axis, groundAnchor: gp,
      // Raw (unsnapped) accumulator — avoids sticky-snap problem
      rawPos:   p0 ? p0.pos   : 0,
      rawStart: p0 ? p0.start : 0,
      rawEnd:   p0 ? p0.end   : 0,
    };
    canvas.style.cursor = 'grab';
    pHit.material.opacity = 1;
    return;
  }

  // 1. Hit an opening handle → select on first click, drag on second
  const hit = raycastHandles(e);
  if (hit) {
    const op = state.openings.find(o => o.id === hit.openingId);
    if (!op) return;
    if (selectedHandleId === op.id) {
      const ww = wallWidth(op.wall);
      dragState = { openingId: op.id, wall: op.wall, wallW: ww };
      canvas.style.cursor = 'grabbing';
    } else {
      deselectAll();
      selectHandle(op.id);
      canvas.style.cursor = 'grab';
    }
    return;
  }

  // 2. Palette active → place on wall
  if (activePaletteType) {
    const wh = raycastWall(e);
    if (wh) placeOpening(activePaletteType, wh.wallId, wh.localX);
    return;
  }

  // Clicked empty space — deselect everything
  deselectAll();

  // 3. Right-click or Shift+drag → pan camera
  if (e.button === 2 || e.shiftKey) {
    panActive = true; rightDragged = false;
    rightDownX = e.clientX; rightDownY = e.clientY;
    prevMouseX = e.clientX; prevMouseY = e.clientY;
    // Capture the world point under the cursor on a horizontal plane at target height
    const _panPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -orbitTarget.y);
    const _panRay = new THREE.Raycaster();
    _panRay.setFromCamera(getMouseNDC(e), camera);
    const _panHit = new THREE.Vector3();
    panAnchor = _panRay.ray.intersectPlane(_panPlane, _panHit) ? _panHit.clone() : null;
    canvas.style.cursor = 'move';
    return;
  }

  // 4. Click empty space → deselect + orbit (or pan in floorplan mode)
  selectedHandleId = null;
  refreshHandleColors();
  if (typeof renderSelectedOpening === 'function') renderSelectedOpening();
  orbitActive=true; prevMouseX=e.clientX; prevMouseY=e.clientY;
  if (floorplanViewMode) {
    // In floorplan: left-click always pans, never orbits — capture anchor for 2D pan
    const _panPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -orbitTarget.y);
    const _panRay = new THREE.Raycaster();
    _panRay.setFromCamera(getMouseNDC(e), camera);
    const _panHit = new THREE.Vector3();
    panAnchor = _panRay.ray.intersectPlane(_panPlane, _panHit) ? _panHit.clone() : null;
    canvas.style.cursor = 'move';
  }
});

canvas.addEventListener('dblclick', () => {
  if (!dragState) {
    targetOrigin.set(0, 1.5, 0);
    targetTheta = 0.343; targetPhi = 1.350; targetRadius = 22.11;
    markDirty();
  }
});

window.addEventListener('mouseup', () => {
  if (orbitActive && floorplanViewMode) canvas.style.cursor = 'default';
  orbitActive = false;
  panActive = false;
  panAnchor = null;
  if (edgeDragState) {
    edgeDragState = null;
    canvas.style.cursor = 'default';
    if (typeof stateHistory !== 'undefined') stateHistory.push();
  }
  if (presetRoomDragState) {
    presetRoomDragState = null;
    canvas.style.cursor = activePaletteType ? 'crosshair' : 'default';
    if (typeof stateHistory !== 'undefined') stateHistory.push();
  }
  if (partitionDragState) {
    partitionDragState = null;
    canvas.style.cursor = 'default';
    if (typeof stateHistory !== 'undefined') stateHistory.push();
  }
  if (electricDragState) {
    electricDragState = null;
    canvas.style.cursor = 'default';
    if (typeof stateHistory !== 'undefined') stateHistory.push();
  }
  if (furnitureDragState) {
    furnitureDragState = null;
    canvas.style.cursor = 'default';
    if (typeof stateHistory !== 'undefined') stateHistory.push();
  }
  if (interiorDoorDragState) {
    interiorDoorDragState = null;
    canvas.style.cursor = 'default';
    if (typeof stateHistory !== 'undefined') stateHistory.push();
  }
  if (dragState) {
    dragState = null;
    canvas.style.cursor = activePaletteType ? 'crosshair' : (hoveredHandleId ? 'grab' : 'default');
    if (typeof stateHistory !== 'undefined') stateHistory.push();
  }
});

window.addEventListener('mousemove', e => {
  // Interior door drag
  if (interiorDoorDragState) {
    const gp = raycastGround(e);
    if (gp) {
      const ds = interiorDoorDragState;
      if (ds.type === 'partition') {
        const p = state.partitions.find(p => p.id === ds.partitionId);
        const d = p && p.doors && p.doors[ds.doorIndex];
        if (p && d) {
          const DOOR_W = 0.9, MARGIN = 0.15;
          const along = p.axis === 'x' ? gp.x : gp.z;
          const delta = along - ds.groundAnchorAlong;
          ds.groundAnchorAlong = along;
          const wallLen = p.end - p.start;
          d.offset = Math.max(DOOR_W / 2 + MARGIN, Math.min(wallLen - DOOR_W / 2 - MARGIN, d.offset + delta));
          buildPartitions();
          markDirty();
        }
      } else if (ds.type === 'preset') {
        const r = state.presetRooms.find(r => r.id === ds.presetRoomId);
        if (r) {
          const frame = _prFrame(r);
          const PR_DOOR_W = 0.9, MARGIN = 0.08;
          const along = frame.alongAxis === 'x' ? gp.x : gp.z;
          const delta = along - ds.groundAnchorAlong;
          ds.groundAnchorAlong = along;
          // doorOffset is relative to r.offset; clamp so door stays in wall
          const maxOff = r.width / 2 - PR_DOOR_W / 2 - MARGIN;
          r.doorOffset = Math.max(-maxOff, Math.min(maxOff, (r.doorOffset || 0) + delta));
          buildPresetRooms();
          buildFurniture();
          markDirty();
        }
      }
    }
    return;
  }

  // Electric drag (wall-snap repositioning)
  if (electricDragState) {
    const snap = _electricWallRaycast(e);
    if (snap) {
      const el = (state.electrics || []).find(x => x.id === electricDragState.id);
      if (el) {
        el.x = snap.x; el.z = snap.z; el.rotY = snap.rotY;
        const em = electricMeshes.find(m => m.id === el.id);
        if (em) { em.group.position.x = el.x; em.group.position.z = el.z; em.group.rotation.y = el.rotY; }
      }
    }
    markDirty();
    return;
  }

  // Furniture drag
  if (furnitureDragState) {
    const gp = raycastGround(e);
    if (gp && furnitureDragState.groundAnchor) {
      const f = state.furniture.find(f => f.id === furnitureDragState.id);
      if (f) {
        const def = FURNITURE_CATALOG[f.type];
        const dims = def ? { w: def.w, d: def.d }
          : (f.dims ? { w: Array.isArray(f.dims) ? f.dims[0] : f.dims.w,
                        d: Array.isArray(f.dims) ? f.dims[2] : f.dims.d } : null);

        if (def?.wallHug && dims) {
          // ── Wall-hug mode ──────────────────────────────────────────────────
          // Piece must keep its back face against a wall at all times.
          // Determine whether to snap inside a preset room or against exterior walls.
          if (f.presetRoomId != null) {
            const r = state.presetRooms.find(r => r.id === f.presetRoomId);
            const frame = r && _prFrame(r);
            if (r && frame) {
              let groupX, groupZ, groupRotY;
              if (frame.alongAxis === 'x') {
                groupX = r.offset; groupZ = frame.wallPos + frame.depthSign * r.depth / 2;
                groupRotY = frame.depthSign === 1 ? 0 : Math.PI;
              } else {
                groupX = frame.wallPos + frame.depthSign * r.depth / 2; groupZ = r.offset;
                groupRotY = frame.depthSign === 1 ? Math.PI / 2 : -Math.PI / 2;
              }
              const cr = Math.cos(groupRotY), sr = Math.sin(groupRotY);
              // World → local room space
              const lpx = (gp.x - groupX) * cr - (gp.z - groupZ) * sr;
              const lpz = (gp.x - groupX) * sr + (gp.z - groupZ) * cr;
              const snap = _wallHugSnapLocal(lpx, lpz, dims.w, dims.d, r.width / 2, r.depth / 2);
              // Local → world
              f.x = groupX + cr * snap.x + sr * snap.z;
              f.z = groupZ - sr * snap.x + cr * snap.z;
              f.localX = snap.x; f.localZ = snap.z;
              f.localRotY = snap.rotY;
              f.rotY = groupRotY + snap.rotY;
            }
          } else {
            // Snap to nearest exterior wall
            const snap = _snapToNearestWallFace(gp.x, gp.z, dims.w, dims.d, _gatherWallFaces(), state.width / 2, state.depth / 2);
            f.x = snap.x; f.z = snap.z; f.rotY = snap.rotY;
          }
        } else {
          // ── Free movement with boundary clamp ──────────────────────────────
          // Accumulate raw (unsnapped) position so grid snap doesn't resist cursor movement
          furnitureDragState.rawX += gp.x - furnitureDragState.groundAnchor.x;
          furnitureDragState.rawZ += gp.z - furnitureDragState.groundAnchor.z;
          f.x = _snapEnabled ? _snapToGrid(furnitureDragState.rawX) : furnitureDragState.rawX;
          f.z = _snapEnabled ? _snapToGrid(furnitureDragState.rawZ) : furnitureDragState.rawZ;
          if (dims) {
            const hw = state.width / 2, hd = state.depth / 2;
            const rotY = f.rotY ?? 0;
            const cosA = Math.abs(Math.cos(rotY));
            const sinA = Math.abs(Math.sin(rotY));
            const hrX = cosA * dims.w / 2 + sinA * dims.d / 2;
            const hrZ = sinA * dims.w / 2 + cosA * dims.d / 2;
            const MARGIN = 0.05;
            const WALL_SNAP = 0.15;
            f.x = Math.max(-hw + hrX + MARGIN, Math.min(hw - hrX - MARGIN, f.x));
            f.z = Math.max(-hd + hrZ + MARGIN, Math.min(hd - hrZ - MARGIN, f.z));
            if (Math.abs(f.x - (-hw + hrX + MARGIN)) < WALL_SNAP) f.x = -hw + hrX + MARGIN;
            if (Math.abs(f.x - ( hw - hrX - MARGIN)) < WALL_SNAP) f.x =  hw - hrX - MARGIN;
            if (Math.abs(f.z - (-hd + hrZ + MARGIN)) < WALL_SNAP) f.z = -hd + hrZ + MARGIN;
            if (Math.abs(f.z - ( hd - hrZ - MARGIN)) < WALL_SNAP) f.z =  hd - hrZ - MARGIN;
          }
        }
        furnitureDragState.groundAnchor = gp;
        // If this piece belongs to a preset room, back-transform to update local coords
        // so the piece keeps its new position if the room moves later
        if (f.presetRoomId != null) {
          const r = state.presetRooms.find(r => r.id === f.presetRoomId);
          if (r) {
            const frame = _prFrame(r);
            if (frame) {
              let groupX, groupZ, groupRotY;
              if (frame.alongAxis === 'x') {
                groupX = r.offset;
                groupZ = frame.wallPos + frame.depthSign * r.depth / 2;
                groupRotY = frame.depthSign === 1 ? 0 : Math.PI;
              } else {
                groupX = frame.wallPos + frame.depthSign * r.depth / 2;
                groupZ = r.offset;
                groupRotY = frame.depthSign === 1 ? Math.PI / 2 : -Math.PI / 2;
              }
              const cos = Math.cos(-groupRotY), sin = Math.sin(-groupRotY);
              const dx2 = f.x - groupX, dz2 = f.z - groupZ;
              f.localX = cos * dx2 + sin * dz2;
              f.localZ = -sin * dx2 + cos * dz2;
            }
          }
        }
        // Move the mesh/group directly for smooth feel; full rebuild on mouseup
        const group = furnitureGroups[f.id];
        if (group) { group.position.x = f.x; group.position.z = f.z; group.rotation.y = f.rotY ?? 0; }
        else {
          const mesh = furnitureMeshes.find(m => m.userData.furnitureId === f.id);
          if (mesh) { mesh.position.x = f.x; mesh.position.z = f.z; mesh.rotation.y = f.rotY ?? 0; }
        }
        markDirty();
      }
    }
    return;
  }

  // Preset room drag
  if (presetRoomDragState) {
    const { id, role } = presetRoomDragState;
    const gp = raycastGround(e);
    if (gp) {
      const r = state.presetRooms.find(r => r.id === id);
      if (r) {
        const frame = _prFrame(r);
        const { alongAxis, depthSign, limit } = frame;
        const dX = gp.x - presetRoomDragState.groundAnchor.x;
        const dZ = gp.z - presetRoomDragState.groundAnchor.z;
        const dAlong = alongAxis === 'x' ? dX : dZ;
        const dDepth = alongAxis === 'x' ? dZ * depthSign : dX * depthSign;

        const ANCHOR_SNAP = 0.4;

        if (role === 'move') {
          // Translate only — no dimension change
          const oldOffset = r.offset;
          presetRoomDragState.rawOffset += dAlong;
          const halfW   = r.width / 2;
          const snapped = _snapToGrid(presetRoomDragState.rawOffset);
          r.offset = Math.max(-limit + halfW + TK, Math.min(limit - halfW - TK, snapped));
          // Shift associated furniture by the same world-space delta
          const deltaOffset = r.offset - oldOffset;
          if (deltaOffset !== 0) {
            state.furniture.filter(f => f.presetRoomId === r.id).forEach(f => {
              if (alongAxis === 'x') f.x += deltaOffset; else f.z += deltaOffset;
            });
          }

          // Auto re-anchor when an edge gets within ANCHOR_SNAP of a perpendicular exterior wall.
          // prevWall guard prevents oscillation: after switching wall A→B, don't immediately
          // switch back B→A because the edge is still sitting at the corner.
          const leftEdge  = r.offset - halfW;
          const rightEdge = r.offset + halfW;
          const oldWallPos   = frame.wallPos;
          const oldDepthSign = frame.depthSign;
          const leftTarget  = alongAxis === 'x' ? 'left'  : 'back';
          const rightTarget = alongAxis === 'x' ? 'right' : 'front';
          if (Math.abs(leftEdge + limit) < ANCHOR_SNAP && presetRoomDragState.prevWall !== leftTarget) {
            const oldW = r.width, oldD = r.depth;
            presetRoomDragState.prevWall = r.wall;
            r.wall   = leftTarget;
            r.offset = oldWallPos + oldDepthSign * oldD / 2;
            r.width  = oldD;
            r.depth  = oldW;
            state.furniture = state.furniture.filter(f => f.presetRoomId !== r.id);
            r.doorOffset = 0;
            presetRoomDragState.rawOffset = r.offset;
          } else if (Math.abs(rightEdge - limit) < ANCHOR_SNAP && presetRoomDragState.prevWall !== rightTarget) {
            const oldW = r.width, oldD = r.depth;
            presetRoomDragState.prevWall = r.wall;
            r.wall   = rightTarget;
            r.offset = oldWallPos + oldDepthSign * oldD / 2;
            r.width  = oldD;
            r.depth  = oldW;
            state.furniture = state.furniture.filter(f => f.presetRoomId !== r.id);
            r.doorOffset = 0;
            presetRoomDragState.rawOffset = r.offset;
          }

        } else if (role === 'depth') {
          presetRoomDragState.rawDepth += dDepth;
          const maxDepth = (alongAxis === 'x' ? state.depth : state.width) - TK * 2;
          r.depth = Math.min(maxDepth, Math.max(PR_MIN_D, _snapToGrid(presetRoomDragState.rawDepth)));
          state.furniture = state.furniture.filter(f => f.presetRoomId !== r.id);

        } else if (role === 'sideL') {
          presetRoomDragState.rawSideL += dAlong;
          const snapped = _snapToGrid(presetRoomDragState.rawSideL);
          const rightEdge = r.offset + r.width / 2;
          const newLeft = Math.max(-limit + TK, Math.min(rightEdge - PR_MIN_W, snapped));
          r.offset = (newLeft + rightEdge) / 2;
          r.width  = rightEdge - newLeft;
          state.furniture = state.furniture.filter(f => f.presetRoomId !== r.id);

        } else if (role === 'sideR') {
          presetRoomDragState.rawSideR += dAlong;
          const snapped = _snapToGrid(presetRoomDragState.rawSideR);
          const leftEdge = r.offset - r.width / 2;
          const newRight = Math.min(limit - TK, Math.max(leftEdge + PR_MIN_W, snapped));
          r.offset = (leftEdge + newRight) / 2;
          r.width  = newRight - leftEdge;
          state.furniture = state.furniture.filter(f => f.presetRoomId !== r.id);
        }

        presetRoomDragState.groundAnchor = gp;
        buildPresetRooms();
        buildFurniture();
        markDirty();
      }
    }
    return;
  }

  // Partition drag — only rebuild partitions, not the whole room
  if (partitionDragState) {
    const { id, role, axis, groundAnchor } = partitionDragState;
    const gp = raycastGround(e);
    if (gp && groundAnchor) {
      const p = state.partitions.find(p => p.id === id);
      if (p) {
        const prevPos = p.pos, prevStart = p.start, prevEnd = p.end;
        const dX = gp.x - groundAnchor.x;
        const dZ = gp.z - groundAnchor.z;
        if (role === 'move') {
          partitionDragState.rawPos += (axis === 'x') ? dZ : dX;
          p.pos = _snapPos(axis, partitionDragState.rawPos);
        } else if (role === 'start') {
          partitionDragState.rawStart += (axis === 'x') ? dX : dZ;
          const snapped = _snapEnd(axis, partitionDragState.rawStart);
          if (p.end - snapped >= 0.5) p.start = snapped;
        } else if (role === 'end') {
          partitionDragState.rawEnd += (axis === 'x') ? dX : dZ;
          const snapped = _snapEnd(axis, partitionDragState.rawEnd);
          if (snapped - p.start >= 0.5) p.end = snapped;
        }
        partitionDragState.groundAnchor = gp;
        if (p.pos !== prevPos || p.start !== prevStart || p.end !== prevEnd) {
          buildPartitions();
          markDirty();
        }
      }
    }
    return;
  }

  // Edge handle drag → resize wall (only rebuild when snapped value changes)
  if (edgeDragState) {
    const { axis, sign, groundAnchor } = edgeDragState;
    const gp = raycastGround(e);
    if (gp && groundAnchor) {
      const prevW = state.width, prevD = state.depth;
      if (axis === 'z') {
        const delta = gp.z - groundAnchor.z;
        state.depth = Math.round(Math.max(2, Math.min(8, state.depth + delta * sign * 2)) * 4) / 4;
      } else {
        const delta = gp.x - groundAnchor.x;
        state.width = Math.round(Math.max(2, Math.min(10, state.width + delta * sign * 2)) * 4) / 4;
      }
      edgeDragState.groundAnchor = gp;
      if (state.width !== prevW || state.depth !== prevD) {
        buildRoom();
        if (typeof updatePriceDisplay === 'function') updatePriceDisplay();
        if (typeof syncDimSliders === 'function') syncDimSliders();
      }
    }
    return;
  }

  // Pan camera — raycast against horizontal plane at target height for 1:1 tracking
  if (panActive) {
    const totalDx = e.clientX - rightDownX, totalDy = e.clientY - rightDownY;
    if (Math.sqrt(totalDx * totalDx + totalDy * totalDy) > 6) rightDragged = true;
    if (panAnchor) {
      const _panPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -orbitTarget.y);
      const _panRay = new THREE.Raycaster();
      _panRay.setFromCamera(getMouseNDC(e), camera);
      const _panHit = new THREE.Vector3();
      if (_panRay.ray.intersectPlane(_panPlane, _panHit)) {
        // Move target so that the grabbed world point stays under the cursor
        const delta = panAnchor.clone().sub(_panHit);
        delta.y = 0;
        orbitTarget.add(delta);
        targetOrigin.copy(orbitTarget);
        updateCamera();
      }
    }
    return;
  }

  if (dragState) {
    const wh = raycastWall(e);
    if (!wh || wh.wallId !== dragState.wall) return;
    const op = state.openings.find(o => o.id === dragState.openingId);
    if (!op) return;

    const targetCx = wh.localX;
    const validCx  = findValidPosition(op.type, op.style, op.wall, targetCx, op.id);
    if (validCx === null) return;
    const newOffset = validCx - dragState.wallW / 2;
    if (newOffset === op.offset) return;  // no change — skip rebuild
    op.offset = newOffset;

    buildRoom();
    updatePriceDisplay();
    renderOpeningsList();
    if (typeof renderSelectedOpening === 'function') renderSelectedOpening();
    return;
  }

  if (orbitActive) {
    if (floorplanViewMode) {
      // In floorplan mode left-drag pans, not orbits
      if (panAnchor) {
        const _panPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -orbitTarget.y);
        const _panRay = new THREE.Raycaster();
        _panRay.setFromCamera(getMouseNDC(e), camera);
        const _panHit = new THREE.Vector3();
        if (_panRay.ray.intersectPlane(_panPlane, _panHit)) {
          const delta = panAnchor.clone().sub(_panHit);
          delta.y = 0;
          orbitTarget.add(delta);
          targetOrigin.copy(orbitTarget);
          updateCamera();
        }
      }
    } else {
      // Direct 1:1 response — set both current and target so lerp has no work to do
      const speed = 0.005 + orbitRadius * 0.00020;
      const dTheta = -(e.clientX - prevMouseX) * speed;
      const dPhi   = -(e.clientY - prevMouseY) * speed;
      targetTheta  = orbitTheta  += dTheta;
      targetPhi    = orbitPhi    = Math.max(0.05, Math.min(1.35, orbitPhi + dPhi));
      prevMouseX = e.clientX; prevMouseY = e.clientY;
      updateCamera();
    }
    return;
  }

  const hh = raycastHandles(e);
  const newId = hh ? hh.openingId : null;
  if (newId !== hoveredHandleId) {
    hoveredHandleId = newId;
    refreshHandleColors();
    canvas.style.cursor = activePaletteType ? 'crosshair' : (hoveredHandleId ? 'grab' : 'default');
  }

  // Update edge handle sphere and opening handle visibility based on cursor proximity
  updateEdgeHandleVisibility(e.clientX, e.clientY);
  updateHandleVisibility(e.clientX, e.clientY);
  updatePartitionHandleVisibility(e.clientX, e.clientY);
  updatePresetRoomHandleVisibility(e.clientX, e.clientY);
  updateInteriorDoorHandleVisibility(e.clientX, e.clientY);

  // Furniture hover highlight
  if (!furnitureDragState) {
    raycaster.setFromCamera(getMouseNDC(e), camera);
    const fHover = raycaster.intersectObjects(furnitureMeshes, false);
    _setFurnitureHover(fHover.length ? fHover[0].object.userData.furnitureId : null);
  }
});

canvas.addEventListener('mouseleave', () => { _setFurnitureHover(null); });

canvas.addEventListener('contextmenu', e => {
  e.preventDefault();
  if (rightDragged) { rightDragged = false; return; }
  rightDragged = false;

  const ctx = window._ctxMenu;
  if (!ctx) return;

  // --- Check what was clicked ---
  const handle = raycastHandles(e);
  if (handle) {
    const op = state.openings.find(o => o.id === handle.openingId);
    if (!op) return;
    const label = op.type === 'door' ? 'Door' : 'Window';
    const walls = ['front','back','left','right'];
    const moveItems = walls.filter(w => w !== op.wall).map(w => ({
      icon: '↩', label: `Move to ${w} wall`,
      action() { op.wall = w; op.offset = 0; stateHistory.push(); buildRoom(); if (typeof renderOpeningsList==='function') renderOpeningsList(); }
    }));
    ctx.show(e.clientX, e.clientY, [
      { icon: '✕', label: `Delete ${label}`, danger: true, action() { deleteOpening(op.id); } },
      'sep',
      ...moveItems,
    ]);
    return;
  }

  // Check partition body (recursive=true handles door pivot Groups)
  raycaster.setFromCamera(getMouseNDC(e), camera);
  const partHits = raycaster.intersectObjects(partitionMeshes.map(pm => pm.mesh), true);
  if (partHits.length) {
    // Walk up to the object that owns partitionId (mesh may be inside a Group)
    let hitObj = partHits[0].object;
    while (hitObj && !hitObj.userData.partitionId) hitObj = hitObj.parent;
    const pid = hitObj?.userData.partitionId;
    const p   = state.partitions.find(x => x.id === pid);
    if (!p) return;
    const lenM = (p.end - p.start).toFixed(2);
    // Work out where along the wall the right-click landed
    const partRayHit = partHits[0].point;
    const hitAlong = p.axis === 'x' ? partRayHit.x : partRayHit.z;
    const doorOffset = Math.max(p.start + 0.5, Math.min(p.end - 0.5, hitAlong));

    const DOOR_MARGIN = 0.15;  // min clear space between door edge and wall end / other door
    const wallLen = p.end - p.start;
    const relOffset = doorOffset - p.start;

    // Check there's enough room at the click point
    const clearStart = relOffset - DOOR_W / 2 >= DOOR_MARGIN;
    const clearEnd   = relOffset + DOOR_W / 2 <= wallLen - DOOR_MARGIN;
    const noOverlap  = (p.doors || []).every(d =>
      Math.abs(d.offset - relOffset) >= DOOR_W + DOOR_MARGIN * 2
    );
    const canAddDoor = clearStart && clearEnd && noOverlap;

    const hasDoors = (p.doors || []).length > 0;
    const doorItems = (p.doors || []).map((d, i) => ({
      icon: '🚪', label: `Remove door at ${(p.start + d.offset).toFixed(2)}m`,
      danger: true,
      action() {
        p.doors.splice(i, 1);
        stateHistory.push(); buildPartitions(); markDirty();
      }
    }));

    const addDoorItem = canAddDoor
      ? { icon: '🚪', label: 'Add door here', action() {
          if (!p.doors) p.doors = [];
          p.doors.push({ offset: relOffset });
          stateHistory.push(); buildPartitions(); markDirty();
        }}
      : { icon: '🚪', disabled: true,
          label: wallLen < DOOR_W + DOOR_MARGIN * 2
            ? `Too short — need ≥${(DOOR_W + DOOR_MARGIN * 2).toFixed(1)}m`
            : 'No space here for a door',
          action() {} };

    ctx.show(e.clientX, e.clientY, [
      { icon: 'ℹ', label: `Wall — ${lenM} m`, disabled: true, action() {} },
      'sep',
      addDoorItem,
      ...(hasDoors ? ['sep', ...doorItems] : []),
      'sep',
      { icon: '✕', label: 'Delete wall', danger: true, action() {
        const idx = state.partitions.findIndex(x => x.id === pid);
        if (idx !== -1) { state.partitions.splice(idx,1); stateHistory.push(); buildPartitions(); markDirty(); if (typeof renderPartitionsList==='function') renderPartitionsList(); }
        const key = p.axis==='x' ? 'horizontal_wall' : 'vertical_wall';
        if (typeof updateItemQty==='function') updateItemQty('structuralItems', key, -1);
      }},
    ]);
    return;
  }

  // Check preset room walls
  const prBodyHits = raycaster.intersectObjects(
    presetRoomMeshes.flatMap(p => p.meshes.filter(m => !m.userData.isFurniture)),
    true
  );
  if (prBodyHits.length) {
    const rid = prBodyHits[0].object.userData.presetRoomId ??
                prBodyHits[0].object.parent?.userData?.presetRoomId;
    if (rid != null) {
      const r = state.presetRooms.find(x => x.id === rid);
      if (r) {
        const wallLabels2 = { front: 'Front', back: 'Back', left: 'Left', right: 'Right' };
        const moveItems = ['front','back','left','right']
          .filter(w => w !== r.wall)
          .map(w => ({
            icon: '↩', label: `Move to ${wallLabels2[w]} wall`,
            action() {
              r.wall = w; r.offset = 0;
              state.furniture = state.furniture.filter(f => f.presetRoomId !== r.id);
              stateHistory.push(); buildRoom();
            }
          }));
        ctx.show(e.clientX, e.clientY, [
          { icon: '🏠', label: `${r.type.charAt(0).toUpperCase()+r.type.slice(1)} room — ${r.width.toFixed(1)}m × ${r.depth.toFixed(1)}m`, disabled: true, action(){} },
          'sep',
          ...moveItems,
          'sep',
          { icon: '✕', label: 'Delete room', danger: true, action() {
            state.furniture = state.furniture.filter(f => f.presetRoomId !== rid);
            state.presetRooms = state.presetRooms.filter(x => x.id !== rid);
            stateHistory.push(); buildRoom();
          }},
        ]);
        return;
      }
    }
  }

  // Check placed electrics
  const elecGroups = electricMeshes.map(em => em.group);
  const elecHits = raycaster.intersectObjects(elecGroups, true);
  if (elecHits.length) {
    let hitObj = elecHits[0].object;
    while (hitObj && !hitObj.userData.electricId) hitObj = hitObj.parent;
    const eid = hitObj?.userData.electricId;
    const el = (state.electrics || []).find(x => x.id === eid);
    if (el) {
      const def = ELECTRICS_CATALOG[el.type];
      const elLabel = def ? def.label : el.type;
      ctx.show(e.clientX, e.clientY, [
        { icon: '🔌', label: elLabel, disabled: true, action() {} },
        'sep',
        { icon: '↑', label: 'Raise 100mm', action() {
          el.mountY = Math.min(state.height - 0.05, el.mountY + 0.10);
          stateHistory.push(); buildElectrics(); markDirty();
        }},
        { icon: '↓', label: 'Lower 100mm', action() {
          el.mountY = Math.max(0.05, el.mountY - 0.10);
          stateHistory.push(); buildElectrics(); markDirty();
        }},
        'sep',
        { icon: '✕', label: 'Delete', danger: true, action() {
          const pKey = ELECTRIC_PRICING_KEY[el.type];
          if (pKey && state.electricalItems[pKey] > 0) state.electricalItems[pKey]--;
          const _qEl = pKey ? document.getElementById('qty-' + pKey) : null;
      if (_qEl) _qEl.textContent = state.electricalItems[pKey];
          state.electrics = state.electrics.filter(x => x.id !== eid);
          stateHistory.push(); buildElectrics(); markDirty();
          if (typeof updatePriceDisplay === 'function') updatePriceDisplay();
          if (typeof renderElectricsList === 'function') renderElectricsList();
        }},
      ]);
      return;
    }
  }

  // Check furniture
  const fBodyHits = raycaster.intersectObjects(furnitureMeshes, false);
  if (fBodyHits.length) {
    const fid = fBodyHits[0].object.userData.furnitureId;
    const f = state.furniture.find(x => x.id === fid);
    if (f) {
      const def = FURNITURE_CATALOG[f.type];
      const fLabel = f.type === '__preset__' ? 'Room furniture' : (def ? def.label : f.type);
      ctx.show(e.clientX, e.clientY, [
        { icon: '🪑', label: fLabel, disabled: true, action() {} },
        'sep',
        { icon: '↻', label: 'Rotate +45°', action() {
          f.rotY = ((f.rotY ?? 0) + Math.PI / 4) % (Math.PI * 2);
          stateHistory.push(); buildFurniture(); markDirty();
        }},
        { icon: '↺', label: 'Rotate -45°', action() {
          f.rotY = ((f.rotY ?? 0) - Math.PI / 4 + Math.PI * 2) % (Math.PI * 2);
          stateHistory.push(); buildFurniture(); markDirty();
        }},
        { icon: '↻', label: 'Rotate +90°', action() {
          f.rotY = ((f.rotY ?? 0) + Math.PI / 2) % (Math.PI * 2);
          stateHistory.push(); buildFurniture(); markDirty();
        }},
        { icon: '↺', label: 'Rotate -90°', action() {
          f.rotY = ((f.rotY ?? 0) - Math.PI / 2 + Math.PI * 2) % (Math.PI * 2);
          stateHistory.push(); buildFurniture(); markDirty();
        }},
        { icon: '⊙', label: `Set angle… (${Math.round(((f.rotY ?? 0) * 180 / Math.PI))}°)`, action() {
          const cur = Math.round((f.rotY ?? 0) * 180 / Math.PI);
          const raw = prompt('Enter rotation angle (0–360°):', cur);
          if (raw === null) return;
          const deg = parseFloat(raw);
          if (isNaN(deg)) return;
          f.rotY = ((deg % 360) + 360) % 360 * Math.PI / 180;
          stateHistory.push(); buildFurniture(); markDirty();
        }},
        { icon: '⟳', label: 'Reset rotation', action() {
          f.rotY = 0;
          stateHistory.push(); buildFurniture(); markDirty();
        }},
        { icon: '✕', label: 'Delete', danger: true, action() {
          state.furniture = state.furniture.filter(x => x.id !== fid);
          stateHistory.push(); buildFurniture(); markDirty();
          if (typeof renderFurnitureList === 'function') renderFurnitureList();
        }},
      ]);
      return;
    }
  }

  // Empty canvas — show camera/view shortcuts
  ctx.show(e.clientX, e.clientY, [
    { icon: '🏠', label: 'Reset view',    action() { targetTheta=0.343; targetPhi=1.350; targetRadius=(_isMobile?30:22.11); targetOrigin.set(0,1.5,0); markDirty(); } },
    { icon: '🔲', label: 'Floorplan view', action() { toggleFloorplanView(); } },
    { icon: '👁', label: 'Interior view',  action() { toggleInteriorView(); } },
  ]);
});

window.addEventListener('keydown', e => {
  if (e.key==='Delete'||e.key==='Backspace') {
    if (document.activeElement.tagName==='INPUT'||document.activeElement.tagName==='TEXTAREA') return;
    if (selectedHandleId!==null) deleteOpening(selectedHandleId);
  }
  if (e.key==='Escape') { setActivePalette(null); if(typeof updatePaletteUI==='function') updatePaletteUI(); }
});

canvas.addEventListener('wheel', e => {
  // Rotate selected furniture with scroll (22.5° per notch) — only when already selected
  if (_selectedFurnitureId !== null) {
    raycaster.setFromCamera(getMouseNDC(e), camera);
    const fWheelHits = raycaster.intersectObjects(furnitureMeshes, false);
    if (fWheelHits.length && fWheelHits[0].object.userData.furnitureId === _selectedFurnitureId) {
      const fw = state.furniture.find(f => f.id === _selectedFurnitureId);
      if (fw) {
        const step = Math.PI / 8; // 22.5°
        fw.rotY = ((fw.rotY ?? 0) + Math.sign(e.deltaY) * step + Math.PI * 2) % (Math.PI * 2);
        const grp = furnitureGroups[fw.id];
        if (grp) { grp.rotation.y = fw.rotY; }
        else {
          const mesh = furnitureMeshes.find(m => m.userData.furnitureId === fw.id);
          if (mesh) mesh.rotation.y = fw.rotY;
        }
        stateHistory.push();
        markDirty();
        e.preventDefault();
        return;
      }
    }
  }
  // Exponential zoom feels consistent — same number of scroll clicks regardless
  // of current distance. Factor of 1.12 per 100px of deltaY.
  // Apply directly — no lerp lag on scroll
  orbitRadius = targetRadius = Math.max(4, Math.min(28, orbitRadius * Math.pow(1.15, e.deltaY / 100)));
  updateCamera();
  e.preventDefault();
}, { passive: false });

// ─── TOUCH CONTROLS ────────────────────────────────────────────────────────────

let touchState = null;
// touchState types: 'orbit', 'pinch', 'handle'

function pinchDist(touches) {
  const dx = touches[0].clientX - touches[1].clientX;
  const dy = touches[0].clientY - touches[1].clientY;
  return Math.sqrt(dx*dx + dy*dy);
}

let _longPressTimer = null;
function _cancelLongPress() { if (_longPressTimer) { clearTimeout(_longPressTimer); _longPressTimer = null; } }

canvas.addEventListener('touchstart', e => {
  e.preventDefault();
  _cancelLongPress();
  const t0 = e.touches[0];

  if (e.touches.length === 2) {
    _cancelLongPress();
    touchState = {
      type: 'pinch',
      lastDist: pinchDist(e.touches),
      lastMidX: (e.touches[0].clientX + e.touches[1].clientX) / 2,
      lastMidY: (e.touches[0].clientY + e.touches[1].clientY) / 2,
    };
    return;
  }

  const fakeEvent = { clientX: t0.clientX, clientY: t0.clientY };

  // Single touch — check for preset room handle first
  const prHitT = raycastPresetRoomHandle(fakeEvent);
  if (prHitT) {
    const id   = prHitT.userData.presetRoomId;
    const role = prHitT.userData.presetRoomRole;
    const gp   = raycastGround(fakeEvent);
    const r    = state.presetRooms.find(r => r.id === id);
    presetRoomDragState = {
      id, role, groundAnchor: gp,
      rawOffset: r ? r.offset : 0,
      rawDepth:  r ? r.depth  : 0,
      rawSideL:  r ? r.offset - r.width / 2 : 0,
      rawSideR:  r ? r.offset + r.width / 2 : 0,
      prevWall:  null,
    };
    touchState = { type: 'presetRoom' };
    return;
  }

  // Check for partition handle
  const pHit = raycastPartitionHandle(fakeEvent);
  if (pHit) {
    const id   = pHit.userData.partitionId;
    const role = pHit.userData.partitionRole;
    const axis = pHit.userData.partitionAxis;
    const gp   = raycastGround(fakeEvent);
    const p0   = state.partitions.find(p => p.id === id);
    partitionDragState = {
      id, role, axis, groundAnchor: gp,
      rawPos:   p0 ? p0.pos   : 0,
      rawStart: p0 ? p0.start : 0,
      rawEnd:   p0 ? p0.end   : 0,
    };
    touchState = { type: 'partition' };
    return;
  }

  // Check for opening handle
  const handleHit = raycastHandles(fakeEvent);
  if (handleHit) {
    const op = state.openings.find(o => o.id === handleHit.openingId);
    if (op) {
      selectHandle(op.id);
      touchState = {
        type: 'handle',
        openingId: op.id,
        wall: op.wall,
        wallW: wallWidth(op.wall),
      };
      return;
    }
  }

  // Check for placed electric → select or drag
  const elecGroups0 = electricMeshes.map(em => em.group);
  const elecHits0 = raycaster.intersectObjects(elecGroups0, true);
  if (elecHits0.length) {
    let hitObj0 = elecHits0[0].object;
    while (hitObj0 && !hitObj0.userData.electricId) hitObj0 = hitObj0.parent;
    if (hitObj0?.userData.electricId != null) {
      const eid = hitObj0.userData.electricId;
      if (_selectedElectricId === eid) {
        electricDragState = { id: eid };
        touchState = { type: 'electric' };
      } else {
        deselectAll(); selectElectric(eid);
        touchState = { type: 'orbit', lastX: t0.clientX, lastY: t0.clientY, startX: t0.clientX, startY: t0.clientY, moved: false };
      }
      return;
    }
  }

  // Check for placed furniture → select or drag
  raycaster.setFromCamera(getMouseNDC(fakeEvent), camera);
  const fHitsT = raycaster.intersectObjects(furnitureMeshes, false);
  if (fHitsT.length) {
    const fid = fHitsT[0].object.userData.furnitureId;
    if (fid != null) {
      if (_selectedFurnitureId === fid) {
        const gp0 = raycastGround(fakeEvent);
        const f0 = state.furniture.find(f => f.id === fid);
        furnitureDragState = { id: fid, groundAnchor: gp0, rawX: f0 ? f0.x : 0, rawZ: f0 ? f0.z : 0 };
        touchState = { type: 'furniture' };
      } else {
        deselectAll(); selectFurniture(fid);
        touchState = { type: 'orbit', lastX: t0.clientX, lastY: t0.clientY, startX: t0.clientX, startY: t0.clientY, moved: false };
      }
      return;
    }
  }

  // Long-press → context menu (fires if finger doesn't move for 500ms)
  _longPressTimer = setTimeout(() => {
    _longPressTimer = null;
    touchState = null;  // cancel orbit so it doesn't keep going
    // Synthesise a contextmenu event at the touch point
    canvas.dispatchEvent(Object.assign(new MouseEvent('contextmenu', {
      bubbles: true, cancelable: true, clientX: t0.clientX, clientY: t0.clientY,
    })));
  }, 500);

  // Default: orbit
  touchState = { type: 'orbit', lastX: t0.clientX, lastY: t0.clientY, startX: t0.clientX, startY: t0.clientY, moved: false };
}, { passive: false });

canvas.addEventListener('touchmove', e => {
  e.preventDefault();
  _cancelLongPress();  // any movement cancels long-press
  if (!touchState) return;

  if (e.touches.length === 2 && touchState.type !== 'handle') {
    // Pinch to zoom + two-finger pan
    const dist = pinchDist(e.touches);
    const midX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
    const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2;

    if (touchState.type === 'pinch') {
      const scale = touchState.lastDist / dist;
      targetRadius = Math.max(4, Math.min(28, targetRadius * scale));

      // Two-finger pan on the ground plane
      const dx = midX - touchState.lastMidX;
      const dy = midY - touchState.lastMidY;
      const right   = new THREE.Vector3();
      const camDir  = new THREE.Vector3();
      const forward = new THREE.Vector3();
      camera.getWorldDirection(camDir);
      right.crossVectors(camDir, new THREE.Vector3(0,1,0)).normalize();
      forward.set(-camDir.x, 0, -camDir.z).normalize();
      const sp = orbitRadius * 0.0015;
      targetOrigin.addScaledVector(right, -dx * sp);
      targetOrigin.addScaledVector(forward, dy * sp);
    }
    touchState.lastDist = dist;
    touchState.lastMidX = midX;
    touchState.lastMidY = midY;
    markDirty();
    return;
  }

  const t0 = e.touches[0];

  if (touchState.type === 'presetRoom') {
    const fakeE = { clientX: t0.clientX, clientY: t0.clientY };
    const gp = raycastGround(fakeE);
    if (gp && presetRoomDragState) {
      const { id, role } = presetRoomDragState;
      const r = state.presetRooms.find(r => r.id === id);
      if (r) {
        const frame = _prFrame(r);
        const { alongAxis, depthSign, limit } = frame;
        const dX = gp.x - presetRoomDragState.groundAnchor.x;
        const dZ = gp.z - presetRoomDragState.groundAnchor.z;
        const dAlong = alongAxis === 'x' ? dX : dZ;
        const dDepth = alongAxis === 'x' ? dZ * depthSign : dX * depthSign;
        const ANCHOR_SNAP = 0.4;

        if (role === 'move') {
          // Translate only — no dimension change
          const oldOffset = r.offset;
          presetRoomDragState.rawOffset += dAlong;
          const halfW   = r.width / 2;
          const snapped = _snapToGrid(presetRoomDragState.rawOffset);
          r.offset = Math.max(-limit + halfW + TK, Math.min(limit - halfW - TK, snapped));
          // Shift associated furniture by the same world-space delta
          const deltaOffset = r.offset - oldOffset;
          if (deltaOffset !== 0) {
            state.furniture.filter(f => f.presetRoomId === r.id).forEach(f => {
              if (alongAxis === 'x') f.x += deltaOffset; else f.z += deltaOffset;
            });
          }

          // Auto re-anchor when an edge gets within ANCHOR_SNAP of a perpendicular exterior wall.
          // prevWall guard prevents oscillation: after switching wall A→B, don't immediately
          // switch back B→A because the edge is still sitting at the corner.
          const leftEdge  = r.offset - halfW;
          const rightEdge = r.offset + halfW;
          const oldWallPos   = frame.wallPos;
          const oldDepthSign = frame.depthSign;
          const leftTarget  = alongAxis === 'x' ? 'left'  : 'back';
          const rightTarget = alongAxis === 'x' ? 'right' : 'front';
          if (Math.abs(leftEdge + limit) < ANCHOR_SNAP && presetRoomDragState.prevWall !== leftTarget) {
            const oldW = r.width, oldD = r.depth;
            presetRoomDragState.prevWall = r.wall;
            r.wall   = leftTarget;
            r.offset = oldWallPos + oldDepthSign * oldD / 2;
            r.width  = oldD;
            r.depth  = oldW;
            state.furniture = state.furniture.filter(f => f.presetRoomId !== r.id);
            r.doorOffset = 0;
            presetRoomDragState.rawOffset = r.offset;
          } else if (Math.abs(rightEdge - limit) < ANCHOR_SNAP && presetRoomDragState.prevWall !== rightTarget) {
            const oldW = r.width, oldD = r.depth;
            presetRoomDragState.prevWall = r.wall;
            r.wall   = rightTarget;
            r.offset = oldWallPos + oldDepthSign * oldD / 2;
            r.width  = oldD;
            r.depth  = oldW;
            state.furniture = state.furniture.filter(f => f.presetRoomId !== r.id);
            r.doorOffset = 0;
            presetRoomDragState.rawOffset = r.offset;
          }

        } else if (role === 'depth') {
          presetRoomDragState.rawDepth += dDepth;
          const maxDepth = (alongAxis === 'x' ? state.depth : state.width) - TK * 2;
          r.depth = Math.min(maxDepth, Math.max(PR_MIN_D, _snapToGrid(presetRoomDragState.rawDepth)));
          state.furniture = state.furniture.filter(f => f.presetRoomId !== r.id);

        } else if (role === 'sideL') {
          presetRoomDragState.rawSideL += dAlong;
          const snapped = _snapToGrid(presetRoomDragState.rawSideL);
          const rightEdge = r.offset + r.width / 2;
          const newLeft = Math.max(-limit + TK, Math.min(rightEdge - PR_MIN_W, snapped));
          r.offset = (newLeft + rightEdge) / 2;
          r.width  = rightEdge - newLeft;
          state.furniture = state.furniture.filter(f => f.presetRoomId !== r.id);

        } else if (role === 'sideR') {
          presetRoomDragState.rawSideR += dAlong;
          const snapped = _snapToGrid(presetRoomDragState.rawSideR);
          const leftEdge = r.offset - r.width / 2;
          const newRight = Math.min(limit - TK, Math.max(leftEdge + PR_MIN_W, snapped));
          r.offset = (leftEdge + newRight) / 2;
          r.width  = newRight - leftEdge;
          state.furniture = state.furniture.filter(f => f.presetRoomId !== r.id);
        }
        presetRoomDragState.groundAnchor = gp;
        buildPresetRooms(); buildFurniture(); markDirty();
      }
    }
    return;
  }

  if (touchState.type === 'partition') {
    // Re-use the same mouse-move logic via a fake mousemove
    const fakeE = { clientX: t0.clientX, clientY: t0.clientY };
    const gp = raycastGround(fakeE);
    if (gp && partitionDragState) {
      const { id, role, axis, groundAnchor } = partitionDragState;
      const p = state.partitions.find(p => p.id === id);
      if (p) {
        const prevPos = p.pos, prevStart = p.start, prevEnd = p.end;
        const dX = gp.x - groundAnchor.x, dZ = gp.z - groundAnchor.z;
        if (role === 'move') {
          partitionDragState.rawPos += axis === 'x' ? dZ : dX;
          p.pos = _snapPos(axis, partitionDragState.rawPos);
        } else if (role === 'start') {
          partitionDragState.rawStart += axis === 'x' ? dX : dZ;
          const snapped = _snapEnd(axis, partitionDragState.rawStart);
          if (p.end - snapped >= 0.5) p.start = snapped;
        } else if (role === 'end') {
          partitionDragState.rawEnd += axis === 'x' ? dX : dZ;
          const snapped = _snapEnd(axis, partitionDragState.rawEnd);
          if (snapped - p.start >= 0.5) p.end = snapped;
        }
        partitionDragState.groundAnchor = gp;
        if (p.pos !== prevPos || p.start !== prevStart || p.end !== prevEnd) {
          buildPartitions(); markDirty();
        }
      }
    }
    return;
  }

  if (touchState.type === 'handle') {
    const fakeEvent = { clientX: t0.clientX, clientY: t0.clientY };
    const wh = raycastWall(fakeEvent);
    if (!wh || wh.wallId !== touchState.wall) return;
    const op = state.openings.find(o => o.id === touchState.openingId);
    if (!op) return;
    const validCx = findValidPosition(op.type, op.style, op.wall, wh.localX, op.id);
    if (validCx === null) return;
    op.offset = validCx - touchState.wallW / 2;
    buildRoom(); updatePriceDisplay(); renderOpeningsList();
    if (typeof renderSelectedOpening === 'function') renderSelectedOpening();
    return;
  }

  if (touchState.type === 'electric') {
    const fakeE = { clientX: t0.clientX, clientY: t0.clientY };
    const snap = _electricWallRaycast(fakeE);
    if (snap && electricDragState) {
      const el = (state.electrics || []).find(x => x.id === electricDragState.id);
      if (el) {
        el.x = snap.x; el.z = snap.z; el.rotY = snap.rotY;
        const em = electricMeshes.find(m => m.id === el.id);
        if (em) { em.group.position.x = el.x; em.group.position.z = el.z; em.group.rotation.y = el.rotY; }
      }
    }
    markDirty();
    return;
  }

  if (touchState.type === 'furniture') {
    const fakeE = { clientX: t0.clientX, clientY: t0.clientY };
    const gp = raycastGround(fakeE);
    if (gp && furnitureDragState?.groundAnchor) {
      const f = state.furniture.find(f => f.id === furnitureDragState.id);
      if (f) {
        const def = FURNITURE_CATALOG[f.type];
        const dims = def ? { w: def.w, d: def.d }
          : (f.dims ? { w: Array.isArray(f.dims) ? f.dims[0] : f.dims.w,
                        d: Array.isArray(f.dims) ? f.dims[2] : f.dims.d } : null);
        if (def?.wallHug && dims) {
          const snap = _snapToNearestWallFace(gp.x, gp.z, dims.w, dims.d, _gatherWallFaces(), state.width / 2, state.depth / 2);
          f.x = snap.x; f.z = snap.z; f.rotY = snap.rotY;
        } else {
          furnitureDragState.rawX += gp.x - furnitureDragState.groundAnchor.x;
          furnitureDragState.rawZ += gp.z - furnitureDragState.groundAnchor.z;
          f.x = _snapEnabled ? _snapToGrid(furnitureDragState.rawX) : furnitureDragState.rawX;
          f.z = _snapEnabled ? _snapToGrid(furnitureDragState.rawZ) : furnitureDragState.rawZ;
          if (dims) {
            const hw = state.width / 2, hd = state.depth / 2;
            const cosA = Math.abs(Math.cos(f.rotY ?? 0)), sinA = Math.abs(Math.sin(f.rotY ?? 0));
            const hrX = cosA * dims.w / 2 + sinA * dims.d / 2;
            const hrZ = sinA * dims.w / 2 + cosA * dims.d / 2;
            const MARGIN = 0.05, WS = 0.15;
            f.x = Math.max(-hw + hrX + MARGIN, Math.min(hw - hrX - MARGIN, f.x));
            f.z = Math.max(-hd + hrZ + MARGIN, Math.min(hd - hrZ - MARGIN, f.z));
            if (Math.abs(f.x - (-hw + hrX + MARGIN)) < WS) f.x = -hw + hrX + MARGIN;
            if (Math.abs(f.x - ( hw - hrX - MARGIN)) < WS) f.x =  hw - hrX - MARGIN;
            if (Math.abs(f.z - (-hd + hrZ + MARGIN)) < WS) f.z = -hd + hrZ + MARGIN;
            if (Math.abs(f.z - ( hd - hrZ - MARGIN)) < WS) f.z =  hd - hrZ - MARGIN;
          }
        }
        furnitureDragState.groundAnchor = gp;
        const group = furnitureGroups[f.id];
        if (group) { group.position.x = f.x; group.position.z = f.z; group.rotation.y = f.rotY ?? 0; }
        else {
          const mesh = furnitureMeshes.find(m => m.userData.furnitureId === f.id);
          if (mesh) { mesh.position.x = f.x; mesh.position.z = f.z; mesh.rotation.y = f.rotY ?? 0; }
        }
        markDirty();
      }
    }
    return;
  }

  if (touchState.type === 'orbit') {
    const dx = t0.clientX - touchState.lastX;
    const dy = t0.clientY - touchState.lastY;
    targetTheta -= dx * 0.005;
    targetPhi    = Math.max(0.05, Math.min(1.35, targetPhi - dy * 0.005));
    touchState.lastX = t0.clientX;
    touchState.lastY = t0.clientY;
    touchState.moved = true;
    markDirty();
  }
}, { passive: false });

canvas.addEventListener('touchend', e => {
  _cancelLongPress();
  if (e.touches.length === 0) {
    if (touchState?.type === 'handle' || touchState?.type === 'partition' || touchState?.type === 'presetRoom' || touchState?.type === 'furniture' || touchState?.type === 'electric') {
      if (typeof stateHistory !== 'undefined') stateHistory.push();
    }
    if (touchState?.type === 'partition') partitionDragState = null;
    if (touchState?.type === 'presetRoom') presetRoomDragState = null;
    if (touchState?.type === 'furniture') furnitureDragState = null;
    if (touchState?.type === 'electric') electricDragState = null;

    // Tap detection: short touch with no meaningful movement → run click logic
    if (touchState?.type === 'orbit' && !touchState.moved) {
      const fakeE = { clientX: touchState.startX, clientY: touchState.startY, button: 0 };
      raycaster.setFromCamera(getMouseNDC(fakeE), camera);

      // Check electric
      const elecGroups = electricMeshes.map(em => em.group);
      const elecHits = raycaster.intersectObjects(elecGroups, true);
      if (elecHits.length) {
        let hitObj = elecHits[0].object;
        while (hitObj && !hitObj.userData.electricId) hitObj = hitObj.parent;
        if (hitObj?.userData.electricId != null) {
          const eid = hitObj.userData.electricId;
          deselectAll(); selectElectric(eid);
          touchState = null; return;
        }
      }

      // Check furniture
      const fHits = raycaster.intersectObjects(furnitureMeshes, false);
      if (fHits.length) {
        const fid = fHits[0].object.userData.furnitureId;
        if (fid != null) {
          deselectAll(); selectFurniture(fid);
          touchState = null; return;
        }
      }

      // Check opening handle
      const handleHit = raycastHandles(fakeE);
      if (handleHit) {
        const op = state.openings.find(o => o.id === handleHit.openingId);
        if (op) { deselectAll(); selectHandle(op.id); touchState = null; return; }
      }

      // Tap on empty space — deselect
      deselectAll();
    }

    touchState = null;
  } else if (e.touches.length === 1 && touchState?.type === 'pinch') {
    // Dropped to one finger — switch to orbit
    touchState = { type: 'orbit', lastX: e.touches[0].clientX, lastY: e.touches[0].clientY };
  }
});

function setView(preset) {
  const v = {front:[0,0.7,15], side:[Math.PI/2,0.7,15], top:[0,0.05,18], isometric:[0.45,0.88,14]}[preset];
  if (v) { [targetTheta, targetPhi, targetRadius] = v; }
  markDirty();
}

// ─── FLOORPLAN VIEW ──────────────────────────────────────────────────────────────

let floorplanViewMode = false;

function toggleFloorplanView() {
  floorplanViewMode = !floorplanViewMode;
  const btn = document.getElementById('tbFloorplan');
  if (btn) btn.classList.toggle('active', floorplanViewMode);
  if (floorplanViewMode) {
    // Switch to top-down view
    targetTheta = 0; targetPhi = 0.01; targetRadius = 16;
    targetOrigin.set(0, 0, 0);
    markDirty();
    // Hide roof meshes
    [buildingGroup, roofGroup].forEach(grp => grp.traverse(child => {
      if (child.isMesh && child.userData.isRoof) {
        child.userData._fpSavedVis = child.visible;
        child.visible = false;
      }
    }));
    // Hide sky dome for cleaner view
    skyDome.visible = false;
  } else {
    // Restore
    [buildingGroup, roofGroup].forEach(grp => grp.traverse(child => {
      if (child.isMesh && child.userData._fpSavedVis !== undefined) {
        child.visible = child.userData._fpSavedVis;
        delete child.userData._fpSavedVis;
      }
    }));
    skyDome.visible = true;
    // Return to isometric via smooth camera animation
    targetTheta = 0.343; targetPhi = 1.350; targetRadius = 22.11;
    targetOrigin.set(0, 1.5, 0);
    markDirty();
  }
}

updateCamera();

// ─── DIRTY FLAG (defined early — used throughout file) ───────────────────────
window.markSceneDirty = markDirty;

function onResize() {
  const vp = document.querySelector('.viewport');
  renderer.setSize(vp.clientWidth, vp.clientHeight);
  camera.aspect = vp.clientWidth / vp.clientHeight;
  camera.updateProjectionMatrix();
  markDirty();
}
window.addEventListener('resize', onResize);
requestAnimationFrame(() => requestAnimationFrame(onResize));

// ─── DRAG-DROP PLACEMENT SYSTEM ───────────────────────────────────────────────
// Called from onmousedown on panel buttons. Builds a ghost in the scene that
// follows the cursor; mouseup drops the item at the cursor position.

function _clearDDGhost() {
  _ddGhost.traverse(obj => {
    if (!obj.isMesh && !obj.isLine) return;
    if (obj.geometry) obj.geometry.dispose();
    if (obj.material) { obj.material.dispose(); }
  });
  while (_ddGhost.children.length) _ddGhost.remove(_ddGhost.children[0]);
  _ddGhost.visible = false;
}

function _ddFloorPoint(e) {
  const rc = new THREE.Raycaster();
  rc.setFromCamera(getMouseNDC(e), camera);
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const pt = new THREE.Vector3();
  return rc.ray.intersectPlane(plane, pt) ? pt.clone() : null;
}

// Raycast against actual wall meshes and clamp hit point to the interior face.
// Returns { x, z, rotY } for the snapped position, or null if no wall hit.
function _electricWallRaycast(e) {
  const rc = new THREE.Raycaster();
  rc.setFromCamera(getMouseNDC(e), camera);
  const allWalls = Object.values(wallMeshes).flat();
  const hits = rc.intersectObjects(allWalls, false);
  if (!hits.length) return null;
  const hit = hits[0];
  const wallId = hit.object.userData.wallId;
  if (!wallId) return null;
  const hw = state.width / 2, hd = state.depth / 2;
  const MARGIN = 0.10;
  // Interior face: front/back walls (BoxGeometry) centered at ±hd, interior face at hd-TK/2.
  // left/right walls (ShapeGeometry) exterior at ±hw, interior face at ±(hw-TK).
  const interiorFace = { front: hd - TK / 2, back: -(hd - TK / 2), left: -(hw - TK), right: hw - TK };
  const WALL_ROT = { front: Math.PI, back: 0, left: Math.PI / 2, right: -Math.PI / 2 };
  let x = hit.point.x, z = hit.point.z;
  if (wallId === 'front' || wallId === 'back') {
    z = interiorFace[wallId];
    x = Math.max(-hw + MARGIN, Math.min(hw - MARGIN, x));
  } else {
    x = interiorFace[wallId];
    z = Math.max(-hd + MARGIN, Math.min(hd - MARGIN, z));
  }
  return { x, z, rotY: WALL_ROT[wallId] };
}

function _buildDDGhost(category, type) {
  _clearDDGhost();
  if (category === 'furniture') {
    const def = FURNITURE_CATALOG[type];
    if (!def) return;
    const geo  = new THREE.BoxGeometry(def.w, def.h, def.d);
    const mat  = new THREE.MeshStandardMaterial({ color: 0x1e88e5, transparent: true, opacity: 0.40 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.y = def.h / 2;
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: 0x1565c0 }));
    edges.position.y = def.h / 2;
    _ddGhost.add(mesh, edges);
  } else if (category === 'preset') {
    const defaults = { bathroom:{w:2.0,d:1.8}, bedroom:{w:3.0,d:2.5}, office:{w:3.0,d:2.0} };
    const { w, d } = defaults[type] || { w:2.5, d:2.0 };
    const h = state.height;
    const geo  = new THREE.BoxGeometry(w, h, d);
    const mat  = new THREE.MeshStandardMaterial({ color: 0x43a047, transparent: true, opacity: 0.25 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.y = h / 2;
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: 0x2e7d32 }));
    edges.position.y = h / 2;
    _ddGhost.add(mesh, edges);
  } else if (category === 'electric') {
    const def = ELECTRICS_CATALOG[type];
    if (!def) return;
    const geo = new THREE.BoxGeometry(def.w, def.h, def.d);
    const mat = new THREE.MeshStandardMaterial({ color: 0xffe082, transparent: true, opacity: 0.70 });
    const mesh = new THREE.Mesh(geo, mat);
    _ddGhost.add(mesh);
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: 0xf57f17 }));
    _ddGhost.add(edges);
  }
  _ddGhost.visible = true;
  markDirty();
}

function startDragDrop(category, type, e) {
  e.preventDefault();
  if (_ddState) { _clearDDGhost(); }
  _buildDDGhost(category, type);
  _ddState = { category, type };
  document.body.style.cursor = 'grabbing';
  document.addEventListener('pointermove', _ddOnMove);
  document.addEventListener('pointerup',   _ddOnUp);
}

function _ddOnMove(e) {
  if (!_ddState) return;
  if (_ddState.category === 'electric') {
    const def = ELECTRICS_CATALOG[_ddState.type];
    if (def) {
      const snap = _electricWallRaycast(e);
      if (snap) {
        const mountY = def.mountHeight < 0
          ? state.height - def.h / 2 - 0.02
          : def.mountHeight;
        _ddGhost.position.set(snap.x, mountY, snap.z);
        _ddGhost.rotation.y = snap.rotY;
        _ddGhost.visible = true;
      } else {
        _ddGhost.visible = false;
      }
    }
  } else {
    const pt = _ddFloorPoint(e);
    if (pt) {
      _ddGhost.position.set(pt.x, 0, pt.z);
      _ddGhost.visible = true;
    } else {
      _ddGhost.visible = false;
    }
  }
  markDirty();
}

function _ddOnUp(e) {
  if (!_ddState) return;
  const { category, type } = _ddState;
  _ddState = null;
  document.removeEventListener('pointermove', _ddOnMove);
  document.removeEventListener('pointerup',   _ddOnUp);
  document.body.style.cursor = '';
  _clearDDGhost();
  markDirty();

  // Only place if mouse is over the canvas
  const cr = canvas.getBoundingClientRect();
  const overCanvas = e.clientX >= cr.left && e.clientX <= cr.right &&
                     e.clientY >= cr.top  && e.clientY <= cr.bottom;

  const pt = overCanvas ? _ddFloorPoint(e) : null;

  if (category === 'furniture') {
    const id = state.nextFurnitureId++;
    const rawX = pt ? pt.x : 0;
    const rawZ = pt ? pt.z : 0;
    const x = _snapEnabled ? _snapToGrid(rawX) : rawX;
    const z = _snapEnabled ? _snapToGrid(rawZ) : rawZ;
    state.furniture.push({ id, type, x, z, rotY: 0 });
    stateHistory.push();
    buildFurniture();
    markDirty();
    if (typeof renderFurnitureList === 'function') renderFurnitureList();
  } else if (category === 'preset') {
    if (typeof addPresetRoom === 'function') addPresetRoom(type);
    // addPresetRoom defaults to back wall; user can drag it after placement
  } else if (category === 'electric') {
    const def = ELECTRICS_CATALOG[type];
    const snap = overCanvas ? _electricWallRaycast(e) : null;
    if (def && snap) {
      const mountY = def.mountHeight < 0
        ? state.height - def.h / 2 - 0.02
        : def.mountHeight;
      const id = state.nextElectricId++;
      state.electrics.push({ id, type, x: snap.x, z: snap.z, rotY: snap.rotY, mountY });
      // Keep pricing qty in sync
      const pKey = ELECTRIC_PRICING_KEY[type];
      if (pKey && state.electricalItems[pKey] !== undefined) state.electricalItems[pKey]++;
      const _qEl = pKey ? document.getElementById('qty-' + pKey) : null;
      if (_qEl) _qEl.textContent = state.electricalItems[pKey];
      stateHistory.push();
      buildElectrics();
      if (typeof updatePriceDisplay === 'function') updatePriceDisplay();
      if (typeof renderElectricsList === 'function') renderElectricsList();
      markDirty();
    }
  }
}

const _origUpdateCamera = updateCamera;

(function loop() {
  requestAnimationFrame(loop);
  // tickCamera lerps toward targets every frame — marks dirty itself if moving
  tickCamera();
  if (_dirty || _dirtyFrames > 0) {
    if (_hoverBoxHelper)     _hoverBoxHelper.update();
    if (_furnitureBoxHelper) _furnitureBoxHelper.update();
    if (_electricBoxHelper)  _electricBoxHelper.update();
    if (interiorViewMode) updateWallVisibility();
    renderer.render(scene, camera);
    updateWallLabels();
    if (_dirtyFrames > 0) _dirtyFrames--;
    else _dirty = false;
  }
})();
