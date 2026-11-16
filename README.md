# OpenHeatPumps Logs Analyzer 🚀

Welkom bij **OpenHeatPumps.nl**! Dit is een onafhankelijke hulpkit voor bezitters van slimme warmtepomp-systemen zoals de **OpenQuatt**.

Complexe databestanden (`.oqdebug.json`) die door de controller worden aangemaakt, worden door onze website omgezet in begrijpelijk Nederlandstalige diagnoses via een lichte frontend en een Cloudflare Workers-backend met Google Gemini-integratie en dagelijks gesynchroniseerde documentatie.

---

## 🛠 Hoe werkt de website nu? (v0.23.2+)

1. **Frontend:** Sleep je `.oqdebug.json` bestand naar het scherm, plak het vanaf je klembord of gebruik **"Koppel Log-map"**.
2. **Backend & AI:** Cloudflare Workers verdeelt verzoeken slim over Google Gemini-modellen, ondersteund door dagelijks ververste documentatie en een RAG-geheugen.
3. **Deelbare links:** Genereer met één klik een unieke diagnose-link die **7 dagen** geldig blijft.

---

## 🗺 Roadmap

* **Fase 1 & 2 (Live in v0.23.2+):** `.oqdebug.json` parsing, AI-diagnose, woningprofielen meesturen en tijdelijke deelbare links via Cloudflare KV.
* **Fase 3 t/m 5 (Toekomst):** Verdieping van *Power House*- en *Heat Intent*-regels, historische trendvergelijkingen en anonieme installatie-benchmarks.

---

## 🔒 Privacy & Veiligheid

* **AI-verwerking:** Bestanden worden tijdelijk naar de Google Gemini API gestuurd voor analyse.
* **Geen accounts:** Er wordt geen persoonlijke informatie zoals namen of e-mailadressen gevraagd.
* **Deelbare links:** Analysegegevens worden enkel opgeslagen na een bewuste klik op **"Deel analyse"** en worden na **7 dagen** automatisch gewist uit Cloudflare KV.
* **Analytics:** Maakt gebruik van een eigen, cookievrije **Umami Analytics**-instantie.

---

## 💻 Meehelpen?

Heb je ideeën of wil je bijdragen aan de backend? Open gerust een Issue of Pull Request op GitHub!



## 💻 Meehelpen?

Dit project is gemaakt voor en door warmtepomp-bezitters die van duidelijke taal houden. Heb je ideeën om de website nog simpeler te maken of wil je meebouwen aan de cloud-motor? Open dan een Issue of Pull Request op GitHub!
