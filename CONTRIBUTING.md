# Contributing & AI Development Guidelines — OpenHeatPumps Logs Analyzer (v0.24.0)

Dit document bevat de architectuurregels, het gedeelde dataprotocol en de ontwikkelafspraken voor **`openheatpumps-logs-analyzer`** (`openheatpumps.nl`). Zowel menselijke bijdragers als AI-code-assistenten (Cursor, Windsurf, Claude Code, etc.) moeten deze regels strikt volgen.

---

## 1. Ecosysteem & Rolverdeling

1. **Leading Project (`OpenQuatt/OpenQuatt`):** De open-source ESPHome-firmware voor de Heatpump Controller Q-edition.
2. **Eerstelijns Zelfhulp (`openheatpumps-logs-analyzer` — publiek):** Analyseert `.oqdebug.json` logs en screenshots in B1-Nederlands met behulp van Google Gemini en de actuele OpenQuatt-documentatie.
3. **Tweedelijns Intelligentie (`openheatpumps-newsfeed` — privé):** Ontvangt geanonimiseerde events van deze worker, bundelt dossiers en informeert het kernteam in Discord.

---

## 2. Onschendbare Architectuurregels ("Niet Slopen")

Bij nieuwe features of bugfixes mogen onderstaande bestaande onderdelen **nooit** worden overschreven, ingekort of verwijderd:

* **BYOK & Privacy (rontend/index.html & ackend/backend_index.js):**
  * yokProvider (openai | gemini) en yokApiKey worden uitsluitend meegestuurd naar WORKER_URL (https://api.openheatpumps.nl) en **nooit** naar /share of NEWSFEED_SERVICE.
  * Bij een ingevulde BYOK-sleutel gebruikt de backend die sleutel direct zonder terug te vallen op de gedeelde server-key.
* **Gecontroleerde 5-modellen rotatie (ackend/backend_index.js):**
  * Gebruik exact één ronde langs de 5 modellen (`gemini-3.8-flash`, `gemini-3.6-flash`, `gemini-3-flash-preview`, `gemini-3.1-flash-lite`, `gemini-3.5-flash-lite`).
  * **Geen** oneindige `while`-lussen (voorkomt Cloudflare subrequest-limieten).
  * **Geen** kunstmatige `AbortSignal.timeout` (grote logs + afbeeldingen mogen rustig afronden).
  * Breek bij HTTP `400` direct af (`break`); schakel bij `429` of `503` na `800 ms` door naar het volgende model.
* **Multimodale afbeeldingen (`frontend/index.html` & `backend/backend_index.js`):**
  * Afbeeldingen worden in de browser verkleind naar JPEG en meegestuurd met pure base64 (`dataUrl.split(',')[1]`, **nooit** extra indexering zoals `[1][1]`).
  * Strip `inlineData` altijd naar `{ text: "[Afbeelding bijgevoegd door gebruiker]" }` in `stripAfbeeldingenVoorOpslag` vóór verzending naar `NEWSFEED_SERVICE`.
* **Logcompressie met kolomnamen (`bereidLogVoorAi` in `backend/backend_index.js`):**
  * Vertaal `.oqdebug.json` sample-arrays altijd naar `{ t: tijd, waarden: { kolomNaam: waarde } }` en laat de losse `columns`-array weg uit de AI-payload, zodat Gemini nooit kan mistellen op indexnummers.
* **Quick-scan logboek UI (`frontend/index.html`):**
  * Toon bij laden 3 vaste basisinzichten uit de logs en wissel pas tijdens de AI-analyse (elke `4,2s`) willekeurig door de inzichten, inclusief live model- en pogingweergave (`---MODEL_TRY---`).

---

## 3. Gedeeld Dataprotocol (`NEWSFEED_SERVICE` & `PUBLIC_SHARE_KV`)

Deze worker communiceert met `openheatpumps-newsfeed` via twee vaste koppelingen. Wijzig deze JSON-structuur nooit zonder gelijktijdige aanpassing in `openheatpumps-newsfeed`:

### A. Service Binding (`POST https://internal/event`)
Verstuurd via `stuurNaarPrivateFeed(payload)` na elke `startanalyse`, `vervolgvraag` of handmatige `share`:
* `type`: `"startanalyse"` | `"vervolgvraag"` | `"share"`
* `installId`: Unieke sessie-/installatie-sleutel voor dossierkoppeling
* `shareId`: Optioneel 8-karakter ID wanneer een publieke link is aangemaakt
* `userProfile`: `{ woning_type, afgiftesysteem, cv_ketel, thermostaat }`
* `logData`: Gecomprimeerde logmetingen en metadata (zonder base64-afbeeldingen)
* `messages`: Volledige chatgeschiedenis (`[{ role: "user"|"model", parts: [{ text }] }]`, waarbij afbeeldingen zijn vervangen door tekstplaceholders)
* `laatsteVraag`: De actuele gebruikersvraag
* `aiAntwoord`: Het volledige Gemini-antwoord (of foutmelding)
* `apiAttempts`: Array met `{ model, status }` voor diagnose in het testdossier

### B. Gedeelde KV (`LOGS_KV` / `PUBLIC_SHARE_KV`)
* **Key:** `share:<shareId>` (8 tekens, TTL 7 dagen)
* **Value (JSON):** `{ userProfile, logData, messages, aiAntwoord }`

---

## 4. Werkwijze voor AI-Assistenten & Bijdragers

1. **Plan eerst, codeer daarna:** Geef bij grotere wijzigingen eerst een kort plan van aanpak in het Nederlands voordat je bestanden wijzigt.
2. **Chirurgische wijzigingen:** Pas uitsluitend de bestanden en functies aan die direct nodig zijn voor de gevraagde taak. Herschrijf nooit volledige bestanden zonder noodzaak.
3. **Bot-commits respecteren:** De GitHub Action `update-docs.yml` pusht dagelijks om `00:17 UTC` naar `main`. Gebruik lokaal altijd `git pull --rebase origin main` vóór een `git push`.
