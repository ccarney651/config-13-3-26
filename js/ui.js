/**
 * ui.js — UI event handlers for the garden room configurator.
 * Updated to work with CATALOGUE-based pricing and swatch UI.
 */

// ─── UNDO / REDO ────────────────────────────────────────────────────────────────

function undoState() { stateHistory.undo(); }
function redoState() { stateHistory.redo(); }

document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
    e.preventDefault(); undoState();
  }
  if ((e.ctrlKey || e.metaKey) && (e.key === 'Z' || (e.key === 'z' && e.shiftKey) || e.key === 'y')) {
    e.preventDefault(); redoState();
  }
});

// ─── PRICE DISPLAY ──────────────────────────────────────────────────────────────

function updatePriceDisplay() {
  const total = calcTotal(state);
  document.getElementById('totalPrice').textContent = fmt(total);
  updateSpecsBar();
}

// ─── INTERIOR PARTITIONS ─────────────────────────────────────────────────────

const _WALL_TK = 0.14; // must match TK in scene.js

function addPartition(axis) {
  const id = state.nextPartitionId++;
  const hw = state.width / 2, hd = state.depth / 2;
  const halfLen = 1.0;
  const pos  = 0;
  // Clamp within interior bounds (exclude exterior wall thickness)
  const innerLimit = (axis === 'x' ? hw : hd) - _WALL_TK;
  const start = Math.max(-innerLimit, -halfLen);
  const end   = Math.min( innerLimit,  halfLen);
  state.partitions.push({ id, axis, pos, start, end, doors: [] });
  stateHistory.push();
  buildRoom();
  renderPartitionsList();
}

function addPresetRoom(type) {
  const id = state.nextPresetRoomId++;
  const defaults = {
    bathroom: { width: 2.0, depth: 1.8 },
    bedroom:  { width: 3.0, depth: 2.5 },
    office:   { width: 3.0, depth: 2.0 },
  };
  const { width, depth } = defaults[type] || { width: 2.5, depth: 2.0 };
  // Default to back wall, centred
  state.presetRooms.push({ id, type, wall: 'back', offset: 0, width, depth, doorOffset: 0 });
  stateHistory.push();
  buildRoom();
}

function addFurniture(type) {
  const id = state.nextFurnitureId++;
  // Place at room centre; user drags it from there
  state.furniture.push({ id, type, x: 0, z: 0, rotY: 0 });
  stateHistory.push();
  if (typeof buildFurniture === 'function') buildFurniture();
  if (typeof markDirty === 'function') markDirty();
  renderFurnitureList();
}

function renderFurnitureList() {
  const el = document.getElementById('furnitureList');
  if (!el) return;
  if (!state.furniture.length) {
    el.innerHTML = '<div style="color:var(--muted);font-size:12px;padding:2px 0">No furniture placed</div>';
    return;
  }
  const catalog = typeof FURNITURE_CATALOG !== 'undefined' ? FURNITURE_CATALOG : {};
  el.innerHTML = state.furniture.map(f => {
    const def = catalog[f.type];
    const label = def ? def.label : f.type;
    return `<div style="display:flex;align-items:center;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--border);font-size:12px">
      <span>${label}</span>
      <div style="display:flex;gap:4px">
        <button onclick="rotateFurniture(${f.id})" style="border:none;background:none;cursor:pointer;font-size:14px;padding:0 4px" title="Rotate 90°">↻</button>
        <button onclick="deleteFurniture(${f.id})" style="border:none;background:none;color:var(--warn);cursor:pointer;font-size:14px;padding:0 4px">✕</button>
      </div>
    </div>`;
  }).join('');
}

function rotateFurniture(id) {
  const f = state.furniture.find(x => x.id === id);
  if (!f) return;
  f.rotY = ((f.rotY ?? 0) + Math.PI / 2) % (Math.PI * 2);
  stateHistory.push();
  if (typeof buildFurniture === 'function') buildFurniture();
  if (typeof markDirty === 'function') markDirty();
}

function deleteFurniture(id) {
  state.furniture = state.furniture.filter(x => x.id !== id);
  stateHistory.push();
  if (typeof buildFurniture === 'function') buildFurniture();
  if (typeof markDirty === 'function') markDirty();
  renderFurnitureList();
}

function removeLastPartition(axis) {
  // Remove the most recently added partition of the given axis
  const idx = state.partitions.map(p => p.axis).lastIndexOf(axis);
  if (idx !== -1) {
    state.partitions.splice(idx, 1);
    stateHistory.push();
    buildRoom();
    renderPartitionsList();
  }
}

// Called by drag-to-place with a world position
function placePartitionAtPos(axis, cx, cz) {
  const id  = state.nextPartitionId++;
  const hw  = state.width / 2, hd = state.depth / 2;
  const halfLen = 1.0;
  let pos, start, end;
  if (axis === 'x') {
    pos   = Math.max(-hd, Math.min(hd, cz));
    start = Math.max(-hw, Math.min(hw, cx - halfLen));
    end   = Math.max(-hw, Math.min(hw, cx + halfLen));
  } else {
    pos   = Math.max(-hw, Math.min(hw, cx));
    start = Math.max(-hd, Math.min(hd, cz - halfLen));
    end   = Math.max(-hd, Math.min(hd, cz + halfLen));
  }
  if (end - start < 0.5) end = start + 0.5;
  state.partitions.push({ id, axis, pos, start, end, doors: [] });
  stateHistory.push();
  buildRoom();
  renderPartitionsList();
}

