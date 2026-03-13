/**
 * leads.js
 * Lead capture form — shown before the quote modal.
 * Collects customer details, then passes them into the quote.
 */

// ─── CONFIG ────────────────────────────────────────────────────────────────────

// Change this to the email address that should receive enquiries
const ENQUIRY_EMAIL = 'enquiries@yourcompany.co.uk';

// ─── STATE ─────────────────────────────────────────────────────────────────────

// Populated when the lead form is submitted
const leadInfo = {
  name:  '',
  email: '',
  phone: '',
  notes: '',
};

// ─── LEAD MODAL OPEN / CLOSE ───────────────────────────────────────────────────

function openLeadModal() {
  document.getElementById('leadModal').classList.add('open');
  document.getElementById('leadName').focus();
}

function closeLeadModal() {
  document.getElementById('leadModal').classList.remove('open');
}

// ─── FORM SUBMISSION ───────────────────────────────────────────────────────────

function submitLeadForm() {
  const name  = document.getElementById('leadName').value.trim();
  const email = document.getElementById('leadEmail').value.trim();

  // Basic validation
  if (!name) {
    showLeadError('Please enter your name.');
    document.getElementById('leadName').focus();
    return;
  }
  if (!email || !email.includes('@')) {
    showLeadError('Please enter a valid email address.');
    document.getElementById('leadEmail').focus();
    return;
  }

  // Store details
  leadInfo.name  = name;
  leadInfo.email = email;
  leadInfo.phone = document.getElementById('leadPhone').value.trim();
  leadInfo.notes = document.getElementById('leadNotes').value.trim();

  clearLeadError();
  closeLeadModal();
  openQuoteModal(); // defined in quote.js
}

function skipLeadForm() {
  leadInfo.name  = '';
  leadInfo.email = '';
  leadInfo.phone = '';
  leadInfo.notes = '';
  clearLeadError();
  closeLeadModal();
  openQuoteModal();
}

function showLeadError(msg) {
  const el = document.getElementById('leadError');
  el.textContent = msg;
  el.style.display = 'block';
}

function clearLeadError() {
  const el = document.getElementById('leadError');
  el.textContent = '';
  el.style.display = 'none';
}

// Allow Enter key to submit from any field except the notes textarea
document.addEventListener('keydown', e => {
  if (e.key !== 'Enter') return;
  if (!document.getElementById('leadModal').classList.contains('open')) return;
  if (document.activeElement.id === 'leadNotes') return;
  submitLeadForm();
});

// ─── ENQUIRY EMAIL BUILDER ─────────────────────────────────────────────────────

/**
 * Opens the user's mail client with a pre-filled enquiry containing
 * the customer's details and a plain-text quote summary.
 * Labels are derived from the CATALOGUE via getItem() so they stay in sync
 * with pricing.js automatically.
 */
function sendEnquiryEmail() {
  const total = calcTotal(state);

  // Helper: return human-readable label for a catalogue key or a foundation key.
  function label(key) {
    if (!key) return 'None';
    if (typeof FOUNDATION !== 'undefined' && FOUNDATION[key]) return FOUNDATION[key].label;
    const item = getItem(key);
    return item ? item.label : key;
  }

  const specs = [
    `Width:       ${state.width}m`,
    `Depth:       ${state.depth}m`,
    `Height:      ${state.height}m`,
    `Floor Area:  ${(state.width * state.depth).toFixed(1)}m²`,
    `Foundation:  ${label(state.foundation)}`,
    `Roof Style:  ${state.roof === 'apex' ? 'Apex' : 'Flat'}`,
    `Roof Finish: ${label(state.roofFinish)}`,
    `Cladding:    ${label(state.cladding)}`,
    `Doors:       ${state.openings.filter(o => o.type === 'door').map(o => label(o.style)).join(', ') || 'None'}`,
    `Windows:     ${state.openings.filter(o => o.type === 'window').map(o => label(o.style)).join(', ') || 'None'}`,
    `Int. Walls:  ${label(state.interiorWalls)}`,
    `Int. Floor:  ${label(state.interiorFloor)}`,
    `Guttering:   ${state.guttering && state.guttering !== 'none' ? label(state.guttering) : 'None'}`,
  ].join('\n');

  // Collect all non-zero quantity items across every category
  const qtyCategories = [
    ['electricalItems', 'Electrics'],
    ['bathroomItems',   'Bathroom'],
    ['heatingItems',    'Heating'],
    ['structuralItems', 'Structural'],
    ['roofPorchItems',  'Roof / Porch'],
    ['miscItems',       'Accessories'],
  ];

  const qtyLines = [];
  qtyCategories.forEach(([key, title]) => {
    if (!state[key]) return;
    const entries = Object.entries(state[key]).filter(([, qty]) => qty > 0);
    if (entries.length === 0) return;
    qtyLines.push(`${title}:`);
    entries.forEach(([itemKey, qty]) => {
      qtyLines.push(`  ${label(itemKey)}: ${qty}`);
    });
  });

  const extras = state.extras.decking
    ? `Decking: ${state.deckingArea}m² (${label(state.deckingMaterial)})`
    : 'None';

  const services = [
    state.mainsConnection      && 'Mains electric connection',
    state.ethernetConnection   && 'Ethernet connection',
    state.waterWasteConnection && 'Water & waste connection',
    state.groundProtectionMats && 'Ground protection mats',
    state.skipHire             && 'Skip hire',
    state.groundworks          && 'Groundworks',
  ].filter(Boolean).join(', ') || 'None';

  const customerBlock = leadInfo.name
    ? `CUSTOMER DETAILS\n----------------\nName:  ${leadInfo.name}\nEmail: ${leadInfo.email}${leadInfo.phone ? '\nPhone: ' + leadInfo.phone : ''}${leadInfo.notes ? '\nNotes: ' + leadInfo.notes : ''}\n\n`
    : '';

  const body = [
    customerBlock,
    'CONFIGURATION\n-------------',
    specs,
    '',
    'EXTRAS & ADD-ONS',
    '----------------',
    'Decking: ' + extras,
    'Services: ' + services,
    '',
    ...(qtyLines.length > 0 ? ['QUANTITY ITEMS', '--------------', ...qtyLines, ''] : []),
    'ESTIMATE TOTAL (exc. VAT)',
    '-------------------------',
    `£${Math.round(total).toLocaleString('en-GB')}`,
    '',
    '---',
    'Generated by Garden Room Configurator',
  ].join('\n');

  const subject = encodeURIComponent(
    `Garden Room Enquiry${leadInfo.name ? ' — ' + leadInfo.name : ''}`
  );

  window.location.href = `mailto:${ENQUIRY_EMAIL}?subject=${subject}&body=${encodeURIComponent(body)}`;
}
