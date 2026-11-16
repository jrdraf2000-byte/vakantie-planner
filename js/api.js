// Live databronnen: OpenStreetMap (Nominatim + Overpass), Wikipedia/Wikidata en optioneel Google Places.

const OVERPASS = [
  "https://overpass-api.de/api/interpreter",
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

// Zoekstraal per categorie: klein genoeg om snel te zijn, groot genoeg voor genoeg keus.
const RADIUS = { restaurants: 2500, cafes: 2500, nightlife: 4000, markets: 5000, malls: 9000, outlets: 25000, nature: 12000, activities: 12000, sights: 6000, museums: 6000 };
export const autoRadius = (catKey, halal) => (RADIUS[catKey] || 6000) * (halal ? 2.4 : 1);
function areaFilter(dest, catKey, halal) {
  if (dest.fixedRadius) return `(around:${Math.round(dest.fixedRadius)},${dest.lat},${dest.lon})`;
  let r = RADIUS[catKey] || 6000;
  if (halal) r *= 2.4; // minder treffers, dus breder zoeken
  const b = dest.bbox;
  if (b) { // kleine plek (dorp, wijk): niet verder zoeken dan nodig
    const half = dist(b[0], b[2], b[1], b[3]) * 500;
    if (half > 600) r = Math.min(r, Math.max(half, 1500));
  }
  return `(around:${Math.round(r)},${dest.lat},${dest.lon})`;
}

const DUTCH_CUISINE = { turks: "turkish", italiaans: "italian", libanees: "lebanese", marokkaans: "moroccan", indiaas: "indian", chinees: "chinese", japans: "japanese", grieks: "greek", spaans: "spanish", mexicaans: "mexican", thais: "thai", arabisch: "arab", pakistaans: "pakistani", vis: "seafood", burger: "burger", pizza: "pizza", sushi: "sushi", kebab: "kebab", ontbijt: "breakfast", vegetarisch: "vegetarian", steak: "steak", koreaans: "korean", perzisch: "persian", indonesisch: "indonesian", surinaams: "surinamese", frans: "french" };

const CACHE_MS = 3 * 24 * 3600 * 1000;
const inflight = new Map();
const cacheKey = (dest, catKey, halal) => `ovp1:${dest.lat.toFixed(3)},${dest.lon.toFixed(3)}:${catKey}:${halal ? 1 : 0}:${dest.fixedRadius || "a"}`;

export function cachedSearch(dest, catKey, { halal = false } = {}) {
  try {
    const j = JSON.parse(localStorage.getItem(cacheKey(dest, catKey, halal && catOf(catKey).food)) || "null");
    if (j && Date.now() - j.t < CACHE_MS) return j.v;
  } catch (e) {}
  return null;
}

export async function overpassSearch(dest, catKey, { halal = false, fresh = false } = {}) {
  halal = halal && catOf(catKey).food;
  const key = cacheKey(dest, catKey, halal);
  if (!fresh) { const c = cachedSearch(dest, catKey, { halal }); if (c) return c; }
  if (inflight.has(key)) return inflight.get(key);
  let parts = Q[catKey] || Q.sights;
  if (halal) parts = parts.flatMap(p => [p + '["diet:halal"~"^(yes|only)$"]', p + '["name"~"halal",i]', p + '["cuisine"~"halal",i]']);
  const area = areaFilter(dest, catKey, halal);
  const body = "data=" + encodeURIComponent(`[out:json][timeout:20];(${parts.map(p => p + area + ";").join("")});out center tags qt 250;`);
  // Alle servers tegelijk proberen: de snelste wint, de rest wordt afgebroken.
  const ctrls = OVERPASS.map(() => new AbortController());
  const p = Promise.any(OVERPASS.map((ep, i) => getJSON(ep, { method: "POST", body, signal: ctrls[i].signal, headers: { "Content-Type": "application/x-www-form-urlencoded" } }, 25000)
    .then(res => { if (!res || !res.elements) throw new Error("leeg"); return [i, res]; })))
    .then(([win, res]) => {
      ctrls.forEach((c, i) => i !== win && c.abort());
      const v = normalizeOSM(res.elements, dest, catKey).slice(0, 120);
      try { localStorage.setItem(key, JSON.stringify({ t: Date.now(), v })); } catch (e) { pruneCache(); }
      return v;
    })
    .catch(() => { throw new Error("Overpass niet bereikbaar"); })
    .finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

function pruneCache() {
  try {
    const ks = Object.keys(localStorage).filter(k => k.startsWith("ovp1:"));
    ks.sort((a, b) => (JSON.parse(localStorage.getItem(a)).t || 0) - (JSON.parse(localStorage.getItem(b)).t || 0));
    ks.slice(0, Math.ceil(ks.length / 2)).forEach(k => localStorage.removeItem(k));
  } catch (e) {}
}

// Na het openen van een bestemming alvast de populairste categorieën ophalen (één tegelijk).
export async function prefetch(dest, cats) {
  for (const c of cats) {
    if (cachedSearch(dest, c)) continue;
    try { await overpassSearch(dest, c); } catch (e) {}
    await new Promise(r => setTimeout(r, 400));
  }
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
      tagText: Object.entries(t).map(([k, v]) => k + "=" + v).join(" ").toLowerCase(),
      score
    });
  }
  return out.sort((a, b) => b.score - a.score);
}

export function filterByText(list, q) {
  if (!q) return list;
  const words = q.toLowerCase().split(/\s+/).filter(Boolean).map(w => DUTCH_CUISINE[w] || w);
  return list.filter(p => words.every(w => p.tagText.includes(w) || p.name.toLowerCase().includes(w)));
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
