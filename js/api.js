// Live databronnen: OpenStreetMap (Nominatim + Overpass), Wikipedia/Wikidata en optioneel Google Places.

const OVERPASS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter"
];

async function getJSON(url, opts = {}, ms = 30000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  if (opts.signal) opts.signal.addEventListener("abort", () => ctrl.abort());
  try {
    const r = await fetch(url, { ...opts, signal: ctrl.signal });
    if (!r.ok) throw new Error("HTTP " + r.status);
    return await r.json();
  } finally { clearTimeout(t); }
}

/* ---------- Bestemming zoeken (Nominatim) ---------- */
export async function geocode(q, near) {
  let url = "https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=6&accept-language=nl&q=" + encodeURIComponent(q);
  if (near) { const d = 0.6; url += `&viewbox=${near.lon - d},${near.lat + d},${near.lon + d},${near.lat - d}`; }
  const res = await getJSON(url, { headers: { "Accept": "application/json" } }, 15000);
  return res.map(r => ({
    name: r.name || r.display_name.split(",")[0],
    label: r.display_name,
    country: r.address && r.address.country || "",
    lat: +r.lat, lon: +r.lon,
    bbox: r.boundingbox ? r.boundingbox.map(Number) : null, // [south, north, west, east]
    type: r.addresstype || r.type
  }));
}

// Snelle suggesties tijdens het typen (Photon, gemaakt voor autocomplete).
export async function suggestPlaces(q, signal) {
  const r = await getJSON("https://photon.komoot.io/api/?limit=6&q=" + encodeURIComponent(q), { signal }, 8000);
  const seen = new Set();
  return (r.features || []).map(f => {
    const p = f.properties || {}, c = f.geometry.coordinates;
    const e = p.extent; // [minLon, maxLat, maxLon, minLat]
    const label = [...new Set([p.name, p.city, p.county, p.state, p.country].filter(Boolean))].join(", ");
    return { name: p.name || label.split(",")[0], label, country: p.country || "", lat: c[1], lon: c[0], bbox: e ? [e[3], e[1], e[0], e[2]] : null, type: p.osm_value };
  }).filter(g => g.name && !seen.has(g.label) && seen.add(g.label));
}

/* ---------- Categorieën ---------- */
export const CATS = [
  { k: "sights", l: "Bezienswaardigheden", e: "🏛️", g: "top tourist attractions" },
  { k: "restaurants", l: "Restaurants", e: "🍽️", g: "best restaurants", food: true },
  { k: "cafes", l: "Cafés & ontbijt", e: "☕", g: "best cafes breakfast", food: true },
  { k: "malls", l: "Winkelcentra", e: "🛍️", g: "shopping malls" },
  { k: "outlets", l: "Outlets", e: "🏷️", g: "outlet stores" },
  { k: "markets", l: "Markten & winkelstraten", e: "🧺", g: "markets and shopping streets" },
  { k: "nature", l: "Natuur & stranden", e: "🌿", g: "parks beaches nature" },
  { k: "activities", l: "Activiteiten", e: "🎢", g: "things to do activities" },
  { k: "museums", l: "Musea", e: "🖼️", g: "museums" },
  { k: "nightlife", l: "Avond & uitzicht", e: "🌆", g: "rooftop bars viewpoints" }
];
export const catOf = k => CATS.find(c => c.k === k) || CATS[0];

const Q = {
  sights: ['nwr["tourism"~"^(attraction|viewpoint)$"]["name"]', 'nwr["historic"~"^(monument|castle|palace|fort|archaeological_site|memorial|ruins|city_gate)$"]["name"]', 'nwr["amenity"="place_of_worship"]["wikidata"]', 'nwr["building"~"^(cathedral|mosque|church)$"]["wikidata"]'],
  restaurants: ['nwr["amenity"~"^(restaurant|fast_food)$"]["name"]'],
  cafes: ['nwr["amenity"~"^(cafe|ice_cream)$"]["name"]', 'nwr["shop"="pastry"]["name"]'],
  malls: ['nwr["shop"~"^(mall|department_store)$"]["name"]'],
  outlets: ['nwr["shop"="outlet"]["name"]', 'nwr["shop"]["name"~"outlet",i]', 'nwr["outlet"="yes"]["name"]'],
  markets: ['nwr["amenity"="marketplace"]["name"]', 'nwr["shop"="market"]["name"]', 'way["highway"="pedestrian"]["name"]["wikidata"]'],
  nature: ['nwr["leisure"~"^(park|nature_reserve|garden)$"]["name"]', 'nwr["natural"~"^(beach|peak|waterfall|bay)$"]["name"]'],
  activities: ['nwr["tourism"~"^(theme_park|zoo|aquarium)$"]["name"]', 'nwr["leisure"~"^(water_park|marina|stadium)$"]["name"]', 'nwr["tourism"="attraction"]["attraction"]["name"]'],
  museums: ['nwr["tourism"~"^(museum|gallery)$"]["name"]'],
  nightlife: ['nwr["amenity"~"^(bar|pub|nightclub)$"]["name"]', 'nwr["tourism"="viewpoint"]["name"]']
};

