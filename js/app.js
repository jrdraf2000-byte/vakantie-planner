import { CATS, catOf, geocode, overpassSearch, filterByText, wikiSummary, destinationIntro, googleSearch, googleReviews } from "./api.js";

const TINTS = ["#fde2d6", "#d8eef0", "#fff0c8", "#e2ecdc", "#ece2f3", "#dbe6f6"];
const EMO = ["🌴", "🏙️", "🏝️", "⛰️", "🕌", "🗼", "🌅", "🏖️"];
const PAGE = 15;
const LS = "vakantieplanner_v1";

let state = { destinations: [], settings: { gkey: "" } };
let ui = { view: "home", destId: null, tripId: null, tab: "discover", cat: "sights", halal: false, query: "", src: "osm", mode: "list",
  raw: [], results: [], shown: PAGE, loading: false, err: "", modal: null, sugg: null, suggLoading: false, reviews: {}, dayMap: null };
const wiki = {}; // _id -> summary

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const $ = s => document.querySelector(s);

/* ---------- opslag ---------- */
function load() {
  try { const j = localStorage.getItem(LS); if (j) state = Object.assign(state, JSON.parse(j)); } catch (e) {}
  state.settings = state.settings || { gkey: "" };
}
function save() { try { localStorage.setItem(LS, JSON.stringify(state)); } catch (e) { toast("Opslaan mislukt (opslag vol?)"); } }
try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch (e) {}

/* ---------- helpers ---------- */
const dest = () => state.destinations.find(d => d.id === ui.destId);
const trip = () => { const d = dest(); return d && d.trips.find(t => t.id === ui.tripId); };
function toast(m) { const t = document.createElement("div"); t.className = "toast"; t.textContent = m; document.body.appendChild(t); setTimeout(() => t.remove(), 2200); }
function days(t) {
  if (!t || !t.start || !t.end) return [];
  const out = []; const d = new Date(t.start + "T12:00:00"), e = new Date(t.end + "T12:00:00");
  let n = 0; while (d <= e && n < 60) { out.push(d.toISOString().slice(0, 10)); d.setDate(d.getDate() + 1); n++; }
  return out;
}
const fmtDay = s => new Date(s + "T12:00:00").toLocaleDateString("nl-NL", { weekday: "long", day: "numeric", month: "long" });
const fmtShort = s => s ? new Date(s + "T12:00:00").toLocaleDateString("nl-NL", { day: "numeric", month: "short", year: "numeric" }) : "";
const gmaps = (p, dn) => p.mapsUrl || "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(p.name + " " + (p.address || dn));
const taUrl = (p, dn) => "https://www.tripadvisor.com/Search?q=" + encodeURIComponent(p.name + " " + dn);
const gSearch = (p, dn, x) => "https://www.google.com/search?q=" + encodeURIComponent(p.name + " " + dn + " " + x);
const kmTxt = km => km == null ? "" : km < 1 ? Math.round(km * 1000) + " m" : km.toFixed(km < 10 ? 1 : 0) + " km";
const halalLabel = { ja: "✅ Halal", opties: "🟦 Halal-opties", nee: "✖ Niet halal", onbekend: "? Halal onbekend", zoekterm: "🔎 Gevonden op ‘halal’" };
const KIND = { attraction: "Attractie", viewpoint: "Uitzichtpunt", museum: "Museum", gallery: "Galerie", monument: "Monument", castle: "Kasteel", palace: "Paleis", fort: "Fort", ruins: "Ruïne", memorial: "Gedenkteken", archaeological_site: "Archeologische plek", place_of_worship: "Gebedshuis", restaurant: "Restaurant", fast_food: "Fastfood", cafe: "Café", ice_cream: "IJssalon", pastry: "Banketbakker", mall: "Winkelcentrum", department_store: "Warenhuis", outlet: "Outlet", marketplace: "Markt", market: "Markt", park: "Park", nature_reserve: "Natuurgebied", garden: "Tuin", beach: "Strand", peak: "Bergtop", waterfall: "Waterval", theme_park: "Pretpark", zoo: "Dierentuin", aquarium: "Aquarium", water_park: "Waterpark", bar: "Bar", pub: "Pub", nightclub: "Nachtclub", marina: "Jachthaven", stadium: "Stadion" };

function slimPlace(p) {
  const w = wiki[p._id];
  return { _id: p._id, src: p.src, name: p.name, cat: p.cat, lat: p.lat, lon: p.lon, address: p.address, area: p.area, rating: p.rating || null, reviewCount: p.reviewCount || null,
    priceLevel: p.priceLevel || null, halal: p.halal, cuisine: p.cuisine || null, openingHours: p.openingHours || null, website: p.website || null, mapsUrl: p.mapsUrl || null, gId: p.gId || null,
    image: (w && w.image) || null };
}

