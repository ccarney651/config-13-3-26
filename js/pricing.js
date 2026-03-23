/**
 * pricing.js — Data-driven pricing catalogue.
 * Generated from gardenroomplanner.com price export (505 items).
 * All prices in GBP. Edit via admin.html or directly below.
 */

// ─── ITEM CATALOGUE ──────────────────────────────────────────────────────────
// Each category contains subcategories, each with an array of items.
// Every item: { key, label, rate, unit }
// rate = price per unit (£). unit = 'Each', 'M2', 'Quantity', etc.

const CATALOGUE = {
  bathroom: {
    fixtures: [
      { key: 'large_vanity', label: 'Large Vanity', rate: 160, unit: 'Each' },
      { key: 'bathroom', label: 'Bathroom (Full Suite)', rate: 3000, unit: 'Each' },
      { key: 'combined_vanity', label: 'Combined Vanity', rate: 220, unit: 'Each' },
      { key: 'shower_room', label: 'Shower Room', rate: 3000, unit: 'Each' },
      { key: 'mid_vanity', label: 'Mid Vanity', rate: 140, unit: 'Each' },
      { key: 'small_vanity', label: 'Small Vanity', rate: 120, unit: 'Each' },
      { key: 'basin_pedestal', label: 'Basin Pedestal', rate: 250, unit: 'Each' },
      { key: 'electric_shower', label: 'Electric Shower (Standard)', rate: 160, unit: 'Each' },
      { key: 'toilet', label: 'Toilet', rate: 140, unit: 'Each' },
      { key: 'toilet_vanity', label: 'Toilet Vanity', rate: 180, unit: 'Each' },
      // TODO: confirm with employer what this £80 'Bathroom' entry represents — key renamed to avoid shadowing the £3000 entry above
      { key: 'bathroom_v2', label: 'Bathroom (Additional)', rate: 80, unit: 'Each' },
      // TODO: confirm with employer which electric shower rate is correct (£160 vs £180)
      { key: 'electric_shower_v2', label: 'Electric Shower (Premium)', rate: 180, unit: 'Each' },
      { key: 'towel_rail', label: 'Towel Rail', rate: 150, unit: 'Each' },
      { key: 'shower_tray', label: 'Shower Tray', rate: 103, unit: 'Each' },
      { key: 'cloakroom', label: 'Cloakroom', rate: 1500, unit: 'Each' },
      { key: 'combined_toilet_vanity', label: 'Combined Toilet Vanity', rate: 200, unit: 'Each' },
      { key: 'mini_vanity', label: 'Mini Vanity', rate: 100, unit: 'Each' },
    ],
  },
  cladding: {
    items: [
      // ── Natural timber ──────────────────────────────────────────────────────
      { key: 'vertical_cedar_cladding',            label: 'Vertical Cedar',              rate: 220, unit: 'M2' },
      { key: 'horizontal_cedar_cladding',          label: 'Horizontal Cedar',            rate: 220, unit: 'M2' },
      { key: 'vertical_larch_cladding',            label: 'Vertical Larch',              rate: 150, unit: 'M2' },
      { key: 'oak_planks_cladding',                label: 'Oak Planks',                  rate: 150, unit: 'M2' },
      { key: 'vertical_shiplap_cladding',          label: 'Vertical Shiplap',            rate: 100, unit: 'M2' },
      { key: 'shiplap_black_cladding',             label: 'Shiplap Black',               rate: 110, unit: 'M2' },
      { key: 'vertical_tongue_and_groove_cladding',label: 'Vertical Tongue & Groove',    rate: 100, unit: 'M2' },
      { key: 'loglap_horizontal_cladding',         label: 'Loglap Horizontal',           rate: 100, unit: 'M2' },
      // ── Thermowood ──────────────────────────────────────────────────────────
      { key: 'charred_thermowood_cladding',        label: 'Charred Thermowood',          rate: 130, unit: 'M2' },
      { key: 'charred_black_thermowood_cladding',  label: 'Charred Black Thermowood',    rate: 130, unit: 'M2' },
      // ── Composite / WPC ─────────────────────────────────────────────────────
      { key: 'strongcore_cladding',                               label: 'Strongcore Composite',                rate: 170, unit: 'M2' },
      { key: 'neotimber_classic_plank_charcoal_vertical_cladding',label: 'NeoTimber Charcoal (Vertical)',       rate: 190, unit: 'M2' },
      { key: 'neotimber_classic_plank_grey_vertical_cladding',    label: 'NeoTimber Grey (Vertical)',           rate: 190, unit: 'M2' },
      // ── Metal ───────────────────────────────────────────────────────────────
      { key: 'anthracite_vertical_metal_cladding', label: 'Anthracite Metal (Vertical)', rate: 100, unit: 'M2' },
      { key: 'black_vertical_metal_cladding',      label: 'Black Metal (Vertical)',      rate: 100, unit: 'M2' },
      { key: 'corten_cladding',                    label: 'Corten Steel',                rate: 180, unit: 'M2' },
      // ── Stone & Brick ───────────────────────────────────────────────────────
      { key: 'stone_01_cladding',                  label: 'Stone',                       rate: 300, unit: 'M2' },
      { key: 'red_brick_wall_01_cladding',         label: 'Red Brick',                   rate: 290, unit: 'M2' },
    ],
  },
  decking: {
    inbuilt: [
      { key: 'inbuilt_decking_natural_wood_grain_finish', label: 'Inbuilt Decking, Natural Wood Grain Finish', rate: 220, unit: 'M2' },
      { key: 'inbuilt_decking_hardwood_finish', label: 'Inbuilt Decking, Hardwood Finish', rate: 250, unit: 'M2' },
      { key: 'inbuilt_decking_pewter_wood_grain_finish', label: 'Inbuilt Decking, Pewter Wood Grain Finish', rate: 220, unit: 'M2' },
      { key: 'inbuilt_decking_fawn_wood_grain_finish', label: 'Inbuilt Decking, Fawn Wood Grain Finish', rate: 220, unit: 'M2' },
      { key: 'inbuilt_decking_agate_wood_grain_finish', label: 'Inbuilt Decking, Agate Wood Grain Finish', rate: 220, unit: 'M2' },
      { key: 'inbuilt_decking_larch_finish', label: 'Inbuilt Decking, Larch Finish', rate: 220, unit: 'M2' },
      { key: 'inbuilt_decking_clay_wood_grain_finish', label: 'Inbuilt Decking, Clay Wood Grain Finish', rate: 220, unit: 'M2' },
      { key: 'inbuilt_decking_sandstone_paving_finish', label: 'Inbuilt Decking, Sandstone Paving Finish', rate: 220, unit: 'M2' },
      { key: 'inbuilt_decking_slate_finish', label: 'Inbuilt Decking, Slate Finish', rate: 220, unit: 'M2' },
      { key: 'inbuilt_decking_ice_grey_finish', label: 'Inbuilt Decking, Ice Grey Finish', rate: 220, unit: 'M2' },
      { key: 'inbuilt_decking_cool_sand_finish', label: 'Inbuilt Decking, Cool Sand Finish', rate: 220, unit: 'M2' },
      { key: 'inbuilt_decking_oak_finish', label: 'Inbuilt Decking, Oak Finish', rate: 220, unit: 'M2' },
      { key: 'inbuilt_decking_treated_finish', label: 'Inbuilt Decking,Treated Finish', rate: 160, unit: 'M2' },
      { key: 'inbuilt_decking_ivory_wood_grain_finish', label: 'Inbuilt Decking, Ivory Wood Grain Finish', rate: 220, unit: 'M2' },
      { key: 'inbuilt_decking_mocca_finish', label: 'Inbuilt Decking, Mocca Finish', rate: 220, unit: 'M2' },
      { key: 'inbuilt_decking_charcoal_wood_grain_finish', label: 'Inbuilt Decking, Charcoal Wood Grain Finish', rate: 220, unit: 'M2' },
      { key: 'inbuilt_decking_anthracite_wood_grain_finish', label: 'Inbuilt Decking, Anthracite Wood Grain Finish', rate: 220, unit: 'M2' },
    ],
    standalone: [
      { key: 'agate_wood_grain_decking', label: 'Agate Wood Grain Decking', rate: 220, unit: 'Width x Depth' },
      { key: 'sandstone_paving_decking', label: 'Sandstone Paving Decking', rate: 220, unit: 'Width x Depth' },
      { key: 'clay_wood_grain_decking', label: 'Clay Wood Grain Decking', rate: 220, unit: 'Width x Depth' },
      { key: 'oak_decking', label: 'Oak Decking', rate: 220, unit: 'Width x Depth' },
      { key: 'mocca_decking', label: 'Mocca Decking', rate: 220, unit: 'Width x Depth' },
      { key: 'ivory_wood_grain_decking', label: 'Ivory Wood Grain Decking', rate: 220, unit: 'Width x Depth' },
      { key: 'larch_decking', label: 'Larch Decking', rate: 220, unit: 'Width x Depth' },
      { key: 'slate_decking', label: 'Slate Decking', rate: 220, unit: 'Width x Depth' },
      { key: 'fawn_wood_grain_decking', label: 'Fawn Wood Grain Decking', rate: 220, unit: 'Width x Depth' },
      { key: 'cool_sand_decking', label: 'Cool Sand Decking', rate: 220, unit: 'Width x Depth' },
      { key: 'charcoal_wood_grain_decking', label: 'Charcoal Wood Grain Decking', rate: 220, unit: 'Width x Depth' },
      { key: 'natural_wood_grain_decking', label: 'Natural Wood Grain Decking', rate: 220, unit: 'Width x Depth' },
      { key: 'ice_grey_decking', label: 'Ice Grey Decking', rate: 220, unit: 'Width x Depth' },
      { key: 'aura_decking', label: 'Aura Decking', rate: 220, unit: 'Width x Depth' },
      { key: 'anthracite_wood_grain_decking', label: 'Anthracite Wood Grain Decking', rate: 220, unit: 'Width x Depth' },
      { key: 'treated_decking', label: 'Treated Decking', rate: 160, unit: 'Width x Depth' },
      { key: 'hardwood_decking', label: 'Hardwood Decking', rate: 250, unit: 'Width x Depth' },
      { key: 'pewter_wood_grain_decking', label: 'Pewter Wood Grain Decking', rate: 220, unit: 'Width x Depth' },
    ],
  },
  doors: {
    folding: [
      { key: 'folding_4_part_door', label: 'Folding 4-Part Door(w) x(h) (mm)', rate: 3300, unit: 'Each' },
      { key: 'folding_3_part_door', label: 'Folding 3-Part Door(w) x(h) (mm)', rate: 2500, unit: 'Each' },
      { key: 'folding_5_part_door', label: 'Folding 5-Part Door(w) x(h) (mm)', rate: 4200, unit: 'Each' },
    ],
    interior: [
      { key: 'interior_cavity_door', label: 'Interior Cavity Door(w) x(h) (mm)', rate: 550, unit: 'Each' },
      { key: 'interior_door', label: 'Interior Door(w) x(h) (mm)', rate: 450, unit: 'Each' },
    ],
    sliding: [
      { key: 'sliding_2_part_door', label: 'Sliding 2-Part Door(w) x(h) (mm)', rate: 3000, unit: 'Each' },
      { key: 'stacker_door', label: 'Stacker Door(w) x(h) (mm)', rate: 3100, unit: 'Each' },
      { key: 'sliding_4_part_door', label: 'Sliding 4-Part Door(w) x(h) (mm)', rate: 5200, unit: 'Each' },
      // TODO: confirm with employer which sliding_4_part_door rate is correct (£5200 vs £4000) — may be different sizes
      { key: 'sliding_4_part_door_v2', label: 'Sliding 4-Part Door — Alt (w) x(h) (mm)', rate: 4000, unit: 'Each' },
      // TODO: confirm with employer which stacker_door rate is correct (£3100 vs £3500)
      { key: 'stacker_door_v2', label: 'Stacker Door — Alt (w) x(h) (mm)', rate: 3500, unit: 'Each' },
      { key: 'sliding_3_part_door', label: 'Sliding 3-Part Door(w) x(h) (mm)', rate: 3800, unit: 'Each' },
    ],
    standard: [
      { key: 'half_glazed_door', label: 'Half Glazed Door(w) x(h) (mm)', rate: 1000, unit: 'Each' },
      { key: 'single_glass_door', label: 'Single Glass Door(w) x(h) (mm)', rate: 1200, unit: 'Each' },
      { key: 'double_door', label: 'Double Door(w) x(h) (mm)', rate: 1800, unit: 'Each' },
      { key: 'double_solid_door', label: 'Double Solid Door(w) x(h) (mm)', rate: 2100, unit: 'Each' },
      { key: 'georgian_6_pane_single_door', label: 'Georgian 6 Pane Single Door(w) x(h) (mm)', rate: 1200, unit: 'Each' },
      { key: 'clad_door', label: 'Clad Door(w) x(h) (mm)', rate: 1000, unit: 'Each' },
      { key: 'single_door', label: 'Single Door(w) x(h) (mm)', rate: 900, unit: 'Each' },
      { key: 'solid_door', label: 'Solid Door(w) x(h) (mm)', rate: 1150, unit: 'Each' },
      { key: 'georgian_10_pane_double_door', label: 'Georgian 10 Pane Double Door(w) x(h) (mm)', rate: 2400, unit: 'Each' },
      { key: 'frameless_door', label: 'Frameless Door(w) x(h) (mm)', rate: 1000, unit: 'Each' },
    ],
  },
  electrical: {
    lights: [
      { key: 'track_light', label: 'Track light', rate: 350, unit: 'Each' },
      { key: 'linear_wall_light', label: 'Linear Wall Light', rate: 400, unit: 'Each' },
      { key: 'security_light_with_pir', label: 'Security Light with PIR', rate: 235, unit: 'Each' },
      { key: 'external_ceiling_light', label: 'External Ceiling light', rate: 95, unit: 'Each' },
      { key: 'strip_light', label: 'Strip Light', rate: 200, unit: 'Each' },
      { key: 'up_down_light', label: 'Up/down light', rate: 140, unit: 'Each' },
      { key: 'track_light_ceiling', label: 'Track light ceiling', rate: 350, unit: 'Each' },
      { key: 'panel_light', label: 'Panel Light', rate: 250, unit: 'Each' },
      { key: 'wall_light', label: 'Wall light', rate: 140, unit: 'Each' },
      { key: 'ceiling_light', label: 'Ceiling light', rate: 95, unit: 'Each' },
    ],
    other: [
      { key: 'mains_electric_connection', label: 'Mains Electric Connection', rate: 0, unit: 'Each' },
      { key: 'ethernet_connection',        label: 'Ethernet Connection',       rate: 0, unit: 'Each' },
      { key: 'isolator_20a', label: 'Isolator 20A', rate: 110, unit: 'Each' },
      { key: 'electrics', label: 'Electrics', rate: 50, unit: 'Each' },
      { key: 'fan_isolator', label: 'Fan isolator', rate: 150, unit: 'Each' },
      { key: 'consumer_box', label: 'Consumer box', rate: 1030, unit: 'Each' },
      { key: 'pir_sensor', label: 'PIR Sensor', rate: 190, unit: 'Each' },
      { key: 'internal_consumer_unit', label: 'Internal Consumer Unit', rate: 490, unit: 'Each' },
      { key: 'extractor_fan', label: 'Extractor Fan', rate: 100, unit: 'Each' },
      { key: 'isolator_45a', label: 'Isolator 45A', rate: 160, unit: 'Each' },
      { key: 'data_point', label: 'Data point', rate: 100, unit: 'Each' },
    ],
    sockets: [
      { key: 'single_socket', label: 'Single socket', rate: 85, unit: 'Each' },
      { key: 'smart_socket', label: 'Smart Socket', rate: 150, unit: 'Each' },
      { key: 'tv_socket', label: 'TV socket', rate: 170, unit: 'Each' },
      { key: 'shaver_socket', label: 'Shaver Socket', rate: 150, unit: 'Each' },
      { key: 'phone_socket', label: 'Phone socket', rate: 100, unit: 'Each' },
      { key: 'floor_socket', label: 'Floor Socket', rate: 150, unit: 'Each' },
      { key: 'double_socket', label: 'Double socket', rate: 130, unit: 'Each' },
      { key: 'external_socket', label: 'External socket', rate: 180, unit: 'Each' },
      { key: 'usb_socket', label: 'USB socket', rate: 150, unit: 'Each' },
    ],
    switches: [
      { key: 'dimmer_switch', label: 'Dimmer switch', rate: 100, unit: 'Each' },
      { key: '3_gang_dimmer', label: '3 Gang Dimmer', rate: 180, unit: 'Each' },
      { key: '2_gang_dimmer_switch', label: '2 Gang Dimmer switch', rate: 110, unit: 'Each' },
      { key: 'rotary_switch', label: 'Rotary switch', rate: 175, unit: 'Each' },
      { key: 'store_switch', label: 'Store Switch', rate: 100, unit: 'Each' },
      { key: '4_gang_dimmer', label: '4 Gang Dimmer', rate: 210, unit: 'Each' },
      { key: 'light_switch', label: 'Light switch', rate: 80, unit: 'Each' },
      { key: 'double_light_switch', label: 'Double Light switch', rate: 100, unit: 'Each' },
    ],
  },
  exterior_finish: {
    guttering: [
      { key: 'gutter_white', label: 'Gutter (White)', rate: 75, unit: 'Length Metres' },
      { key: 'gutter_black', label: 'Gutter (Black)', rate: 75, unit: 'Length Metres' },
      { key: 'gutter_brown', label: 'Gutter (Brown)', rate: 75, unit: 'Length Metres' },
    ],
  },
  flooring: {
    gym: [
      { key: 'black_gym_flooring', label: 'Black Gym Flooring', rate: 160, unit: 'Quantity' },
    ],
    rubber: [
      { key: 'light_grey_rubber_flooring', label: 'Light Grey Rubber Flooring', rate: 115, unit: 'Quantity' },
      { key: 'light_green_rubber_flooring', label: 'Light Green Rubber Flooring', rate: 115, unit: 'Quantity' },
      { key: 'black_rubber_flooring', label: 'Black Rubber Flooring', rate: 115, unit: 'Quantity' },
      { key: 'orange_rubber_flooring', label: 'Orange Rubber Flooring', rate: 115, unit: 'Quantity' },
      { key: 'green_rubber_flooring', label: 'Green Rubber Flooring', rate: 115, unit: 'Quantity' },
      { key: 'red_rubber_flooring', label: 'Red Rubber Flooring', rate: 115, unit: 'Quantity' },
      { key: 'dark_grey_rubber_flooring', label: 'Dark Grey Rubber Flooring', rate: 115, unit: 'Quantity' },
      { key: 'beige_rubber_flooring', label: 'Beige Rubber Flooring', rate: 115, unit: 'Quantity' },
      { key: 'dark_blue_rubber_flooring', label: 'Dark Blue Rubber Flooring', rate: 115, unit: 'Quantity' },
      { key: 'mid_blue_rubber_flooring', label: 'Mid Blue Rubber Flooring', rate: 115, unit: 'Quantity' },
      { key: 'light_blue_rubber_flooring', label: 'Light Blue Rubber Flooring', rate: 115, unit: 'Quantity' },
    ],
    stone_tile: [
      { key: 'stone_porcelain_ocre_tiles', label: 'Stone Porcelain Ocre Tiles', rate: 280, unit: 'M2' },
      { key: 'grey_stone_flooring', label: 'Grey Stone Flooring', rate: 100, unit: 'Quantity' },
      { key: 'white_marble_flooring', label: 'White Marble Flooring', rate: 100, unit: 'Quantity' },
      { key: 'stone_porcelain_gris_tiles', label: 'Stone Porcelain Gris Tiles', rate: 280, unit: 'M2' },
      { key: 'tiles_flooring', label: 'Tiles Flooring', rate: 55, unit: 'Quantity' },
      { key: 'beige_stone_flooring', label: 'Beige Stone Flooring', rate: 100, unit: 'Quantity' },
      { key: 'white_tiles_flooring', label: 'White Tiles Flooring', rate: 100, unit: 'Quantity' },
      { key: 'hadley_tiles_flooring', label: 'Hadley Tiles Flooring', rate: 55, unit: 'Quantity' },
    ],
    structural: [
      { key: 'osb_subfloor', label: 'Osb Subfloor', rate: 0, unit: 'Quantity' },
    ],
    wood: [
      { key: 'oxford_oak_flooring', label: 'Oxford Oak Flooring', rate: 55, unit: 'Quantity' },
      { key: 'farm_house_light_oak_flooring', label: 'Farm House Light Oak Flooring', rate: 55, unit: 'Quantity' },
      { key: 'aster_staggered_oak_flooring', label: 'Aster Staggered Oak Flooring', rate: 55, unit: 'Quantity' },
      { key: 'phantom_oak_flooring', label: 'Phantom Oak Flooring', rate: 55, unit: 'Quantity' },
      { key: 'loft_dark_grey_oak_flooring', label: 'Loft Dark Grey Oak Flooring', rate: 55, unit: 'Quantity' },
      { key: 'decking_flooring', label: 'Decking Flooring', rate: 55, unit: 'Quantity' },
      { key: 'sip_floor', label: 'SIP Floor', rate: 100, unit: 'M2' },
      { key: 'victorian_oak_flooring', label: 'Victorian Oak Flooring', rate: 55, unit: 'Quantity' },
      { key: 'rhino_oak_flooring', label: 'Rhino Oak Flooring', rate: 55, unit: 'Quantity' },
      { key: 'wiltshire_english_oak_flooring', label: 'Wiltshire English Oak Flooring', rate: 55, unit: 'Quantity' },
      { key: 'loft_midnight_oak_flooring', label: 'Loft Midnight Oak Flooring', rate: 55, unit: 'Quantity' },
      { key: 'beech_flooring', label: 'Beech Flooring', rate: 55, unit: 'Quantity' },
      { key: 'farm_house_dark_oak_flooring', label: 'Farm House Dark Oak Flooring', rate: 55, unit: 'Quantity' },
      { key: 'natural_oak_flooring', label: 'Natural Oak Flooring', rate: 55, unit: 'Quantity' },
      { key: 'oak_parquet_flooring', label: 'Oak Parquet Flooring', rate: 55, unit: 'Quantity' },
      { key: 'sawn_flooring', label: 'Sawn Flooring', rate: 55, unit: 'Quantity' },
      { key: 'westchester_oak_flooring', label: 'Westchester Oak Flooring', rate: 55, unit: 'Quantity' },
      { key: 'kentucky_oak_beige_flooring', label: 'Kentucky Oak Beige Flooring', rate: 55, unit: 'Quantity' },
      { key: 'dark_oak_parquet_flooring', label: 'Dark Oak Parquet Flooring', rate: 55, unit: 'Quantity' },
      { key: 'aspen_oak_flooring', label: 'Aspen Oak Flooring', rate: 55, unit: 'Quantity' },
      { key: 'sicilia_oak_flooring', label: 'Sicilia Oak Flooring', rate: 55, unit: 'Quantity' },
      { key: 'tongue_and_groove_flooring', label: 'Tongue And Groove Flooring', rate: 55, unit: 'Quantity' },
      { key: 'wiltshire_weathered_grey_parquet_flooring', label: 'Wiltshire Weathered Grey Parquet Flooring', rate: 55, unit: 'Quantity' },
      { key: 'oak_flooring', label: 'Oak Flooring', rate: 55, unit: 'Quantity' },
      { key: 'honey_oak_flooring', label: 'Honey Oak Flooring', rate: 55, unit: 'Quantity' },
      { key: 'farm_oak_flooring', label: 'Farm Oak Flooring', rate: 55, unit: 'Quantity' },
      { key: 'liguiria_oak_flooring', label: 'Liguiria Oak Flooring', rate: 55, unit: 'Quantity' },
      { key: 'walnut_flooring', label: 'Walnut Flooring', rate: 55, unit: 'Quantity' },
    ],
  },
  heating: {
    units: [
      { key: 'blow_heater', label: 'Blow Heater', rate: 180, unit: 'Each' },
      { key: 'climate_control', label: 'Climate control', rate: 850, unit: 'Each' },
      { key: 'wall_heater', label: 'Wall Heater', rate: 800, unit: 'Each' },
      { key: 'underfloor_heating', label: 'Underfloor Heating', rate: 90, unit: 'Length Metres' },
    ],
  },
  interior: {
    walls: [
      { key: 'plywood_finished_walls', label: 'Plywood Finished Walls', rate: 100, unit: 'M2' },
      { key: 'light_yellow_finished_walls', label: 'Light Yellow Finished Walls', rate: 100, unit: 'M2' },
      { key: 'melamine_boards_finished_walls', label: 'Melamine Boards Finished Walls', rate: 100, unit: 'M2' },
      { key: 'studs_membrane_finished_walls', label: 'Studs & Membrane Finished Walls', rate: 100, unit: 'M2' },
      { key: 'oak_panels_finished_walls', label: 'Oak Panels Finished Walls', rate: 100, unit: 'M2' },
      { key: 'light_blue_finished_walls', label: 'Light Blue Finished Walls', rate: 100, unit: 'M2' },
      { key: 'light_green_finished_walls', label: 'Light Green Finished Walls', rate: 100, unit: 'M2' },
      { key: 'studs_osb_finished_walls', label: 'Studs & OSB Finished Walls', rate: 100, unit: 'M2' },
      { key: 'tongue_and_groove_finished_walls', label: 'Tongue And Groove Finished Walls', rate: 100, unit: 'M2' },
      { key: 'charcoal_grey_finished_walls', label: 'Charcoal Grey Finished Walls', rate: 100, unit: 'M2' },
      { key: 'studs_insulation_finished_walls', label: 'Studs & Insulation Finished Walls', rate: 100, unit: 'M2' },
      { key: 'white_finished_walls', label: 'White Finished Walls', rate: 100, unit: 'M2' },
      { key: 'alder_wood_finished_walls', label: 'Alder Wood Finished Walls', rate: 100, unit: 'M2' },
    ],
  },
  misc: {
    other: [
      { key: 'glass_panels', label: 'Glass panels', rate: 2500, unit: 'Each' },
      { key: 'smoke_heat_alarm', label: 'Smoke Heat Alarm', rate: 100, unit: 'Each' },
      { key: 'solid_panel', label: 'Solid Panel', rate: 1000, unit: 'Each' },
      { key: 'windscreen', label: 'Windscreen', rate: 2000, unit: 'Each' },
      { key: 'blinds', label: 'Blinds', rate: 100, unit: 'Each' },
      { key: 'loggia_panels', label: 'Loggia panels', rate: 2000, unit: 'Each' },
      { key: 'smoke_alarm', label: 'Smoke alarm', rate: 80, unit: 'Each' },
    ],
  },
  roof_porch: {
    rooflights: [
      // TODO: confirm with employer exact size brackets for these three roof window tiers
      { key: 'roof_window',    label: 'Roof Window — Small (w) x(h) (mm)',  rate: 1800, unit: 'Each' },
      { key: 'roof_window_v2', label: 'Roof Window — Medium (w) x(h) (mm)', rate: 2000, unit: 'Each' },
      { key: 'roof_window_v3', label: 'Roof Window — Large (w) x(h) (mm)',  rate: 2500, unit: 'Each' },
    ],
    structures: [
      { key: 'pergola', label: 'Pergola', rate: 4000, unit: 'Each' },
      { key: 'veranda', label: 'Veranda(w) x(d) (mm)', rate: 491, unit: 'Width x Depth' },
      { key: 'trellis_canopy', label: 'Trellis Canopy(w) x(d) (mm)', rate: 1000, unit: 'Width x Depth' },
      { key: 'canopy_roof_overhang', label: 'Canopy/Roof overhang', rate: 416, unit: 'M2' },
    ],
  },
  roofing: {
    materials: [
      { key: 'epdm_black_roofing', label: 'EPDM Black Roofing', rate: 40, unit: 'M2' },
      { key: 'green_roof', label: 'Green Roof', rate: 100, unit: 'Roof Area' },
      { key: 'cedar_roofing', label: 'Cedar Roofing', rate: 90, unit: 'M2' },
      { key: 'corrugated_roofing', label: 'Corrugated Roofing', rate: 60, unit: 'M2' },
      { key: 'pebbles_roof', label: 'Pebbles Roof', rate: 100, unit: 'Roof Area' },
      { key: 'shingles_square_red_roofing', label: 'Shingles Square Red Roofing', rate: 110, unit: 'M2' },
      { key: 'copper_roofing', label: 'Copper Roofing', rate: 120, unit: 'M2' },
      { key: 'shingles_square_black_roofing', label: 'Shingles Square Black Roofing', rate: 110, unit: 'M2' },
      { key: 'coated_tile_roofing', label: 'Coated Tile Roofing', rate: 120, unit: 'M2' },
      { key: 'sip_roof', label: 'SIP Roof', rate: 118, unit: 'M2' },
    ],
  },
  site: {
    services: [
      { key: 'water_waste_connection',  label: 'Water & Waste Connection',  rate: 0, unit: 'Each' },
      { key: 'ground_protection_mats',  label: 'Ground Protection Mats',    rate: 0, unit: 'Each' },
      { key: 'skip_hire',               label: 'Skip Hire',                 rate: 0, unit: 'Each' },
      { key: 'groundworks',             label: 'Groundworks',               rate: 0, unit: 'Each' },
    ],
  },
  structural: {
    elements: [
      { key: 'vertical_wall', label: 'Vertical Wall', rate: 500, unit: 'Length Metres' },
      { key: 'mezzanine', label: 'Mezzanine', rate: 500, unit: 'Width x Depth' },
      { key: 'sip_walls', label: 'SIP Walls', rate: 95, unit: 'M2' },
      { key: 'horizontal_wall', label: 'Horizontal Wall', rate: 500, unit: 'Length Metres' },
    ],
  },
  uncategorised: {
    other: [
      { key: '10_way_cu', label: '10 Way CU', rate: 180, unit: 'Each' },
    ],
  },
  windows: {
    awning: [
      // TODO: confirm with employer size brackets for these three awning window tiers
      { key: 'awning_window',    label: 'Awning Window — Small (w) x(h) (mm)',  rate: 300, unit: 'Each' },
      { key: 'awning_window_v2', label: 'Awning Window — Medium (w) x(h) (mm)', rate: 500, unit: 'Each' },
      { key: 'awning_window_v3', label: 'Awning Window — Large (w) x(h) (mm)',  rate: 800, unit: 'Each' },
      // TODO: confirm with employer size brackets for these two awning vertical window tiers
      { key: 'awning_vertical_window',    label: 'Awning Vertical Window — Standard (w) x(h) (mm)', rate: 507, unit: 'Each' },
      { key: 'awning_vertical_window_v2', label: 'Awning Vertical Window — Large (w) x(h) (mm)',    rate: 800, unit: 'Each' },
      { key: 'double_awning_window', label: 'Double Awning Window(w) x(h) (mm)', rate: 1500, unit: 'Each' },
    ],
    bathroom: [
      { key: 'bathroom_frost_window', label: 'Bathroom Frost Window(w) x(h) (mm)', rate: 312, unit: 'Each' },
    ],
    fixed: [
      { key: 'georgian_10_pane_fixed_window', label: 'Georgian 10 Pane Fixed Window(w) x(h) (mm)', rate: 1000, unit: 'Each' },
      { key: 'glass_window', label: 'Glass Window(w) x(h) (mm)', rate: 1000, unit: 'Each' },
      // TODO: confirm with employer size brackets for these three fixed window tiers
      { key: 'fixed_window',    label: 'Fixed Window — Large (w) x(h) (mm)',  rate: 900, unit: 'Each' },
      { key: 'fixed_window_v2', label: 'Fixed Window — Small (w) x(h) (mm)',  rate: 300, unit: 'Each' },
      { key: 'fixed_window_v3', label: 'Fixed Window — Medium (w) x(h) (mm)', rate: 500, unit: 'Each' },
      { key: 'top_open_fixed_window', label: 'Top Open Fixed Window(w) x(h) (mm)', rate: 700, unit: 'Each' },
    ],
    gable: [
      { key: 'gable_window_front', label: 'Gable Window Front(w) x(h) (mm)', rate: 300, unit: 'Each' },
      { key: 'gable_window_1p', label: 'Gable Window 1P(w) x(h) (mm)', rate: 500, unit: 'Each' },
      { key: 'gable_window_3p', label: 'Gable Window 3P(w) x(h) (mm)', rate: 600, unit: 'Each' },
      { key: 'gable_window_front_gap', label: 'Gable Window Front Gap(w) x(h) (mm)', rate: 300, unit: 'Each' },
      { key: 'gable_window_rear_gap', label: 'Gable Window Rear Gap(w) x(h) (mm)', rate: 300, unit: 'Each' },
      { key: 'gable_window_rear', label: 'Gable Window Rear(w) x(h) (mm)', rate: 300, unit: 'Each' },
    ],
    georgian: [
      { key: 'georgian_6_pane_opening_window', label: 'Georgian 6 Pane Opening Window(w) x(h) (mm)', rate: 700, unit: 'Each' },
    ],
    glazing_units: [
      { key: 'triple', label: 'Triple', rate: 1100, unit: 'Each' },
      { key: 'single', label: 'Single', rate: 500, unit: 'Each' },
      { key: 'split', label: 'Split', rate: 800, unit: 'Each' },
    ],
    hung: [
      { key: 'double_hung_bar_window', label: 'Double Hung Bar Window(w) x(h) (mm)', rate: 1000, unit: 'Each' },
      { key: 'double_hung_window', label: 'Double Hung Window(w) x(h) (mm)', rate: 568, unit: 'Each' },
      { key: 'double_hung_bar_small_window', label: 'Double Hung Bar Small Window(w) x(h) (mm)', rate: 600, unit: 'Each' },
    ],
    other: [
      { key: 'top_open_window', label: 'Top open Window(w) x(h) (mm)', rate: 900, unit: 'Each' },
    ],
    sliding: [
      { key: 'sliding_window', label: 'Sliding Window(w) x(h) (mm)', rate: 1500, unit: 'Each' },
    ],
    split: [
      { key: 'split_window', label: 'Split Window(w) x(h) (mm)', rate: 593, unit: 'Each' },
      { key: 'georgian_6_pane_split_window', label: 'Georgian 6 Pane Split Window(w) x(h) (mm)', rate: 1200, unit: 'Each' },
    ],
    tilt_turn: [
      { key: 'tilt_n_turn_top_window', label: 'Tilt\'n\'turn Top Window(w) x(h) (mm)', rate: 250, unit: 'Each' },
      // TODO: confirm with employer size brackets for these two tilt & turn tiers
      { key: 'tilt_n_turn_window',    label: 'Tilt\'n\'turn Window — Standard (w) x(h) (mm)', rate: 250, unit: 'Each' },
      { key: 'tilt_n_turn_window_v2', label: 'Tilt\'n\'turn Window — Large (w) x(h) (mm)',    rate: 350, unit: 'Each' },
    ],
  },
};

