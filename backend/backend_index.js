export default {
  // 1. HANDEL AUTOMATISCHE CRON-TRIGGERS AF (Elke nacht om 03:00 uur)
  async scheduled(event, env, ctx) {
    ctx.waitUntil(this.voerIngestieUit(env));
  },

  // 2. HANDEL HTTP-VERKEER AF
  async fetch(request, env) {
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    // CHECK OF HET EEN "GET" VERZOEK IS (VOORKOM JSON PARSE CRASHES BIJ CURL)
    if (request.method === "GET") {
      try {
        const resultaatTxt = await this.voerIngestieUit(env);
        return new Response(JSON.stringify({ status: "success", melding: resultaatTxt }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      } catch (err) {
        return new Response(JSON.stringify({ status: "error", fout: err.message }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }
    }

    // HANDEL "POST" VERZOEKEN AF VOOR DE DIAGNOSE EN CHAT
    try {
      const body = await request.json();
      const { userProfile, logData, messages } = body;

      if (!env.GEMINI_API_KEY) {
        return new Response(JSON.stringify({ diagnose: "🚨 CONFIGURATIEFOUT: GEMINI_API_KEY ontbreekt." }), { headers: corsHeaders });
      }

      let dynamischeKennisContext = "";

      // GECORRIGEERD: Veilige array-uitlezing voor de gebruikersvraag om de text-crash te voorkomen
      if (messages && messages.length > 0 && env.VECTOR_INDEX && env.AI) {
        const laatsteBericht = messages[messages.length - 1];
        if (laatsteBericht && laatsteBericht.parts && laatsteBericht.parts.length > 0) {
          const gebruikersVraag = laatsteBericht.parts[0].text;

          try {
            // Bereken de vector lokaal binnen Cloudflare AI (768 dimensies)
            const embeddingResponse = await env.AI.run("@cf/baai/bge-base-en-v1.5", {
              text: [gebruikersVraag]
            });
            const queryVector = embeddingResponse.data;

            // Doorzoek de Cloudflare Vectorize-index
            const vectorMatches = await env.VECTOR_INDEX.query(queryVector, { topK: 2, returnMetadata: true });
            
            dynamischeKennisContext = vectorMatches.matches
              .map(match => `[Bron: OpenQuatt Richtlijn]: ${match.metadata.text}`)
              .join("\n");
          } catch (ragErr) {
            console.error("Vectorize Query Error:", ragErr.message);
          }
        }
      }

      const systemInstruction = `
        Je bent de 'OpenHeatPumps AI Assistent'. Je analyseert een volledig .oqdebug JSON logbestand van een warmtepomp-controller en beantwoordt vragen.
        
        STRIKTE RAG INSTRUCTIE:
        Hieronder wordt dynamisch opgehaalde kennis uit de handleidingen meegegeven. Je MOET dit als absolute waarheid beschouwen.
        Als de bron stelt dat iets NIET kan (zoals handmatige pompregeling), blijf dan strikt feitelijk en verzin geen Home Assistant knoppen.

        DYNAMISCH OPGEHAALDE OPENQUATT KENNIS (RAG):
        ${dynamischeKennisContext || "Geen specifieke documentatie-matches gevonden voor deze vraag."}

        ANALYSEVOLGORDE:
        1. WARMTEVRAAG CONTROLEREN: Binnentemperatuur vs setpoint.
        2. STATUS CONTROLEREN: In 'Standby' is een nul-flow normaal.
      `;

      let contents = [];
      if (!messages || messages.length === 0) {
        const initieelBericht = `PROFIEL: ${JSON.stringify(userProfile)}\n\nLOGDATA:\n${JSON.stringify(logData)}`;
        contents.push({ role: "user", parts: [{ text: systemInstruction + "\n\n" + initieelBericht }] });
      } else {
        contents = messages;
        const pureVraag = contents[contents.length - 1].parts[0].text;
        contents[contents.length - 1].parts[0].text = systemInstruction + "\n\n" + pureVraag;
      }

      // UPGRADE: We stappen direct over naar het gloednieuwe gemini-3.5-flash model uit jouw dashboard!
      let geminiUrl = "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent";
      let geminiResponse = await fetch(geminiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY },
        body: JSON.stringify({ contents: contents })
      });

      let responseText = await geminiResponse.text();
      let geminiJson = JSON.parse(responseText);

      // AUTOMATISCHE FAILOVER: Als 3.5-flash vol zit of de quota is bereikt, schakelen we direct door naar 3.8-flash
      if (geminiJson && (geminiJson.error?.code === 503 || geminiJson.error?.code === 429 || geminiJson.error?.message?.includes("quota") || geminiJson.error?.message?.includes("high demand"))) {
        console.warn("⚠️ Quota of drukte bereikt op Gemini 3.5. Schakelt nu direct over naar Gemini 3.8-flash...");      
        geminiUrl = "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent";
        geminiResponse = await fetch(geminiUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY },
          body: JSON.stringify({ contents: contents })
        });
        responseText = await geminiResponse.text();
        geminiJson = JSON.parse(responseText);
      }

      // GECORRIGEERD: Veilige JSON-uitlezing van de AI-tekst zonder syntax-fouten
      let aiText = "Geen resultaat gegenereerd.";
      if (geminiJson && geminiJson.candidates && geminiJson.candidates[0] && geminiJson.candidates[0].content && geminiJson.candidates[0].content.parts && geminiJson.candidates[0].content.parts[0]) {
        aiText = geminiJson.candidates[0].content.parts[0].text;
      } else if (geminiJson && geminiJson.error) {
        aiText = `🚨 GOOGLE API FOUT: ${geminiJson.error.message}`;
      }

      return new Response(JSON.stringify({ diagnose: aiText }), { headers: corsHeaders });

    } catch (error) {
      return new Response(JSON.stringify({ diagnose: `🚨 SYSTEMISCHE CRASH: ${error.message}` }), { headers: corsHeaders });
    }
  },

  // 3. DE GEAUTOMATISEERDE RECHTTREEKSE INGESTIE-MOTOR (NU MET SKILL.MD EXPERT KENNIS)
  async voerIngestieUit(env) {
    if (!env.VECTOR_INDEX || !env.AI) {
      throw new Error("Cloudflare AI of Vectorize binding ontbreekt in deze omgeving.");
    }

    // BRON 1: Haal eerst de gewone problemen-oplossen pagina op van internet
    const url = "https://openquatt.github.io/OpenQuatt/problemen-oplossen.html";
    const response = await fetch(url);
    const html = await response.text();

    const alineas = html
      .split("<p>")
      .map(p => p.split("</p>")[0].replace(/<[^>]*>/g, '').trim())
      .filter(text => text.length > 50 && !text.includes("javascript") && !text.includes("css"));

    // BRON 2: GECORRIGEERD - WE VOEGEN DE HARDEN EXPERT-REGELS UIT SKILL.MD RECHTTREEKS TOE AAN DE PAYLOAD!
    const expertSecties = [
      "OpenQuatt logboeken gebruiken een speciale deltamix encoding (device-psram-delta-json-v1). Waarden in de samples zijn geen absolute totalen, maar wijzigingen ten opzichte van de startstatus (t=0). De analyzer moet een lopende status bijhouden per kolom.",
      "De warmtepomp werkt via de Power House-strategie. Dit is vermogensgestuurd op basis van huisverlies (phouseHouse) en interne vraag (phouseReq). Er is GEEN vaste aanvoertemperatuur (supply target) zoals bij klassieke stooklijnen.",
      "Als de warmtepomp snel stopt (kort cyclen), vergelijk dan het gevraagde vermogen (strategyRequestedPower) met de laagste fysieke stand van de compressor (pmin in lowLoadDynamicThresholds). Levert de pomp op zijn laagste stand al te veel warmte bij zacht weer? Dan stopt de actuator logischerwijs via de off-drempel.",
      "De start en herstart van de warmtepomp wordt bepaald door de warmte-intentie (Heat Intent). Zodra de binnentemperatuur zakt onder het setpoint minus de comfort-band (standaard 0,1 graden), schiet de vraag via het fast_floor_w_ mechanisme direct omhoog naar het minimale startvermogen om een gezonde run te starten.",
      "Het compressor-niveau (hp1Compressor) is de stand die via Modbus-register 1999 naar de buitenunit wordt gestuurd. De gemeten frequentie (hp1Freq) is wat de buitenunit daadwerkelijk doet. Er is geen vaste 48 Hz minimumlimiet in de code; de laagste stand van het modelanker is altijd 20 Hz."
    ];

    // Voeg de expert-secties samen met de gewone alineas
    expertSecties.forEach(txt => alineas.push(txt));

    const cloudflarePayload = [];

    for (let i = 0; i < alineas.length; i++) {
      const tekstSectie = alineas[i];

      try {
        const embeddingResponse = await env.AI.run("@cf/baai/bge-base-en-v1.5", {
          text: [tekstSectie]
        });
        const vectorValues = embeddingResponse.data;

        if (vectorValues && vectorValues.length === 768) {
          cloudflarePayload.push({
            id: `expert_doc_${i}`,
            values: vectorValues,
            metadata: {
              source: i >= alineas.length - expertSecties.length ? "OpenQuatt SKILL Expert-Matrix" : "OpenQuatt Live Documentatie",
              text: tekstSectie
            }
          });
        }
      } catch (e) {
        console.error(`Sectie ${i} kon niet worden omgezet: ${e.message}`);
      }
    }

    if (cloudflarePayload.length > 0) {
      await env.VECTOR_INDEX.insert(cloudflarePayload);
      return `Succesvol ${cloudflarePayload.length} documentatie- en expert-secties gevectoriseerd en opgeslagen!`;
    }

    return "Geen geschikte alineas gevonden om te importeren.";
  }
  
};