/* ---------- Leaflet (kaart) ---------- */
let leafletP = null;
function loadLeaflet() {
  if (window.L) return Promise.resolve(window.L);
  if (leafletP) return leafletP;
  leafletP = new Promise((res, rej) => {
    const l = document.createElement("link"); l.rel = "stylesheet"; l.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"; document.head.appendChild(l);
    const s = document.createElement("script"); s.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"; s.onload = () => res(window.L); s.onerror = rej; document.head.appendChild(s);
  });
  return leafletP;
}
async function drawMap(el, pts, center) {
  const L = await loadLeaflet();
  if (!document.body.contains(el)) return;
  const map = L.map(el, { zoomControl: true, attributionControl: true });
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "© OpenStreetMap" }).addTo(map);
  const ll = [];
  pts.forEach((p, i) => {
    if (p.lat == null) return;
    const icon = L.divIcon({ className: "", html: `<div class="pin">${i + 1}</div>`, iconSize: [26, 26], iconAnchor: [13, 13] });
    L.marker([p.lat, p.lon], { icon }).addTo(map).bindPopup(`<b>${esc(p.name)}</b>${p.time ? "<br>" + esc(p.time) : ""}`);
    ll.push([p.lat, p.lon]);
  });
  if (ll.length > 1) map.fitBounds(ll, { padding: [30, 30] });
  else if (ll.length) map.setView(ll[0], 15);
  else map.setView([center.lat, center.lon], 12);
}

/* ---------- zoeken ---------- */
async function search() {
  const d = dest(); if (!d) return;
  const c = catOf(ui.cat);
  const halal = ui.halal && c.food;
  ui.loading = true; ui.err = ""; ui.results = []; ui.shown = PAGE; render();
  try {
    if (ui.src === "google") {
      ui.raw = await googleSearch(state.settings.gkey, d, ui.cat, { halal, query: ui.query });
      ui.results = ui.raw;
    } else {
      ui.raw = await overpassSearch(d, ui.cat, { halal });
      ui.results = filterByText(ui.raw, ui.query);
      if (!ui.results.length && ui.raw.length && ui.query) ui.err = `Niets gevonden voor “${ui.query}”. Probeer een ander woord, of zoek zonder extra wens.`;
    }
    if (!ui.results.length && !ui.err) ui.err = halal
      ? "Geen plekken gevonden die in OpenStreetMap als halal gemarkeerd zijn. Veel halal zaken zijn daar niet gelabeld — probeer de bron Google (met sleutel) of de knop hieronder."
      : "Niets gevonden in dit gebied voor deze categorie.";
  } catch (e) {
    console.warn(e);
    ui.err = ui.src === "google" ? (e.message || "Google-zoekopdracht mislukt.") : "De kaartdienst reageert niet (druk of geen internet). Probeer het zo opnieuw.";
  }
  ui.loading = false; render(); enrich();
}
async function enrich() {
  if (ui.src !== "osm") return;
  const vis = ui.results.slice(0, ui.shown).filter(p => (p.wikidata || p.wikipedia) && !(p._id in wiki));
  await Promise.all(vis.map(async p => {
    wiki[p._id] = null;
    const s = await wikiSummary({ wikidata: p.wikidata, wikipedia: p.wikipedia });
    wiki[p._id] = s;
    if (s) { const el = document.getElementById("card_" + p._id); if (el) el.outerHTML = placeCard(p, dest(), inList().has(p._id)); }
  }));
}
const inList = () => new Set(((trip() || { items: [] }).items).map(i => i.place._id));

async function loadReviews(p) {
  ui.reviews[p._id] = { loading: true }; render();
  try { ui.reviews[p._id] = await googleReviews(state.settings.gkey, p.gId); }
  catch (e) { ui.reviews[p._id] = { error: e.message || "Reviews ophalen mislukt" }; }
  render();
}

