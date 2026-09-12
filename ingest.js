import fs from 'fs';

// DE OFFICIËLE OPENQUATT KENNISBLOKKEN (GEGROND OP DE PROBLEMEN-OPLOSSEN PAGINA)
const documentatieBlokken = [
  {
    id: "doc_001",
    section: "Hoofdregel",
    text: "De absolute hoofdregel bij het oplossen van problemen in OpenQuatt is: Eerst kijken welke informatie OpenQuatt gebruikt, pas daarna instellingen aanpassen. Kijk altijd naar de logische hiërarchie van waarden: buitentemperatuur, kamertemperatuur, setpoint, aanvoertemperatuur en flow."
  },
  {
    id: "doc_002",
    section: "Pomp en Flow regeling",
    text: "De Quatt warmtepomp regelt de interne circulatiepomp volledig autonoom via PWM op basis van een gewenste Delta-T (meestal streefdoel 4 Kelvin verschil tussen aanvoer en retour). De API en software is strikt read-only vanwege garantievoorwaarden. Het is via Home Assistant of MQTT onmogelijk om de pompsnelheid handmatig aan te passen."
  },
  {
    id: "doc_003",
    section: "Bypass AVDO instellingen",
    text: "Als OpenQuatt een hoge flow laat zien (>1000 L/h) maar de warmtepomp snel in temperatuur stijgt en gaat pendelen, controleer dan het fysieke bypassventiel (AVDO). Als de AVDO te soepel staat (0,1 of 0,2 bar), stroomt het water direct via de bypass terug de warmtepomp in. Draai de AVDO strakker naar 0,3 of 0,4 bar."
  },
  {
    id: "doc_004",
    section: "Honeywell en OpenTherm",
    text: "De Honeywell Round (T87M1003) thermostaat wordt passief uitgelezen. Wanneer de warmtepomp in rust (Stand-by) staat omdat de kamertemperatuur hoger is dan het setpoint, zal de status 'otThermostatStatusValid' of de modulatie-indicator inactief lijken in de logs. Dit is normaal gedrag."
  },
  {
    id: "doc_005",
    section: "Hardwareprofiel en Quick Start",
    text: "OpenQuatt detecteert automatisch het hardwareprofiel (Single of Duo warmtepomp) bij de eerste opstart. Wijzigingen in de aansturing van de OpenTherm-interface met de CV-ketel worden autonoom door de regelcomputer (CIC) bepaald op basis van de stooklijn."
  }
];

// FUNCTIE OM DE TEKST OM TE ZETTEN IN EEN WISKUNDIGE VECTOR VIA GOOGLE GEMINI API
async function genereerEmbedding(tekst, apiKey) {
  // De schone URL zonder ?key= parameter achteraan [1.5]
  const url = "https://generativelanguage.googleapis.com/v1/models/models/gemini-embedding-2:embedContent";

  const response = await fetch(url, {
    method: "POST",
    headers: { 
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey
    },
    // DE VOLLEDIG GECORRIGEERDE EN VERPLICHTE PAYLOAD-STRUCTUUR VOOR GEMINI-EMBEDDING-2 [1.5]
    body: JSON.stringify({
      model: "models/gemini-embedding-2",
      content: {
        parts: [
          { text: tekst }
        ]
      }
    })
  });
  
  const responseText = await response.text();
  
  if (!responseText || responseText.trim() === "") {
    throw new Error("Google stuurde een volledig lege response terug.");
  }
  
  if (responseText.trim().startsWith("<")) {
    throw new Error(`Google stuurde een HTML-beveiligingspagina terug. Status: ${response.status}`);
  }
  
  const data = JSON.parse(responseText);
  if (data.error) throw new Error(data.error.message);
  
  // Controleer of de wiskundige waarden aanwezig zijn
  if (data.embedding && data.embedding.values) {
    return data.embedding.values;
  } else {
    throw new Error(`Onverwachte JSON-structuur ontvangen van Google: ${responseText}`);
  }
}  

async function main() {
  // Haal de API-sleutel op uit de wrangler.toml of voer hem hier tijdelijk in
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("🚨 FOUT: Start het script met je GEMINI_API_KEY om de vectoren te kunnen berekenen!");
    return;
  }

  console.log("🚀 Starten met het vectoriseren van de OpenQuatt documentatie...");
  
  const cloudflarePayload = [];

  for (const blok of documentatieBlokken) {
    try {
      console.log(` -> Vectoriseren van sectie: [${blok.section}]`);
      const vector = await genereerEmbedding(blok.text, apiKey);
      
      cloudflarePayload.push({
        id: blok.id,
        values: vector,
        metadata: {
          section: blok.section,
          text: blok.text
        }
      });
    } catch (err) {
      console.error(`🚨 FOUT bij ${blok.section}:`, err.message);
    }
  }

  // Schrijf de vectoren weg naar een tijdelijk bestand dat Wrangler kan uploaden
  fs.writeFileSync('vectoren.json', JSON.stringify(cloudflarePayload, null, 2));
  console.log("\n✅ Succes! Alle vectoren zijn berekend en opgeslagen in 'vectoren.json'.");
  console.log("👉 Voer nu het wrangler bulk-upload commando uit om ze in de cloud te schieten!");
}

main();