function removePartition(id) {
  state.partitions = state.partitions.filter(p => p.id !== id);
  stateHistory.push();
  buildRoom();
  renderPartitionsList();
}

function renderPartitionsList() {
  const el = document.getElementById('partitionsList');
  if (!el) return;
  if (!state.partitions.length) {
    el.innerHTML = '<div style="font-size:12px;color:var(--muted);padding:4px 0">No interior walls added yet</div>';
    return;
  }
  el.innerHTML = state.partitions.map(p => {
    const label   = p.axis === 'x' ? 'Horizontal wall' : 'Vertical wall';
    const lengthM = (p.end - p.start).toFixed(1);
    return `<div style="display:flex;justify-content:space-between;align-items:center;padding:5px 0;border-bottom:1px solid var(--border)">
      <span style="font-size:13px">${label} <span style="color:var(--muted);font-size:11px">${lengthM}m</span></span>
      <button onclick="removePartition(${p.id})" style="background:none;border:none;cursor:pointer;color:var(--muted);font-size:16px;padding:0 4px;line-height:1" title="Remove">×</button>
    </div>`;
  }).join('');
}

// ── Drag-to-place partition from UI ──────────────────────────────────────────
function partitionDragStart(e, axis) {
  e.dataTransfer.setData('text/plain', axis);
  e.dataTransfer.effectAllowed = 'copy';
}

function partitionDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'copy';
}

function partitionDrop(e) {
  e.preventDefault();
  const axis = e.dataTransfer.getData('text/plain');
  if (axis !== 'x' && axis !== 'z') return;
  addPartition(axis);
  const key = axis === 'x' ? 'horizontal_wall' : 'vertical_wall';
  updateItemQty('structuralItems', key, 1);
}

// ─── SPECS BAR ───────────────────────────────────────────────────────────────

function updateSpecsBar() {
  const el = id => document.getElementById(id);
  const u  = state.units === 'imperial';
  const s  = v => u ? (v * 3.281).toFixed(1) + 'ft'  : v.toFixed(2) + 'm';
  const s2 = v => u ? (v * 10.764).toFixed(0) + 'ft²' : v.toFixed(1) + 'm²';

  // Dimensions
  if (el('spec-width'))  el('spec-width').textContent  = s(state.width);
  if (el('spec-depth'))  el('spec-depth').textContent  = s(state.depth);
  if (el('spec-height')) el('spec-height').textContent = s(state.height);
  if (el('spec-area'))   el('spec-area').textContent   = s2(state.width * state.depth);
  const wallArea = (state.width * 2 + state.depth * 2) * state.height;
  if (el('spec-wall-area')) el('spec-wall-area').textContent = s2(wallArea);

  // Materials — resolve human-readable labels from the catalogue
  const label = key => {
    if (!key) return '—';
    const it = getItem(key);
    if (it) return it.label;
    // Fallback: title-case the key
    return key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  };
  const FOUNDATION_LABELS = { concrete: 'Concrete', block: 'Block', ground_screws: 'Ground Screws' };
  const roofLabel    = state.roof === 'apex' ? 'Apex' : 'Flat';
  const finishLabel  = label(state.roofFinish);
  if (el('spec-found'))      el('spec-found').textContent      = FOUNDATION_LABELS[state.foundation] || label(state.foundation);
  if (el('spec-roof'))       el('spec-roof').textContent       = roofLabel + (finishLabel !== '—' ? ' · ' + finishLabel : '');
  if (el('spec-cladding'))   el('spec-cladding').textContent   = label(state.cladding);
  if (el('spec-int-walls'))  el('spec-int-walls').textContent  = label(state.interiorWalls);
  if (el('spec-int-floor'))  el('spec-int-floor').textContent  = label(state.interiorFloor);

  // Doors & Windows
  const openingsList = el('spec-openings-list');
  const openingsCount = el('spec-openings-count');
  if (openingsList) {
    const ops = state.openings || [];
    if (openingsCount) openingsCount.textContent = ops.length;
    openingsList.innerHTML = ops.length ? ops.map(op => {
      const wallName  = op.wall.charAt(0).toUpperCase() + op.wall.slice(1) + ' wall';
      const styleName = label(op.style) !== '—' ? label(op.style) : (op.type === 'door' ? 'Door' : 'Window');
      return `<div class="spec-sub-row"><span>${wallName}</span><span>${styleName}</span></div>`;
    }).join('') : '<div class="spec-empty">None added</div>';
  }

  // Extras & Additions
  const extrasList  = el('spec-extras-list');
  const extrasCount = el('spec-extras-count');
  if (extrasList) {
    const rows = [];
    const qtyGroups = ['electricalItems','bathroomItems','heatingItems','structuralItems','roofPorchItems','miscItems'];
    qtyGroups.forEach(group => {
      Object.entries(state[group] || {}).forEach(([key, qty]) => {
        if (qty > 0) {
          const it = getItem(key);
          rows.push([it ? it.label : key, qty + '×']);
        }
      });
    });
    // Boolean services
    [
      ['mainsConnection',       'Mains Connection'],
      ['ethernetConnection',    'Ethernet Connection'],
      ['waterWasteConnection',  'Water & Waste'],
      ['groundProtectionMats',  'Ground Protection Mats'],
      ['skipHire',              'Skip Hire'],
      ['groundworks',           'Groundworks'],
    ].forEach(([key, lbl]) => { if (state[key]) rows.push([lbl, '✓']); });
    // Decking
    if (state.extras && state.extras.decking)
      rows.push(['Decking', s2(state.deckingArea)]);

    if (extrasCount) extrasCount.textContent = rows.length;
    extrasList.innerHTML = rows.length
      ? rows.map(([l, v]) => `<div class="spec-sub-row"><span>${l}</span><span>${v}</span></div>`).join('')
      : '<div class="spec-empty">None added</div>';
  }
}

