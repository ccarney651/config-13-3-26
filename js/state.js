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

// ─── DEFAULT STATE ────────────────────────────────────────────────────────────
// Edit this object to change what the configurator loads with on first visit
// and what "New Build" resets to.

const DEFAULT_STATE = {
  width: 6, depth: 4.75, height: 2.5,
  foundation: 'concrete',
  roof: 'apex', roofTilt: 2, roofFinish: 'corrugated_roofing', apexPitch: 1,
  cladding: 'vertical_cedar_cladding', claddingTint: '#5c4033',
  claddingPerWall: { front: null, back: null, left: null, right: null },
  frameColour: '#1a1a1a', handleColour: 'black',
  defaultDoor: 'double_door', defaultWindow: 'glass_window', defaultDoorMat: 'aluminium',
  openings: [
    { id: 1, type: 'door',   wall: 'front', offset: 0,                      style: 'double_french_door' },
    { id: 2, type: 'window', wall: 'left',  offset: -1.0010264624337832,     style: 'tilt_n_turn_window' },
    { id: 3, type: 'window', wall: 'right', offset: 0,                      style: 'tilt_n_turn_window' },
    { id: 4, type: 'window', wall: 'back',  offset: 1.66307138692118,        style: 'glass_window' },
  ],
  nextOpeningId: 5,
  partitions: [], nextPartitionId: 1,
  presetRooms: [
    { id: 1, type: 'office', wall: 'left', offset: -1.12125, width: 2.2274999999999996, depth: 2.86, doorOffset: 0 },
  ],
  nextPresetRoomId: 2,
  furniture: [
    { id: 173, type: '__preset__', x: -2.59,                    z: -1.44,                    rotY: 1.5707963267948966, localX:  0.31874999999999976, localZ: -1.0199999999999998, localRotY: 0,                   dims: { w: 1.33, h: 1.02, d: 0.56 }, model: 'assets/computer_desk.glb',  modelRotY: 0, label: 'Desk',        presetRoomId: 1 },
    { id: 174, type: '__preset__', x: -1.8099999999999998,      z: -1.44,                    rotY: 1.5707963267948966, localX:  0.31874999999999976, localZ: -0.23999999999999982, localRotY: 0,                   dims: { w: 0.51, h: 0.99, d: 0.60 }, model: 'assets/office_chair.glb',   modelRotY: 0, label: 'Office Chair', presetRoomId: 1 },
    { id: 175, type: '__preset__', x: -2.4899999999999998,      z: -0.3225000000000003,      rotY: 3.141592653589793,  localX: -0.7987499999999998,  localZ: -0.9199999999999998,  localRotY: 1.5707963267948966,  dims: { w: 0.76, h: 1.40, d: 0.37 }, model: 'assets/shelf_unit.glb',     modelRotY: 0, label: 'Bookshelf',   presetRoomId: 1 },
    { id: 176, type: '__preset__', x: -0.40000000000000013,     z: -0.26750000000000024,     rotY: 1.5707963267948966, localX: -0.8537499999999998,  localZ:  1.17,                 localRotY: 0,                   dims: { w: 0.26, h: 1.03, d: 0.26 }, model: 'assets/watercooler.glb',    modelRotY: 0, label: 'Water Cooler', presetRoomId: 1 },
    { id: 177, type: 'plant',        x: -2.265094642126492,     z:  1.9800000000000002,      rotY: 0 },
    { id: 178, type: 'table_lamp',   x:  2.6900000000000004,    z: -2.0650000000000004,      rotY: 0 },
    { id: 179, type: 'rug',          x:  1.7024149173050545,    z: -0.14083062465940577,     rotY: 0 },
    { id: 180, type: 'coffee_table', x:  1.6022618016258268,    z: -0.11161591358817269,     rotY: 0 },
    { id: 181, type: 'sofa_2',       x:  1.6723378420058908,    z:  1.1982104277095988,      rotY: 0 },
    { id: 182, type: 'armchair',     x:  1.6881626431171757,    z: -1.305524929849346,       rotY: 3.1415926535897896 },
  ],
  nextFurnitureId: 183,
  interiorWalls: 'white_finished_walls', interiorFloor: 'oak_flooring',
  guttering: 'gutter_black',
  extras: { decking: false },
  deckingMaterial: 'composite_decking', deckingArea: 10, deckingBalustrade: 'glass',
  mainsConnection: false, ethernetConnection: false, waterWasteConnection: false,
  groundProtectionMats: false, skipHire: false, groundworks: false,
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
  heatingItems:    { climate_control: 0, wall_heater: 0, blow_heater: 0, underfloor_heating: 0 },
  structuralItems: { sip_walls: 0, sip_floor: 0, sip_roof: 0, vertical_wall: 0, horizontal_wall: 0, mezzanine: 0 },
  roofPorchItems:  { roof_window: 0, roof_window_v2: 0, roof_window_v3: 0, pergola: 0, trellis_canopy: 0, canopy_roof_overhang: 0, veranda: 0 },
  miscItems:       { blinds: 0, windscreen: 0, glass_panels: 0, loggia_panels: 0, solid_panel: 0, smoke_alarm: 0, smoke_heat_alarm: 0 },
  groundType: 'grass', structureType: 'freestanding',
  windowSillAdjust: 0,
  veranda: { enabled: false, depth: 1.5 },
  gutterColour: '#1a1a1a', units: 'metric',
};

const state = JSON.parse(JSON.stringify(DEFAULT_STATE));
