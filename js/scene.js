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

// Hemisphere light: sky colour from above, ground bounce from below
// This gives PBR materials (MeshStandardMaterial) a much more natural base
const hemiLight = new THREE.HemisphereLight(0x87ceeb, 0x5a8a3a, 0.55);
scene.add(hemiLight);

const sunLight = new THREE.DirectionalLight(0xfff8e7, 1.1);
sunLight.position.set(8, 12, 6);
sunLight.castShadow = true;
sunLight.shadow.mapSize.set(2048, 2048);
sunLight.shadow.camera.left   = -16;
sunLight.shadow.camera.right  =  16;
sunLight.shadow.camera.top    =  16;
sunLight.shadow.camera.bottom = -16;
sunLight.shadow.bias = -0.0003;   // reduce shadow acne on flat surfaces
scene.add(sunLight);
scene.add(sunLight.target);

const fillLight = new THREE.DirectionalLight(0xd0e8ff, 0.28);
fillLight.position.set(-5, 3, -5);
scene.add(fillLight);

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
  color: 0xd5e6d0,   // initialised to grass fog colour; updated in setGroundType / applyTOD
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
scene.add(buildingGroup);
scene.add(handlesGroup);

// Exterior wall meshes collected during buildWallFace so interior view can
// update their opacity each frame based on camera position.
const wallMeshes = { front: [], back: [], left: [], right: [] };

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
// ─── TIME OF DAY ────────────────────────────────────────────────────────────
// tod = 0.0 (dawn) → 0.5 (midday) → 1.0 (dusk)
let tod = 0.55;  // default: mid-afternoon

const TOD_PRESETS = [
  // tod,  skyTop,    horizon,   sunColor,  sunIntensity, fillColor, fogColor
  { t: 0.0, top: 0xff9966, hor: 0xffcc88, sun: 0xff8844, si: 0.6,  fill: 0xffd4a0, fog: 0xffcc88 }, // dawn
  { t: 0.3, top: 0x6aabda, hor: 0xd4e8f8, sun: 0xfff5dd, si: 1.0,  fill: 0xd0e8ff, fog: 0xd4e8f8 }, // morning
  { t: 0.55,top: 0x4a90c4, hor: 0xd5e6d0, sun: 0xfff8e7, si: 1.1,  fill: 0xd0e8ff, fog: 0xd5e6d0 }, // afternoon (default)
  { t: 0.75,top: 0x3a6080, hor: 0xffc870, sun: 0xff9944, si: 0.85, fill: 0xffa060, fog: 0xffc870 }, // golden hour
  { t: 1.0, top: 0x1a2840, hor: 0xff7744, sun: 0xff4422, si: 0.4,  fill: 0x334466, fog: 0xff7744 }, // dusk
];

function lerpPresets(t) {
  const presets = TOD_PRESETS;
  let lo = presets[0], hi = presets[presets.length - 1];
  for (let i = 0; i < presets.length - 1; i++) {
    if (t >= presets[i].t && t <= presets[i+1].t) { lo = presets[i]; hi = presets[i+1]; break; }
  }
  const f = lo.t === hi.t ? 0 : (t - lo.t) / (hi.t - lo.t);
  function lc(a, b) { return new THREE.Color(a).lerp(new THREE.Color(b), f); }
  return {
    top: lc(lo.top, hi.top), hor: lc(lo.hor, hi.hor),
    sun: lc(lo.sun, hi.sun), si: lo.si + (hi.si - lo.si) * f,
    fill: lc(lo.fill, hi.fill), fog: lc(lo.fog, hi.fog),
  };
}

function applyTOD(t) {
  tod = Math.max(0, Math.min(1, t));
  const p = lerpPresets(tod);
  skyDome.material.uniforms.uTop.value.copy(p.top);
  skyDome.material.uniforms.uHorizon.value.copy(p.hor);
  skyDome.material.uniforms.uSunDir.value.copy(getSunDir(tod));
  skyDome.material.uniforms.uSunColor.value.copy(p.sun);
  sunLight.color.copy(p.sun);
  sunLight.intensity = p.si;
  fillLight.color.copy(p.fill);
  // Hemisphere: sky colour shifts with time of day; ground bounce stays earthy
  hemiLight.color.copy(p.top);
  hemiLight.groundColor.lerp(new THREE.Color(0x5a8a3a), 0.5);
  scene.fog = new THREE.FogExp2(p.fog.getHex(), 0.022);
  fogCylMat.color.copy(p.fog);
  markDirty();
}