// ─── DIMENSIONS ─────────────────────────────────────────────────────────────────

function setDimension(key, val) {
  state[key] = parseFloat(val);
  syncDimSliders();
  stateHistory.push();
  buildRoom();
  updatePriceDisplay();
}

function syncDimSliders() {
  const w = state.width, d = state.depth, h = state.height;
  const u = state.units === 'imperial';
  const s = v => u ? (v * 3.281).toFixed(1) + 'ft' : v.toFixed(2) + 'm';
  document.getElementById('widthSlider').value  = w;
  document.getElementById('depthSlider').value  = d;
  document.getElementById('heightSlider').value = h;
  document.getElementById('widthVal').textContent  = s(w);
  document.getElementById('depthVal').textContent  = s(d);
  document.getElementById('heightVal').textContent = s(h);
  updateSpecsBar();
}

function toggleUnits() {
  state.units = state.units === 'metric' ? 'imperial' : 'metric';
  document.getElementById('unitsLabel').textContent = state.units === 'metric' ? 'm' : 'ft';
  syncDimSliders();
  if (typeof markDirty === 'function') markDirty();
}

// ─── GENERIC OPTION SELECT ──────────────────────────────────────────────────────

function selectOpt(key, value, el) {
  state[key] = value;
  // Deactivate siblings
  if (el) {
    el.closest('.option-grid').querySelectorAll('.option-btn').forEach(b => b.classList.remove('active'));
    el.classList.add('active');
  }
  stateHistory.push();
  buildRoom();
  updatePriceDisplay();
  // Show/hide roof pitch/tilt sliders when roof type changes
  if (key === 'roof') syncRoofSliderVisibility();
}

// ─── SCENE ──────────────────────────────────────────────────────────────────────

function selectScene(type, el) {
  state.groundType = type;
  el.closest('.option-grid').querySelectorAll('.option-btn').forEach(b => b.classList.remove('active'));
  el.classList.add('active');
  if (typeof setGroundType === 'function') setGroundType(type);
}

// ─── SUB-TAB FILTERING ──────────────────────────────────────────────────────────

function filterSubTab(tabId, subKey, el) {
  // Deactivate sibling tabs
  el.closest('.sub-tabs').querySelectorAll('.sub-tab').forEach(b => b.classList.remove('active'));
  el.classList.add('active');
  // Show matching content, hide others
  const section = el.closest('.section');
  section.querySelectorAll('.sub-content').forEach(c => c.classList.remove('active'));
  const target = section.querySelector(`[data-subtab="${tabId}-${subKey}"]`);
  if (target) target.classList.add('active');
}

// ─── CLADDING ───────────────────────────────────────────────────────────────────

let _claddingWall = 'all';

function setCladdingWall(wall) {
  _claddingWall = wall;
}

function selectCladding(key, el) {
  if (_claddingWall === 'all') {
    state.cladding = key;
    state.claddingPerWall = { front: null, back: null, left: null, right: null };
  } else {
    state.claddingPerWall[_claddingWall] = key;
  }
  // Update active swatch
  el.closest('.swatch-grid').querySelectorAll('.cat-swatch').forEach(b => b.classList.remove('active'));
  el.classList.add('active');
  stateHistory.push();
  buildRoom();
  updatePriceDisplay();
}

// ─── ROOF FINISH ────────────────────────────────────────────────────────────────

function selectRoofFinish(key, el) {
  state.roofFinish = key;
  el.closest('.swatch-grid').querySelectorAll('.cat-swatch').forEach(b => b.classList.remove('active'));
  el.classList.add('active');
  stateHistory.push();
  if (typeof _invalidateMat === 'function') _invalidateMat('roof_');
  buildRoom();
  updatePriceDisplay();
}

// ─── INTERIOR ───────────────────────────────────────────────────────────────────

function selectInteriorWalls(key, el) {
  state.interiorWalls = key;
  el.closest('.swatch-grid').querySelectorAll('.cat-swatch').forEach(b => b.classList.remove('active'));
  el.classList.add('active');
  stateHistory.push();
  buildRoom();
  updatePriceDisplay();
}

function selectInteriorFloor(key, el) {
  state.interiorFloor = key;
  el.closest('.swatch-grid').querySelectorAll('.cat-swatch').forEach(b => b.classList.remove('active'));
  el.classList.add('active');
  stateHistory.push();
  if (typeof _invalidateMat === 'function') _invalidateMat('intFloor_');
  buildRoom();
  updatePriceDisplay();
}

