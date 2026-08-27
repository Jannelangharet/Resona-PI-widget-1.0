# Resona PI widget 1.0

Första version för **Resona AB**: projektoberoende lägenhetsstatistik och ljus BTA från StreamBIM, utan Power BI i drift.

## Widget-URL

https://jannelangharet.github.io/Resona-PI-widget-1.0/

Lägg URL:en som widget i StreamBIM. Domänen måste vara tillåten och widgeten aktiverad i varje projekt enligt [StreamBIMs integrationsanvisningar](https://github.com/streambim/streambim-widget-api). Att öppna URL:en fristående ger ingen åtkomst till projektdata.

## Funktioner

- Antal ROK-objektrader, lägenhetsarea, medelarea och ljus BTA.
- Lägenhetsmix, trapphusfördelning och LBTA per plan.
- Filter för våningsplan och trapphus, sökbar objektlista, lokal CSV-export och navigering till objekt i live-läge.
- Datakontroll för saknad area, återkommande GUID och valfria förväntade objektantal.
- Anpassningsbara egenskaper för area, plan, trapphus och areaenhet.

## Datakoppling

SDK:t ansluter till `window.parent`. `getProjectId()` och `getBuildingId()` läses vid varje hämtning. Inga projekt-ID:n, byggnads-ID:n, lösenord eller tokens är hårdkodade. StreamBIM gör autentiserade anrop via `makeApiRequest` i den befintliga användarsessionen.

Två sökningar görs: `Space` eller `Spatial zone`, där **Long Name innehåller ROK** respektive **LBTA**. Alla exporterade sidor hämtas från samma sök-ID. Projektbyte, upprepade sidor, ogiltiga svar och ofullständiga kända totaler ger fel i stället för missvisande nyckeltal. Hämtningen omfattar aktuell byggnad i projektet, alla plan, utan koppling till kamerans läge eller aktivt sökfilter. En synlig uppdatering måste göras efter modelländringar; widgeten är inte en kontinuerlig modellprenumeration.

| Nyckeltal     | Definition                                                                                   |
| ------------- | -------------------------------------------------------------------------------------------- |
| Lägenheter    | Antal exporterade ROK-objektrader, motsvarande Power BI:s `#LGH` (COUNT), inte DISTINCTCOUNT |
| Lägenhetsarea | Summa giltiga `Dimensions~Area` för ROK                                                      |
| Medelarea     | ROK-area / antal ROK-rader med giltig area                                                   |
| Ljus BTA      | Summa giltiga `Dimensions~Area` för LBTA                                                     |

Numeriska areor antas vara m² som i underlaget; det kan ändras till mm². Saknade, noll, negativa eller ogiltiga areor blir **inte noll**. Delsummor markeras. Även trapphusfiltret påverkar LBTA; utrymmen utan trapphus kan då falla bort.

Lägenhetsarea är inte hela BOA-måttet i PBIX (det måttet inkluderar också LOFT). LBTA är inte total BTA. MBTA, LOFT, LOA, parkering och projektspecifikt normalplan ingår inte i v1. Ingen ekonomisk kalkyl eller kontraktsuppgift har kopierats.

## Verifiering och begränsningar

Beräkningar har jämförts med den lokala PBIX-filen. Den har 308 ROK-rader men 303 unika GUID och 59 LBTA-rader men 56 unika GUID. Den öppna StreamBIM-sökningen visade också **59 LBTA-utrymmen**, inte det föreslagna kontrollvärdet 50. Återkommande GUID behålls och flaggas, eftersom GUID ensamt inte säkert skiljer modeller åt. Kontrollera modellurvalet innan beslutsanvändning.

Riktiga PBIX-referensdata har testats lokalt. Den fullständiga iframe-kopplingen måste slutverifieras genom att widget-URL:en öppnas som godkänd widget i StreamBIM. API-kontraktet är baserat på SDK, StreamBIM-klientens implementation och Power Query i PBIX. Sökresultatets 59 LBTA har kontrollerats i den inloggade projektvyn; det är inte ett påstående om att widgetens liveanrop redan har körts där.

## Integritet

Inga projektdata medföljer publiceringen. HAR, PBIX, exporter, cookies och tokens läggs inte i Git. Referensimport läser JSON lokalt i webbläsaren, utan uppladdning. Ingen lokal lagring av projektdata, ingen telemetri och inget eget backendkonto används. GitHub Pages serverar bara statisk kod. Separat Sites-visning är privat och är inte avsedd som iframe-URL.

## Utveckling

Node 22.13 eller senare:

```sh
npm ci
npm test
npx tsc --noEmit
npm run build:widget
npm run dev
```

`npm run build:widget` skapar statiska filer i `widget-dist/`, med relativa resurssökvägar för valfri hosting. `npm run build` bygger Sites-versionen. Samma React-komponent och beräkningskod används i båda. CI testar och publicerar `widget-dist` till GitHub Pages.

För privat jämförelse från PBIX (kräver endast lokalt `pip install pbixray`):

```sh
python scripts/extract_reference.py INPUT.pbix work/reference.json
```

Öppna sedan referensfilen i widgeten. Lokal utveckling erbjuder också knappen **Visa data från din PBIX-fil**. Den dev-endpointen tillåter bara loopback och finns inte i produktionsbygget. Referensläget använder `BIP_Namn~Beskrivning` i stället för Long Name eftersom Long Name saknas i den sparade PBIX-tabellen. Testet mot privat data hoppas över i CI när filen saknas.