// ─── ADMIN OVERRIDES ─────────────────────────────────────────────────────────
// Admin panel can save per-item rate overrides to localStorage.
// Guard for Node.js test environment where localStorage is not available.
const _ls = typeof localStorage !== 'undefined' ? localStorage : { getItem: () => null };

// Read overrides dynamically so admin changes take effect as soon as the
// customer next triggers a price calculation (no page reload required).
function _getPricingOverrides() { return JSON.parse(_ls.getItem('gardenroom_pricing') || '{}'); }
function _getDisabledItems()    { return JSON.parse(_ls.getItem('gardenroom_disabled') || '{}'); }

// Keep a module-level snapshot for callers that need a stable reference
// (e.g. applyAdminDisabledItems runs once on page load).
const DISABLED_ITEMS = _getDisabledItems();

// Load custom items added via admin panel
(function loadCustomItems() {
  const customs = JSON.parse(_ls.getItem('gardenroom_custom_items') || '[]');
  customs.forEach(c => {
    if (!CATALOGUE[c.catKey]) CATALOGUE[c.catKey] = {};
    if (!CATALOGUE[c.catKey][c.subKey]) CATALOGUE[c.catKey][c.subKey] = [];
    if (!CATALOGUE[c.catKey][c.subKey].find(it => it.key === c.key)) {
      CATALOGUE[c.catKey][c.subKey].push({ key: c.key, label: c.label, rate: c.rate, unit: c.unit });
    }
  });
})();

