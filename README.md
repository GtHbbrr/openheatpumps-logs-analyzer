# OpenHeatPumps Logs Analyzer 🚀

Welkom bij OpenHeatPumps.nl! Dit is een onafhankelijke en gebruiksvriendelijke hulpkit voor bezitters van een slimme warmtepomp (zoals de Quatt). 

Wanneer een warmtepomp niet goed werkt, maakt de computer van de warmtepomp een groot databestand aan (een zogenaamd logbestand). Voor gewone mensen zijn deze bestanden onleesbaar. Deze website lost dat op. Je sleept het bestand simpelweg naar de website, en onze ingebouwde AI-assistent legt je in begrijpelijk Nederlands uit wat er aan de hand is.

---

## 🛠️ Hoe werkt de website nu?

De website bestaat uit twee delen die veilig in de cloud samenwerken:

1.  **De Voorkant (Website):** Een overzichtelijke, webpagina. Met de knop "Koppel Log-map" zoekt de website automatisch het nieuwste logbestand op je computer. Je kunt het bestand er ook gewoon naartoe slepen.
2.  **De Achterkant (De Slimme Motor):** Dit deeltje praat veilig met de kunstmatige intelligentie (AI) van Google Gemini. De motor leest de cijfers uit je logbestand en stuurt de begrijpelijke analyse terug naar jouw scherm. 

Sinds de laatste update heeft de slimme motor een betrouwbaar 'geheugen' gekregen. We hebben de officiële handleidingen van de warmtepomp in dit geheugen opgeslagen. Als jij een vraag stelt over bijvoorbeeld de pompsnelheid, controleert de computer eerst de officiële regels voordat hij antwoord geeft. Hierdoor verzint de AI geen gekke dingen meer en krijg je altijd een betrouwbaar advies.

## 🗺️ OpenQuatt Expert & AI Roadmap (Gegrond op SKILL.md & Ontwikkelaarsvisie)

Om van dit platform een betrouwbare tool te maken, stappen we over op de officiële, gefaseerde architectuur van de OpenQuatt-hoofdontwikkelaar. We gebruiken AI niet als een losse prompt, maar als een slimme laag bovenop harde, lokale feiten.

### 📍 Fase 2.5: Deterministische Delta-Decoder & Web Worker (Huidige Sprint)
*   **Doel:** Stoppen met het blind inlezen van de JSON-matrix. De warmtepomp slaat gegevens op als "wijzigingen" (deltas) in de PSRAM-buffer om ruimte te besparen.
*   **Uitvoering:** We bouwen een 'Format Reader' en 'Normalizer' in JavaScript. Deze rekent eerst lokaal in de browser de complete tijdlijn uit (met een stabiele tijdas). Grote logbestanden draaien we in een *Web Worker* zodat de website van de gebruiker nooit vastloopt tijdens het laden.

### 📍 Fase 3: Lokale 'Episode' Detectie & Cloud Vectorize (RAG Core)
*   **Doel:** De website bouwt eerst zélf een lokaal basisrapport op met harde bewijzen, zónder dat er data naar een AI-service wordt gestuurd.
*   **Uitvoering:** De code zoekt lokaal naar specifieke gebeurtenissen (episodes):
    *   *Compressorcycli:* Start, stop, draaitijd en hoevaak hij start (limiet = 10 starts per 2 uur).
    *   *Stopvensters:* Wat gebeurde er exact 5 tot 15 minuten vóór en na een compressor-stop?
*   **Wiskundig Geheugen:** De Cloudflare Vectorize-database wordt gevuld met de regels van de *Power House-strategie* (huisverlies `phouseHouse`, vraag `phouseReq`, en de `fast_floor_w_` start-intentie).

### 📍 Fase 4: Version-Aware Diagnose & AI-Proxy (Privacy Eerst)
*   **Doel:** De AI mag NOOIT de volledige, ruwe logbestanden te zien krijgen vanwege jouw privacy. Ook moet de AI oordelen op basis van de firmwareversie uit het logboek (bijv. `v0.45.2`), en niet op basis van de allernieuwste code op internet.
*   **Uitvoering:** De website vraagt de gebruiker expliciet om toestemming (Opt-in). Pas na akkoord sturen we een compacte "factsheet" naar onze Cloudflare AI-Proxy:
    *   Alleen de klachttekst van de gebruiker.
    *   De lokaal berekende episodes (bijv. "HP1 stopte om 13:42 vanwege low_flow").
    *   De specifieke code-regels van die exacte firmware-versie.
*   **Gemini 3.5/3.8 Failover:** De API-key blijft veilig achter slot en grendel op de Cloudflare-server staan en lekt nooit naar de browser. Als een model overbelast raakt, schakelt de proxy direct geruisloos over naar de reserve-motor.

### 📍 Fase 5: Het Gestructureerde Expert-Rapport
*   **Doel:** Het eindrapport heeft altijd een vaste, betrouwbare vorm en is geen 'black box' of raadspelletje.
*   **Uitvoering:** De AI deelt het rapport verplicht op in:
    1. Korte conclusie met een betrouwbaarheidsscore (Confidence).
    2. Wat er precies gebeurde en waarom.
    3. Fysiek bewijs uit de opname (timestamps en waarden).
    4. Wat waarschijnlijk wél en wat waarschijnlijk niét de oorzaak is.
    5. Concrete vervolgstappen voor jou of de installateur.