// ─── GUTTERING ──────────────────────────────────────────────────────────────────

function selectGuttering(key, el) {
  state.guttering = key;
  el.closest('.swatch-grid').querySelectorAll('.cat-swatch').forEach(b => b.classList.remove('active'));
  el.classList.add('active');
  stateHistory.push();
  buildRoom();
  updatePriceDisplay();
}

// ─── FRAME COLOUR ───────────────────────────────────────────────────────────────

function selectFrameColour(hex, el) {
  state.frameColour = hex;
  el.closest('.colour-circles').querySelectorAll('.colour-dot').forEach(b => b.classList.remove('active'));
  el.classList.add('active');
  stateHistory.push();
  if (typeof applyFrameColour === 'function') applyFrameColour(); else buildRoom();
}

// ─── DOORS & WINDOWS ────────────────────────────────────────────────────────────

function selectDoorStyle(key, el) {
  state.defaultDoor = key;
  el.closest('.swatch-grid').querySelectorAll('.cat-swatch').forEach(b => b.classList.remove('active'));
  el.classList.add('active');
}

function selectWindowStyle(key, el) {
  state.defaultWindow = key;
  el.closest('.swatch-grid').querySelectorAll('.cat-swatch').forEach(b => b.classList.remove('active'));
  el.classList.add('active');
}

function selectGlazingType(key, el) {
  el.closest('.swatch-grid').querySelectorAll('.cat-swatch').forEach(b => b.classList.remove('active'));
  el.classList.add('active');
  stateHistory.push();
  updatePriceDisplay();
}

// ─── DECKING ────────────────────────────────────────────────────────────────────

function selectDeckingMaterial(key, el) {
  state.deckingMaterial = key;
  el.closest('.swatch-grid').querySelectorAll('.cat-swatch').forEach(b => b.classList.remove('active'));
  el.classList.add('active');
  stateHistory.push();
  buildRoom();
  updatePriceDisplay();
}

function updateDeckingArea(val) {
  state.deckingArea = parseFloat(val);
  document.getElementById('deckingAreaVal').textContent = val + 'm²';
  stateHistory.push();
  buildRoom();
  updatePriceDisplay();
}

// ─── TOGGLES ────────────────────────────────────────────────────────────────────

function toggleExtra(key, btn) {
  state.extras[key] = !state.extras[key];
  btn.classList.toggle('on');
  stateHistory.push();
  buildRoom();
  updatePriceDisplay();
}

// ─── SERVICE CONNECTION BOOLEANS ─────────────────────────────────────────────────

function toggleMainsConnection(val) {
  state.mainsConnection = val;
  if (!val) {
    // Clear electrical quantities when mains is removed
    Object.keys(state.electricalItems).forEach(k => { state.electricalItems[k] = 0; });
    syncQtyDisplays('electricalItems');
  }
  syncElectricsUI();
  stateHistory.push();
  updatePriceDisplay();
}

function toggleEthernetConnection(val) {
  state.ethernetConnection = val;
  stateHistory.push();
  updatePriceDisplay();
}

function toggleSiteOption(key, val) {
  state[key] = val;
  stateHistory.push();
  updatePriceDisplay();
}

function syncElectricsUI() {
  const disabled = !state.mainsConnection;
  document.querySelectorAll('#tab-electrics .qty-btn').forEach(b => b.disabled = disabled);
}

function syncQtyDisplays(stateKey) {
  if (!state[stateKey]) return;
  Object.entries(state[stateKey]).forEach(([key, qty]) => {
    const el = document.getElementById('qty-' + key);
    if (el) {
      el.textContent = qty;
      const row = el.closest('.qty-item');
      if (row) row.classList.toggle('has-qty', qty > 0);
    }
  });
}

// ─── QUANTITY ITEMS (electrical, bathroom, heating, etc.) ────────────────────────

function updateItemQty(stateObj, key, delta) {
  if (!state[stateObj]) return;
  const current = state[stateObj][key] || 0;
  const newVal = Math.max(0, current + delta);
  state[stateObj][key] = newVal;

  const valEl = document.getElementById('qty-' + key);
  if (valEl) {
    valEl.textContent = newVal;
    const row = valEl.closest('.qty-item');
    if (row) row.classList.toggle('has-qty', newVal > 0);
  }

  // If veranda qty changed, rebuild 3D and sync depth slider visibility
  if (stateObj === 'roofPorchItems' && key === 'veranda') {
    syncVerandaDepthSlider();
    buildRoom();
  }

  stateHistory.push();
  updatePriceDisplay();
}

// ─── OPENINGS LIST ──────────────────────────────────────────────────────────────

function renderOpeningsList() {
  const container = document.getElementById('openingsList');
  if (!container) return;

  if (state.openings.length === 0) {
    container.innerHTML = '<p class="helper-text" style="margin:4px 0">No openings placed yet.</p>';
    return;
  }

  container.innerHTML = state.openings.map(op => {
    const item = getItem(op.style);
    const label = item ? item.label : op.style;
    const price = item ? fmt(item.rate) : '';
    return `<div class="opening-row">
      <span class="opening-label">${op.type === 'door' ? '🚪' : '🪟'} ${label}</span>
      <span class="opening-price">${price}</span>
      <span class="opening-wall">${op.wall}</span>
      <button class="opening-del" onclick="deleteOpening(${op.id})" title="Remove">✕</button>
    </div>`;
  }).join('');
}