function isItemEnabled(key) { return !_getDisabledItems()[key]; }

function getRate(key) {
  const overrides = _getPricingOverrides();
  if (overrides[key] !== undefined) return overrides[key];
  for (const cat of Object.values(CATALOGUE)) {
    for (const sub of Object.values(cat)) {
      const found = sub.find(i => i.key === key);
      if (found) return found.rate;
    }
  }
  return 0;
}

// Lookup an item by key across the whole catalogue.
// Returns a copy with the admin-overridden rate applied, so all
// callers that use item.rate automatically get the admin price.
function _getItemMeta() { return JSON.parse(_ls.getItem('gardenroom_item_meta') || '{}'); }

function getItem(key) {
  const overrides = _getPricingOverrides();
  const meta      = _getItemMeta();
  for (const cat of Object.values(CATALOGUE)) {
    for (const sub of Object.values(cat)) {
      const found = sub.find(i => i.key === key);
      if (found) {
        const rate  = overrides[key] !== undefined ? overrides[key] : found.rate;
        const m     = meta[key] || {};
        return Object.assign({}, found, { rate, label: m.label || found.label, unit: m.unit || found.unit });
      }
    }
  }
  return null;
}

function fmt(n) { return '£' + Math.round(n).toLocaleString('en-GB'); }

