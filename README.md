# OpenHeatPumps Logs Analyzer (`openheatpumps.nl`) — v0.25.0

Publieke eerstelijns AI-diagnosetool en zelfhulpschil voor **[OpenQuatt](https://github.com)**-gebruikers. Warmtepompbezitters kunnen hiermee hun `.oqdebug.json` logbestanden en screenshots van instellingen of grafieken direct laten analyseren in begrijpelijk Nederlands, gekoppeld aan de actuele OpenQuatt-documentatie.

## Architectuur & Onderdelen

* **Frontend (`frontend/index.html`):**
  * **Systeemprofiel (localStorage):** Keuze voor woningtype, afgiftesysteem, aanwezige cv-ketel en thermostaat voor contextbewuste diagnoses. Wordt automatisch lokaal bewaard (oq_user_profile_v1) en gedeeld tussen de hoofdsite en het zijpaneel.
  * **BYOK (Bring Your Own Key):** Ondersteuning voor een eigen prepaid API-sleutel van **OpenAI (gpt-4o)** of **Google Gemini**, lokaal opgeslagen in de browser en nooit opgeslagen op de server.
  * **AI-zijpaneel (?embed=1):** Compacte embed-modus voor integratie naast de live OpenQuatt-interface, inclusief ⚙️ Profiel- en 🔑 Eigen API-key-knop in de topbalk.
  * **Logboek koppelen:** Ondersteunt het koppelen van een volledige log-map, een los `.oqdebug.json` bestand (via upload of drag-and-drop) of plakken vanaf het klembord.
  * **Quick-scan logboek:** Toont direct na het laden 3 willekeurige basisinzichten uit de logs en wisselt tijdens de AI-analyse rustig door de meetpunten (4,2s interval) met live weergave van het actieve Gemini-model en pogingnummer.
  * **Multimodale bijlagen:** Ondersteunt het uploaden of plakken (`Ctrl+V`) van screenshots en foto's (zoals OpenQuatt-instellingen, bedrading of thermostaat). Afbeeldingen worden in de browser verkleind naar JPEG (`maxBreedte: 1200px`) en als pure base64 (`inlineData`) meegestuurd bij zowel de startanalyse als vervolgvragen.
  * **Deelbare links (`?id=<shareId>`):** Genereert een publieke deellink (7 dagen geldig) om een analyse en gesprek eenvoudig te delen in bijvoorbeeld Discord of op Tweakers.

* **Backend Worker (`backend/backend_index.js`):**
  * **Slimme logcompressie met kolomnamen (`bereidLogVoorAi`):** Filtert technische ruisvelden weg (`uptimeMs`, `freeHeap`, etc.), behoudt alle statuswisselingen en storingen, en vertaalt indexnummers direct naar leesbare `"kolomnaam": waarde`-paren om telfouten bij AI-modellen uit te sluiten.
  * **Gecontroleerde 5-modellen rotatie:** Verdeelt aanvragen binnen de Gemini free tier over één volledige ronde van 5 modellen (`gemini-3.8-flash`, `gemini-3.6-flash`, `gemini-3-flash-preview`, `gemini-3.1-flash-lite`, `gemini-3.5-flash-lite`). Bij een `400 Bad Request` breekt de rotatie direct af; bij `429` of `503` schakelt de worker na 800 ms automatisch door naar het volgende model.
  * **RAG-documentatie:** Combineert de logdata en afbeeldingen met de actuele `openquatt_docs_snapshot.txt`.
  * **Koppeling met tweedelijns newsfeed:** Stuurt elke afgeronde startanalyse, vervolgvraag en gedeelde link via de Cloudflare Service Binding (`NEWSFEED_SERVICE` -> `https://internal/event`) naar `openheatpumps-newsfeed` (zonder zware base64-afbeeldingen mee te sturen naar het archief).

## Cloudflare Bindings & Secrets

* `LOGS_KV` (`PUBLIC_SHARE_KV`): Slaat gedeelde analyses op onder `share:<shareId>` met een TTL van 7 dagen.
* `NEWSFEED_SERVICE`: Service Binding naar de privé `openheatpumps-newsfeed` worker.
* `GEMINI_API_KEY`: API-sleutel voor Google AI Studio / Gemini.

## Lokaal ontwikkelen & Deployen

1. Zorg dat de Wrangler CLI geïnstalleerd is (`npm install`).
2. Test de backend lokaal vanuit de map `backend`:
   ```bash
   npx wrangler dev
   ```
3. Wijzigingen op `main` worden automatisch uitgerold naar Cloudflare Pages / Workers.