function getSunDir(t) {
  // Arc from east horizon (dawn) over south-zenith (noon) to west horizon (dusk)
  const angle = Math.PI * t;  // 0 = east, PI/2 = overhead, PI = west
  return new THREE.Vector3(
    Math.cos(angle) * 0.8,    // X: east → west
    Math.sin(angle),           // Y: horizon → sky → horizon
    -0.5                       // Z: slight south bias
  ).normalize();
}

function updateSunPosition(t) {
  const dir = getSunDir(t);
  const dist = 15;
  sunLight.position.copy(dir).multiplyScalar(dist);
  sunLight.target.position.set(0, 0, 0);
  sunLight.target.updateMatrixWorld();
  markDirty();
}

// Sky dome with sun disc in fragment shader
const skyDome = new THREE.Mesh(
  new THREE.SphereGeometry(80, 32, 16),
  new THREE.ShaderMaterial({
    uniforms: {
      uTop:      { value: new THREE.Color(0x4a90c4) },
      uHorizon:  { value: new THREE.Color(0xd5e6d0) },
      uSunDir:   { value: getSunDir(tod) },
      uSunColor: { value: new THREE.Color(0xfff8e7) },
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
      uniform vec3 uSunDir;
      uniform vec3 uSunColor;
      varying vec3 vWorldPos;
      void main() {
        vec3 dir = normalize(vWorldPos);
        // Sky gradient — horizon band extends below y=0 so fog and sky
        // blend seamlessly; the ground edge is never visible as a hard line.
        float t = clamp((dir.y + 0.25) / 1.25, 0.0, 1.0);
        vec3 sky = mix(uHorizon, uTop, pow(t, 0.55));
        // Sun disc + soft halo
        float cosA = dot(dir, normalize(uSunDir));
        float disc  = smoothstep(0.9980, 0.9995, cosA);      // sharp disc
        float halo  = pow(max(0.0, cosA), 18.0) * 0.35;      // wide glow
        float glow  = pow(max(0.0, cosA), 5.0)  * 0.10;      // atmospheric scatter
        vec3  col   = sky + uSunColor * (disc + halo + glow);
        gl_FragColor = vec4(col, 1.0);
      }
    `,
    side: THREE.BackSide,
    depthWrite: false,
  })
);
scene.add(skyDome);
scene.fog = new THREE.FogExp2(0xd5e6d0, 0.022);

// Initialise ground now that skyDome exists
setGroundType('grass');

// Expose for UI — time-of-day slider can call this
window.setTimeOfDay = function(t) { applyTOD(t); updateSunPosition(t); };

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
function makeWallMat(w, h, wallId) {
  const cfg = CLADDING_CFG[_claddingKey(wallId)] || _CLADDING_FALLBACK;
  return makeTiledMat({ ...cfg, worldW: w, worldH: h, tint: state.claddingTint });
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
const TK           = 0.08;          // wall thickness
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

// ─── WALL FACE BUILDER ─────────────────────────────────────────────────────────

// Triangular wedge panel that fills the slanted top of left/right walls under tilted flat roof
// minH = back (low) wall height, maxH = front (high) wall height
function addSideWedge(wallId, minH, maxH, mat, hw, hd, highAtBack) {
  const x   = wallId === 'left' ? -hw : hw;
  const xIn = wallId === 'left' ? -hw + TK : hw - TK;
  const yBase = 0.18 + minH;
  const yTop  = 0.18 + maxH;
  // highZ = z-coord of the tall end, lowZ = z-coord of the short end
  const highZ = highAtBack ? -hd : hd;
  const lowZ  = highAtBack ? hd : -hd;
  const geo = new THREE.BufferGeometry();
  const v = new Float32Array([
    x, yBase, lowZ,     // 0 low-end bottom
    x, yBase, highZ,    // 1 high-end bottom
    x, yTop,  highZ,    // 2 high-end top
    xIn, yBase, lowZ,   // 3 low-end bottom inner
    xIn, yBase, highZ,  // 4 high-end bottom inner
    xIn, yTop,  highZ,  // 5 high-end top inner
  ]);
  geo.setAttribute('position', new THREE.BufferAttribute(v, 3));
  geo.setIndex([
    0,2,1,       // outer tri
    3,4,5,       // inner tri
    0,1,4, 0,4,3, // bottom quad
    1,2,5, 1,5,4, // vertical face at high end
    0,3,5, 0,5,2, // hypotenuse slant
  ]);
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = m.receiveShadow = true;
  buildingGroup.add(m);
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

function placeWindowGLB(wallId, worldCentre, oh, ow, style, hw, hd, gen) {
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
      case 'left':  model.rotation.y = Math.PI/2;   model.position.set(-hw, yB, z + wm.naturalW/2); break;
      case 'right': model.rotation.y = -Math.PI/2;  model.position.set( hw, yB, z - wm.naturalW/2); break;
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
    // Fascia heights adjust with tilt: front is higher, back lower
    const tiltRise = Math.tan(tiltRad) * (hd + ov);
    const fH = 0.25;
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

    // ── Gable end fills: flat BufferGeometry triangles, flush with wall faces ──
    // Span from z=-(hd+ov) to z=+(hd+ov) to cover the full overhang width
    const gMat = makeWallMat(w, h, 'left'); // gable ends align with left/right walls
    [-hw, hw].forEach(x => {
      const geo = new THREE.BufferGeometry();
      const verts = new Float32Array([
        x, roofY,       -(hd+ov),
        x, roofY,        (hd+ov),
        x, roofY+rh,     0,
      ]);
      geo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
      // Double-sided: two triangles with opposite winding
      geo.setIndex([0,2,1, 0,1,2]);
      geo.computeVertexNormals();
      const g = new THREE.Mesh(geo, gMat);
      g.castShadow = true;
      g.userData.isRoof = true;
      buildingGroup.add(g);
    });

    // ── Front & back eave fascia boards ──
    const fH=0.20, eY=roofY;
    fa(spanW+0.06,fH,0.07, 0,eY-fH/2+0.02, +(hd+ov));
    fa(spanW+0.06,fH,0.07, 0,eY-fH/2+0.02, -(hd+ov));

  }

  // ── Guttering ──────────────────────────────────────────────────────────────
  buildGuttering(w, d, h, hw, hd, ov);
}

function buildGuttering(w, d, h, hw, hd, ov) {
  const gutMat = new THREE.MeshLambertMaterial({ color: state.gutterColour ?? 0x1a1a1a });
  const gutH = 0.09, gutD = 0.10, pipeR = 0.035;

  // Box is long along LOCAL X (span), shallow profile in Y (height) and Z (depth).
  // Side gutters pass rotY=PI/2 which rotates local-X → world-Z.
  function gutter(span, cx, cy, cz, rotY) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(span, gutH, gutD), gutMat);
    m.position.set(cx, cy, cz);
    if (rotY) m.rotation.y = rotY;
    m.castShadow = true;
    buildingGroup.add(m);
  }

  // Downpipe from y=0 (ground) up to topY (eave)
  function downpipe(cx, cz, topY) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(pipeR, pipeR, topY, 8), gutMat);
    m.position.set(cx, topY / 2, cz);
    m.castShadow = true;
    buildingGroup.add(m);
  }

  if (state.roof === 'flat') {
    const tiltRad  = ((state.roofTilt || 0) * Math.PI) / 180;
    const tiltRise = Math.tan(tiltRad) * (hd + ov);
    // Front is HIGH (+Z, rotation.x = -tiltRad makes +Z rise)
    const eaveYFront = 0.18 + h + tiltRise;
    // Back is LOW (drainage side)
    const eaveYBack  = 0.18 + h - tiltRise;
    const eaveYSide  = 0.18 + h; // sides are midpoint

    // Front gutter (high side) — box long in X, sits just outside front fascia
    gutter(w + ov*2, 0, eaveYFront - gutH/2, hd + ov + gutD/2);
    // Back gutter (low/drain side)
    gutter(w + ov*2, 0, eaveYBack  - gutH/2, -(hd + ov + gutD/2));
    // Left & right side gutters — rotY=PI/2 makes span run in Z
    gutter(d + ov*2, -(hw + ov + gutD/2), eaveYSide - gutH/2, 0, Math.PI/2);
    gutter(d + ov*2,   hw + ov + gutD/2,  eaveYSide - gutH/2, 0, Math.PI/2);
    // Downpipe at back-right corner (lowest point — drain side)
    downpipe(hw + ov, -(hd + ov + gutD/2), eaveYBack);

  } else if (state.roof === 'apex') {
    const eaveY = 0.18 + h;
    // Front & back eave gutters (apex pitches front/back so both are same height)
    gutter(w + ov*2, 0, eaveY - gutH/2,   hd + ov + gutD/2);
    gutter(w + ov*2, 0, eaveY - gutH/2, -(hd + ov + gutD/2));
    // Downpipes at back-left and back-right corners
    downpipe(-(hw + ov), -(hd + ov + gutD/2), eaveY);
    downpipe(  hw + ov,  -(hd + ov + gutD/2), eaveY);

  }
}

// ─── MAIN BUILD ────────────────────────────────────────────────────────────────

function buildRoom() {
  const gen = ++_buildGen;   // any async GLB that captures this will bail if gen no longer matches
  markDirty(8);  // GLBs load async — keep rendering for a few frames
  while (buildingGroup.children.length) buildingGroup.remove(buildingGroup.children[0]);
  // Clear wall mesh registry so interior-view opacity is applied to fresh meshes.
  Object.keys(wallMeshes).forEach(k => { wallMeshes[k] = []; });
  const w=state.width, d=state.depth, h=state.height, hw=w/2, hd=d/2;
  const wallTexInfo = null; // computed per-wall inside buildWallFace

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

  // Interior wall surfaces (thin inner faces)
  const intWallCol = INTERIOR_WALL_COLORS[state.interiorWalls] ?? 0xf5f5f5;
  const intWallMat = new THREE.MeshStandardMaterial({ color: intWallCol, roughness: 0.88, metalness: 0.0, side: THREE.FrontSide });

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
  // Side walls: rectangle up to shorter height, plus triangle wedge on top if needed
  const sideBaseH = Math.min(frontH, backH);
  buildWallFace('left',  d, sideBaseH, wallOps.left,  hw, hd, gen);
  buildWallFace('right', d, sideBaseH, wallOps.right, hw, hd, gen);
  if (Math.abs(frontH - backH) > 0.005) {
    const highAtBack = backH > frontH;
    const wedgeH = Math.max(frontH, backH) - sideBaseH;
    addSideWedge('left',  sideBaseH, Math.max(frontH, backH), makeWallMat(d, wedgeH, 'left'),  hw, hd, highAtBack);
    addSideWedge('right', sideBaseH, Math.max(frontH, backH), makeWallMat(d, wedgeH, 'right'), hw, hd, highAtBack);
  }

  // Corner posts — variable height per corner
  [[-hw,-hd,backH],[hw,-hd,backH],[-hw,hd,frontH],[hw,hd,frontH]]
    .forEach(([x,z,ph])=>box(0.1, ph, 0.1, x, 0.18+ph/2, z, getFrameMat()));

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

  // Veranda / canopy
  if (state.veranda && state.veranda.enabled) {
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
    if (child.isMesh && child.userData.isRoof) child.visible = false;
  });
  // Wider FOV feels more natural inside a room — avoids the compressed
  // telephoto look and makes the space feel correctly proportioned.
  camera.fov = 20;
  camera.updateProjectionMatrix();
  updateWallVisibility();
  markDirty(2);
}

function restoreExteriorView() {
  buildingGroup.traverse(child => {
    if (child.isMesh && child.userData.isRoof) child.visible = true;
  });
  for (const meshes of Object.values(wallMeshes)) {
    for (const m of meshes) m.visible = true;
  }
  // Restore the default telephoto FOV used for exterior presentation.
  camera.fov = 20;
  camera.updateProjectionMatrix();
  markDirty(2);
}

// Called every render frame while in interior view.
// Walls whose outward normal points toward the camera are hidden (cutaway);
// walls facing away remain visible so the room structure is clear.
function updateWallVisibility() {
  const hw = state.width / 2;
  const hd = state.depth / 2;
  // Wall plane offsets along their outward normals (world-space position of each wall face)
  const WALL_OFFSETS = {
    front:  new THREE.Vector3(0,  0,  hd),
    back:   new THREE.Vector3(0,  0, -hd),
    left:   new THREE.Vector3(-hw, 0, 0),
    right:  new THREE.Vector3(hw,  0, 0),
  };
  for (const [wallId, meshes] of Object.entries(wallMeshes)) {
    // Camera is on the outward side of a wall when:
    // normal · (cameraPos - wallPos) > 0
    const wallPos = WALL_OFFSETS[wallId];
    const camRelative = camera.position.clone().sub(wallPos);
    const facingCamera = WALL_NORMALS[wallId].dot(camRelative) > 0;
    for (const m of meshes) m.visible = !facingCamera;
  }
}

// ─── HANDLES ───────────────────────────────────────────────────────────────────

function rebuildHandles() {
  while (handlesGroup.children.length) handlesGroup.remove(handlesGroup.children[0]);
  const hw=state.width/2, hd=state.depth/2;
  state.openings.forEach(op => {
    const desc = opToDescriptor(op);
    const wc   = localToWorld(op.wall, desc.localCx, desc.localCy, hw, hd);
    const color = op.type==='door' ? HANDLE_DOOR_COLOR : HANDLE_WIN_COLOR;
    const disc = new THREE.Mesh(
      new THREE.CylinderGeometry(0.22, 0.22, 0.05, 20),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false })
    );
    disc.userData = { openingId: op.id, baseColor: color };
    const proud=0.09;
    disc.position.set(wc.x, wc.y, wc.z);
    switch(op.wall){
      case 'front': disc.rotation.x=Math.PI/2; disc.position.z+=proud; break;
      case 'back':  disc.rotation.x=Math.PI/2; disc.position.z-=proud; break;
      case 'left':  disc.rotation.z=Math.PI/2; disc.position.x-=proud; break;
      case 'right': disc.rotation.z=Math.PI/2; disc.position.x+=proud; break;
    }
    handlesGroup.add(disc);
  });
  refreshHandleColors();
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

// ── DIMENSION ARROW HELPERS ───────────────────────────────────────────────────

const DIM_MAT = new THREE.MeshBasicMaterial({
  color: 0x333333, transparent: true, opacity: 0.88,
  side: THREE.DoubleSide, depthTest: false,
});

// Thin flat strip lying in the XZ plane, centred at origin, pointing along +X
function dimLine(length) {
  const g = new THREE.PlaneGeometry(length, 0.018);
  g.rotateX(-Math.PI / 2);
  return new THREE.Mesh(g, DIM_MAT);
}

// Small filled dot (disc) lying in XZ plane
function dimDot(r) {
  const g = new THREE.CircleGeometry(r, 14);
  g.rotateX(-Math.PI / 2);
  return new THREE.Mesh(g, DIM_MAT);
}

// Short perpendicular tick mark at end of a horizontal dim line (in XZ plane)
function dimTickH() {
  const g = new THREE.PlaneGeometry(0.018, 0.32);
  g.rotateX(-Math.PI / 2); g.rotateY(Math.PI / 2);
  return new THREE.Mesh(g, DIM_MAT);
}

// Short perpendicular tick mark at end of a vertical dim line (in XY plane)
function dimTickV() {
  const g = new THREE.PlaneGeometry(0.32, 0.018);
  return new THREE.Mesh(g, DIM_MAT);
}

// Extension line: short perpendicular stub from wall corner to dim line
function dimExtH(extLen) {
  const g = new THREE.PlaneGeometry(0.018, extLen);
  g.rotateX(-Math.PI / 2); g.rotateY(Math.PI / 2);
  return new THREE.Mesh(g, DIM_MAT);
}

/**
 * Full horizontal dimension indicator, spans `length` along +X,
 * at y=y0, offset from wall by `offZ` in local Z.
 * wallGap = distance from wall surface to the extension line start.
 */
function makeDimGroupH(length, wallGap, extLen) {
  const g = new THREE.Group();
  const half = length / 2;

  // Main dimension line
  const l = dimLine(length); g.add(l);

  // Tick marks at each end
  [-half, half].forEach(x => {
    const t = dimTickH(); t.position.x = x; g.add(t);
  });

  // Extension lines at both ends (in local Z, from wall edge out to dim line)
  [-half, half].forEach(x => {
    const ext = dimExtH(extLen);
    ext.position.x = x;
    ext.position.z = -(wallGap + extLen / 2);
    g.add(ext);
  });

  // Wide invisible hit plane
  const hitG = new THREE.PlaneGeometry(length + 1.0, 0.7);
  hitG.rotateX(-Math.PI / 2);
  const hitM = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
  const hit = new THREE.Mesh(hitG, hitM); hit.userData.isHitBox = true; g.add(hit);

  return g;
}

/**
 * Full vertical dimension indicator, spans `length` along +Y,
 * centred at origin.
 */
function makeDimGroupV(length) {
  const g = new THREE.Group();
  const half = length / 2;

  // Main line
  const lineG = new THREE.PlaneGeometry(0.018, length);
  const line = new THREE.Mesh(lineG, DIM_MAT); g.add(line);

  // Tick marks at top and bottom
  [half, -half].forEach(y => { const t = dimTickV(); t.position.y = y; g.add(t); });

  // Hit plane facing Z
  const hitG = new THREE.PlaneGeometry(0.7, length + 1.0);
  const hitM = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
  const hit = new THREE.Mesh(hitG, hitM); hit.userData.isHitBox = true; g.add(hit);

  return g;
}

function rebuildWallArrows() {
  while (wallArrowGroup.children.length) wallArrowGroup.remove(wallArrowGroup.children[0]);
  ensureWallLabels();
  const hw = state.width / 2, hd = state.depth / 2;
  const y0 = 0.12;
  const dimOff = 0.9;   // distance from wall face to dim line
  const extLen = 0.7;   // length of extension stubs

  // ── Width: spans along X, positioned in front (+Z side) ──
  const wArr = makeDimGroupH(state.width, dimOff, extLen);
  wArr.position.set(0, y0, hd + dimOff);
  wArr.userData = { isWallArrow: true, dimension: 'width' };
  wallArrowGroup.add(wArr);

  // ── Depth: spans along Z (via Y rotation), positioned on right (+X side) ──
  const dArr = makeDimGroupH(state.depth, dimOff, extLen);
  dArr.rotation.y = Math.PI / 2;
  dArr.position.set(hw + dimOff, y0, 0);
  dArr.userData = { isWallArrow: true, dimension: 'depth' };
  wallArrowGroup.add(dArr);

  // ── Height: vertical, at front-right corner ──
  const hArr = makeDimGroupV(state.height);
  hArr.position.set(hw + 1.1, 0.18 + state.height / 2, hd + 0.3);
  hArr.userData = { isWallArrow: true, dimension: 'height' };
  wallArrowGroup.add(hArr);
}

function raycastWallArrows(e) {
  raycaster.setFromCamera(getMouseNDC(e), camera);
  // Deep=true to hit hit-box meshes inside groups
  const hits = raycaster.intersectObjects(wallArrowGroup.children, true);
  if (!hits.length) return null;
  // Walk up to find the group with isWallArrow
  let obj = hits[0].object;
  while (obj && !obj.userData.isWallArrow) obj = obj.parent;
  return (obj && obj.userData.isWallArrow) ? obj : null;
}

function raycastGround(e) {
  raycaster.setFromCamera(getMouseNDC(e), camera);
  const plane = new THREE.Plane(new THREE.Vector3(0,1,0), -0.22);
  const target = new THREE.Vector3();
  return raycaster.ray.intersectPlane(plane, target) ? target : null;
}

function updateWallLabels() {
  if (!wallLabels.width) return;
  const vp = document.querySelector('.viewport');
  if (!vp) return;
  const vr = vp.getBoundingClientRect();
  const hw=state.width/2, hd=state.depth/2;
  const labelData = [
    { key:'width',  pos: new THREE.Vector3(0,       0.55, hd+1.7),                  text: state.width.toFixed(1)+'m'  },
    { key:'depth',  pos: new THREE.Vector3(hw+1.7,  0.55, 0),                       text: state.depth.toFixed(1)+'m'  },
    { key:'height', pos: new THREE.Vector3(hw+1.1,  0.22+state.height*0.5, hd+0.9), text: state.height.toFixed(1)+'m' },
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

function raycastHandles(e) {
  raycaster.setFromCamera(getMouseNDC(e), camera);
  const hits = raycaster.intersectObjects(handlesGroup.children, true);
  if (!hits.length) return null;
  let obj=hits[0].object;
  while(obj && !obj.userData.openingId) obj=obj.parent;
  return obj ? { openingId: obj.userData.openingId, handleMesh: obj } : null;
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
  handlesGroup.children.forEach(disc => {
    const id=disc.userData.openingId;
    let color=disc.userData.baseColor;
    if(id===selectedHandleId) color=HANDLE_SEL_COLOR;
    else if(id===hoveredHandleId) color=HANDLE_HOVER_COLOR;
    disc.material.color.setHex(color);
    // Scale up slightly on select/hover for visual feedback
    const s = (id===selectedHandleId||id===hoveredHandleId) ? 1.18 : 1.0;
    disc.scale.setScalar(s);
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
let wallArrowDragState = null;
let wallArrowHover = null;

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

  // 0. Wall dimension arrow → resize drag
  const rHit = raycastWallArrows(e);
  if (rHit) {
    wallArrowDragState = { dimension: rHit.userData.dimension, lastX: e.clientX, lastY: e.clientY };
    const dim = rHit.userData.dimension;
    canvas.style.cursor = dim === 'height' ? 'ns-resize' : 'ew-resize';
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

  // 3. Shift+drag → pan camera
  if (e.shiftKey) {
    panActive = true; prevMouseX = e.clientX; prevMouseY = e.clientY;
    canvas.style.cursor = 'move';
    return;
  }

  // 4. Click empty space → deselect + orbit
  selectedHandleId = null;
  refreshHandleColors();
  if (typeof renderSelectedOpening === 'function') renderSelectedOpening();
  orbitActive=true; prevMouseX=e.clientX; prevMouseY=e.clientY;
});

canvas.addEventListener('dblclick', e => {
  if (!dragState && !wallArrowDragState) {
    targetOrigin.set(0, 1.5, 0);
    targetTheta = 0.343; targetPhi = 1.350; targetRadius = 22.11;
    markDirty();
  }
});

window.addEventListener('mouseup', () => {
  orbitActive = false;
  panActive = false;
  if (wallArrowDragState) {
    wallArrowDragState = null;
    canvas.style.cursor = activePaletteType ? 'crosshair' : (hoveredHandleId ? 'grab' : 'default');
    if (typeof stateHistory !== 'undefined') stateHistory.push();
  }
  if (dragState) {
    dragState = null;
    canvas.style.cursor = activePaletteType ? 'crosshair' : (hoveredHandleId ? 'grab' : 'default');
    if (typeof stateHistory !== 'undefined') stateHistory.push();
  }
});

window.addEventListener('mousemove', e => {
  // Wall dimension arrow drag
  if (wallArrowDragState) {
    const { dimension } = wallArrowDragState;
    if (dimension === 'width') {
      const g = raycastGround(e);
      if (g) state.width = Math.round(Math.max(2, Math.min(10, Math.abs(g.x)*2)) * 4) / 4;
    } else if (dimension === 'depth') {
      const g = raycastGround(e);
      if (g) state.depth = Math.round(Math.max(2, Math.min(8, Math.abs(g.z)*2)) * 4) / 4;
    } else {
      const dy = e.clientY - wallArrowDragState.lastY;
      wallArrowDragState.lastY = e.clientY;
      state.height = Math.round(Math.max(2.2, Math.min(3.5, state.height - dy*0.008)) * 10) / 10;
    }
    buildRoom();
    if (typeof updatePriceDisplay === 'function') updatePriceDisplay();
    if (typeof syncDimSliders === 'function') syncDimSliders();
    return;
  }

  // Pan camera (shift+drag)
  if (panActive) {
    const dx = e.clientX - prevMouseX;
    const dy = e.clientY - prevMouseY;
    prevMouseX = e.clientX; prevMouseY = e.clientY;
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

  // Wall arrow hover
  if (!activePaletteType && !dragState && !wallArrowDragState) {
    const rh = raycastWallArrows(e);
    if (rh !== wallArrowHover) {
      if (wallArrowHover) wallArrowHover.material.opacity = 0.72;
      wallArrowHover = rh;
      if (wallArrowHover) {
        wallArrowHover.material.opacity = 1.0;
        const dim = wallArrowHover.userData.dimension;
        canvas.style.cursor = dim === 'height' ? 'ns-resize' : 'ew-resize';
        showResizeTooltip(dim, e);
      } else {
        hideResizeTooltip();
      }
    } else if (!rh && !wallArrowHover) {
      hideResizeTooltip();
    }
  }

  const hh = raycastHandles(e);
  const newId = hh ? hh.openingId : null;
  if (newId !== hoveredHandleId) {
    hoveredHandleId = newId;
    refreshHandleColors();
    if (!wallArrowHover) {
      canvas.style.cursor = activePaletteType ? 'crosshair' : (hoveredHandleId ? 'grab' : 'default');
    }
  }
});

function showResizeTooltip(dim, e) {
  let el = document.getElementById('resizeTooltip');
  if (!el) {
    el = document.createElement('div');
    el.id = 'resizeTooltip';
    el.style.cssText = 'position:fixed;background:rgba(0,0,0,0.75);color:#fff;font-size:12px;padding:5px 10px;border-radius:6px;pointer-events:none;z-index:50;font-family:DM Sans,sans-serif;white-space:nowrap;';
    document.body.appendChild(el);
  }
  const labels = { width: '↔ Width', depth: '↕ Depth', height: '↑ Height' };
  el.textContent = labels[dim] || dim;
  el.style.left = (e.clientX + 14) + 'px';
  el.style.top  = (e.clientY - 10) + 'px';
  el.style.display = 'block';
}
function hideResizeTooltip() {
  const el = document.getElementById('resizeTooltip');
  if (el) el.style.display = 'none';
}

canvas.addEventListener('contextmenu', e => { e.preventDefault(); const h=raycastHandles(e); if(h) deleteOpening(h.openingId); });

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
// touchState types: 'orbit', 'pinch', 'handle', 'arrow'

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

  // Single touch — check for arrow hit first
  const fakeEvent = { clientX: t0.clientX, clientY: t0.clientY };
  const arrowHit = raycastWallArrows(fakeEvent);
  if (arrowHit) {
    touchState = {
      type: 'arrow',
      dimension: arrowHit.userData.dimension,
      lastX: t0.clientX, lastY: t0.clientY,
    };
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

  // Default: orbit
  touchState = { type: 'orbit', lastX: t0.clientX, lastY: t0.clientY };
}, { passive: false });

canvas.addEventListener('touchmove', e => {
  e.preventDefault();
  if (!touchState) return;

  if (e.touches.length === 2 && touchState.type !== 'arrow' && touchState.type !== 'handle') {
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

  if (touchState.type === 'arrow') {
    const fakeEvent = { clientX: t0.clientX, clientY: t0.clientY };
    const { dimension } = touchState;
    if (dimension === 'width' || dimension === 'depth') {
      const g = raycastGround(fakeEvent);
      if (g) {
        if (dimension === 'width')
          state.width = Math.round(Math.max(2, Math.min(10, Math.abs(g.x)*2)) * 4) / 4;
        else
          state.depth = Math.round(Math.max(2, Math.min(8,  Math.abs(g.z)*2)) * 4) / 4;
      }
    } else {
      // height: vertical drag
      const dy = t0.clientY - touchState.lastY;
      state.height = Math.round(Math.max(2.2, Math.min(3.5, state.height - dy*0.006)) * 10) / 10;
      touchState.lastY = t0.clientY;
    }
    buildRoom();
    if (typeof updatePriceDisplay === 'function') updatePriceDisplay();
    if (typeof syncDimSliders === 'function') syncDimSliders();
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
    if (touchState?.type === 'arrow' || touchState?.type === 'handle') {
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