// ─── FOUNDATION ─────────────────────────────────────────────────────────────
const FOUNDATION_BASE_AREA = 12;
const FOUNDATION = {
  concrete: { basePrice: 1800, extraPerSqm: 95, label: 'Concrete Base' },
  block:    { basePrice: 550,  extraPerSqm: 45, label: 'Block Base'    },
  screws:   { basePrice: 480,  extraPerSqm: 0,  label: 'Ground Screws', perScrew: 120, perSqm: 0.4, min: 4 },
};

// Roof style carries a fixed uplift on top of the roof finish material cost.
// Flat is the baseline (no uplift); apex adds a structural premium.
const ROOF_STYLE_UPLIFT = {
  flat: 0,
  apex: 1400,
};

function calcFoundation(s) {
  const area = s.width * s.depth;
  const f = FOUNDATION[s.foundation] || FOUNDATION.concrete;
  if (s.foundation === 'screws') {
    const qty = Math.max(f.min, Math.ceil(area * f.perSqm));
    return { total: qty * f.perScrew, label: f.label, detail: `${qty} screws × £${f.perScrew}` };
  }
  const extra = Math.max(0, area - FOUNDATION_BASE_AREA);
  const cost = f.basePrice + Math.round(extra * f.extraPerSqm);
  return { total: cost, label: f.label, detail: extra > 0 ? `Base + ${extra.toFixed(1)}m² extra` : `Includes up to ${FOUNDATION_BASE_AREA}m²` };
}

