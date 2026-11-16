// Live databronnen: OpenStreetMap (Nominatim + Overpass), Wikipedia/Wikidata en optioneel Google Places.

const OVERPASS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter"
];

async function getJSON(url, opts = {}, ms = 30000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { ...opts, signal: ctrl.signal });
    if (!r.ok) throw new Error("HTTP " + r.status);
    return await r.json();
  } finally { clearTimeout(t); }
}

/* ---------- Bestemming zoeken (Nominatim) ---------- */
export async function geocode(q) {
  const url = "https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=6&accept-language=nl&q=" + encodeURIComponent(q);
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

function areaFilter(dest) {
  const b = dest.bbox;
  const big = !b || (b[1] - b[0]) > 0.45 || (b[3] - b[2]) > 0.45;
  if (big) return `(around:${dest.radius || 12000},${dest.lat},${dest.lon})`;
  return `(${b[0]},${b[2]},${b[1]},${b[3]})`;
}

const DUTCH_CUISINE = { turks: "turkish", italiaans: "italian", libanees: "lebanese", marokkaans: "moroccan", indiaas: "indian", chinees: "chinese", japans: "japanese", grieks: "greek", spaans: "spanish", mexicaans: "mexican", thais: "thai", arabisch: "arab", pakistaans: "pakistani", vis: "seafood", burger: "burger", pizza: "pizza", sushi: "sushi", kebab: "kebab", ontbijt: "breakfast", vegetarisch: "vegetarian", steak: "steak", koreaans: "korean", perzisch: "persian", indonesisch: "indonesian", surinaams: "surinamese", frans: "french" };

export async function overpassSearch(dest, catKey, { halal = false } = {}) {
  let parts = Q[catKey] || Q.sights;
  if (halal && catOf(catKey).food) {
    parts = parts.flatMap(p => [p + '["diet:halal"~"^(yes|only)$"]', p + '["name"~"halal",i]', p + '["cuisine"~"halal",i]']);
  }
  const area = areaFilter(dest);
  const body = `[out:json][timeout:30];(${parts.map(p => p + area + ";").join("")});out center tags 400;`;
  let lastErr;
  for (const ep of OVERPASS) {
    try {
      const res = await getJSON(ep, { method: "POST", body: "data=" + encodeURIComponent(body), headers: { "Content-Type": "application/x-www-form-urlencoded" } }, 40000);
      return normalizeOSM(res.elements || [], dest, catKey);
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error("Overpass niet bereikbaar");
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
      return { extract: s.extract, image: s.thumbnail && s.thumbnail.source, url: s.content_urls && s.content_urls.mobile && s.content_urls.mobile.page, lang: pick[0] };
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
    locationBias: { lat: dest.lat, lng: dest.lon }
  };
  const { places } = await Place.searchByText(req);
  return (places || []).map(p => {
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
