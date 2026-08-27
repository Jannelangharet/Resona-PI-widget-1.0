# Resona PI widget 1.0

Projektoberoende projektinsikt för **Resona AB**, direkt från StreamBIM utan Power BI i drift. Uppdatering **1.2.1**.

## Widget-URL

https://jannelangharet.github.io/Resona-PI-widget-1.0/

Öppna URL:en som godkänd widget i StreamBIM. Domänen måste vara tillåten och widgeten aktiverad i projektet enligt [StreamBIMs integrationsanvisningar](https://github.com/streambim/streambim-widget-api). Fristående öppning ger ingen åtkomst till projektdata.

## KPI-översikt

- Åtta kort: antal lägenheter, medelstorlek, BOA, LOA, total BTA, ljus BTA, BOA+LOA och yteffektivitet.
- Tre ringdiagram: ljus/mörk BTA, BOA+LOA/övrig ljus BTA, samma kvot för ett valbart normalplan.
- Staplade lägenhetstyper per trapphus och jämförande LBTA-/MBTA-staplar per plan.
- Separata objektdetaljer med sökning, kategorival, CSV-export och navigering till objekt.
- Datakontroll, anpassningsbara egenskaper och utfällbar API-konsol.

Resonas logotyp och webbpalett behålls. Systemtypsnitt används; kommersiella fontfiler distribueras inte.

## Beräkningar och urval

| Nyckeltal       | Definition                                                                          |
| --------------- | ----------------------------------------------------------------------------------- |
| Lägenheter      | Antal ROK-objektrader, samma definition i alla kort och staplar som Power BI:s #LGH |
| Medelstorlek    | ROK-area / antal ROK-rader med giltig area                                          |
| BOA             | ROK + LOFT                                                                          |
| LOA             | LOKAL                                                                               |
| Ljus / mörk BTA | LBTA / MBTA                                                                         |
| Total BTA       | LBTA + MBTA                                                                         |
| BOA + LOA       | ROK + LOFT + LOKAL                                                                  |
| Yteffektivitet  | (BOA + LOA) / LBTA × 100                                                            |
| Övrig ljus BTA  | LBTA − (ROK + LOFT + LOKAL)                                                         |

Plan och trapphus avgränsar KPI-kort och jämförelsevärden i ringarna. Diagramval avgränsar **markerat urval**, staplar, objektdetaljer och StreamBIM. Ringarnas nämnare ligger kvar så att en vald sektor inte blir 100 procent. Klick på en geografisk stapel väljer även plan/trapphus. Normalplan är ett separat, uttryckligt jämförelseval med samma trapphusfilter; inget PLAN 11 är hårdkodat. Klick på dess sektor väljer det planet också i huvudfiltret.

Vald flik och objektlistans sidindelning ändrar aldrig modellurvalet. Kategori-, typ- och textfilter i detaljerna behålls mellan flikar och kan rensas i urvalslisten. Alla filter kan återställas tillsammans.

En restarea är en **beräknad differens, inte ett eget modellobjekt**. Klick på ”övrig ljus BTA” visar bakomliggande LBTA-utrymmen och detta anges i urvalslisten. Alla areakategorier överlappar fysiskt och ska inte summeras till en gemensam total.

Egenskapen `Dimensions~Area` antas vara m²; användaren kan ändra egenskap och enhet. Saknade, noll, negativa eller ogiltiga areor blir inte noll: berörda summor och kvoter visas som —. En hämtad kategori utan objekt summerar däremot till noll. Saknade kategorier i äldre referenser förblir okända. Negativa restareor ritas inte som tårtbitar. Parkering och ekonomiska kalkyler ingår inte.

Power BI:s generella BTA-mått söker på ”BTA”; denna version har den uttryckliga definitionen LBTA+MBTA. Projekt med andra BTA-kategorier behöver en utökad kategorimappning. Originalrapportens normalplansrubrik och nämnare var inte konsekventa; widgeten använder ljus BTA som nämnare i båda effektivitetsringarna.

## Datakoppling

SDK:t ansluter till `window.parent`. `getProjectId()` och `getBuildingId()` läses vid hämtning och innan modellsynk. Inga projekt-ID:n, byggnads-ID:n, lösenord eller tokens är hårdkodade.

Fem sökningar görs via den autentiserade föräldrasessionens `makeApiRequest`: **Space eller Spatial zone**, med Long Name innehållande **ROK, LBTA, MBTA, LOFT respektive LOKAL**. Alla exportsidor hämtas från respektive sök-ID. En misslyckad kategori blir inte en tyst nolla. Överlappande kategorinamn, ofullständiga totaler, upprepade sidor och projektbyte ger ett fel. Uppdatera uttryckligen efter modelländringar; detta är inte en kontinuerlig modellprenumeration.

## Filtersynk: åtgärd för försvinnande utrymmen

Den tidigare versionen utelämnade `@kind` från modellfrågan. StreamBIM använder denna regel för att aktivera utrymmesgeometrin. Varje OR-grupp innehåller nu GUID, tillgängliga Long Name- och plan-/trapphusegenskaper samt **@kind = Space eller Spatial zone**. Om exporten saknar typ används två alternativa grupper, aldrig två motstridiga typer i samma AND-grupp.

Innan `applyObjectSearch({rules: [...]}, true)` skickas verifieras **antal rader och GUID-multipliciteter** via samma direkta `makeApiRequest`-sökning/export som datahämtningen. Exporten begränsas till GUID/ID, sorteras uttryckligen på ID och pagineras till komplett resultat. `getViewportState` läser klippplan; kontrollsökningen får samma `Clipping planes`-regel som StreamBIM själv lägger till. Klippningen läses igen före applicering och ändras aldrig av widgeten. Noll, avvikande GUID, ofullständigt svar, ändrad klippning eller projektbyte stoppar appliceringen med synligt fel. Statusen skiljer ”sökning skickad” från verifiering av resultatet före applicering; den påstår inte att en API-kvittens bevisar bestående rendering.

Version 1.2.1 undviker `getObjectInfoForSearch`: den rapporterade felloggen kom från detta försteg med `{code: "unknown", debug: null}`, inte från själva appliceringen. Den granskade StreamBIM-klienten kan tappa det ursprungliga felet i sin interna viewer-sökning och skickar dessutom `sortField=undefined` när sortering utelämnas. Loggen ensam visar inte vilket underliggande fel som inträffade. Den direkta vägen undviker dessa problem och loggar varje HTTP-steg samt tillgänglig serverstatus/feltext; inget filter appliceras om verifieringen misslyckas.

**Tomt widgeturval lämnar föregående modellfilter kvar och visar detta tydligt.** StreamBIM kan stänga scenfiltreringen vid noll träffar, så widgeten skickar inte längre en tomresultatfråga som riskerar att återställa visningen. Urval över 5 000 rader eller utan GUID stoppas också; gränsen matchar klientens utrymmessökning.

Synkningen är på som standard och kan pausas. Ändringar samlas i 250 ms och skickas seriellt, med endast senaste väntande valet kvar. Ett skickat anrop kan inte återkallas. Ingen automatisk kameraflytt eller ändring av klippplan görs. **Visa hela urvalet** zoomar på begäran. Återanvända GUID med samma egenskaper i flera modeller kan inte alltid särskiljas; kontrollera även källmodellerna.

## Verifiering

Lokala beräkningar har jämförts med PBIX: 308 ROK-rader (303 unika GUID), 59 LBTA-rader (56 unika GUID), 14 MBTA-rader, 2 LOFT-rader och 6 LOKAL-rader. De föreslagna 50 LBTA-utrymmena stämmer inte med detta underlag; en tidigare kontroll i StreamBIM visade också 59.

Tester täcker KPI-formler, dataluckor, femkategorihämtning, diagramrendering, utrymmesregler, snabba filterbyten, tomma resultat, felaktiga träffar, dubbletter och projektbyte. Simulerade API-svar och lokal renderkontroll ersätter inte slutkontroll av den nya filtersynkningen i en inloggad StreamBIM-modell. Den äldre datahämtningen har bekräftats fungera av användaren.

## Integritet och API-konsol

Inga projektdata medföljer publiceringen. HAR, PBIX, referensexporter, cookies och tokens läggs inte i Git. Lokal referensimport laddar inte upp filen. Ingen telemetri, beständig lagring av projektdata eller eget backendkonto används.

Konsolen behåller högst 60 anrop i minnet tills sidan laddas om eller loggen rensas. Den visar sökfrågor, status, tid och korta svarssammanfattningar. Känsliga fält och vanliga tokenformat maskeras; fullständiga lyckade objektsvar loggas inte. Projekt-ID, sökvärden och GUID förekommer i frågorna. Dela kopierade loggar med omsorg.

## Utveckling

Node 22.13+ och npm 11.6.2 (samma som CI):

```sh
npm ci
npm test
npx tsc --noEmit
npm run lint
npm run build:widget
npm run dev
```

`build:widget` skapar statiska filer med relativa resurslänkar i `widget-dist/`. GitHub Actions testar och publicerar dem till Pages. `npm run build` bygger den separata Sites-versionen; samma komponenter och beräkningar används.

Privat jämförelse från PBIX (lokalt installerat `pbixray`):

```sh
python scripts/extract_reference.py INPUT.pbix work/reference.json
```

Importera referensen i widgeten eller välj dev-knappen **Visa data från din PBIX-fil**. Den dev-endpointen tillåter bara loopback och finns inte i produktionsbygget. PBIX-referensen använder `BIP_Namn~Beskrivning` när Long Name saknas i den sparade tabellen. Privata jämförelsetester hoppas över i CI när referensfilen saknas.