const DUTCH_CUISINE = { turks: "turkish", italiaans: "italian", libanees: "lebanese", marokkaans: "moroccan", indiaas: "indian", chinees: "chinese", japans: "japanese", grieks: "greek", spaans: "spanish", mexicaans: "mexican", thais: "thai", arabisch: "arab", pakistaans: "pakistani", vis: "seafood", burger: "burger", pizza: "pizza", sushi: "sushi", kebab: "kebab", ontbijt: "breakfast", vegetarisch: "vegetarian", steak: "steak", koreaans: "korean", perzisch: "persian", indonesisch: "indonesian", surinaams: "surinamese", frans: "french", ijs: "ice_cream", koffie: "coffee", gebak: "cake", dessert: "dessert" };

/* ---------- Alles in één keer ophalen (Overpass) ----------
   Eén verzoek haalt alle categorieën tegelijk op. "out count" scheidt de categorieën in het antwoord. */
export const DEFAULT_RADIUS = 2000;
const LIMIT = { restaurants: 300, cafes: 200 };
const CACHE_MS = 3 * 24 * 3600 * 1000;
const mem = new Map();
const keyOf = w => `ovp2:${w.lat.toFixed(4)},${w.lon.toFixed(4)}:${Math.round(w.radius)}`;

export function cachedAll(w) {
  const k = keyOf(w);
  if (mem.has(k) && !(mem.get(k) instanceof Promise)) return mem.get(k);
  try {
    const j = JSON.parse(localStorage.getItem(k) || "null");
    if (j && Date.now() - j.t < CACHE_MS) { mem.set(k, j.v); return j.v; }
  } catch (e) {}
  return null;
}

// w = { lat, lon, radius }  →  { sights: [...], restaurants: [...], ... }
export function fetchAll(w, { fresh = false } = {}) {
  const k = keyOf(w);
  if (!fresh) {
    const c = cachedAll(w); if (c) return Promise.resolve(c);
    if (mem.get(k) instanceof Promise) return mem.get(k);
  }
  const area = `(around:${Math.round(w.radius)},${w.lat},${w.lon})`;
  const sets = CATS.map((c, i) => `(${Q[c.k].map(q => q + area + ";").join("")})->.s${i};.s${i} out count;.s${i} out center tags qt ${LIMIT[c.k] || 150};`).join("");
  const halal = `(${['nwr["amenity"~"^(restaurant|fast_food|cafe)$"]["diet:halal"~"^(yes|only)$"]', 'nwr["amenity"~"^(restaurant|fast_food|cafe)$"]["name"~"halal",i]'].map(q => q + area + ";").join("")})->.h;.h out count;.h out center tags qt 150;`;
  const body = "data=" + encodeURIComponent(`[out:json][timeout:25];${sets}${halal}`);
  const ctrls = OVERPASS.map(() => new AbortController());
  const p = Promise.any(OVERPASS.map((ep, i) => getJSON(ep, { method: "POST", body, signal: ctrls[i].signal, headers: { "Content-Type": "application/x-www-form-urlencoded" } }, 30000)
    .then(res => { if (!res || !res.elements || !res.elements.some(e => e.type === "count")) throw new Error("leeg"); return [i, res]; })))
    .then(([win, res]) => {
      ctrls.forEach((c, i) => i !== win && c.abort());
      const groups = []; let cur = null;
      for (const el of res.elements) { if (el.type === "count") { cur = []; groups.push(cur); } else if (cur) cur.push(el); }
      const out = {};
      CATS.forEach((c, i) => { out[c.k] = normalizeOSM(groups[i] || [], w, c.k); });
      // halal-plekken die buiten de limiet vielen alsnog toevoegen
      const h = groups[CATS.length] || [];
      for (const [cat, re] of [["restaurants", /restaurant|fast_food/], ["cafes", /cafe/]]) {
        const extra = normalizeOSM(h.filter(e => re.test((e.tags || {}).amenity || "")), w, cat);
        const have = new Set(out[cat].map(p => p._id));
        out[cat] = out[cat].concat(extra.filter(p => !have.has(p._id))).sort((a, b) => b.score - a.score);
      }
      for (const kk in out) out[kk] = out[kk].slice(0, 200);
      mem.set(k, out);
      try { localStorage.setItem(k, JSON.stringify({ t: Date.now(), v: out })); } catch (e) { pruneCache(); try { localStorage.setItem(k, JSON.stringify({ t: Date.now(), v: out })); } catch (e2) {} }
      return out;
    })
    .catch(e => { mem.delete(k); throw new Error("Kaartdienst niet bereikbaar"); });
  mem.set(k, p);
  return p;
}