// ─── SYNC SWATCHES TO STATE ─────────────────────────────────────────────────────
// Called on load and undo/redo to highlight the correct active swatches.

function syncSwatchesToState() {
  // Highlight active cladding swatch
  document.querySelectorAll('#tab-cladding .cat-swatch').forEach(s => {
    s.classList.toggle('active', s.dataset.key === state.cladding);
  });
  // Highlight active roof finish
  document.querySelectorAll('#tab-roof .cat-swatch').forEach(s => {
    s.classList.toggle('active', s.dataset.key === state.roofFinish);
  });
  // Highlight active interior walls
  document.querySelectorAll('#tab-interior .cat-swatch').forEach(s => {
    if (s.closest('.section')?.querySelector('.section-title')?.textContent === 'Wall Finish') {
      s.classList.toggle('active', s.dataset.key === state.interiorWalls);
    }
  });
  // Highlight active interior floor
  document.querySelectorAll('#tab-interior [data-subtab^="floor-sub"] .cat-swatch').forEach(s => {
    s.classList.toggle('active', s.dataset.key === state.interiorFloor);
  });
  // Highlight active guttering
  document.querySelectorAll('#tab-exterior .cat-swatch').forEach(s => {
    s.classList.toggle('active', s.dataset.key === state.guttering);
  });
  // Sync qty displays and has-qty class (for drag-drop highlight + minus button visibility)
  for (const obj of ['electricalItems', 'bathroomItems', 'heatingItems', 'structuralItems', 'roofPorchItems', 'miscItems']) {
    if (state[obj]) {
      Object.entries(state[obj]).forEach(([key, qty]) => {
        const el = document.getElementById('qty-' + key);
        if (el) {
          el.textContent = qty;
          const row = el.closest('.qty-item');
          if (row) row.classList.toggle('has-qty', qty > 0);
        }
      });
    }
  }
  // Sync option-button active states (foundation, roof type, etc.)
  document.querySelectorAll('.option-btn[data-key]').forEach(btn => {
    const key = btn.dataset.key;
    const val = btn.dataset.val;
    if (key && val !== undefined) btn.classList.toggle('active', String(state[key]) === String(val));
  });
  document.querySelectorAll('#tab-style .option-btn').forEach(btn => {
    // foundation buttons: onclick="selectOpt('foundation','concrete',this)"
    const match = btn.getAttribute('onclick')?.match(/selectOpt\('(\w+)','([^']+)'/);
    if (match) btn.classList.toggle('active', state[match[1]] === match[2]);
  });
  // Sync decking toggle
  const deckToggle = document.getElementById('toggle-decking');
  if (deckToggle) deckToggle.classList.toggle('on', state.extras.decking);
  // Sync service connection checkboxes
  const chkMains = document.getElementById('chk-mains');
  if (chkMains) chkMains.checked = !!state.mainsConnection;
  const chkEth = document.getElementById('chk-ethernet');
  if (chkEth) chkEth.checked = !!state.ethernetConnection;
  const chkWater = document.getElementById('chk-waterwaste');
  if (chkWater) chkWater.checked = !!state.waterWasteConnection;
  const chkMats = document.getElementById('chk-protectionmats');
  if (chkMats) chkMats.checked = !!state.groundProtectionMats;
  const chkSkip = document.getElementById('chk-skip');
  if (chkSkip) chkSkip.checked = !!state.skipHire;
  const chkGw = document.getElementById('chk-groundworks');
  if (chkGw) chkGw.checked = !!state.groundworks;
  // Sync electrics disabled state
  if (typeof syncElectricsUI === 'function') syncElectricsUI();
  // Sync roof pitch/tilt sliders
  if (typeof syncRoofSliders === 'function') syncRoofSliders();
  // Sync veranda depth slider
  if (typeof syncVerandaDepthSlider === 'function') syncVerandaDepthSlider();
}

// ─── DESIGN FLIP ────────────────────────────────────────────────────────────────

function flipDesign() {
  state.openings.forEach(op => {
    if (op.wall === 'left') op.wall = 'right';
    else if (op.wall === 'right') op.wall = 'left';
    op.offset = -op.offset;
  });
  stateHistory.push();
  buildRoom();
  renderOpeningsList();
  renderPartitionsList();
}

// ─── VIEW PRESETS ───────────────────────────────────────────────────────────────

function setViewPreset(name) {
  if (typeof setView === 'function') setView(name);
}

// ─── ROOF CONTROLS ───────────────────────────────────────────────────────────────

function setRoofTilt(val) {
  state.roofTilt = parseFloat(val);
  stateHistory.push();
  buildRoom();
}

function setApexPitch(val) {
  state.apexPitch = Math.min(2.0, parseFloat(val));
  stateHistory.push();
  buildRoom();
}

function syncRoofSliderVisibility() {
  const isApex = state.roof === 'apex';
  const apexRow = document.getElementById('apexPitchRow');
  const tiltRow = document.getElementById('roofTiltRow');
  if (apexRow) apexRow.style.display = isApex ? '' : 'none';
  if (tiltRow) tiltRow.style.display = isApex ? 'none' : '';
}

