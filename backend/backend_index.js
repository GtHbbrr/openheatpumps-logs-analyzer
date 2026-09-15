export default {
  // 1. HANDEL AUTOMATISCHE CRON-TRIGGERS AF (Elke nacht om 03:00 uur)
  async scheduled(event, env, ctx) {
    ctx.waitUntil(this.voerIngestieUit(env, null));
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

    const urlObj = new URL(request.url);

    // ENDPOINT 1: VECTORISEER-ENDPOINT VANUIT DE FRONTEND [1.5]
    if (request.method === "POST" && urlObj.pathname === "/ingest") {
      try {
        const body = await request.json();
        const { customUrls } = body;
        
        if (!customUrls || customUrls.length === 0) {
          return new Response(JSON.stringify({ status: "error", diagnose: "Geen URL's meegegeven om te vectoriseren." }), { headers: corsHeaders });
        }

        const resultaatTxt = await this.voerIngestieUit(env, customUrls);
        return new Response(JSON.stringify({ status: "success", diagnose: resultaatTxt }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      } catch (err) {
        return new Response(JSON.stringify({ status: "error", diagnose: `🚨 INGESTIE FOUT: ${err.message}` }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }
    }

    // ENDPOINT 2: HAAL DE LIJST MET GEVECTORISEERDE URL'S OP [1]
    if (request.method === "GET" && urlObj.pathname === "/sources") {
      try {
        let uniekeBronnen = [
          "openquatt.github.io/OpenQuatt/problemen-oplossen.html",
          "OpenQuatt SKILL Expert-Matrix"
        ];

        if (env.VECTOR_INDEX) {
          // GECORRIGEERD: Veilig de IDs ophalen volgens de Cloudflare Vectorize standaarden [1]
          const overzicht = await env.VECTOR_INDEX.list({ count: 100 });
          const vectorIds = overzicht.vectorIds || (overzicht.keys ? overzicht.keys.map(k => k.id) : []);
          
          if (vectorIds && vectorIds.length > 0) {
            // Pak maximaal de eerste 20 om netwerkdruk te voorkomen [1]
            const detailData = await env.VECTOR_INDEX.getByIds(vectorIds.slice(0, 20));
            if (detailData && detailData.length > 0) {
              const gescrapteUrls = detailData
                .filter(v => v && v.metadata && v.metadata.source)
                .map(v => v.metadata.source);
              uniekeBronnen = [...new Set([...uniekeBronnen, ...gescrapteUrls])];
            }
          }
        }

        return new Response(JSON.stringify({ status: "success", bronnen: uniekeBronnen }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      } catch (err) {
        // FALLBACK: Als Cloudflare list() weigert, sturen we alsnog de basisbronnen mee zodat de UI nooit blijft hangen [1]
        const basisFallback = [
          "openquatt.github.io/OpenQuatt/problemen-oplossen.html",
          "OpenQuatt SKILL Expert-Matrix"
        ];
        return new Response(JSON.stringify({ status: "success", bronnen: basisFallback, waarschuwing: err.message }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }
    }

    // STANDAARD GET FALLBACK: Voor de handmatige cron-test aanroep
    if (request.method === "GET") {
      try {
        const resultaatTxt = await this.voerIngestieUit(env, null);
        return new Response(JSON.stringify({ status: "success", melding: resultaatTxt }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      } catch (err) {
        return new Response(JSON.stringify({ status: "error", fout: err.message }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }
    }
    // HANDEL HIERONDER DE NORMALE CHAT EN DIAGNOSE AF (POST)
    try {
      const body = await request.json();
      const { userProfile, logData, messages } = body;

      if (!env.GEMINI_API_KEY) {
        return new Response(JSON.stringify({ status: "error", diagnose: "🚨 CONFIGURATIEFOUT: GEMINI_API_KEY ontbreekt." }), { headers: corsHeaders });
      }

      let actueleVraag = "Analyseer dit bestand.";
      if (messages && messages.length > 0) {
        const laatsteBericht = messages[messages.length - 1];
        if (laatsteBericht && laatsteBericht.parts && laatsteBericht.parts.text) {
          actueleVraag = laatsteBericht.parts.text;
        }
      }

      let dynamischeKennisContext = "";

      if (env.VECTOR_INDEX && env.AI) {
        try {
          const embeddingResponse = await env.AI.run("@cf/baai/bge-base-en-v1.5", { text: [actueleVraag] });
          const queryVector = embeddingResponse.data;
          const vectorMatches = await env.VECTOR_INDEX.query(queryVector, { topK: 3, returnMetadata: true });
          dynamischeKennisContext = vectorMatches.matches.map(match => `[Geverifieerde Richtlijn]: ${match.metadata.text}`).join("\n");
        } catch (ragErr) {
          console.error("Vectorize Query Error:", ragErr.message);
        }
      }

      const systemInstruction = `
        Je bent de 'OpenHeatPumps AI Assistent'. Je analyseert .oqdebug JSON logbestanden van OpenQuatt warmtepomp-controllers.
        
        STRIKTE GEBRUIKERSCONTEXT (NEGEER DIT NIET!):
        * Woningtype: ${userProfile?.woning_type || "Onbekend"}
        * Afgiftesysteem: ${userProfile?.afgiftesysteem || "Onbekend"}
        * Aanwezige CV-ketel: ${userProfile?.cv_ketel || "GEEN KETEL AANWEZIG"}
        * Thermostaat: ${userProfile?.thermostaat || "Onbekend"}
        
        STRIKTE RAG INSTRUCTIE:
        Hieronder staat live kennis uit de handleidingen en de 'Power House' software-matrix. Dit is de absolute waarheid.
        OpenQuatt werkt VERMOGENSGESTUURD op basis van huisverlies (phouseHouse) en de actuele vraag (phouseReq). Er is GEEN sprake van een klassieke stooklijn of vast aanvoerdoel (supply target)!
        
        DYNAMISCH GEPROMPTE KENNIS UIT DATABASE:
        ${dynamischeKennisContext || "Geen specifieke documentatie-matches gevonden voor deze vraag."}

        ANALYSEVOLGORDE VOOR EERSTE RUN:
        1. WARMTEVRAAG: Binnentemperatuur vs setpoint.
        2. STATUS: In Standby is 0-flow normaal.
      `;
      let contents = [];
      if (!messages || messages.length === 0) {
        const initieelBericht = `LOGDATA:\n${JSON.stringify(logData)}`;
        contents.push({ role: "user", parts: [{ text: systemInstruction + "\n\n" + initieelBericht }] });
      } else {
        contents = JSON.parse(JSON.stringify(messages));
        const oorspronkelijkeTekst = contents[contents.length - 1].parts.text;
        contents[contents.length - 1].parts.text = systemInstruction + "\n\nVolgens de chat-geschiedenis loopt het hieronder door. Beantwoord nu de specifieke gebruikersvraag:\n" + oorspronkelijkeTekst;
      }

      const beschikbareModellen = ["gemini-3.5-flash", "gemini-3.6-flash", "gemini-3.7-flash", "gemini-3.8-flash"];
      let gekozenIndex = Math.floor(Math.random() * beschikbareModellen.length);
      let primairModel = beschikbareModellen[gekozenIndex];
      let reserveModel = undefined;

      let geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${primairModel}:generateContent`;
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
        
        geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${reserveModel}:generateContent`;
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

      if (geminiJson && geminiJson.candidates && geminiJson.candidates[0] && geminiJson.candidates[0].content && geminiJson.candidates[0].content.parts && geminiJson.candidates[0].content.parts[0] && geminiJson.candidates[0].content.parts[0].text) {
        pureAiText = geminiJson.candidates[0].content.parts[0].text;
      } else if (geminiJson && geminiJson.error) {
        statusType = "error";
        pureAiText = `🚨 GOOGLE API FOUT: ${geminiJson.error.message}`;
      }

      // Stuur de complete prompt-matrix (contents) mee terug voor de openheid! [1.5]
      return new Response(JSON.stringify({ 
        status: statusType,
        model: gebruiktModel,
        diagnose: pureAiText,
        verzondenPrompt: contents
      }), { headers: corsHeaders });

    } catch (error) {
      return new Response(JSON.stringify({ status: "error", model: "Crash-pijp", diagnose: `🚨 SYSTEMISCHE CRASH: ${error.message}` }), { headers: corsHeaders });
    }
  },

  // 3. DE GEAUTOMATISEERDE INGESTIE ENGINE (NU UNIVERSEEL EN INTERACTIEF) [1.5]
  async voerIngestieUit(env, customUrls) {
    if (!env.VECTOR_INDEX || !env.AI) {
      throw new Error("Cloudflare AI of Vectorize binding ontbreekt.");
    }

    let targets = [];
    let isHandmatig = false;

    if (customUrls && customUrls.length > 0) {
      targets = customUrls;
      isHandmatig = true;
    } else {
      targets = ["openquatt.github.io/OpenQuatt/problemen-oplossen.html"];
    }

    const alineas = [];

    for (const url of targets) {
      try {
        const res = await fetch(url, { headers: { "User-Agent": "OpenHeatPumps-RAG-Engine" } });
        const html = await res.text();
        const rauweSecties = html
          .split(/<p>|\n/g)
          .map(t => t.replace(/<[^>]*>/g, '').trim())
          .filter(t => t.length > 60 && !t.includes("javascript") && !t.includes("css"));
        rauweSecties.forEach(txt => alineas.push({ bron: url, tekst: txt }));
      } catch (err) {
        console.error(`Fout bij scrapen van ${url}: ${err.message}`);
      }
    }

    if (!isHandmatig) {
      const expertSecties = [
        "OpenQuatt logboeken gebruiken een speciale deltamix encoding (device-psram-delta-json-v1). Waarden in de samples zijn geen absolute totalen, maar wijzigingen ten opzichte van de startstatus (t=0). De analyzer moet een lopende status bijhouden per kolom.",
        "De warmtepomp werkt via de Power House-strategie. Dit is vermogensgestuurd op basis van huisverlies (phouseHouse) en interne vraag (phouseReq). Er is GEEN vaste aanvoertemperatuur (supply target) zoals bij klassieke stooklijnen. Als de pomp minder kW levert dan de thermostaat vraagt, regelt de Cicero dat autonoom in omdat phouseHouse leidend is.",
        "Als de warmtepomp snel stopt (kort cyclen), vergelijk dan het gevraagde vermogen (strategyRequestedPower) met de laagste fysieke stand van de compressor (pmin in lowLoadDynamicThresholds). Levert de pomp op zijn laagste stand al te veel warmte bij zacht weer? Dan stopt de actuator logischerwijs via de off-drempel.",
        "De start en herstart van de warmtepomp wordt bepaald door de warmte-intentie (Heat Intent). Zodra de binnentemperatuur zakt onder het setpoint minus de comfort-band (standaard 0,1 graden), schiet de vraag via het fast_floor_w_ mechanisme direct omhoog naar het minimale startvermogen om een gezonde run te starten.",
        "Het compressor-niveau (hp1Compressor) is the stand die via Modbus-register 1999 naar de buitenunit wordt gestuurd. De gemeten frequentie (hp1Freq) is what de buitenunit daadwerkelijk doet. Er is geen vaste 48 Hz minimumlimiet in de code; de laagste stand van het modelanker is altijd 20 Hz."
      ];
      expertSecties.forEach(txt => alineas.push({ bron: "OpenQuatt SKILL Expert-Matrix", tekst: txt }));
    }

    const cloudflarePayload = [];

    for (let i = 0; i < alineas.length; i++) {
      const item = alineas[i];
      try {
        const embeddingResponse = await env.AI.run("@cf/baai/bge-base-en-v1.5", { text: [item.tekst] });
        const vectorValues = embeddingResponse.data;

        if (vectorValues && vectorValues.length === 768) {
          const uniekeId = `custom_doc_${Date.now()}_${i}`;
          cloudflarePayload.push({
            id: uniekeId,
            values: vectorValues,
            metadata: { source: item.bron, text: item.tekst }
          });
        }
      } catch (e) {
        console.error(`Sectie ${i} vector-fout: ${e.message}`);
      }
    }

    if (cloudflarePayload.length > 0) {
      await env.VECTOR_INDEX.insert(cloudflarePayload);
      return `Succesvol ${cloudflarePayload.length} nieuwe documentatie-secties gevectoriseerd en permanent opgeslagen in Cloudflare Vectorize!`;
    }
    return "Geen geschikte alineas gevonden om te importeren.";
  }
};
