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

// ── Lighting ──────────────────────────────────────────────────────────────────
const hemiLight = new THREE.HemisphereLight(0xd8eaf8, 0xc0d0b4, 1.7);
scene.add(hemiLight);

const sunLight = new THREE.DirectionalLight(0xfff8f4, 0.45);
sunLight.position.set(8, 14, 5);
sunLight.castShadow = true;
sunLight.shadow.mapSize.set(2048, 2048);
sunLight.shadow.camera.left   = -16;
sunLight.shadow.camera.right  =  16;
sunLight.shadow.camera.top    =  16;
sunLight.shadow.camera.bottom = -16;
sunLight.shadow.bias = -0.0003;
scene.add(sunLight);
scene.add(sunLight.target);

const fillLight = new THREE.DirectionalLight(0xe8f0ff, 0.5);
fillLight.position.set(-8, 6, -5);
scene.add(fillLight);

const backLight = new THREE.DirectionalLight(0xf4f0ff, 0.35);
backLight.position.set(0, 5, -10);
scene.add(backLight);

// ── Lighting presets ──────────────────────────────────────────────────────────
const LIGHTING = {
  architectural: {
    hemi:   { sky: 0xd8eaf8, ground: 0xc0d0b4, intensity: 1.7 },
    sun:    { color: 0xfff8f4, intensity: 0.45, pos: [8, 14, 5] },
    fill:   { color: 0xe8f0ff, intensity: 0.50, pos: [-8, 6, -5] },
    back:   { color: 0xf4f0ff, intensity: 0.35, pos: [0, 5, -10] },
    skyTop:     0xb8ccd8,
    skyHorizon: 0xdde8ec,
    fog:        0xdde8ec,
  },
  cinematic: {
    // Golden-hour low sun — warm key, long shadows
    hemi:   { sky: 0x7a8ca0, ground: 0x5a4830, intensity: 0.55 },
    sun:    { color: 0xff9e50, intensity: 1.6,  pos: [14, 5, 8] },
    fill:   { color: 0x2040a0, intensity: 0.25, pos: [-10, 8, -4] },
    back:   { color: 0x4060c0, intensity: 0.40, pos: [-4, 10, -14] },
    skyTop:     0x0d1a2e,
    skyHorizon: 0xe8600a,
    fog:        0xc05010,
  },
};

let _lightingMode = 'architectural';

function setLightingMode(mode) {
  _lightingMode = mode;
  const p = LIGHTING[mode];
  hemiLight.color.setHex(p.hemi.sky);
  hemiLight.groundColor.setHex(p.hemi.ground);
  hemiLight.intensity = p.hemi.intensity;
  sunLight.color.setHex(p.sun.color);
  sunLight.intensity = p.sun.intensity;
  sunLight.position.set(...p.sun.pos);
  fillLight.color.setHex(p.fill.color);
  fillLight.intensity = p.fill.intensity;
  fillLight.position.set(...p.fill.pos);
  backLight.color.setHex(p.back.color);
  backLight.intensity = p.back.intensity;
  backLight.position.set(...p.back.pos);
  skyDome.material.uniforms.uTop.value.setHex(p.skyTop);
  skyDome.material.uniforms.uHorizon.value.setHex(p.skyHorizon);
  skyDome.material.needsUpdate = true;
  scene.fog.color.setHex(p.fog);
  const btn = document.getElementById('tbLighting');
  if (btn) btn.classList.toggle('active', mode === 'cinematic');
  markDirty(4);
}