// ─── VERANDA CONTROLS ────────────────────────────────────────────────────────────

function setVerandaDepth(val) {
  state.veranda = state.veranda || {};
  state.veranda.depth = parseFloat(val);
  document.getElementById('verandaDepthVal').textContent = parseFloat(val).toFixed(2) + 'm';
  stateHistory.push();
  buildRoom();
}

function syncVerandaDepthSlider() {
  const qty = state.roofPorchItems?.veranda ?? 0;
  const row = document.getElementById('verandaDepthRow');
  if (row) row.style.display = qty > 0 ? '' : 'none';
  const slider = document.getElementById('verandaDepthSlider');
  const val    = document.getElementById('verandaDepthVal');
  const depth  = state.veranda?.depth ?? 2.0;
  if (slider) slider.value = depth;
  if (val)    val.textContent = depth.toFixed(2) + 'm';
}

// ─── ROOF SLIDERS ─────────────────────────────────────────────────────────────

function syncRoofSliders() {
  const pitchSlider = document.getElementById('apexPitchSlider');
  const pitchVal    = document.getElementById('apexPitchVal');
  if (pitchSlider) pitchSlider.value = state.apexPitch ?? 1.0;
  if (pitchVal)    pitchVal.textContent = (state.apexPitch ?? 1.0).toFixed(2) + 'm';

  const tiltSlider = document.getElementById('roofTiltSlider');
  const tiltVal    = document.getElementById('roofTiltVal');
  if (tiltSlider) tiltSlider.value = state.roofTilt ?? 2;
  if (tiltVal)    tiltVal.textContent = (state.roofTilt ?? 2).toFixed(1) + '°';

  syncRoofSliderVisibility();
}

// ─── SAVE / LOAD / PRESETS ───────────────────────────────────────────────────────

const DESIGN_STORAGE_PREFIX = 'gardenroom_design_';

// Hardcoded starting presets — loaded once if localStorage has no saved designs yet.
const DESIGN_PRESETS = [
  {
    name: 'Garden Office',
    state: {
      width: 5.0, depth: 4.0, height: 2.7,
      roof: 'apex', apexPitch: 1.0, roofTilt: 2,
      roofFinish: 'epdm_black_roofing',
      cladding: 'vertical_cedar_cladding', claddingTint: '#5c4033',
      frameColour: '#1a1a1a',
      openings: [
        { id: 1, type: 'door',   wall: 'front', offset: 0,    style: 'sliding_2_part_door' },
        { id: 2, type: 'window', wall: 'left',  offset: 0,    style: 'fixed_window' },
        { id: 3, type: 'window', wall: 'right', offset: 0,    style: 'fixed_window' },
      ],
      nextOpeningId: 4,
      interiorWalls: 'white_finished_walls', interiorFloor: 'oak_flooring',
      guttering: 'gutter_black',
    }
  },
  {
    name: 'Summer House',
    state: {
      width: 5.0, depth: 3.0, height: 2.5,
      roof: 'apex', apexPitch: 1.3, roofTilt: 0,
      roofFinish: 'shingles_square_black_roofing',
      cladding: 'shiplap_horizontal_cladding', claddingTint: '#8b6914',
      frameColour: '#5b2019',
      openings: [
        { id: 1, type: 'door',   wall: 'front', offset: 0,   style: 'double_door' },
        { id: 2, type: 'window', wall: 'left',  offset: 0,   style: 'tilt_n_turn_window' },
        { id: 3, type: 'window', wall: 'right', offset: 0,   style: 'tilt_n_turn_window' },
        { id: 4, type: 'window', wall: 'front', offset: -1.5, style: 'fixed_window' },
        { id: 5, type: 'window', wall: 'front', offset:  1.5, style: 'fixed_window' },
      ],
      nextOpeningId: 6,
      interiorWalls: 'tongue_and_groove_finished_walls', interiorFloor: 'farm_oak_flooring',
      guttering: 'gutter_black',
    }
  },
  {
    name: 'Studio / Bar',
    state: {
      width: 6.0, depth: 4.0, height: 2.7,
      roof: 'flat', apexPitch: 1.0, roofTilt: 3,
      roofFinish: 'epdm_black_roofing',
      cladding: 'horizontal_midnight_charcoal_cladding', claddingTint: '#2a2a2a',
      frameColour: '#111111',
      openings: [
        { id: 1, type: 'door',   wall: 'front', offset: 0,   style: 'bifold_door' },
        { id: 2, type: 'window', wall: 'left',  offset: 0,   style: 'long_panel_window' },
        { id: 3, type: 'window', wall: 'right', offset: 0,   style: 'long_panel_window' },
      ],
      nextOpeningId: 4,
      interiorWalls: 'white_finished_walls', interiorFloor: 'polished_concrete_flooring',
      guttering: 'gutter_black',
    }
  },
  {
    name: 'Compact Retreat',
    state: {
      width: 3.0, depth: 3.0, height: 2.5,
      roof: 'apex', apexPitch: 0.8, roofTilt: 0,
      roofFinish: 'shingles_square_black_roofing',
      cladding: 'vertical_loglap_cladding', claddingTint: '#7a5533',
      frameColour: '#3b2a1a',
      openings: [
        { id: 1, type: 'door',   wall: 'front', offset: 0, style: 'single_door' },
        { id: 2, type: 'window', wall: 'left',  offset: 0, style: 'tilt_n_turn_window' },
        { id: 3, type: 'window', wall: 'back',  offset: 0, style: 'fixed_window' },
      ],
      nextOpeningId: 4,
      interiorWalls: 'plywood_finished_walls', interiorFloor: 'oak_flooring',
      guttering: 'gutter_black',
    }
  },
];