// ─── AREA / QUANTITY PRICING HELPERS ─────────────────────────────────────────

function calcAreaItem(key, area) {
  const item = getItem(key);
  if (!item) return { total: 0, label: key, detail: '' };
  const cost = Math.round(item.rate * area);
  return { total: cost, label: item.label, detail: `${area.toFixed(1)}m² × £${item.rate}` };
}

function calcEachItem(key, qty) {
  if (qty <= 0) return { total: 0, label: '', detail: '' };
  const item = getItem(key);
  if (!item) return { total: 0, label: key, detail: '' };
  const cost = Math.round(item.rate * qty);
  return { total: cost, label: item.label, detail: qty > 1 ? `${qty} × £${item.rate}` : `£${item.rate}` };
}

// ─── GRAND TOTAL ────────────────────────────────────────────────────────────
function calcTotal(s) {
  let total = 0;
  const area = s.width * s.depth;
  const wallArea = 2 * (s.width + s.depth) * s.height;

  // Foundation
  total += calcFoundation(s).total;

  // Roofing
  if (s.roofFinish) { const r = getItem(s.roofFinish); if (r) total += Math.round(r.rate * area); }

  // Cladding
  if (s.cladding && s.cladding !== 'none') { const c = getItem(s.cladding); if (c) total += Math.round(c.rate * wallArea); }

  // Interior walls
  if (s.interiorWalls && s.interiorWalls !== 'none') { const w = getItem(s.interiorWalls); if (w) total += Math.round(w.rate * wallArea); }

  // Interior floor
  if (s.interiorFloor && s.interiorFloor !== 'none') { const f = getItem(s.interiorFloor); if (f) total += Math.round(f.rate * area); }

  // Openings (doors + windows)
  s.openings.forEach(op => {
    const item = getItem(op.style);
    if (item) total += item.rate;
  });

  // Decking
  if (s.extras.decking && s.deckingMaterial) {
    const d = getItem(s.deckingMaterial);
    if (d) total += Math.round(d.rate * s.deckingArea);
  }

  // Electrical items (sockets, switches, lights)
  if (s.electricalItems) {
    Object.entries(s.electricalItems).forEach(([key, qty]) => {
      if (qty > 0) { const item = getItem(key); if (item) total += Math.round(item.rate * qty); }
    });
  }

  // Bathroom items
  if (s.bathroomItems) {
    Object.entries(s.bathroomItems).forEach(([key, qty]) => {
      if (qty > 0) { const item = getItem(key); if (item) total += Math.round(item.rate * qty); }
    });
  }

  // Heating items
  if (s.heatingItems) {
    Object.entries(s.heatingItems).forEach(([key, qty]) => {
      if (qty > 0) { const item = getItem(key); if (item) total += Math.round(item.rate * qty); }
    });
  }

  // Structural items
  if (s.structuralItems) {
    Object.entries(s.structuralItems).forEach(([key, qty]) => {
      if (qty > 0) { const item = getItem(key); if (item) total += Math.round(item.rate * qty); }
    });
  }

  // Roof & porch extras
  if (s.roofPorchItems) {
    Object.entries(s.roofPorchItems).forEach(([key, qty]) => {
      if (qty > 0) { const item = getItem(key); if (item) total += Math.round(item.rate * qty); }
    });
  }

  // Misc items
  if (s.miscItems) {
    Object.entries(s.miscItems).forEach(([key, qty]) => {
      if (qty > 0) { const item = getItem(key); if (item) total += Math.round(item.rate * qty); }
    });
  }

  // Guttering
  if (s.guttering && s.guttering !== 'none') {
    const g = getItem(s.guttering);
    const perim = 2 * (s.width + s.depth);
    if (g) total += Math.round(g.rate * perim);
  }

  // Roof style uplift (flat is baseline; apex has a fixed structural premium)
  if (s.roof === 'apex') total += ROOF_STYLE_UPLIFT.apex;

  // Service / site booleans
  if (s.mainsConnection)      total += getRate('mains_electric_connection');
  if (s.ethernetConnection)   total += getRate('ethernet_connection');
  if (s.waterWasteConnection) total += getRate('water_waste_connection');
  if (s.groundProtectionMats) total += getRate('ground_protection_mats');
  if (s.skipHire)             total += getRate('skip_hire');
  if (s.groundworks)          total += getRate('groundworks');

  return total;
}

