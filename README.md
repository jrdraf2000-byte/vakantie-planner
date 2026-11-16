# Vakantieplanner ✈️

Een webapp voor je vakantie-uitjes. Je kunt hem op je telefoon installeren als app.

- **Ontdekken:** zoek een stad, plek of gebied. De app haalt live bezienswaardigheden, restaurants, cafés, winkelcentra, outlets, markten, natuur, activiteiten, musea en uitgaansplekken op.
- **Halal:** bij restaurants en cafés kun je filteren op *Alleen halal*. Elke plek krijgt een halal-label.
- **To-do's:** voeg plekken toe aan je lijst en vink ze af als je ze gedaan hebt.
- **Planning per dag:** stel je reisdatums in, zet uitjes op een dag en tijd, en bekijk een dag op de kaart.
- **Geschiedenis:** elke plek bewaart al je reizen ernaartoe. Ga je terug, dan zie je precies wat je de vorige keer hebt gedaan.
- **Kaart:** zoekresultaten en dagplanningen zie je ook op een kaart.
- **Back-up:** download je gegevens of zet ze terug, bijvoorbeeld op een nieuwe telefoon.

## Waar komt de informatie vandaan?

| Bron | Wat | Nodig |
|---|---|---|
| [OpenStreetMap](https://www.openstreetmap.org) (Nominatim + Overpass) | Plekken, adressen, openingstijden, keuken, halal-label (`diet:halal`) | Niets, gratis |
| [Wikipedia](https://nl.wikipedia.org) / Wikidata | Beschrijvingen en foto's van bekende plekken en bestemmingen | Niets, gratis |
| [Google Places](https://developers.google.com/maps/documentation/javascript/place) | ★-scores, aantal reviews, de nieuwste reviews, foto's, prijsniveau, of er alcohol geschonken wordt | Eigen API-sleutel (zie hieronder) |

Zonder Google-sleutel zie je dus geen sterren of reviews in de app zelf. Elke plek heeft wel knoppen naar **Google Maps** en **Tripadvisor**, waar je de reviews kunt lezen.

**Over halal:** in OpenStreetMap zijn veel halal zaken nog niet gelabeld. Krijg je weinig resultaten, gebruik dan de bron *Google ★*. Die zoekt op "halal restaurants in …". Of gebruik de knop *Halal check* bij een restaurant. Check bij twijfel altijd ter plekke of de zaak een certificaat heeft.

## Online zetten (GitHub Pages)

1. Ga in deze repo naar **Settings → Pages**.
2. Kies bij *Source* **Deploy from a branch**, daarna branch **main** en map **/ (root)**, en klik **Save**.
3. Na een minuutje staat de app op **https://jrdraf2000-byte.github.io/vakantie-planner/**

## Op je telefoon installeren

- **iPhone (Safari):** open de link, tik op het deel-icoon en kies **Zet op beginscherm**.
- **Android (Chrome):** open de link, tik op ⋮ en kies **App installeren** of **Toevoegen aan startscherm**.

Je reizen worden op je telefoon bewaard. Maak via ⚙︎ af en toe een back-up.

## Google-reviews aanzetten (optioneel)

1. Ga naar [console.cloud.google.com](https://console.cloud.google.com) en maak een project aan.
2. Koppel een betaalaccount. Google geeft elke maand gratis gebruik. Voor persoonlijk vakantiegebruik blijf je daar meestal ruim binnen. Je kunt ook een budgetwaarschuwing instellen.
3. Zet bij **APIs & Services → Library** de volgende twee aan: **Maps JavaScript API** en **Places API (New)**.
4. Maak bij **APIs & Services → Credentials** een **API key** aan.
5. **Beperk de sleutel** (belangrijk!):
   - *Application restrictions:* **Websites**, met `https://jrdraf2000-byte.github.io/*`
   - *API restrictions:* alleen de twee API's hierboven
6. Open de app, tik op ⚙︎, plak de sleutel en tik op **Opslaan**. Kies daarna bij Ontdekken de bron **Google ★**.

De sleutel wordt alleen op je eigen apparaat bewaard en staat niet in deze repo.

## Techniek

Gewone HTML, CSS en JavaScript, zonder build-stap. Kaarten met [Leaflet](https://leafletjs.com) en OpenStreetMap-tegels. De app werkt ook offline: je to-do's en planning blijven zichtbaar, alleen zoeken heeft internet nodig.

```
index.html            app-pagina
css/style.css         opmaak
js/app.js             schermen en logica
js/api.js             live databronnen (OSM, Wikipedia, Google)
sw.js                 offline-ondersteuning
manifest.webmanifest  installeerbaar als app
```

Lokaal testen: `python3 -m http.server` in deze map, en daarna `http://localhost:8000` openen.