function toggleLightingMode() {
  setLightingMode(_lightingMode === 'architectural' ? 'cinematic' : 'architectural');
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
scene.add(grid);

const buildingGroup = new THREE.Group();
const handlesGroup  = new THREE.Group();
const edgeHandleGroup = new THREE.Group();
scene.add(buildingGroup);
scene.add(handlesGroup);
scene.add(edgeHandleGroup);

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
  stone_01_cladding:                       { texFile: 'assets/tex_render.jpg', roughness: 0.95, rotated: false, tilesX: 0.5, tilesY: 0.5 },
  red_brick_wall_02_cladding:              { texFile: 'assets/tex_render.jpg', roughness: 0.94, rotated: false, tilesX: 1.0, tilesY: 0.8 },
  london_stone_cladding:                   { texFile: 'assets/tex_render.jpg', roughness: 0.96, rotated: false, tilesX: 0.6, tilesY: 0.6 },
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
    // No dedicated texture for these — closest available substituted:
    corrugated_roofing:          'assets/roof_shingle_grey.jpg',
    shingles_square_black_roofing:'assets/roof_shingle_grey.jpg',
    coated_tile_roofing:         'assets/roof_shingle_grey.jpg',
    copper_roofing:              'assets/roof_epdm.jpg',
    sip_roof:                    'assets/roof_epdm.jpg',
  }[finish] || 'assets/roof_epdm.jpg';
  const cfg = ROOF_FINISH_CFG[finish] || { tilesPerMeter: 0.5, roughness: 0.90 };
  return makeTiledMat({ texFile, worldW: w, worldH: d, tilesPerMeter: cfg.tilesPerMeter, roughness: cfg.roughness });
}

// Glass: physically-based, slightly reflective
const glassMat = new THREE.MeshStandardMaterial({
  color: 0xa8d8ea, transparent: true, opacity: 0.18,
  roughness: 0.05, metalness: 0.1,
  side: THREE.DoubleSide, depthWrite: false,
});
// Frame: aluminium-style — slightly metallic
let frameMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.45, metalness: 0.55 });
function getFrameMat() {
  frameMat.color.set(state.frameColour || '#1a1a1a');
  return frameMat;
}
// Concrete slab
const slabMat  = new THREE.MeshStandardMaterial({ color: 0xccccbb, roughness: 0.92, metalness: 0.0 });
// Interior floor base colour (overridden per finish below)
const floorMat = new THREE.MeshStandardMaterial({ color: 0xc8a87a, roughness: 0.65, metalness: 0.0 });
// Decking
const deckMat  = new THREE.MeshStandardMaterial({ color: 0x7a5210, roughness: 0.80, metalness: 0.0 });
const boardMat = new THREE.MeshStandardMaterial({ color: 0x6b4810, roughness: 0.85, metalness: 0.0 });

// Interior colour maps
const INTERIOR_FLOOR_COLORS = {
  oak: 0xc8a87a, walnut: 0x5c3a21, farm_oak: 0xb89a65, tiles: 0xd0cfc8,
  polished_concrete: 0x9e9e9e, gym_black: 0x2a2a2a, white_marble: 0xe8e4de, rubber: 0x3a3a3a,
};
const INTERIOR_WALL_COLORS = {
  white: 0xf5f5f5, charcoal: 0x3a3a3a, plywood: 0xc4a46a, oak: 0xb48a52, tongue_groove: 0xd4b87a,
};

const HANDLE_DOOR_COLOR  = 0xf59e0b;
const HANDLE_WIN_COLOR   = 0x38bdf8;
const HANDLE_HOVER_COLOR = 0xffffff;
const HANDLE_SEL_COLOR   = 0xef4444;

// ─── GLB LOADER ────────────────────────────────────────────────────────────────