// Apply a plain state snapshot to the live state object, then refresh all UI and 3D.
function _applyStateSnapshot(snap) {
  stateHistory._paused = true;
  Object.keys(snap).forEach(k => {
    if (typeof snap[k] === 'object' && snap[k] !== null && !Array.isArray(snap[k])) {
      if (typeof state[k] === 'object' && state[k] !== null) {
        Object.assign(state[k], snap[k]);
      } else {
        state[k] = snap[k];
      }
    } else {
      state[k] = snap[k];
    }
  });
  stateHistory._paused = false;
  stateHistory.push();
  buildRoom();
  updatePriceDisplay();
  syncSwatchesToState();
  syncDimSliders();
  renderOpeningsList();
  renderPartitionsList();
}

// ── Presets ──────────────────────────────────────────────────────────────────────

function loadPreset(index) {
  const preset = DESIGN_PRESETS[index];
  if (!preset) return;
  _applyStateSnapshot(preset.state);
}

// ── Save / Load (localStorage) ──────────────────────────────────────────────────

function saveDesign() {
  const name = document.getElementById('designNameInput')?.value.trim();
  if (!name) { alert('Please enter a name for your design.'); return; }
  try {
    localStorage.setItem(DESIGN_STORAGE_PREFIX + name, JSON.stringify(state));
    renderDesignsList();
    document.getElementById('designNameInput').value = '';
  } catch(e) { alert('Could not save design: ' + e.message); }
}

function loadDesign(name) {
  try {
    const raw = localStorage.getItem(DESIGN_STORAGE_PREFIX + name);
    if (!raw) return;
    _applyStateSnapshot(JSON.parse(raw));
  } catch(e) { alert('Could not load design: ' + e.message); }
}

function deleteDesign(name) {
  localStorage.removeItem(DESIGN_STORAGE_PREFIX + name);
  renderDesignsList();
}

function getSavedDesignNames() {
  return Object.keys(localStorage)
    .filter(k => k.startsWith(DESIGN_STORAGE_PREFIX))
    .map(k => k.slice(DESIGN_STORAGE_PREFIX.length))
    .sort();
}

function renderDesignsList() {
  const container = document.getElementById('savedDesignsList');
  if (!container) return;
  const names = getSavedDesignNames();
  if (!names.length) {
    container.innerHTML = '<p class="helper-text" style="margin:4px 0;font-size:12px;color:var(--muted)">No saved designs yet.</p>';
    return;
  }
  container.innerHTML = names.map(name => `
    <div class="opening-row">
      <span class="opening-label" style="flex:1;font-size:13px">${name}</span>
      <button class="qty-btn" style="padding:3px 10px;font-size:12px" onclick="loadDesign(${JSON.stringify(name)})">Load</button>
      <button class="qty-btn" style="padding:3px 8px;font-size:12px;margin-left:4px;color:#e55" onclick="deleteDesign(${JSON.stringify(name)})" title="Delete">✕</button>
    </div>`).join('');
}

// ── Download / Upload (file) ─────────────────────────────────────────────────────

function downloadDesign() {
  const json = JSON.stringify(state, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = 'garden-room-design.json';
  a.click();
  URL.revokeObjectURL(url);
}

function uploadDesignFile(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    try {
      _applyStateSnapshot(JSON.parse(e.target.result));
    } catch(err) { alert('Could not read design file: ' + err.message); }
    input.value = '';
  };
  reader.readAsText(file);
}

// ─── URL HASH SHARE ─────────────────────────────────────────────────────────────

function encodeStateToHash() {
  try {
    // encodeURIComponent first ensures any non-Latin-1 chars in state values
    // are percent-escaped before btoa, which only handles Latin-1.
    return btoa(encodeURIComponent(JSON.stringify(state)));
  } catch(e) { return ''; }
}

function decodeHashToState(hash) {
  try {
    // Support both old plain-btoa links and new encodeURIComponent links.
    let json;
    const raw = atob(hash);
    // If the decoded string starts with '%', it was encodeURIComponent'd.
    json = raw.startsWith('%') || raw.startsWith('{') === false
      ? decodeURIComponent(raw)
      : raw;
    const decoded = JSON.parse(json);
    Object.keys(decoded).forEach(k => {
      if (typeof decoded[k] === 'object' && decoded[k] !== null && !Array.isArray(decoded[k])) {
        if (state[k]) Object.assign(state[k], decoded[k]);
      } else {
        state[k] = decoded[k];
      }
    });
    return true;
  } catch(e) { return false; }
}