// ─── CATALOGUE AUDIT ─────────────────────────────────────────────────────────
// Logs duplicate keys and unexpected unit values to the console.
// Runs automatically in the browser (deferred, non-fatal); also callable from tests.
function auditCatalogue() {
  try {
    const seen = new Map();
    const duplicates = [];
    const allowedUnits = new Set(['M2', 'Each', 'Quantity', 'Length Metres', 'Roof Area', 'Width x Depth']);
    const badUnits = [];

    Object.entries(CATALOGUE).forEach(([catKey, cat]) => {
      Object.entries(cat).forEach(([subKey, items]) => {
        if (!Array.isArray(items)) return;
        items.forEach(it => {
          const k = it.key;
          if (seen.has(k)) {
            duplicates.push({ key: k, first: seen.get(k), second: `${catKey}.${subKey}` });
          } else {
            seen.set(k, `${catKey}.${subKey}`);
          }
          if (it.unit && !allowedUnits.has(it.unit)) badUnits.push(`${k} (${it.unit})`);
        });
      });
    });

    if (duplicates.length) {
      console.warn(`Catalogue audit: ${duplicates.length} duplicate key(s) found:`);
      duplicates.slice(0, 20).forEach(d => console.warn(`  ${d.key}: ${d.first} ← also in ${d.second}`));
      if (duplicates.length > 20) console.warn(`  ...and ${duplicates.length - 20} more`);
    }
    if (badUnits.length) {
      console.warn('Catalogue audit: unexpected unit values:', badUnits.slice(0, 10).join(', '));
    }
    return { duplicates, badUnits };
  } catch (err) {
    console.error('Catalogue audit failed:', err);
    return { error: String(err) };
  }
}

// Auto-run in browser, deferred so it doesn't block startup
if (typeof window !== 'undefined') {
  setTimeout(() => { try { auditCatalogue(); } catch (e) { /* swallow */ } }, 200);
}

// ─── NODE / TEST EXPORTS ─────────────────────────────────────────────────────
// Allows pricing logic to be tested with `node test/pricing.test.js`
// without running in a browser context.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    CATALOGUE, DISABLED_ITEMS, FOUNDATION, ROOF_STYLE_UPLIFT,
    getPricingOverrides: _getPricingOverrides,
    calcFoundation, calcAreaItem, calcEachItem, calcTotal,
    getRate, getItem, isItemEnabled, auditCatalogue,
  };
}

