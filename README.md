# openheatpumps-mvp
De Agile MVP voor **openheatpumps.nl**. Dit platform biedt een 'huisartsen-aanpak' voor open-source warmtepomp-controllers (zoals OpenQuatt). De app draait volledig serverless op Cloudflare Pages & Workers, maakt gebruik van Cloudflare D1 voor flexibele opslag, en zet de Google Gemini API in voor intelligente log-analyses en diagnoses op maat.

## Structuur
- `frontend/`: De Cloudflare Pages code (HTML, Tailwind CSS, JavaScript). Scant de lokale `Downloads`-map via de File System Access API op zoek naar `.oqdebug.json` logbestanden.
- `backend/`: De Cloudflare Worker code (`index.js`). Vangt de logs op, communiceert met Google Gemini en slaat data flexibel op in D1.
- `schema.sql`: Het D1 database-schema.

## Installatie & Cloudflare Setup
1. Clone deze repo naar je computer.
2. Maak een Cloudflare D1 database aan via de Cloudflare CLI (`wrangler d1 create openquatt-db`) of het Cloudflare Dashboard.
3. Importeer het schema: `wrangler d1 execute openquatt-db --file=schema.sql`.
4. Voeg je `GEMINI_API_KEY` toe aan de Worker Secrets in de Cloudflare instellingen.
5. Koppel de `frontend/` map aan Cloudflare Pages via de GitHub-koppeling.