function pruneCache() {
  try {
    const ks = Object.keys(localStorage).filter(k => k.startsWith("ovp"));
    const t = k => { try { return JSON.parse(localStorage.getItem(k)).t || 0; } catch (e) { return 0; } };
    ks.sort((a, b) => t(a) - t(b)).slice(0, Math.ceil(ks.length / 2)).forEach(k => localStorage.removeItem(k));
  } catch (e) {}
}

function dist(a, b, c, d) {
  const R = 6371, r = x => x * Math.PI / 180;
  const dl = r(c - a), dn = r(d - b);
  const h = Math.sin(dl / 2) ** 2 + Math.cos(r(a)) * Math.cos(r(c)) * Math.sin(dn / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function halalOf(t) {
  const v = t["diet:halal"];
  if (v === "only") return "ja";
  if (v === "yes") return "opties";
  if (v === "no") return "nee";
  if (/halal/i.test(t.name || "") || /halal/i.test(t.cuisine || "")) return "ja";
  return "onbekend";
}

function normalizeOSM(els, dest, cat) {
  const seen = new Set(), out = [];
  for (const el of els) {
    const t = el.tags || {};
    const name = t["name:nl"] || t.name;
    if (!name) continue;
    const lat = el.lat ?? (el.center && el.center.lat), lon = el.lon ?? (el.center && el.center.lon);
    if (lat == null) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    let score = 0;
    if (t.wikidata) score += 6;
    if (t.wikipedia) score += 5;
    if (t.website || t["contact:website"]) score += 1.5;
    if (t.opening_hours) score += 1;
    if (t.cuisine) score += .5;
    if (t.image || t.wikimedia_commons) score += 1;
    if (t.tourism === "attraction") score += 1;
    if (t.phone || t["contact:phone"]) score += .5;
    const km = dist(dest.lat, dest.lon, lat, lon);
    score -= Math.min(km, 30) * 0.08;
    const addr = [t["addr:street"] && (t["addr:street"] + (t["addr:housenumber"] ? " " + t["addr:housenumber"] : "")), t["addr:city"]].filter(Boolean).join(", ");
    out.push({
      _id: "osm_" + el.type + el.id,
      src: "osm", osmId: el.type + "/" + el.id,
      name, cat, lat, lon, km,
      address: addr || null,
      area: t["addr:suburb"] || t["addr:district"] || t["addr:city"] || "",
      cuisine: t.cuisine ? t.cuisine.split(";").map(s => s.replace(/_/g, " ")).join(", ") : null,
      openingHours: t.opening_hours || null,
      website: t.website || t["contact:website"] || null,
      phone: t.phone || t["contact:phone"] || null,
      wikidata: t.wikidata || null,
      wikipedia: t.wikipedia || null,
      halal: halalOf(t),
      kind: t.tourism || t.historic || t.amenity || t.shop || t.leisure || t.natural || "",
      wheelchair: t.wheelchair || null,
      fee: t.fee || null,
      tx: [t.name, t["name:en"], t.cuisine, t.amenity, t.shop, t.tourism, t.brand, t.historic, t.leisure, t.natural, t["diet:vegetarian"] === "yes" || t["diet:vegetarian"] === "only" ? "vegetarian" : ""].filter(Boolean).join(" ").toLowerCase(),
      score
    });
  }
  return out.sort((a, b) => b.score - a.score);
}

export function filterByText(list, q) {
  if (!q) return list;
  const words = q.toLowerCase().split(/\s+/).filter(Boolean).map(w => DUTCH_CUISINE[w] || w);
  return list.filter(p => words.every(w => (p.tx || "").includes(w) || p.name.toLowerCase().includes(w)));
}

/* ---------- Wikipedia / Wikidata ---------- */
const wikiCache = new Map();
export async function wikiSummary({ wikidata, wikipedia, title, lang = "nl" }) {
  const key = wikidata || wikipedia || title;
  if (!key) return null;
  if (wikiCache.has(key)) return wikiCache.get(key);
  try { const c = JSON.parse(localStorage.getItem("wiki1:" + key) || "null"); if (c) { wikiCache.set(key, Promise.resolve(c.v)); return c.v; } } catch (e) {}
  const p = (async () => {
    let pick = null;
    if (wikidata) {
      try {
        const r = await getJSON(`https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${wikidata}&props=sitelinks&sitefilter=nlwiki|enwiki&format=json&origin=*`, {}, 12000);
        const sl = r.entities && r.entities[wikidata] && r.entities[wikidata].sitelinks || {};
        if (sl.nlwiki) pick = ["nl", sl.nlwiki.title];
        else if (sl.enwiki) pick = ["en", sl.enwiki.title];
      } catch (e) {}
    }
    if (!pick && wikipedia) { const i = wikipedia.indexOf(":"); pick = i > 0 ? [wikipedia.slice(0, i), wikipedia.slice(i + 1)] : ["en", wikipedia]; }
    if (!pick && title) pick = [lang, title];
    if (!pick) return null;
    try {
      const s = await getJSON(`https://${pick[0]}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(pick[1].replace(/ /g, "_"))}`, {}, 12000);
      if (s.type === "disambiguation") return null;
      const v = { extract: s.extract, image: s.thumbnail && s.thumbnail.source, url: s.content_urls && s.content_urls.mobile && s.content_urls.mobile.page, lang: pick[0] };
      try { localStorage.setItem("wiki1:" + key, JSON.stringify({ v })); } catch (e) {}
      return v;
    } catch (e) { return null; }
  })();
  wikiCache.set(key, p);
  return p;
}

export async function destinationIntro(name) {
  for (const lang of ["nl", "en"]) {
    try {
      const s = await getJSON(`https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(name.replace(/ /g, "_"))}`, {}, 10000);
      if (s.type !== "disambiguation" && s.extract) return { extract: s.extract, image: s.originalimage ? s.originalimage.source : s.thumbnail && s.thumbnail.source, url: s.content_urls && s.content_urls.mobile.page };
    } catch (e) {}
  }
  return null;
}

/* ---------- Google Places (optioneel, eigen API-sleutel) ---------- */
let gPromise = null;
export function loadGoogle(key) {
  if (window.google && google.maps && google.maps.importLibrary) return google.maps.importLibrary("places");
  if (gPromise) return gPromise;
  gPromise = new Promise((resolve, reject) => {
    window.__gmapsReady = () => google.maps.importLibrary("places").then(resolve, reject);
    window.gm_authFailure = () => reject(new Error("Google-sleutel geweigerd. Controleer je API-sleutel en of Places API (New) aan staat."));
    const s = document.createElement("script");
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&v=weekly&loading=async&language=nl&callback=__gmapsReady`;
    s.async = true;
    s.onerror = () => reject(new Error("Kon Google Maps niet laden"));
    document.head.appendChild(s);
  });
  gPromise.catch(() => { gPromise = null; });
  return gPromise;
}

const PRICE = { FREE: "Gratis", INEXPENSIVE: "€", MODERATE: "€€", EXPENSIVE: "€€€", VERY_EXPENSIVE: "€€€€" };
const gPlaces = new Map();

export async function googleSearch(key, dest, catKey, { halal = false, query = "" } = {}) {
  const { Place } = await loadGoogle(key);
  const c = catOf(catKey);
  let text = (query ? query + " " : "") + (halal && c.food ? "halal " : "") + c.g + " in " + dest.name;
  const req = {
    textQuery: text,
    fields: ["id", "displayName", "formattedAddress", "location", "rating", "userRatingCount", "priceLevel", "photos", "googleMapsURI", "editorialSummary", "regularOpeningHours", "websiteURI", "primaryTypeDisplayName"],
    language: "nl",
    maxResultCount: 20,
    locationBias: dest.fixedRadius ? { center: { lat: dest.lat, lng: dest.lon }, radius: Math.min(dest.fixedRadius, 50000) } : { lat: dest.lat, lng: dest.lon }
  };
  const { places } = await Place.searchByText(req);
  return (places || []).filter(p => !dest.fixedRadius || !p.location || dist(dest.lat, dest.lon, p.location.lat(), p.location.lng()) * 1000 <= dest.fixedRadius * 1.15).map(p => {
    gPlaces.set(p.id, p);
    let photo = null;
    try { photo = p.photos && p.photos[0] ? p.photos[0].getURI({ maxWidth: 800 }) : null; } catch (e) {}
    const lat = p.location && p.location.lat(), lon = p.location && p.location.lng();
    return {
      _id: "g_" + p.id, src: "google", gId: p.id,
      name: p.displayName, cat: catKey, lat, lon,
      km: lat != null ? dist(dest.lat, dest.lon, lat, lon) : null,
      address: p.formattedAddress || null,
      area: "",
      rating: p.rating || null, reviewCount: p.userRatingCount || null,
      priceLevel: PRICE[p.priceLevel] || null,
      description: p.editorialSummary || null,
      kindLabel: p.primaryTypeDisplayName || "",
      photo,
      openingDays: p.regularOpeningHours && p.regularOpeningHours.weekdayDescriptions || null,
      website: p.websiteURI || null,
      mapsUrl: p.googleMapsURI || null,
      halal: halal && c.food ? "zoekterm" : "onbekend"
    };
  });
}

export async function googleReviews(key, gId) {
  const { Place } = await loadGoogle(key);
  const p = gPlaces.get(gId) || new Place({ id: gId, requestedLanguage: "nl" });
  await p.fetchFields({ fields: ["reviews", "servesVegetarianFood", "servesBeer", "servesWine", "reservable", "nationalPhoneNumber"] });
  return {
    reviews: (p.reviews || []).map(r => ({
      rating: r.rating, text: r.text || "", when: r.relativePublishTimeDescription || "",
      who: r.authorAttribution ? r.authorAttribution.displayName : "Google-gebruiker"
    })),
    alcohol: (p.servesBeer || p.servesWine) ? "Schenkt alcohol" : (p.servesBeer === false && p.servesWine === false ? "Schenkt geen alcohol" : null),
    reservable: p.reservable, phone: p.nationalPhoneNumber || null
  };
}

/* ---------- Nu open? (eenvoudige lezer voor OSM opening_hours) ----------
   Geeft true / false terug, of null als de tijden te ingewikkeld zijn. */
const DAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
export function isOpenNow(oh, now = new Date()) {
  if (!oh) return null;
  oh = oh.trim();
  if (oh === "24/7") return true;
  if (/PH|SH|week|easter|sunrise|sunset|\[|"|\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/.test(oh)) return null;
  const today = now.getDay(), mins = now.getHours() * 60 + now.getMinutes();
  const dayIn = (spec, d) => spec.split(",").some(part => {
    const m = part.trim().match(/^(Mo|Tu|We|Th|Fr|Sa|Su)(?:-(Mo|Tu|We|Th|Fr|Sa|Su))?$/);
    if (!m) throw 0;
    const a = DAYS.indexOf(m[1]), b = m[2] ? DAYS.indexOf(m[2]) : a;
    return a <= b ? d >= a && d <= b : d >= a || d <= b;
  });
  const toMin = t => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
  try {
    let open = false, decided = false;
    for (const rule of oh.split(";").map(r => r.trim()).filter(Boolean)) {
      const m = rule.match(/^((?:(?:Mo|Tu|We|Th|Fr|Sa|Su)(?:-(?:Mo|Tu|We|Th|Fr|Sa|Su))?,?)+)?\s*(.*)$/);
      const days = m[1], times = m[2].trim();
      // vandaag, of gisteren voor tijden over middernacht
      for (const [d, shift] of [[today, 0], [(today + 6) % 7, 1440]]) {
        if (days && !dayIn(days, d)) continue;
        if (!days && shift) continue;
        if (/^off|closed$/i.test(times)) { if (!shift) { open = false; decided = true; } continue; }
        for (const rng of times.split(",")) {
          const t = rng.trim().match(/^(\d{1,2}:\d{2})-(\d{1,2}:\d{2})\+?$/);
          if (!t) throw 0;
          let a = toMin(t[1]), b = toMin(t[2]); if (b <= a) b += 1440;
          const cur = mins + shift;
          if (!shift) decided = true;
          if (cur >= a && cur < b) { open = true; decided = true; }
        }
      }
    }
    return decided ? open : false;
  } catch (e) { return null; }
}
