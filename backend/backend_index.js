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

    // HANDEL "POST" VERZOEKEN AF (DIAGNOSE & CHAT)
    try {
      const body = await request.json();
      const { userProfile, logData, messages } = body;

      if (!env.GEMINI_API_KEY) {
        return new Response(JSON.stringify({ status: "error", diagnose: "🚨 CONFIGURATIEFOUT: GEMINI_API_KEY ontbreekt." }), { headers: corsHeaders });
      }

      // A. BEPAAL DYNAMISCH DE RELEVANTE VRAAG (EERSTE RUN OF VERVOLGVRAAG)
      let actueleVraag = "Analyseer dit bestand.";
      if (messages && messages.length > 0) {
        const laatsteBericht = messages[messages.length - 1];
        if (laatsteBericht && laatsteBericht.parts && laatsteBericht.parts.text) {
          actueleVraag = laatsteBericht.parts.text;
        }
      }

      let dynamischeKennisContext = "";

      // B. GECORRIGEERD: DOORZOEK DE DATABASE BIJ *ELK* VERZOEK (DUS OOK BIJ CHAT VRAGEN!)
      if (env.VECTOR_INDEX && env.AI) {
        try {
          const embeddingResponse = await env.AI.run("@cf/baai/bge-base-en-v1.5", {
            text: [actueleVraag]
          });
          const queryVector = embeddingResponse.data;

          const vectorMatches = await env.VECTOR_INDEX.query(queryVector, { topK: 3, returnMetadata: true });
          
          dynamischeKennisContext = vectorMatches.matches
            .map(match => `[Geverifieerde Richtlijn]: ${match.metadata.text}`)
            .join("\n");
        } catch (ragErr) {
          console.error("Vectorize Query Error:", ragErr.message);
        }
      }

      // C. GECORRIGEERD: PROFIEL EN INSTRUCTIES WORDEN HIER ENKELDRAADS EN DWINGEND OPGEBOUWD
      const systemInstruction = `
        Je bent de 'OpenHeatPumps AI Assistent'. Je analyseert .oqdebug JSON logbestanden van OpenQuatt warmtepomp-controllers.
        
        STRIKTE GEBRUIKERSCONTEXT (NEGEER DIT NIET!):
        * Woningtype: ${userProfile?.woning_type || "Onbekend"}
        * Afgiftesysteem: ${userProfile?.afgiftesysteem || "Onbekend"}
        * Aanwezige CV-ketel: ${userProfile?.cv_ketel || "GEEN KETEL AANWEZIG"}
        * Thermostaat: ${userProfile?.thermostaat || "Onbekend"}
        
        STRIKTE RAG INSTRUCTIE:
        Hieronder staat live kennis uit de handleidingen en de 'Power House' software-matrix. Dit is de absolute waarheid.
        OpenQuatt werkt VERMOGENSGESTUURD op basis van huisverlies (phouseHouse) en de actuele vraag (phouseReq). Er is GEEN sprake van een klassieke stooklijn of vast aanvoerdoel (supply target)! Als de pomp bijv. 2,4 kW stookt terwijl de warmtevraag 4 kW is, komt dit omdat het berekende huisverlies (phouseHouse) op dat moment aangeeft dat 2,4 kW voldoende is om de comfort-band te bewaken (Power House comfort-band wetten).
        
        DYNAMISCH GEPROMPTE KENNIS UIT DATABASE:
        ${dynamischeKennisContext || "Geen specifieke documentatie-matches gevonden voor deze vraag. Gebruik de algemene OpenQuatt wetten."}

        ANALYSEVOLGORDE VOOR EERSTE RUN:
        1. WARMTEVRAAG: Binnentemperatuur vs setpoint.
        2. STATUS: In Standby is 0-flow normaal.
      `;
      // D. BOUW DE CONVERSATIE OP VOOR GOOGLE GEMINI (ZONDER PROFIEL-VERLIES)
      let contents = [];
      if (!messages || messages.length === 0) {
        // Eerste run: stuur profiel + logboek
        const initieelBericht = `LOGDATA:\n${JSON.stringify(logData)}`;
        contents.push({ role: "user", parts: [{ text: systemInstruction + "\n\n" + initieelBericht }] });
      } else {
        // Vervolgrun: we schonken de geschiedenis op en injecteren de verse systemInstruction dwingend in het laatste bericht
        contents = JSON.parse(JSON.stringify(messages)); // Diepe kopie om front-end niet te breken
        const oorspronkelijkeTekst = contents[contents.length - 1].parts.text;
        contents[contents.length - 1].parts.text = systemInstruction + "\n\nVolgends chat-geschiedenis loopt hieronder door. Beantwoord nu de specifieke gebruikersvraag:\n" + oorspronkelijkeTekst;
      }

      // E. MODEL-ROTATIE EN FAILOVER MOTOR
      const beschikbareModellen = ["gemini-3.5-flash", "gemini-3.6-flash", "gemini-3.7-flash", "gemini-3.8-flash"];
      let gekozenIndex = Math.floor(Math.random() * beschikbareModellen.length);
      let primairModel = beschikbareModellen[gekozenIndex];
      let reserveModel = undefined;

      let geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/{primairModel}:generateContent`;
      let geminiResponse = await fetch(geminiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY },
        body: JSON.stringify({ contents: contents })
      });

      let responseText = await geminiResponse.text();
      let geminiJson = JSON.parse(responseText);

      if (geminiJson && (geminiJson.error?.code === 503 || geminiJson.error?.code === 429 || geminiJson.error?.message?.includes("quota") || geminiJson.error?.message?.includes("high demand"))) {
        const reserveModellen = beschikbareModellen.filter(m => m !== primairModel);
        reserveModel = reserveModellen[Math.floor(Math.random() * reserveModellen.length)];
        
        geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/{reserveModel}:generateContent`;
        geminiResponse = await fetch(geminiUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY },
          body: JSON.stringify({ contents: contents })
        });
        responseText = await geminiResponse.text();
        geminiJson = JSON.parse(responseText);
      }

      let gebruiktModel = typeof reserveModel !== 'undefined' ? reserveModel : primairModel;
      let statusType = "success";
      let pureAiText = "Geen resultaat gegenereerd.";

      if (geminiJson && geminiJson.candidates && geminiJson.candidates?.content?.parts && geminiJson.candidates.content.parts?.text) {
        pureAiText = geminiJson.candidates.content.parts.text;
      } else if (geminiJson && geminiJson.error) {
        statusType = "error";
        pureAiText = `🚨 GOOGLE API FOUT: ${geminiJson.error.message}`;
      }

      return new Response(JSON.stringify({ 
        status: statusType,
        model: gebruiktModel,
        diagnose: pureAiText 
      }), { headers: corsHeaders });

    } catch (error) {
      return new Response(JSON.stringify({ status: "error", model: "Crash-pijp", diagnose: `🚨 SYSTEMISCHE CRASH: ${error.message}` }), { headers: corsHeaders });
    }
  },

  // 3. DE GEAUTOMATISEERDE RECHTTREEKSE INGESTIE-MOTOR (GEERD OP LOKALE EMBEDDINGS)
  async voerIngestieUit(env) {
    if (!env.VECTOR_INDEX || !env.AI) {
      throw new Error("Cloudflare AI of Vectorize binding ontbreekt.");
    }

    const url = "https://github.io";
    const response = await fetch(url);
    const html = await response.text();

    const alineas = html
      .split("<p>")
      .map(p => p.split("</p>").replace(/<[^>]*>/g, '').trim())
      .filter(text => text.length > 50 && !text.includes("javascript") && !text.includes("css"));

    const expertSecties = [
      "OpenQuatt logboeken gebruiken een speciale deltamix encoding (device-psram-delta-json-v1). Waarden in de samples zijn geen absolute totalen, maar wijzigingen ten opzichte van de startstatus (t=0). De analyzer moet een lopende status bijhouden per kolom.",
      "De warmtepomp werkt via de Power House-strategie. Dit is vermogensgestuurd op basis van huisverlies (phouseHouse) en interne vraag (phouseReq). Er is GEEN vaste aanvoertemperatuur (supply target) zoals bij klassieke stooklijnen. Als de pomp minder kW levert dan de thermostaat vraagt, regelt de Cicero dat autonoom in omdat phouseHouse leidend is.",
      "Als de warmtepomp snel stopt (kort cyclen), vergelijk dan het gevraagde vermogen (strategyRequestedPower) met de laagste fysieke stand van de compressor (pmin in lowLoadDynamicThresholds). Levert de pomp op zijn laagste stand al te veel warmte bij zacht weer? Dan stopt de actuator logischerwijs via de off-drempel.",
      "De start en herstart van de warmtepomp wordt bepaald door de warmte-intentie (Heat Intent). Zodra de binnentemperatuur zakt onder het setpoint minus de comfort-band (standaard 0,1 graden), schiet de vraag via het fast_floor_w_ mechanisme direct omhoog naar het minimale startvermogen om een gezonde run te starten.",
      "Het compressor-niveau (hp1Compressor) is de stand die via Modbus-register 1999 naar de buitenunit wordt gestuurd. De gemeten frequentie (hp1Freq) is what de buitenunit daadwerkelijk doet. Er is geen vaste 48 Hz minimumlimiet in de code; de laagste stand van het modelanker is always 20 Hz."
    ];

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
        console.error(`Sectie ${i} fout: ${e.message}`);
      }
    }

    if (cloudflarePayload.length > 0) {
      await env.VECTOR_INDEX.insert(cloudflarePayload);
      return `Succesvol ${cloudflarePayload.length} documentatie- en expert-secties gevectoriseerd en opgeslagen!`;
    }
    return "Geen geschikte alineas gevonden.";
  }
};
