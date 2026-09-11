# OpenHeatPumps Logs Analyzer 🚀

De Agile MVP voor **openheatpumps.nl**. Dit onafhankelijke platform biedt geautomatiseerde, diepgaande data-analyses en live diagnoses voor open-source warmtepomp-controllers (zoals OpenQuatt en Quatt CiC). 

De applicatie draait volledig serverless op **Cloudflare Pages & Workers**, maakt gebruik van **Cloudflare D1** voor flexibele, anonieme opslag van systeemprofielen, en zet de nieuwste **Google Gemini API** in via een waterdichte HTTP REST-header authenticatie.

---

## 🛠️ Huidige MVP Architectuur

Het platform is opgebouwd volgens de principes van een Minimum Viable Product (MVP):

*   **`frontend/index.html`**: De single-page webapp gestyled met Tailwind CSS. Maakt gebruik van de moderne HTML5 *File System Access API* om met één klik de lokale Mac/PC log-map te scannen op de meest recente `.oqdebug.json`-bestanden. Bevat tevens een interactieve context-bewuste chatomgeving voor live vervolggesprekken met de AI.
*   **`backend/backend_index.js`**: De Cloudflare Worker die fungeert als een beveiligde API-gateway. Vangt de logbestanden op, filtert en comprimeert kritieke parameters om payload-overschrijdingen te voorkomen, en communiceert asynchroon met de Google AI Gateway via de stabiele `v1beta` `x-goog-api-key` header-structuur.
*   **`schema.sql`**: Toekomstbestendig SQL-schema voor Cloudflare D1. Slaat de handmatige woningkenmerken op in gestructureerde kolommen en dumpt de veranderlijke log-tijdlijnen als een flexibele JSON tekst-blob.

---

## 🚀 Cloudflare & API Studio Installatiegids

Volg deze stappen om de MVP lokaal of in je eigen Cloudflare-omgeving te draaien:

### 1. Database initialiseren (D1)
1. Maak een D1 database aan via het Cloudflare Dashboard of de CLI:
   ```bash
   wrangler d1 create openquatt-db
   ```
2. Open de D1 Console en voer het database-schema uit via de inhoud van `schema.sql`.

### 2. Backend Configureren (Workers)
1. Maak een nieuwe Worker aan genaamd `openheatpumps-backend`.
2. Koppel de D1-database via de **Bindings** instellingen in het dashboard onder de variabele-naam `D1_DB`.
3. Genereer een gratis API-sleutel op [://google.com](https://://google.com/). Let op: voor de nieuwste `AQ.`-sleutels is de header-authenticatie vereist die standaard in deze code is ingebouwd.
4. Voeg deze sleutel toe aan de Worker **Environment Variables** als een gecodeerd geheim (Secret) onder de naam: `GEMINI_API_KEY`.
5. Pas de database-ID aan in je lokale `wrangler.toml`.

### 3. Frontend Live Zetten (Pages)
1. Koppel je GitHub-repository aan Cloudflare Pages.
2. Stel de **Root Directory** in op `frontend`.
3. Zorg dat het *Build command* volledig leeg is en de *Build output directory* op `/` staat.
4. Kopieer de live URL van je Worker en plak deze onderaan in `index.html` bij de variabele `WORKER_URL`. Push de wijziging via GitHub Desktop.