function shareDesign() {
  const url = location.origin + location.pathname + '#' + encodeStateToHash();
  if (navigator.clipboard) {
    navigator.clipboard.writeText(url).then(() => {
      const copied = document.getElementById('shareCopied');
      if (copied) { copied.style.display='inline'; setTimeout(() => copied.style.display='none', 2000); }
    });
  } else {
    prompt('Copy this link to share your design:', url);
  }
}

function tryLoadFromURL() {
  const hash = location.hash.slice(1);
  if (!hash) return false;
  return decodeHashToState(hash);
}

// ─── PALETTE / OPENING UI ───────────────────────────────────────────────────────
// NOTE: setActivePalette is defined in scene.js (the real implementation).
// Do NOT redefine it here — ui.js loads after scene.js and would shadow it.

function updatePaletteUI() {
  // Called by scene.js after palette/selection changes — keep openings list in sync.
  renderOpeningsList();
  renderPartitionsList();
}

// ─── APPLY ADMIN DISABLED ITEMS ─────────────────────────────────────────────────
// Hides any customer-facing option whose data-key matches a disabled item
// in the admin panel. Runs once on page load.
(function applyAdminDisabledItems() {
  if (typeof DISABLED_ITEMS === 'undefined') return;
  const disabled = Object.keys(DISABLED_ITEMS).filter(k => DISABLED_ITEMS[k]);
  if (!disabled.length) return;

  disabled.forEach(key => {
    // Swatch buttons and option buttons with data-key
    document.querySelectorAll(`[data-key="${key}"]`).forEach(el => {
      el.style.display = 'none';
    });
  });
})();

// ─── DRAG-AND-DROP QTY ITEMS ─────────────────────────────────────────────────
// Parses existing qty-item HTML to extract stateObj/key, then sets up:
//   - Draggable from the panel card
//   - Drop zone on the 3D viewport
//   - Drag handle icon injected into each card
//   - + button hidden; − button kept for removal

(function initQtyDragDrop() {
  // ── 1. Enrich all qty-item elements with data attrs + drag handle ─────────
  document.querySelectorAll('.qty-item').forEach(item => {
    // Parse stateObj and key from the + button's onclick
    const plusBtn = Array.from(item.querySelectorAll('.qty-btn')).find(b => b.textContent.trim() === '+');
    if (!plusBtn) return;
    const m = plusBtn.getAttribute('onclick').match(/updateItemQty\('([^']+)','([^']+)',1\)/);
    if (!m) return;
    item.dataset.stateObj = m[1];
    item.dataset.key = m[2];
    item.setAttribute('draggable', 'true');

    // Hide the + button (dragging is the add gesture now)
    plusBtn.style.display = 'none';

    // Inject drag handle at the front
    const handle = document.createElement('span');
    handle.className = 'qty-drag-handle';
    handle.setAttribute('aria-hidden', 'true');
    handle.innerHTML = '⠿';
    item.insertBefore(handle, item.firstChild);
  });

  // ── 2. Drag events on items ───────────────────────────────────────────────
  let _dragPayload = null;

  document.addEventListener('dragstart', e => {
    const item = e.target.closest('.qty-item[draggable="true"]');
    if (!item) return;
    _dragPayload = { stateObj: item.dataset.stateObj, key: item.dataset.key };
    e.dataTransfer.effectAllowed = 'copy';
    e.dataTransfer.setData('text/plain', JSON.stringify(_dragPayload));
    item.classList.add('dragging');
    const overlay = document.getElementById('dropOverlay');
    if (overlay) overlay.classList.add('active');
  });

  document.addEventListener('dragend', e => {
    const item = e.target.closest('.qty-item');
    if (item) item.classList.remove('dragging');
    _dragPayload = null;
    const overlay = document.getElementById('dropOverlay');
    if (overlay) overlay.classList.remove('active');
  });

  // ── 3. Drop zone on the viewport ─────────────────────────────────────────
  const viewport = document.querySelector('.viewport');
  if (!viewport) return;

  viewport.addEventListener('dragover', e => {
    if (!_dragPayload) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  });

  viewport.addEventListener('dragleave', e => {
    // Only trigger if leaving the viewport entirely (not entering a child)
    if (!viewport.contains(e.relatedTarget)) {
      const overlay = document.getElementById('dropOverlay');
      if (overlay) overlay.classList.remove('active');
    }
  });

  viewport.addEventListener('drop', e => {
    e.preventDefault();
    const overlay = document.getElementById('dropOverlay');
    if (overlay) overlay.classList.remove('active');

    let payload = _dragPayload;
    if (!payload) {
      try { payload = JSON.parse(e.dataTransfer.getData('text/plain')); } catch { return; }
    }
    if (!payload) return;

    updateItemQty(payload.stateObj, payload.key, 1);
    showDropFeedback(e.clientX, e.clientY, payload.key);
  });
})();

function showDropFeedback(x, y, key) {
  // Ripple at drop point
  const ripple = document.createElement('div');
  ripple.className = 'drop-ripple';
  ripple.style.left = x + 'px';
  ripple.style.top = y + 'px';
  document.body.appendChild(ripple);
  setTimeout(() => ripple.remove(), 600);

  // Toast label
  const item = getItem(key);
  const label = item ? item.label : key.replace(/_/g, ' ');
  const toast = document.createElement('div');
  toast.className = 'drop-toast';
  toast.textContent = `✓ ${label} added`;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 2100);
}