/* ---------- acties ---------- */
async function suggest(q) {
  ui.suggLoading = true; ui.sugg = null; render();
  try { ui.sugg = await geocode(q); } catch (e) { ui.sugg = []; toast("Zoeken mislukt — check je internet"); }
  ui.suggLoading = false; render();
}
function addDest(g) {
  const existing = state.destinations.find(x => x.name.toLowerCase() === g.name.toLowerCase() && Math.abs(x.lat - g.lat) < .2);
  if (existing) { openDest(existing.id); return; }
  const t = { id: uid(), name: "Reis " + new Date().getFullYear(), start: "", end: "", items: [], created: Date.now() };
  const n = state.destinations.length;
  const d = { id: uid(), name: g.name, label: g.label, country: g.country, lat: g.lat, lon: g.lon, bbox: g.bbox, created: Date.now(), trips: [t], tint: TINTS[n % TINTS.length], emo: EMO[n % EMO.length] };
  state.destinations.unshift(d); save();
  ui.sugg = null;
  openDest(d.id, true);
  destinationIntro(g.name).then(i => { if (i) { d.intro = i; save(); if (ui.destId === d.id) render(); } });
}
function openDest(id, fresh) {
  const d = state.destinations.find(x => x.id === id); if (!d) return;
  const t = d.trips[d.trips.length - 1];
  Object.assign(ui, { view: "dest", destId: id, tripId: t.id, tab: fresh || !t.items.length ? "discover" : "todo", cat: "sights", query: "", halal: false, raw: [], results: [], err: "", mode: "list", reviews: {}, src: state.settings.gkey ? ui.src : "osm" });
  render(); window.scrollTo(0, 0);
  if (ui.tab === "discover") search();
  if (!d.intro) destinationIntro(d.name).then(i => { if (i) { d.intro = i; save(); if (ui.destId === d.id) render(); } });
}
function addItem(p) {
  const t = trip(); if (!t) return;
  if (t.items.some(i => i.place._id === p._id || i.place.name === p.name)) { toast("Staat al op je lijst"); return; }
  t.items.push({ id: uid(), place: slimPlace(p), day: "", time: "", done: false, note: "", added: Date.now() });
  save(); toast("✓ Toegevoegd aan to-do's"); render();
}
function exportData() {
  const blob = new Blob([JSON.stringify(state, null, 1)], { type: "application/json" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
  a.download = "vakantieplanner-backup-" + new Date().toISOString().slice(0, 10) + ".json";
  document.body.appendChild(a); a.click(); a.remove();
}
function importData(file) {
  const r = new FileReader();
  r.onload = () => {
    try {
      const v = JSON.parse(r.result);
      if (!v.destinations) throw 0;
      const key = state.settings.gkey;
      state = v; state.settings = Object.assign({ gkey: key }, v.settings || {}); save();
      ui.modal = null; ui.view = "home"; render(); toast("Back-up teruggezet ✓");
    } catch (e) { toast("Dit is geen geldig back-upbestand"); }
  };
  r.readAsText(file);
}

/* ---------- render ---------- */
function render() {
  const sy = window.scrollY;
  $("#app").innerHTML = (ui.view === "home" ? homeView() : destView()) + modalView();
  bind();
  window.scrollTo(0, sy);
  if (ui.view === "dest" && ui.tab === "discover" && ui.mode === "map" && ui.results.length) {
    const el = $("#map"); if (el) drawMap(el, ui.results.slice(0, ui.shown), dest()).catch(() => { el.innerHTML = '<div class="empty">Kaart kon niet laden.</div>'; });
  }
  if (ui.dayMap) { const el = document.getElementById("daymap_" + ui.dayMap); const t = trip(); if (el && t) drawMap(el, sortedDay(t, ui.dayMap).map(i => ({ ...i.place, time: i.time })), dest()).catch(() => {}); }
}

function homeView() {
  const ds = state.destinations;
  return `<div class="hero"><div class="sunb"></div><div class="hero-in">
    <div class="topbar"><h1>Mijn uitjes ✈️</h1><button class="iconbtn" data-a="settings" aria-label="Instellingen">⚙︎</button></div>
    <p>Ontdek, plan per dag en bewaar wat je op elke plek hebt gedaan.</p></div></div>
  <div class="wrap lift">
    <div class="card"><div class="row"><input id="newDest" type="text" class="grow" placeholder="Stad, plek of gebied… bv. Istanbul" autocomplete="off"><button class="btn terra" data-a="find">Zoek</button></div>
    ${ui.suggLoading ? `<div class="loadbox" style="padding:14px"><span class="spin"></span></div>` : ""}
    ${ui.sugg ? (ui.sugg.length ? `<div class="suggest">${ui.sugg.map((g, i) => `<button data-a="pick" data-i="${i}"><b>${esc(g.name)}</b><small>${esc(g.label)}</small></button>`).join("")}</div>` : `<div class="small" style="margin-top:8px">Niets gevonden. Probeer een andere spelling.</div>`)
      : `<div class="small" style="margin-top:8px">Tip: je kunt ook een gebied invullen, zoals “Costa Brava” of “Dubai Marina”.</div>`}
    </div>
    ${ds.length ? `<h2 style="font-size:20px;margin:22px 4px 10px">Mijn plekken</h2>` + ds.map(d => {
      const all = d.trips.flatMap(t => t.items); const done = all.filter(i => i.done).length; const last = d.trips[d.trips.length - 1];
      return `<div class="card dest" data-a="open" data-id="${d.id}">
        <div class="ic" style="background:${d.tint}${d.intro && d.intro.image ? `;background-image:url('${esc(d.intro.image)}');background-size:cover;background-position:center` : ""}">${d.intro && d.intro.image ? "" : d.emo}</div>
        <div class="grow"><h3>${esc(d.name)}</h3>
        <div class="meta">${d.country ? esc(d.country) + " · " : ""}${d.trips.length} ${d.trips.length === 1 ? "reis" : "reizen"} · ${done}/${all.length} gedaan${last && last.start ? " · " + fmtShort(last.start) : ""}</div></div>
        <div style="font-size:20px;color:var(--muted)">›</div></div>`;
    }).join("") : `<div class="empty"><div class="big">🗺️</div><p>Nog geen plekken. Zoek hierboven een bestemming om te beginnen.</p></div>`}
  </div>`;
}

function destView() {
  const d = dest(); if (!d) { ui.view = "home"; return homeView(); }
  const t = trip() || d.trips[0]; ui.tripId = t.id;
  const open = t.items.filter(i => !i.done).length;
  const img = d.intro && d.intro.image;
  return `<div class="hero ${img ? "has-img" : ""}" style="padding-bottom:64px${img ? `;background-image:url('${esc(img)}')` : ""}"><div class="sunb"></div><div class="hero-in">
    <div class="topbar"><button class="back" data-a="home">‹ Mijn plekken</button><button class="iconbtn" data-a="editTrip" aria-label="Reis bewerken">✎</button></div>
    <h1>${img ? "" : d.emo + " "}${esc(d.name)}</h1>
    <p>${t.start ? fmtShort(t.start) + " – " + fmtShort(t.end) : "Nog geen datums — tik ✎ om je reis in te plannen"}</p>
    ${d.intro && d.intro.extract ? `<div class="hero-intro">${esc(d.intro.extract)}</div>` : ""}
    <div class="tripsel"><select id="tripSel" class="grow">${d.trips.map(x => `<option value="${x.id}" ${x.id === t.id ? "selected" : ""}>${esc(x.name)}${x.start ? " (" + fmtShort(x.start) + ")" : ""}</option>`).join("")}</select>
    <button class="btn sm" data-a="newTrip">+ Nieuwe reis</button></div>
  </div></div>
  <div class="wrap lift">
    <div class="tabs">
      ${[["discover", "🔎", "Ontdek"], ["todo", "📝", "To-do"], ["plan", "📅", "Planning"], ["hist", "📖", "Gedaan"]].map(([k, ic, l]) => `<button class="tab ${ui.tab === k ? "on" : ""}" data-a="tab" data-k="${k}"><span class="ti">${ic}</span><span>${l}</span>${k === "todo" && open ? `<span class="n">${open}</span>` : ""}</button>`).join("")}
    </div>
    ${ui.tab === "discover" ? discoverView(d) : ui.tab === "todo" ? todoView(t) : ui.tab === "plan" ? planView(t) : histView(d)}
  </div>`;
}

function discoverView(d) {
  const c = catOf(ui.cat);
  const list = ui.results.slice(0, ui.shown);
  const added = inList();
  let body;
  if (ui.loading) body = `<div class="loadbox"><div class="spin"></div><p>Live zoeken naar ${esc(c.l.toLowerCase())} in ${esc(d.name)}…</p></div>`;
  else if (ui.err && !ui.results.length) body = `<div class="card empty"><p>${esc(ui.err)}</p><div class="row" style="justify-content:center;flex-wrap:wrap"><button class="btn" data-a="search">Opnieuw</button><a class="btn ghost" style="text-decoration:none" target="_blank" rel="noopener" href="https://www.google.com/maps/search/${encodeURIComponent((ui.halal && c.food ? "halal " : "") + c.l + " " + d.name)}">Open in Google Maps</a></div></div>`;
  else if (!ui.results.length) body = `<div class="card empty"><div class="big">${c.e}</div><p>Tik op <b>Zoek</b> om ${esc(c.l.toLowerCase())} te vinden.</p></div>`;
  else if (ui.mode === "map") body = `<div id="map"></div><div class="small" style="text-align:center;margin-bottom:12px">${list.length} plekken op de kaart · tik op een pin voor de naam</div>` + list.map((p, i) => `<div class="card row" style="padding:12px"><div class="pin" style="flex:none">${i + 1}</div><div class="grow"><b>${esc(p.name)}</b><div class="meta">${esc(KIND[p.kind] || p.kindLabel || "")} ${p.km != null ? "· " + kmTxt(p.km) : ""}</div></div>${added.has(p._id) ? `<span class="small" style="color:var(--green);font-weight:600">✓</span>` : `<button class="btn terra sm" data-a="add" data-id="${p._id}">+</button>`}</div>`).join("");
  else body = list.map(p => placeCard(p, d, added.has(p._id))).join("") +
    (ui.results.length > ui.shown ? `<div style="text-align:center;margin:6px 0 20px"><button class="btn ghost" data-a="more">Meer laden (${ui.results.length - ui.shown})</button></div>` : "") +
    (ui.src === "google" ? `<div class="attr">Gegevens en reviews: Google</div>` : `<div class="attr">Gegevens: © OpenStreetMap-bijdragers · Wikipedia</div>`);
  return `<div class="chips">${CATS.map(x => `<button class="chip ${ui.cat === x.k ? "on" : ""}" data-a="cat" data-k="${x.k}">${x.e} ${x.l}</button>`).join("")}</div>
  <div class="card">
    <div class="row"><input id="q" type="text" class="grow" placeholder="${c.food ? "bv. turks, pizza, ontbijt…" : "Filter (optioneel)…"}" value="${esc(ui.query)}"><button class="btn" data-a="search">Zoek</button></div>
    ${c.food ? `<div class="toggle" data-a="halal" style="margin-top:8px;cursor:pointer"><div class="sw ${ui.halal ? "on" : ""}"></div> Alleen halal</div>` : ""}
    <div class="srcbar">
      <div class="seg"><button class="${ui.mode === "list" ? "on" : ""}" data-a="mode" data-k="list">☰ Lijst</button><button class="${ui.mode === "map" ? "on" : ""}" data-a="mode" data-k="map">🗺 Kaart</button></div>
      <div class="grow"></div>
      <div class="seg"><button class="${ui.src === "osm" ? "on" : ""}" data-a="src" data-k="osm">OpenStreetMap</button><button class="${ui.src === "google" ? "on" : ""}" data-a="src" data-k="google">Google ★</button></div>
    </div>
  </div>
  ${ui.src === "osm" && !ui.loading && ui.results.length ? `<div class="note">ℹ️ Live gegevens uit OpenStreetMap, gesorteerd op bekendheid. Daar zitten geen sterren of reviews in. Wil je die direct in de app? Zet Google aan (★) met een gratis API-sleutel via ⚙︎ op het startscherm.</div>` : ""}
  ${body}`;
}

function placeCard(p, d, added) {
  const c = catOf(p.cat);
  const w = wiki[p._id];
  const img = p.photo || (w && w.image);
  const desc = p.description || (w && w.extract);
  const rv = ui.reviews[p._id];
  const showHalal = c.food || p.halal === "ja" || p.halal === "opties";
  const kind = KIND[p.kind] || p.kindLabel || "";
  return `<div class="card place" id="card_${p._id}">
    ${img ? `<img class="thumb" src="${esc(img)}" alt="" loading="lazy" onerror="this.remove()">` : ""}
    <h3>${esc(p.name)}</h3>
    <div class="meta">${c.e} ${esc(kind)}${p.area ? " · " + esc(p.area) : ""}${p.km != null ? " · " + kmTxt(p.km) + " van centrum" : ""}</div>
    <div class="badges">
      ${p.rating ? `<span class="b star">★ ${p.rating.toFixed(1)}${p.reviewCount ? " · " + p.reviewCount.toLocaleString("nl-NL") + " reviews" : ""}</span>` : ""}
      ${p.priceLevel ? `<span class="b">${esc(p.priceLevel)}</span>` : ""}
      ${showHalal ? `<span class="b halal-${p.halal === "zoekterm" ? "opties" : esc(p.halal)}">${halalLabel[p.halal] || ""}</span>` : ""}
      ${p.cuisine ? `<span class="b">🍴 ${esc(p.cuisine)}</span>` : ""}
      ${p.fee === "no" ? `<span class="b">Gratis toegang</span>` : ""}
    </div>
    ${desc ? `<div class="desc">${esc(desc.length > 320 ? desc.slice(0, 317) + "…" : desc)}</div>` : ""}
    <dl class="kv">
      ${p.address ? `<dt>Adres</dt><dd>${esc(p.address)}</dd>` : ""}
      ${p.openingHours ? `<dt>Open</dt><dd>${esc(p.openingHours)}</dd>` : ""}
      ${p.openingDays ? `<dt>Open</dt><dd>${esc(p.openingDays[(new Date().getDay() + 6) % 7] || "")}</dd>` : ""}
      ${p.phone ? `<dt>Telefoon</dt><dd>${esc(p.phone)}</dd>` : ""}
    </dl>
    ${rv ? (rv.loading ? `<div class="rev"><span class="spin"></span> Reviews ophalen…</div>` : rv.error ? `<div class="rev">${esc(rv.error)}</div>` :
      `<div class="rev">${rv.alcohol ? `<div class="small" style="margin-bottom:6px">🍷 ${esc(rv.alcohol)}</div>` : ""}${rv.reviews.length ? rv.reviews.map(r => `<div class="review"><div class="who">${"★".repeat(Math.round(r.rating || 0))} ${esc(r.who)} <span class="small">· ${esc(r.when)}</span></div>${esc(r.text)}</div>`).join("") : "Nog geen reviews."}<div class="attr">Reviews van Google</div></div>`) : ""}
    <div class="links">
      <a href="${gmaps(p, d.name)}" target="_blank" rel="noopener">📍 Google Maps${p.src === "osm" ? " & reviews" : ""}</a>
      <a href="${taUrl(p, d.name)}" target="_blank" rel="noopener">🦉 Tripadvisor</a>
      ${p.website ? `<a href="${esc(p.website)}" target="_blank" rel="noopener">🌐 Website</a>` : ""}
      ${w && w.url ? `<a href="${esc(w.url)}" target="_blank" rel="noopener">📖 Wikipedia</a>` : ""}
      ${c.food && p.halal !== "ja" ? `<a href="${gSearch(p, d.name, "halal")}" target="_blank" rel="noopener">🔍 Halal check</a>` : ""}
    </div>
    <div class="act">
      ${p.src === "google" && !rv ? `<button class="btn ghost sm" data-a="reviews" data-id="${p._id}">💬 Reviews tonen</button>` : "<span></span>"}
      ${added ? `<span class="small" style="font-weight:600;color:var(--green)">✓ Op je lijst</span>` : `<button class="btn terra sm" data-a="add" data-id="${p._id}">+ To-do</button>`}
    </div>
  </div>`;
}

function itemRow(i, t) {
  const p = i.place, ds = days(t);
  return `<div class="item ${i.done ? "done" : ""}">
    <button class="chk ${i.done ? "on" : ""}" data-a="done" data-id="${i.id}">${i.done ? "✓" : ""}</button>
    <div class="grow"><div class="t">${esc(p.name)}</div>
      <div class="meta">${p.rating ? "★ " + p.rating.toFixed(1) + " · " : ""}${esc(p.address || p.area || "")}${p.halal === "ja" || p.halal === "opties" ? " · " + halalLabel[p.halal] : ""}</div>
      ${i.note ? `<div class="small">📝 ${esc(i.note)}</div>` : ""}
      <div class="row" style="margin-top:8px;gap:6px">
        <select data-a="setday" data-id="${i.id}" style="padding:7px 9px;font-size:13px">
          <option value="">${ds.length ? "Nog niet ingepland" : "Stel eerst reisdatums in"}</option>
          ${ds.map((x, n) => `<option value="${x}" ${i.day === x ? "selected" : ""}>Dag ${n + 1} · ${new Date(x + "T12:00:00").toLocaleDateString("nl-NL", { weekday: "short", day: "numeric", month: "short" })}</option>`).join("")}
        </select>
        <button class="btn ghost sm" data-a="editItem" data-id="${i.id}">✎</button></div>
    </div></div>`;
}
function todoView(t) {
  if (!t.items.length) return `<div class="card empty"><div class="big">📝</div><p>Je lijst is nog leeg. Ga naar <b>Ontdek</b> en voeg plekken toe.</p><button class="btn" data-a="tab" data-k="discover">Ontdekken</button></div>`;
  const groups = {}; t.items.forEach(i => { (groups[i.place.cat] = groups[i.place.cat] || []).push(i); });
  const done = t.items.filter(i => i.done).length;
  return `<div class="card"><div class="row"><div class="grow"><b>${done} van ${t.items.length} gedaan</b></div><button class="btn ghost sm" data-a="addCustom">+ Eigen item</button></div>
    <div style="height:8px;background:#eee4d6;border-radius:4px;margin-top:10px;overflow:hidden"><div style="height:100%;width:${done / t.items.length * 100}%;background:var(--green)"></div></div></div>
  ${CATS.filter(c => groups[c.k]).map(c => `<div class="card"><h3 style="font-size:17px;margin-bottom:2px">${c.e} ${c.l}</h3>${groups[c.k].map(i => itemRow(i, t)).join("")}</div>`).join("")}`;
}
const sortedDay = (t, day) => t.items.filter(i => i.day === day).sort((a, b) => (a.time || "99").localeCompare(b.time || "99") || (a.order || 0) - (b.order || 0));
function planView(t) {
  const ds = days(t);
  if (!ds.length) return `<div class="card empty"><div class="big">📅</div><p>Vul de datums van je reis in om per dag te plannen.</p><button class="btn" data-a="editTrip">Datums instellen</button></div>`;
  const un = t.items.filter(i => !i.day || !ds.includes(i.day));
  return ds.map((day, n) => {
    const its = sortedDay(t, day);
    return `<div class="card daycard"><div class="dh"><h3>Dag ${n + 1}</h3><span class="meta">${fmtDay(day)}</span></div>
    ${its.length ? its.map(i => `<div class="prow ${i.done ? "done" : ""}"><div class="tm">${esc(i.time || "–")}</div><button class="chk ${i.done ? "on" : ""}" data-a="done" data-id="${i.id}">${i.done ? "✓" : ""}</button><div style="min-width:0"><div class="t">${catOf(i.place.cat).e} ${esc(i.place.name)}</div><div class="meta">${esc(i.place.address || i.place.area || "")}</div></div><div class="mini"><button data-a="up" data-id="${i.id}">↑</button><button data-a="down" data-id="${i.id}">↓</button><button data-a="editItem" data-id="${i.id}">✎</button></div></div>`).join("") +
      (its.some(i => i.place.lat != null) ? (ui.dayMap === day ? `<div class="daymap" id="daymap_${day}"></div>` : `<button class="btn ghost sm" style="margin-top:8px" data-a="dayMap" data-k="${day}">🗺 Toon op kaart</button>`) : "")
      : `<div class="small" style="padding:8px 0">Nog niets gepland.</div>`}
  </div>`;
  }).join("") + (un.length ? `<div class="card"><h3 style="font-size:17px">Nog in te plannen (${un.length})</h3>${un.map(i => itemRow(i, t)).join("")}</div>` : "");
}
function histView(d) {
  const trips = d.trips.slice().reverse();
  const any = trips.some(t => t.items.some(i => i.done));
  return (any ? "" : `<div class="note">Vink items af als je ze gedaan hebt — ze verschijnen hier, per reis. Zo zie je bij een volgend bezoek precies wat je al gedaan hebt.</div>`) +
    trips.map(t => {
      const dn = t.items.filter(i => i.done), open = t.items.filter(i => !i.done);
      return `<div class="card hist"><h3>${esc(t.name)}${t.id === ui.tripId ? `<span class="pill">actief</span>` : ""}</h3>
    <div class="meta">${t.start ? fmtShort(t.start) + " – " + fmtShort(t.end) + " · " : ""}${dn.length} gedaan · ${open.length} niet gedaan</div>
    ${dn.map(i => `<div class="item"><div class="chk on">✓</div><div class="grow"><div class="t">${catOf(i.place.cat).e} ${esc(i.place.name)}</div>${i.day ? `<div class="meta">${fmtDay(i.day)}</div>` : ""}${i.note ? `<div class="small">📝 ${esc(i.note)}</div>` : ""}</div>${i.rating ? `<span class="b star">${"★".repeat(i.rating)}</span>` : ""}</div>`).join("")}
    ${open.length ? `<details style="margin-top:8px"><summary class="small" style="cursor:pointer">Niet aan toegekomen (${open.length})</summary>${open.map(i => `<div class="small" style="padding:4px 0">• ${esc(i.place.name)}</div>`).join("")}</details>` : ""}
    ${t.id !== ui.tripId ? `<button class="btn ghost sm" style="margin-top:10px" data-a="switchTrip" data-id="${t.id}">Bekijk deze reis</button>` : ""}
    </div>`;
    }).join("") + `<div style="text-align:center;margin-top:20px"><button class="btn ghost sm" data-a="delDest" style="color:var(--red)">Plek verwijderen</button></div>`;
}

function modalView() {
  const m = ui.modal; if (!m) return "";
  const t = trip();
  const wrap = inner => `<div class="modal" data-a="closeBg"><div class="sheet">${inner}</div></div>`;
  if (m.type === "settings") return wrap(`<h2>Instellingen</h2>
    <div class="field"><label>Google Maps API-sleutel (optioneel)</label><input id="gkey" type="text" value="${esc(state.settings.gkey || "")}" placeholder="AIza…" autocomplete="off"></div>
    <p class="small">Met een eigen sleutel zie je in de app sterren, aantallen reviews, foto's, openingstijden en de nieuwste Google-reviews. Zonder sleutel gebruikt de app gratis OpenStreetMap en Wikipedia. Uitleg staat in de README van de repo.</p>
    <div class="row" style="margin-bottom:18px"><button class="btn ghost grow" data-a="close">Sluiten</button><button class="btn grow" data-a="saveSettings">Opslaan</button></div>
    <h2 style="font-size:18px">Back-up</h2>
    <p class="small">Je reizen worden op dit apparaat bewaard. Maak af en toe een back-up, of zet ze over naar een ander apparaat.</p>
    <div class="row"><button class="btn ghost grow" data-a="export">⬇︎ Back-up downloaden</button><label class="btn ghost grow" style="text-align:center;cursor:pointer">⬆︎ Terugzetten<input id="importFile" type="file" accept="application/json,.json" style="display:none"></label></div>`);
  if (m.type === "trip" || m.type === "newTrip") {
    const x = m.type === "trip" ? t : { name: "", start: "", end: "" };
    return wrap(`<h2>${m.type === "trip" ? "Reis bewerken" : "Nieuwe reis naar " + esc(dest().name)}</h2>
      <div class="field"><label>Naam</label><input id="tName" type="text" value="${esc(x.name)}" placeholder="bv. Zomer 2027"></div>
      <div class="row"><div class="field grow"><label>Van</label><input id="tStart" type="date" value="${x.start}"></div><div class="field grow"><label>Tot</label><input id="tEnd" type="date" value="${x.end}"></div></div>
      ${m.type === "newTrip" ? `<p class="small">Je eerdere reizen naar deze plek blijven bewaard onder “Gedaan”.</p>` : ""}
      <div class="row"><button class="btn ghost grow" data-a="close">Annuleer</button><button class="btn grow" data-a="saveTrip">Opslaan</button></div>
      ${m.type === "trip" && dest().trips.length > 1 ? `<div style="text-align:center;margin-top:14px"><button class="btn ghost sm" style="color:var(--red)" data-a="delTrip">Deze reis verwijderen</button></div>` : ""}`);
  }
  if (m.type === "item") {
    const i = t.items.find(x => x.id === m.id); if (!i) return ""; const ds = days(t);
    return wrap(`<h2>${catOf(i.place.cat).e} ${esc(i.place.name)}</h2>
      <div class="row"><div class="field grow"><label>Dag</label><select id="iDay"><option value="">Niet ingepland</option>${ds.map((x, n) => `<option value="${x}" ${i.day === x ? "selected" : ""}>Dag ${n + 1} · ${fmtDay(x)}</option>`).join("")}</select></div>
      <div class="field" style="width:120px"><label>Tijd</label><input id="iTime" type="time" value="${i.time || ""}"></div></div>
      <div class="field"><label>Notitie</label><textarea id="iNote" rows="2" placeholder="bv. reserveren om 19:00">${esc(i.note || "")}</textarea></div>
      <div class="field"><label>Jouw beoordeling</label><div class="row" id="iRate">${[1, 2, 3, 4, 5].map(n => `<button class="chip ${i.rating >= n ? "on" : ""}" data-a="rate" data-n="${n}">★</button>`).join("")}</div></div>
      <div class="links" style="margin-bottom:14px"><a href="${gmaps(i.place, dest().name)}" target="_blank" rel="noopener">📍 Route & reviews</a>${i.place.website ? `<a href="${esc(i.place.website)}" target="_blank" rel="noopener">🌐 Website</a>` : ""}</div>
      <div class="row"><button class="btn ghost" style="color:var(--red)" data-a="delItem">Verwijder</button><div class="grow"></div><button class="btn" data-a="saveItem">Opslaan</button></div>`);
  }
  if (m.type === "custom") return wrap(`<h2>Eigen item toevoegen</h2>
      <div class="field"><label>Wat?</label><input id="cName" type="text" placeholder="bv. Boottocht met vrienden"></div>
      <div class="field"><label>Categorie</label><select id="cCat">${CATS.map(c => `<option value="${c.k}">${c.e} ${c.l}</option>`).join("")}</select></div>
      <div class="row"><button class="btn ghost grow" data-a="close">Annuleer</button><button class="btn grow" data-a="saveCustom">Toevoegen</button></div>`);
  if (m.type === "confirm") return wrap(`<h2>${esc(m.title)}</h2><p>${esc(m.text)}</p>
      <div class="row"><button class="btn ghost grow" data-a="close">Annuleer</button><button class="btn grow" style="background:var(--red)" data-a="confirmYes">Verwijder</button></div>`);
  return "";
}

/* ---------- events ---------- */
function bind() {
  const nd = $("#newDest"); if (nd) nd.addEventListener("keydown", e => { if (e.key === "Enter") act("find"); });
  const q = $("#q"); if (q) { q.addEventListener("input", e => ui.query = e.target.value); q.addEventListener("keydown", e => { if (e.key === "Enter") act("search"); }); }
  const ts = $("#tripSel"); if (ts) ts.addEventListener("change", e => { ui.tripId = e.target.value; ui.dayMap = null; render(); });
  const f = $("#importFile"); if (f) f.addEventListener("change", e => { if (e.target.files[0]) importData(e.target.files[0]); });
  document.querySelectorAll("select[data-a=setday]").forEach(s => s.addEventListener("change", e => {
    const i = trip().items.find(x => x.id === s.dataset.id); i.day = e.target.value; save(); toast(i.day ? "Ingepland" : "Uit planning gehaald"); render();
  }));
}
document.addEventListener("click", e => {
  const el = e.target.closest("[data-a]"); if (!el || el.tagName === "SELECT") return;
  if (el.dataset.a === "closeBg" && e.target !== el) return;
  act(el.dataset.a, el);
});
function act(a, el) {
  const d = dest(), t = trip(), id = el && el.dataset.id;
  const findP = () => ui.results.find(x => x._id === id);
  switch (a) {
    case "find": { const v = ($("#newDest").value || "").trim(); if (v) suggest(v); break; }
    case "pick": addDest(ui.sugg[+el.dataset.i]); break;
    case "open": openDest(id); break;
    case "home": ui.view = "home"; ui.sugg = null; ui.dayMap = null; render(); window.scrollTo(0, 0); break;
    case "settings": ui.modal = { type: "settings" }; render(); break;
    case "saveSettings": state.settings.gkey = $("#gkey").value.trim(); save(); ui.modal = null; render(); toast(state.settings.gkey ? "Google staat aan ★" : "Opgeslagen"); break;
    case "export": exportData(); break;
    case "tab": ui.tab = el.dataset.k; ui.dayMap = null; render(); if (ui.tab === "discover" && !ui.results.length && !ui.loading) search(); break;
    case "cat": ui.cat = el.dataset.k; ui.query = ""; search(); break;
    case "halal": ui.halal = !ui.halal; search(); break;
    case "search": search(); break;
    case "mode": ui.mode = el.dataset.k; render(); break;
    case "src":
      if (el.dataset.k === "google" && !state.settings.gkey) { ui.modal = { type: "settings" }; render(); toast("Vul eerst een Google API-sleutel in"); return; }
      ui.src = el.dataset.k; search(); break;
    case "more": ui.shown += PAGE; render(); enrich(); break;
    case "add": { const p = findP(); if (p) addItem(p); break; }
    case "reviews": { const p = findP(); if (p) loadReviews(p); break; }
    case "done": { const i = t.items.find(x => x.id === id); i.done = !i.done; if (i.done) i.doneAt = Date.now(); save(); if (i.done) toast("Lekker! ✓"); render(); break; }
    case "dayMap": ui.dayMap = el.dataset.k; render(); break;
    case "up": case "down": {
      const i = t.items.find(x => x.id === id); const same = sortedDay(t, i.day);
      same.forEach((x, n) => x.order = n); const n = same.indexOf(i), m = a === "up" ? n - 1 : n + 1; if (m < 0 || m >= same.length) return;
      const o = same[m]; if ((o.time || "") !== (i.time || "")) { const tt = o.time; o.time = i.time; i.time = tt; }
      const tmp = o.order; o.order = i.order; i.order = tmp; save(); render(); break;
    }
    case "editTrip": ui.modal = { type: "trip" }; render(); break;
    case "newTrip": ui.modal = { type: "newTrip" }; render(); break;
    case "saveTrip": {
      const name = $("#tName").value.trim(), s = $("#tStart").value, en = $("#tEnd").value;
      if (s && en && en < s) { toast("Einddatum ligt vóór begindatum"); return; }
      if (ui.modal.type === "trip") Object.assign(t, { name: name || t.name, start: s, end: en || s });
      else { const nt = { id: uid(), name: name || ("Reis " + (s ? s.slice(0, 4) : new Date().getFullYear())), start: s, end: en || s, items: [], created: Date.now() }; d.trips.push(nt); ui.tripId = nt.id; ui.tab = "discover"; }
      ui.modal = null; save(); render(); break;
    }
    case "switchTrip": ui.tripId = id; ui.tab = "todo"; render(); window.scrollTo(0, 0); break;
    case "delTrip": ui.modal = { type: "confirm", title: "Reis verwijderen?", text: "Alle items van “" + t.name + "” worden verwijderd.", fn: () => { d.trips = d.trips.filter(x => x.id !== t.id); ui.tripId = d.trips[d.trips.length - 1].id; } }; render(); break;
    case "delDest": ui.modal = { type: "confirm", title: d.name + " verwijderen?", text: "Alle reizen en geschiedenis van deze plek worden verwijderd.", fn: () => { state.destinations = state.destinations.filter(x => x.id !== d.id); ui.view = "home"; } }; render(); break;
    case "confirmYes": { const f = ui.modal.fn; ui.modal = null; f(); save(); render(); break; }
    case "editItem": ui.modal = { type: "item", id }; render(); break;
    case "rate": { const i = t.items.find(x => x.id === ui.modal.id); const n = +el.dataset.n; i.rating = i.rating === n ? 0 : n; document.querySelectorAll("#iRate .chip").forEach((c, k) => c.classList.toggle("on", k < i.rating)); save(); break; }
    case "saveItem": { const i = t.items.find(x => x.id === ui.modal.id); i.day = $("#iDay").value; i.time = $("#iTime").value; i.note = $("#iNote").value.trim(); ui.modal = null; save(); render(); break; }
    case "delItem": t.items = t.items.filter(x => x.id !== ui.modal.id); ui.modal = null; save(); render(); break;
    case "addCustom": ui.modal = { type: "custom" }; render(); break;
    case "saveCustom": { const n = $("#cName").value.trim(); if (!n) return; t.items.push({ id: uid(), place: { _id: uid(), name: n, cat: $("#cCat").value }, day: "", time: "", done: false, note: "", added: Date.now() }); ui.modal = null; save(); render(); break; }
    case "close": case "closeBg": ui.modal = null; render(); break;
  }
}

load(); render();
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
