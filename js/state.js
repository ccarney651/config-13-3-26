/**
 * state.js — single source of truth.
 * Updated to support full gardenroomplanner.com catalogue (505 items).
 */

// ─── UNDO / REDO ────────────────────────────────────────────────────────────────

const stateHistory = {
  stack: [],
  pointer: -1,
  maxSize: 50,
  _paused: false,

  push() {
    if (this._paused) return;
    const snap = JSON.stringify(state);
    if (this.pointer >= 0 && this.stack[this.pointer] === snap) return;
    this.stack.length = this.pointer + 1;
    this.stack.push(snap);
    if (this.stack.length > this.maxSize) this.stack.shift();
    this.pointer = this.stack.length - 1;
    this._updateButtons();
  },

  undo() {
    if (this.pointer <= 0) return;
    this.pointer--;
    this._restore();
  },

  redo() {
    if (this.pointer >= this.stack.length - 1) return;
    this.pointer++;
    this._restore();
  },

  _restore() {
    this._paused = true;
    const snap = JSON.parse(this.stack[this.pointer]);
    Object.keys(snap).forEach(k => {
      if (typeof snap[k] === 'object' && snap[k] !== null && !Array.isArray(snap[k])) {
        Object.assign(state[k], snap[k]);
      } else {
        state[k] = snap[k];
      }
    });
    if (typeof buildRoom === 'function') buildRoom();
    if (typeof updatePriceDisplay === 'function') updatePriceDisplay();
    if (typeof syncSwatchesToState === 'function') syncSwatchesToState();
    if (typeof syncDimSliders === 'function') syncDimSliders();
    if (typeof renderOpeningsList === 'function') renderOpeningsList();
    if (typeof renderPartitionsList === 'function') renderPartitionsList();
    this._paused = false;
    this._updateButtons();
  },

  _updateButtons() {
    const ub = document.getElementById('tbUndo');
    const rb = document.getElementById('tbRedo');
    if (ub) ub.disabled = this.pointer <= 0;
    if (rb) rb.disabled = this.pointer >= this.stack.length - 1;
  },

  canUndo() { return this.pointer > 0; },
  canRedo() { return this.pointer < this.stack.length - 1; },
};

const state = {
  // ─── Dimensions ───────────────────────────────────────────────────────────
  width:  5.0,
  depth:  4.0,
  height: 2.7,

  // ─── Foundation ───────────────────────────────────────────────────────────
  foundation: 'concrete',

  // ─── Roof ─────────────────────────────────────────────────────────────────
  roof:       'apex',
  roofTilt:   2,
  roofFinish: 'epdm_black_roofing',
  apexPitch:  1.0,

  // ─── Cladding ─────────────────────────────────────────────────────────────
  cladding: 'vertical_cedar_cladding',
  claddingTint: '#5c4033',
  claddingPerWall: { front: null, back: null, left: null, right: null },

  // ─── Frame / Trim ─────────────────────────────────────────────────────────
  frameColour:  '#1a1a1a',
  handleColour: 'black',

  // ─── Openings ─────────────────────────────────────────────────────────────
  defaultDoor:    'double_door',
  defaultWindow:  'fixed_window',
  defaultDoorMat: 'aluminium',

  openings: [
    { id: 1, type: 'door',   wall: 'front', offset: 0, style: 'sliding_2_part_door' },
    { id: 2, type: 'window', wall: 'left',  offset: 0, style: 'fixed_window' },
    { id: 3, type: 'window', wall: 'right', offset: 0, style: 'fixed_window' },
    { id: 4, type: 'window', wall: 'back',  offset: 0, style: 'tilt_n_turn_window' },
  ],
  nextOpeningId: 5,

  // ─── Interior partitions ──────────────────────────────────────────────────
  partitions: [],
  nextPartitionId: 1,

  // ─── Interior ─────────────────────────────────────────────────────────────
  interiorWalls: 'white_finished_walls',
  interiorFloor: 'oak_flooring',

  // ─── Exterior finish ──────────────────────────────────────────────────────
  guttering: 'gutter_black',

  // ─── Decking ──────────────────────────────────────────────────────────────
  extras: {
    decking: false,
  },
  deckingMaterial:   'treated_decking',
  deckingArea:       10,
  deckingBalustrade: 'none',

  // ─── Service / site booleans ──────────────────────────────────────────────
  mainsConnection:      false,
  ethernetConnection:   false,
  waterWasteConnection: false,
  groundProtectionMats: false,
  skipHire:             false,
  groundworks:          false,

  // ─── Quantity-based items ─────────────────────────────────────────────────
  electricalItems: {
    double_socket: 0, single_socket: 0, floor_socket: 0, usb_socket: 0,
    smart_socket: 0, external_socket: 0, shaver_socket: 0, tv_socket: 0,
    phone_socket: 0,
    light_switch: 0, double_light_switch: 0, dimmer_switch: 0,
    '2_gang_dimmer_switch': 0, '3_gang_dimmer': 0, '4_gang_dimmer': 0,
    rotary_switch: 0, store_switch: 0,
    ceiling_light: 0, external_ceiling_light: 0, wall_light: 0,
    up_down_light: 0, strip_light: 0, track_light: 0, track_light_ceiling: 0,
    panel_light: 0, linear_wall_light: 0, security_light_with_pir: 0,
    '10_way_cu': 0, consumer_box: 0, internal_consumer_unit: 0,
    electrics: 0, isolator_20a: 0, isolator_45a: 0, fan_isolator: 0,
    pir_sensor: 0, extractor_fan: 0, data_point: 0,
  },

  bathroomItems: {
    bathroom: 0, shower_room: 0, cloakroom: 0,
    combined_vanity: 0, combined_toilet_vanity: 0, toilet_vanity: 0,
    large_vanity: 0, mid_vanity: 0, small_vanity: 0, mini_vanity: 0,
    basin_pedestal: 0, toilet: 0, shower_tray: 0,
    electric_shower: 0, towel_rail: 0,
  },

  heatingItems: {
    climate_control: 0, wall_heater: 0, blow_heater: 0,
    underfloor_heating: 0,
  },

  structuralItems: {
    sip_walls: 0, sip_floor: 0, sip_roof: 0,
    vertical_wall: 0, horizontal_wall: 0, mezzanine: 0,
  },

  roofPorchItems: {
    roof_window: 0, roof_window_v2: 0, roof_window_v3: 0,
    pergola: 0, trellis_canopy: 0,
    canopy_roof_overhang: 0, veranda: 0,
  },

  miscItems: {
    blinds: 0, windscreen: 0, glass_panels: 0, loggia_panels: 0,
    solid_panel: 0, smoke_alarm: 0, smoke_heat_alarm: 0,
  },

  // ─── Scene ────────────────────────────────────────────────────────────────
  groundType: 'grass',
  structureType: 'freestanding',
  windowSillAdjust: 0,
  veranda: { enabled: false, depth: 2.0 },
  gutterColour: '#1a1a1a',
  units: 'metric',
};
