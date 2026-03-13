/**
 * quote.js — Builds and opens the quote summary modal.
 * Updated to use CATALOGUE-based pricing.
 */

function openQuoteModal() {
  const body = document.getElementById('modalBody');
  body.innerHTML = buildQuoteHTML();
  document.getElementById('quoteTotal').textContent = fmt(calcTotal(state));

  const subtitle = document.getElementById('quoteSubtitle');
  subtitle.textContent = typeof leadInfo !== 'undefined' && leadInfo.name
    ? `Prepared for ${leadInfo.name} · Indicative pricing · subject to site survey`
    : 'Indicative pricing · subject to site survey and final specification';

  document.getElementById('modal').classList.add('open');
}

function closeQuoteModal() {
  document.getElementById('modal').classList.remove('open');
}

function qLine(label, cost, isSubItem) {
  const priceStr = typeof cost === 'number' ? fmt(cost) : cost;
  const cls = isSubItem ? 'q-line sub' : 'q-line';
  return `<div class="${cls}"><span>${label}</span><span>${priceStr}</span></div>`;
}

function qSection(title, lines) {
  if (!lines || lines.length === 0) return '';
  return `<div class="q-section"><div class="q-section-title">${title}</div>${lines.join('')}</div>`;
}

function buildQuoteHTML() {
  const s = state;
  const area = s.width * s.depth;
  const wallArea = 2 * (s.width + s.depth) * s.height;
  let html = '';

  // ─── Dimensions ─────────────────────────────────────────────────────────
  html += qSection('Building Dimensions', [
    qLine(`${s.width.toFixed(1)}m × ${s.depth.toFixed(1)}m × ${s.height.toFixed(1)}m (${area.toFixed(1)}m²)`, 'See below'),
  ]);

  // ─── Foundation ─────────────────────────────────────────────────────────
  const found = calcFoundation(s);
  html += qSection('Foundation', [qLine(`${found.label} — ${found.detail}`, found.total)]);

  // ─── Roofing ────────────────────────────────────────────────────────────
  if (s.roofFinish) {
    const r = getItem(s.roofFinish);
    if (r) html += qSection('Roofing', [qLine(`${r.label} (${area.toFixed(1)}m² × £${r.rate})`, Math.round(r.rate * area))]);
  }

  // ─── Cladding ───────────────────────────────────────────────────────────
  if (s.cladding) {
    const c = getItem(s.cladding);
    if (c) html += qSection('Cladding', [qLine(`${c.label} (${wallArea.toFixed(1)}m² × £${c.rate})`, Math.round(c.rate * wallArea))]);
  }

  // ─── Openings ───────────────────────────────────────────────────────────
  if (s.openings.length > 0) {
    const lines = s.openings.map(op => {
      const item = getItem(op.style);
      const label = item ? `${item.label} (${op.wall})` : `${op.style} (${op.wall})`;
      return qLine(label, item ? item.rate : 0);
    });
    html += qSection('Doors & Windows', lines);
  }

  // ─── Interior ───────────────────────────────────────────────────────────
  const intLines = [];
  if (s.interiorWalls) {
    const w = getItem(s.interiorWalls);
    if (w && w.rate > 0) intLines.push(qLine(`Walls: ${w.label} (${wallArea.toFixed(1)}m² × £${w.rate})`, Math.round(w.rate * wallArea)));
  }
  if (s.interiorFloor) {
    const f = getItem(s.interiorFloor);
    if (f && f.rate > 0) intLines.push(qLine(`Floor: ${f.label} (${area.toFixed(1)}m² × £${f.rate})`, Math.round(f.rate * area)));
  }
  html += qSection('Interior Finishes', intLines);

  // ─── Guttering ──────────────────────────────────────────────────────────
  if (s.guttering && s.guttering !== 'none') {
    const g = getItem(s.guttering);
    const perim = 2 * (s.width + s.depth);
    if (g) html += qSection('Guttering', [qLine(`${g.label} (${perim.toFixed(1)}m × £${g.rate})`, Math.round(g.rate * perim))]);
  }

  // ─── Decking ────────────────────────────────────────────────────────────
  if (s.extras.decking && s.deckingMaterial) {
    const d = getItem(s.deckingMaterial);
    if (d) html += qSection('Decking', [qLine(`${d.label} (${s.deckingArea}m² × £${d.rate})`, Math.round(d.rate * s.deckingArea))]);
  }

  // ─── Quantity-based sections ────────────────────────────────────────────
  function qtySection(title, stateKey) {
    if (!s[stateKey]) return '';
    const lines = [];
    Object.entries(s[stateKey]).forEach(([key, qty]) => {
      if (qty > 0) {
        const item = getItem(key);
        if (item) {
          const cost = Math.round(item.rate * qty);
          const detail = qty > 1 ? `${qty} × £${item.rate}` : '';
          lines.push(qLine(`${item.label}${detail ? ' (' + detail + ')' : ''}`, cost));
        }
      }
    });
    return qSection(title, lines);
  }

  html += qtySection('Lighting & Electrics', 'electricalItems');
  html += qtySection('Bathroom & Fixtures', 'bathroomItems');
  html += qtySection('Heating & Climate', 'heatingItems');
  html += qtySection('Structural', 'structuralItems');
  html += qtySection('Roof & Porch Extras', 'roofPorchItems');
  html += qtySection('Accessories', 'miscItems');

  // ─── Service connection booleans ────────────────────────────────────────
  const elecSvcLines = [];
  if (s.mainsConnection)    elecSvcLines.push(qLine('Mains electric connection', getRate('mains_electric_connection')));
  if (s.ethernetConnection) elecSvcLines.push(qLine('Ethernet connection', getRate('ethernet_connection')));
  if (elecSvcLines.length)  html += qSection('Electrical Services', elecSvcLines);

  const siteSvcLines = [];
  if (s.waterWasteConnection) siteSvcLines.push(qLine('Water & waste connection', getRate('water_waste_connection')));
  if (s.groundProtectionMats) siteSvcLines.push(qLine('Ground protection mats', getRate('ground_protection_mats')));
  if (s.skipHire)             siteSvcLines.push(qLine('Skip hire', getRate('skip_hire')));
  if (s.groundworks)          siteSvcLines.push(qLine('Groundworks', getRate('groundworks')));
  if (siteSvcLines.length)    html += qSection('Groundworks & Utility', siteSvcLines);

  // ─── Roof style uplift ──────────────────────────────────────────────────
  if (s.roof === 'apex') {
    html += qSection('Roof Style', [qLine('Apex roof (structural premium)', ROOF_STYLE_UPLIFT.apex)]);
  }

  // ─── Exclusions ─────────────────────────────────────────────────────────
  html += `<div class="q-section">
    <div class="q-section-title">Exclusions & Notes</div>
    <div class="q-note">Plumbing and electrics external to the building are excluded.</div>
    <div class="q-note">Final service connections are subject to site survey and quotation.</div>
    <div class="q-note">A variation form must be completed for any amendments to the agreed specification.</div>
  </div>`;

  return html;
}