const gltfLoader = new THREE.GLTFLoader();
const modelCache = {};
function loadModel(file) {
  return new Promise(resolve => {
    if (modelCache[file]) { resolve(modelCache[file].clone()); return; }
    gltfLoader.load(file, gltf => { modelCache[file] = gltf.scene; resolve(gltf.scene.clone()); }, undefined, err => { console.warn('GLB:', file, err); resolve(null); });
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
  function buildFace(xPos, mat) {
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
    buildingGroup.add(m);
    wallMeshes[wallId].push(m);
  }

  // Exterior cladding face (DoubleSide so it reads correctly from both angles)
  const cfg    = makeWallTexInfo(wallId);
  const extMat = makeTiledMat({ ...cfg, worldW, worldH, tint: state.claddingTint });
  extMat.side  = THREE.DoubleSide;
  buildFace(wallX, extMat);

  // Interior face — inset by wall thickness, plain interior colour
  const iwCol = INTERIOR_WALL_COLORS[state.interiorWalls] ?? 0xf5f5f5;
  const iwMat = new THREE.MeshLambertMaterial({ color: iwCol, side: THREE.DoubleSide });
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
  const iwCol = INTERIOR_WALL_COLORS[state.interiorWalls] ?? 0xf5f5f5;
  const iwMat = new THREE.MeshLambertMaterial({ color: iwCol });

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
  const rp = (W, D, x, y, z, rz=0) => { const m = new THREE.Mesh(new THREE.BoxGeometry(W, pT, D), rMat); m.position.set(x,y,z); m.rotation.z=rz; m.castShadow=true; m.userData.isRoof=true; buildingGroup.add(m); };
  const fa = (W, H, D, x, y, z)    => { const m = new THREE.Mesh(new THREE.BoxGeometry(W, H, D), getFrameMat()); m.position.set(x,y,z); m.userData.isRoof=true; buildingGroup.add(m); };

  if (state.roof === 'flat') {
    rMat = makeRoofMat(w + ov * 2, panelD);
    const tiltRad = ((state.roofTilt || 0) * Math.PI) / 180;
    // Panel: tilted along X axis so front edge is higher (back-to-front drainage)
    const panelM = new THREE.Mesh(new THREE.BoxGeometry(w+ov*2, pT, panelD), rMat);
    panelM.position.set(0, roofY+pT/2, 0);
    panelM.rotation.x = -tiltRad;  // negative: front(+Z) is HIGH, back(-Z) is LOW
    panelM.castShadow = true;
    panelM.userData.isRoof = true;
    buildingGroup.add(panelM);
    // Soffit — covers the underside of the roof panel so the finish texture isn't
    // visible when looking up from outside. Sits just below the panel, same tilt.
    const soffitM = new THREE.Mesh(new THREE.BoxGeometry(w+ov*2, 0.005, panelD), getFrameMat());
    soffitM.position.set(0, roofY - 0.003, 0);
    soffitM.rotation.x = -tiltRad;
    soffitM.userData.isRoof = true;
    buildingGroup.add(soffitM);
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
      const m = new THREE.Mesh(geo, getFrameMat()); m.castShadow=true; m.userData.isRoof=true; buildingGroup.add(m);
    });
    if (state.extras.lantern) {
      const lw=w*0.38,ld=d*0.38,ly=roofY+pT;
      rp(lw+0.1,ld+0.1,0,ly+0.08,0);
      const lg=new THREE.Mesh(new THREE.BoxGeometry(lw,0.55,ld),new THREE.MeshPhongMaterial({color:0xd0ecff,transparent:true,opacity:0.45,shininess:120}));
      lg.position.set(0,ly+0.435,0); lg.userData.isRoof=true; buildingGroup.add(lg);
      rp(lw+0.08,ld+0.08,0,ly+0.72,0);
    }
  } else if (state.roof === 'apex') {
    // Ridge runs along X axis; slopes pitch toward front (+Z) and back (-Z)
    const rh=state.apexPitch??1.0, spanZ=hd+ov, spanW=w+ov*2;
    const slopeLen=Math.sqrt(spanZ*spanZ+rh*rh), angle=Math.atan2(rh,spanZ);
    rMat = makeRoofMat(spanW, slopeLen);

    // ── Front slope panel ──
    const fp=new THREE.Mesh(new THREE.BoxGeometry(spanW,pT,slopeLen),rMat);
    fp.position.set(0,roofY+rh/2,spanZ/2); fp.rotation.x=angle; fp.castShadow=true; fp.userData.isRoof=true; buildingGroup.add(fp);

    // ── Back slope panel ──
    const bp=new THREE.Mesh(new THREE.BoxGeometry(spanW,pT,slopeLen),rMat);
    bp.position.set(0,roofY+rh/2,-spanZ/2); bp.rotation.x=-angle; bp.castShadow=true; bp.userData.isRoof=true; buildingGroup.add(bp);

    // ── Ridge beam ──
    const ridge=new THREE.Mesh(new THREE.BoxGeometry(spanW+0.1,0.10,0.10),getFrameMat());
    ridge.position.set(0,roofY+rh+pT/2,0); ridge.userData.isRoof=true; buildingGroup.add(ridge);

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
      buildingGroup.add(frRake);
      // Back-facing slope rake (-Z half)
      const bkRake = new THREE.Mesh(new THREE.BoxGeometry(rakeFD, rakeH, rakeLen), getFrameMat());
      bkRake.position.set(xPos, roofY + rh/2, -spanZ/2);
      bkRake.rotation.x = -angle;
      bkRake.castShadow = true;
      bkRake.userData.isRoof = true;
      buildingGroup.add(bkRake);
    });

  }

  // ── Guttering ──────────────────────────────────────────────────────────────
  buildGuttering(w, d, h, hw, hd, ov);
}

