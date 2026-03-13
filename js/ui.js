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
  // Specs bar
  const el = id => document.getElementById(id);
  if (el('spec-width'))  el('spec-width').textContent  = s(w);
  if (el('spec-depth'))  el('spec-depth').textContent  = s(d);
  if (el('spec-height')) el('spec-height').textContent = s(h);
  if (el('spec-area'))   el('spec-area').textContent   = u ? (w*d*10.764).toFixed(0)+'ft²' : (w*d).toFixed(1)+'m²';
}

function toggleUnits() {
  state.units = state.units === 'metric' ? 'imperial' : 'metric';
  document.getElementById('unitsLabel').textContent = state.units === 'metric' ? 'm' : 'ft';
  syncDimSliders();
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
  // Update specs bar
  const sf = document.getElementById('spec-found');
  if (sf && key === 'foundation') sf.textContent = el ? el.textContent.trim().split('\n')[0] : value;
  const sr = document.getElementById('spec-roof');
  if (sr && key === 'roof') sr.textContent = el ? el.textContent.trim().split('\n')[0] : value;
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
  buildRoom();
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
}

// ─── VIEW PRESETS ───────────────────────────────────────────────────────────────

function setViewPreset(name) {
  if (typeof setView === 'function') setView(name);
}

// ─── ROOF CONTROLS (kept from original) ─────────────────────────────────────────

function setRoofTilt(val) {
  state.roofTilt = parseFloat(val);
  stateHistory.push();
  buildRoom();
}

function setApexPitch(val) {
  state.apexPitch = parseFloat(val);
  stateHistory.push();
  buildRoom();
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