function buildGuttering(w, _d, h, hw, hd, ov) {
  const gutMat = new THREE.MeshLambertMaterial({ color: state.gutterColour ?? 0x1a1a1a });

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
    bk.castShadow = true; bk.userData.isGutter = true; buildingGroup.add(bk);

    // Bottom plate — horizontal, projects outward (-Z) from base of back plate
    const bt = new THREE.Mesh(new THREE.BoxGeometry(span, tP, chW), gutMat);
    bt.position.set(0, gutTopY - bkH - tP / 2, faceZ - tP - chW / 2);
    bt.castShadow = true; bt.userData.isGutter = true; buildingGroup.add(bt);

    // Front lip — shorter upstand at the outer edge
    const fp = new THREE.Mesh(new THREE.BoxGeometry(span, fpH, tP), gutMat);
    fp.position.set(0, gutTopY - bkH + fpH / 2, faceZ - tP - chW + tP / 2);
    fp.castShadow = true; fp.userData.isGutter = true; buildingGroup.add(fp);
  }

  // Single square-section downpipe at the right-hand back corner.
  function downpipe(gutTopY) {
    const dpZ = -(fasciaFaceR + dpS / 2);
    const botY = 0.18;
    const topY = gutTopY - bkH;
    const dpH  = Math.max(0.05, topY - botY);
    const m = new THREE.Mesh(new THREE.BoxGeometry(dpS, dpH, dpS), gutMat);
    m.position.set(hw, botY + dpH / 2, dpZ);
    m.castShadow = true; m.userData.isGutter = true; buildingGroup.add(m);
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

function buildRoom() {
  const gen = ++_buildGen;   // any async GLB that captures this will bail if gen no longer matches
  markDirty(8);  // GLBs load async — keep rendering for a few frames
  while (buildingGroup.children.length) buildingGroup.remove(buildingGroup.children[0]);
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

  // Interior floor surface — roughness varies by finish
  const intFloorCol = INTERIOR_FLOOR_COLORS[state.interiorFloor] ?? 0xc8a87a;
  const floorRoughMap = { oak:0.70, walnut:0.65, farm_oak:0.72, tiles:0.40, polished_concrete:0.30, gym_black:0.60, white_marble:0.25, rubber:0.85 };
  const intFloorMat = new THREE.MeshStandardMaterial({ color: intFloorCol, roughness: floorRoughMap[state.interiorFloor] ?? 0.70, metalness: 0.0 });
  box(w-0.02, 0.005, d-0.02, 0, 0.185, 0, intFloorMat);

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

  if (state.extras.decking && state.deckingArea > 0) {
    const da = state.deckingArea;
    const dw = Math.min(w * 1.5, Math.sqrt(da * (w / Math.max(w, 3)) * 2));
    const dd = da / dw;
    const deckCol = { softwood: 0x7a5210, hardwood: 0x5a3a10, composite: 0x6b6055 }[state.deckingMaterial] || 0x7a5210;
    const deckRough = { softwood: 0.82, hardwood: 0.78, composite: 0.65 }[state.deckingMaterial] ?? 0.82;
    const dMat = new THREE.MeshStandardMaterial({ color: deckCol, roughness: deckRough, metalness: 0.0 });
    const dBoardMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(deckCol).multiplyScalar(0.85), roughness: deckRough + 0.05, metalness: 0.0 });

    // Deck platform
    box(dw, 0.07, dd, 0, 0.18, hd + dd/2 + 0.02, dMat);
    // Board lines
    const plankW = 0.12, gap = 0.02;
    for (let i = 0; i < Math.floor(dd / (plankW + gap)); i++) {
      box(dw, 0.015, plankW, 0, 0.22, hd + i * (plankW + gap) + plankW/2 + 0.04, dBoardMat);
    }

    // Balustrade
    const bType = state.deckingBalustrade;
    if (bType && bType !== 'none') {
      const postH = 0.9, railY = 0.18 + postH;
      const fMat = getFrameMat();
      const deckZ0 = hd + 0.02;
      const deckZ1 = hd + dd + 0.02;
      const deckX0 = -dw/2, deckX1 = dw/2;

      // Posts at corners and every ~1m
      const postPositions = [];
      // Front edge (far from building)
      for (let x = deckX0; x <= deckX1 + 0.01; x += Math.min(1.0, dw)) {
        postPositions.push([x, deckZ1]);
      }
      // Side edges
      for (let z = deckZ0 + 1.0; z < deckZ1; z += 1.0) {
        postPositions.push([deckX0, z]);
        postPositions.push([deckX1, z]);
      }

      postPositions.forEach(([px, pz]) => {
        box(0.05, postH, 0.05, px, 0.18 + postH/2, pz, fMat);
      });

      // Top rails
      box(dw, 0.04, 0.05, 0, railY, deckZ1, fMat); // front rail
      box(0.05, 0.04, dd, deckX0, railY, hd + dd/2 + 0.02, fMat); // left rail
      box(0.05, 0.04, dd, deckX1, railY, hd + dd/2 + 0.02, fMat); // right rail

      // Fill between posts
      if (bType === 'glass' || bType === 'frameless') {
        const gMat = new THREE.MeshStandardMaterial({ color: 0xa8d8ea, transparent: true, opacity: 0.22, roughness: 0.05, metalness: 0.1, side: THREE.DoubleSide, depthWrite: false });
        box(dw, postH * 0.8, 0.01, 0, 0.18 + postH * 0.45, deckZ1, gMat); // front
        box(0.01, postH * 0.8, dd, deckX0, 0.18 + postH * 0.45, hd + dd/2 + 0.02, gMat); // left
        box(0.01, postH * 0.8, dd, deckX1, 0.18 + postH * 0.45, hd + dd/2 + 0.02, gMat); // right
      } else if (bType === 'picket') {
        // Pickets every 0.1m
        for (let x = deckX0 + 0.1; x < deckX1; x += 0.1) {
          box(0.025, postH * 0.75, 0.025, x, 0.18 + postH * 0.4, deckZ1, fMat);
        }
        for (let z = deckZ0 + 0.1; z < deckZ1; z += 0.1) {
          box(0.025, postH * 0.75, 0.025, deckX0, 0.18 + postH * 0.4, z, fMat);
          box(0.025, postH * 0.75, 0.025, deckX1, 0.18 + postH * 0.4, z, fMat);
        }
      }
    }
  }

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
    buildingGroup.add(vrp);
  }

  rebuildHandles();
  rebuildWallArrows();
  rebuildEdgeHandles();
  if (interiorViewMode) applyInteriorView();
  if (floorplanViewMode) {
    buildingGroup.traverse(child => {
      if (child.isMesh && child.userData.isRoof) {
        child.userData._fpSavedVis = child.visible;
        child.visible = false;
      }
    });
    skyDome.visible = false;
  }
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
  buildingGroup.traverse(child => {
    if (child.isMesh && (child.userData.isRoof || child.userData.isGutter)) child.visible = false;
  });
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
  buildingGroup.traverse(child => {
    if (child.isMesh && (child.userData.isRoof || child.userData.isGutter)) child.visible = true;
  });
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
  ['width','depth'].forEach(dim => {
    const d = document.createElement('div');
    d.style.cssText = [
      'position:absolute', 'pointer-events:none',
      'padding:3px 9px',
      'background:rgba(20,20,20,0.78)',
      'color:#fff',
      'border-radius:5px',
      'font-size:12px',
      'font-weight:600',
      'font-family:DM Sans,sans-serif',
      'white-space:nowrap',
      'transform:translate(-50%,-50%)',
      'display:none',
      'letter-spacing:0.03em',
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

function updateWallLabels() {
  if (!wallLabels.width) return;
  const vp = document.querySelector('.viewport');
  if (!vp) return;
  const vr = vp.getBoundingClientRect();
  const hw=state.width/2, hd=state.depth/2;
  const labelData = [
    { key:'width', pos: new THREE.Vector3(0,      0.55, hd+1.7), text: state.width.toFixed(1)+'m' },
    { key:'depth', pos: new THREE.Vector3(hw+1.7, 0.55, 0),      text: state.depth.toFixed(1)+'m' },
  ];
  labelData.forEach(({ key, pos, text }) => {
    const div = wallLabels[key];
    if (!div) return;
    const v = pos.clone().project(camera);
    if (v.z >= 1) { div.style.display='none'; return; }
    div.style.display = 'block';
    div.style.left = ((v.x*0.5+0.5)*vr.width)+'px';
    div.style.top  = ((-v.y*0.5+0.5)*vr.height)+'px';
    div.textContent = text;
  });
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
}

function selectHandle(id) {
  selectedHandleId = id;
  activePaletteType = null;
  if (typeof updatePaletteUI === 'function') updatePaletteUI();
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
let rightDragged = false;  // true if right-click turned into a pan drag (suppresses delete-on-right-click)
let edgeDragState = null;  // { wall, axis ('x'|'z'), sign (1|-1) } while dragging an edge handle

// ── Camera state: current values (what's rendered) and target values (where we're going)
let orbitTheta=0.343, orbitPhi=1.350, orbitRadius=22.11;
let targetTheta=0.343, targetPhi=1.350, targetRadius=22.11;
const orbitTarget  = new THREE.Vector3(0, 1.5, 0);
const targetOrigin = new THREE.Vector3(0, 1.5, 0);

// Damping factor — lower = more inertia/glide (0.12 is silky, 0.25 is snappier)
const CAM_DAMP = 0.14;

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

  // 1. Hit an opening handle → drag or select
  const hit = raycastHandles(e);
  if (hit) {
    const op = state.openings.find(o => o.id === hit.openingId);
    if (!op) return;
    selectHandle(op.id);
    const ww = wallWidth(op.wall);
    dragState = { openingId: op.id, wall: op.wall, wallW: ww };
    canvas.style.cursor = 'grabbing';
    return;
  }

  // 2. Palette active → place on wall
  if (activePaletteType) {
    const wh = raycastWall(e);
    if (wh) placeOpening(activePaletteType, wh.wallId, wh.localX);
    return;
  }

  // 3. Right-click or Shift+drag → pan camera
  if (e.button === 2 || e.shiftKey) {
    panActive = true; rightDragged = false; prevMouseX = e.clientX; prevMouseY = e.clientY;
    canvas.style.cursor = 'move';
    return;
  }

  // 4. Click empty space → deselect + orbit
  selectedHandleId = null;
  refreshHandleColors();
  if (typeof renderSelectedOpening === 'function') renderSelectedOpening();
  orbitActive=true; prevMouseX=e.clientX; prevMouseY=e.clientY;
});

canvas.addEventListener('dblclick', () => {
  if (!dragState) {
    targetOrigin.set(0, 1.5, 0);
    targetTheta = 0.343; targetPhi = 1.350; targetRadius = 22.11;
    markDirty();
  }
});

window.addEventListener('mouseup', () => {
  orbitActive = false;
  panActive = false;
  if (edgeDragState) {
    edgeDragState = null;
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
  // Edge handle drag → resize wall
  if (edgeDragState) {
    const { axis, sign, groundAnchor } = edgeDragState;
    const gp = raycastGround(e);
    if (gp && groundAnchor) {
      // World-space delta along the relevant axis — fully camera-independent
      if (axis === 'z') {
        const delta = gp.z - groundAnchor.z;
        state.depth = Math.round(Math.max(2, Math.min(8, state.depth + delta * sign * 2)) * 4) / 4;
      } else {
        const delta = gp.x - groundAnchor.x;
        state.width = Math.round(Math.max(2, Math.min(10, state.width + delta * sign * 2)) * 4) / 4;
      }
      edgeDragState.groundAnchor = gp;  // advance anchor each frame
      buildRoom();
      if (typeof updatePriceDisplay === 'function') updatePriceDisplay();
      if (typeof syncDimSliders === 'function') syncDimSliders();
    }
    return;
  }

  // Pan camera (shift+drag)
  if (panActive) {
    const dx = e.clientX - prevMouseX;
    const dy = e.clientY - prevMouseY;
    prevMouseX = e.clientX; prevMouseY = e.clientY;
    if (Math.abs(dx) > 1 || Math.abs(dy) > 1) rightDragged = true;
    const right = new THREE.Vector3();
    const camDir = new THREE.Vector3();
    camera.getWorldDirection(camDir);
    right.crossVectors(camDir, new THREE.Vector3(0,1,0)).normalize();
    const sp = orbitRadius * 0.001;
    targetOrigin.addScaledVector(right, -dx * sp);
    targetOrigin.y += dy * sp;
    markDirty();
    return;
  }

  if (dragState) {
    const wh = raycastWall(e);
    if (!wh || wh.wallId !== dragState.wall) return;
    const op = state.openings.find(o => o.id === dragState.openingId);
    if (!op) return;

    const targetCx = wh.localX;
    const validCx  = findValidPosition(op.type, op.style, op.wall, targetCx, op.id);
    if (validCx === null) return;   // no room anywhere — don't move
    op.offset = validCx - dragState.wallW / 2;

    buildRoom();
    updatePriceDisplay();
    renderOpeningsList();
    if (typeof renderSelectedOpening === 'function') renderSelectedOpening();
    return;
  }

  if (orbitActive) {
    // Scale rotation speed with zoom level — feels consistent at all distances
    const speed = 0.004 + orbitRadius * 0.00025;
    targetTheta -= (e.clientX - prevMouseX) * speed;
    targetPhi    = Math.max(0.05, Math.min(1.35, targetPhi - (e.clientY - prevMouseY) * speed));
    prevMouseX = e.clientX; prevMouseY = e.clientY;
    markDirty(); return;
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
});

canvas.addEventListener('contextmenu', e => {
  e.preventDefault();
  // Only delete if right-click didn't turn into a pan drag
  if (!rightDragged) { const h = raycastHandles(e); if (h) deleteOpening(h.openingId); }
  rightDragged = false;
});

window.addEventListener('keydown', e => {
  if (e.key==='Delete'||e.key==='Backspace') {
    if (document.activeElement.tagName==='INPUT'||document.activeElement.tagName==='TEXTAREA') return;
    if (selectedHandleId!==null) deleteOpening(selectedHandleId);
  }
  if (e.key==='Escape') { setActivePalette(null); if(typeof updatePaletteUI==='function') updatePaletteUI(); }
});

canvas.addEventListener('wheel', e => {
  // Exponential zoom feels consistent — same number of scroll clicks regardless
  // of current distance. Factor of 1.12 per 100px of deltaY.
  targetRadius = Math.max(4, Math.min(28, targetRadius * Math.pow(1.20, e.deltaY / 100)));
  markDirty();
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

canvas.addEventListener('touchstart', e => {
  e.preventDefault();
  const t0 = e.touches[0];

  if (e.touches.length === 2) {
    // Two-finger: cancel any single-touch state, start pinch/pan
    touchState = {
      type: 'pinch',
      lastDist: pinchDist(e.touches),
      lastMidX: (e.touches[0].clientX + e.touches[1].clientX) / 2,
      lastMidY: (e.touches[0].clientY + e.touches[1].clientY) / 2,
    };
    return;
  }

  // Single touch — check for opening handle
  const fakeEvent = { clientX: t0.clientX, clientY: t0.clientY };
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

  // Default: orbit
  touchState = { type: 'orbit', lastX: t0.clientX, lastY: t0.clientY };
}, { passive: false });

canvas.addEventListener('touchmove', e => {
  e.preventDefault();
  if (!touchState) return;

  if (e.touches.length === 2 && touchState.type !== 'handle') {
    // Pinch to zoom + two-finger pan
    const dist = pinchDist(e.touches);
    const midX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
    const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2;

    if (touchState.type === 'pinch') {
      const scale = touchState.lastDist / dist;
      targetRadius = Math.max(4, Math.min(28, targetRadius * scale));

      // Two-finger pan
      const dx = midX - touchState.lastMidX;
      const dy = midY - touchState.lastMidY;
      const right = new THREE.Vector3();
      const camDir = new THREE.Vector3();
      camera.getWorldDirection(camDir);
      right.crossVectors(camDir, new THREE.Vector3(0,1,0)).normalize();
      const sp = orbitRadius * 0.0012;
      targetOrigin.addScaledVector(right, -dx * sp);
      targetOrigin.y += dy * sp;
    }
    touchState.lastDist = dist;
    touchState.lastMidX = midX;
    touchState.lastMidY = midY;
    markDirty();
    return;
  }

  const t0 = e.touches[0];

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

  if (touchState.type === 'orbit') {
    const dx = t0.clientX - touchState.lastX;
    const dy = t0.clientY - touchState.lastY;
    targetTheta -= dx * 0.008;
    targetPhi    = Math.max(0.05, Math.min(1.35, targetPhi - dy * 0.008));
    touchState.lastX = t0.clientX;
    touchState.lastY = t0.clientY;
    markDirty();
  }
}, { passive: false });

canvas.addEventListener('touchend', e => {
  if (e.touches.length === 0) {
    // Push undo snapshot when a dimension or opening drag completes via touch
    if (touchState?.type === 'handle') {
      if (typeof stateHistory !== 'undefined') stateHistory.push();
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
    buildingGroup.traverse(child => {
      if (child.isMesh && child.userData.isRoof) {
        child.userData._fpSavedVis = child.visible;
        child.visible = false;
      }
    });
    // Hide sky dome for cleaner view
    skyDome.visible = false;
  } else {
    // Restore
    buildingGroup.traverse(child => {
      if (child.isMesh && child.userData._fpSavedVis !== undefined) {
        child.visible = child.userData._fpSavedVis;
        delete child.userData._fpSavedVis;
      }
    });
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

const _origUpdateCamera = updateCamera;

(function loop() {
  requestAnimationFrame(loop);
  // tickCamera lerps toward targets every frame — marks dirty itself if moving
  tickCamera();
  if (_dirty || _dirtyFrames > 0) {
    if (interiorViewMode) updateWallVisibility();
    renderer.render(scene, camera);
    updateWallLabels();
    if (_dirtyFrames > 0) _dirtyFrames--;
    else _dirty = false;
  }
})();
