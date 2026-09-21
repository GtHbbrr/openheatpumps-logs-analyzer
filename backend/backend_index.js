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

        // ENDPOINT 1: VECTORISEER-ENDPOINT & VERBORGEN EASTER EGG REBOOT (BUGFIXED)
    if (request.method === "POST" && urlObj.pathname === "/ingest") {
      try {
        const body = await request.json();
        let { customUrls } = body;
        
        if (!customUrls || customUrls.length === 0) {
          return new Response(JSON.stringify({ status: "error", diagnose: "Geen URL's of commando's meegegeven." }), { headers: corsHeaders });
        }

        // BUGFIX: Zorg dat we altijd met een schone string werken voor de commando-check
        // Als de frontend een array stuurt (bijv. ["delete all vectors"]), pakken we het eerste element.
        const inputString = Array.isArray(customUrls) ? customUrls[0] : customUrls;
        const inputCommando = typeof inputString === "string" ? inputString.trim().toLowerCase() : "";

        // FASE 1 VAN DE EASTER EGG: DE VRAAG
        if (inputCommando === "https://delete.all") {
          return new Response(JSON.stringify({ 
            status: "warning", 
            diagnose: "⚠️ ARE YOU SURE? Deze actie wist de gehele index en herstart de basis documentatie. Stuur 'https:yes.com' om te bevestigen of 'https://no.com' om te annuleren." 
          }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }

        // FASE 2 VAN DE EASTER EGG: DE CONFIRMATIE
        if (inputCommando === "https://yes.com" || inputCommando === "https://no.com") {
          if (inputCommando === "https://no.com") {
            return new Response(JSON.stringify({ status: "success", diagnose: "❌ Actie geannuleerd. De database is ongewijzigd gebleven." }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
          }

          // Gebruiker stuurde 'yes': Tijd voor de harde reset!
          if (env.VECTOR_INDEX) {
            const overzicht = await env.VECTOR_INDEX.list({ count: 1000 });
            const vectorIds = overzicht.vectorIds || [];
            
            if (vectorIds.length > 0) {
              await env.VECTOR_INDEX.deleteByIds(vectorIds);
            }

            // Reset naar defaults
            const herstelBericht = await this.voerIngestieUit(env, null);
            
            return new Response(JSON.stringify({ 
              status: "success", 
              diagnose: `💥 DATABASE VOLLEDIG GEWIST (${vectorIds.length} oude vectoren verwijderd). ${herstelBericht}` 
            }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
          }
        }

        // BUGFIX: Zorg dat 'targets' in voerIngestieUit ALTIJD een Array krijgt, 
        // ook als de frontend per ongeluk een pure string stuurde.
        const veiligeUrlArray = Array.isArray(customUrls) ? customUrls : [customUrls];

        const resultaatTxt = await this.voerIngestieUit(env, veiligeUrlArray);
        return new Response(JSON.stringify({ status: "success", diagnose: resultaatTxt }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });

      } catch (err) {
        return new Response(JSON.stringify({ status: "error", diagnose: `🚨 INGESTIE FOUT: ${err.message}` }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }
    }

    // ENDPOINT 2: HAAL DE LIJST MET GEVECTORISEERDE URL'S OP (100% DYNAMISCH)
    if (request.method === "GET" && urlObj.pathname === "/sources") {
      try {
        let uniekeBronnen = [];

        if (env.VECTOR_INDEX) {
          // Haal maximaal 1000 vector-ID's op uit de index (Vectorize limiet per pagina)
          const overzicht = await env.VECTOR_INDEX.list({ count: 1000 });
          const vectorIds = overzicht.vectorIds || [];
          
          if (vectorIds && vectorIds.length > 0) {
            const gedecodeerdeUrls = vectorIds
              .map(id => {
                try {
                  // Pak het gedeelte vóór de chunk-onderbreking (_)
                  const base64Part = id.split("_")[0];
                  // Decodeer dit terug naar de normale URL of bronnaam string
                  return atob(base64Part);
                } catch {
                  return null; // Sla oude of ongeldige ID-structuren veilig over
                }
              })
              .filter(url => url !== null); // Filter mislukte decoderingen eruit

            // Haal alle dubbele bronnen direct weg
            uniekeBronnen = [...new Set(gedecodeerdeUrls)];
          }
        }

        return new Response(JSON.stringify({ status: "success", bronnen: uniekeBronnen }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      } catch (err) {
        // Geen hardcoded fallback meer: bij een fout sturen we een lege lijst met de foutmelding mee
        return new Response(JSON.stringify({ status: "success", bronnen: [], waarschuwing: err.message }), {
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

    // 3. DE GEAUTOMATISEERDE INGESTIE ENGINE (DEFINITIEVE HYBRIDE SCRAIPER) [1.5]
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
      targets = ["https://openquatt.github.io/OpenQuatt/problemen-oplossen.html"];
    }

    const alineas = [];

    // Loop door alle targets heen met browser-vermomming om firewalls te omzeilen [1.5]
    for (const url of targets) {
      try {
        const res = await fetch(url, { 
          headers: { 
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
          } 
        });
        
        if (!res.ok) {
          console.error(`Scrape-fout voor ${url}: Status ${res.status}`);
          continue;
        }

        const binnengekomenHtml = await res.text();
        
        // We splitsen op zowel HTML-tags als regeleinden (\n) om Markdown-pagina's perfect te verwerken [1.5]
        const rauweSecties = binnengekomenHtml
          .split(/<p[^>]*>|<li>|<tr[^>]*>|<td[^>]*>|<h[1-6][^>]*>|\n/gi)
          .map(t => t.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim())
          // Houd korte, krachtige Markdown-lijstjes en expertregels intact (>40 tekens) [1.5]
          .filter(t => t.length > 40 && !t.includes("javascript") && !t.includes("css") && !t.startsWith("import ") && t !== "Open navigatie" && t !== "Kies je route");
          
        rauweSecties.forEach(txt => alineas.push({ bron: url, tekst: txt }));
      } catch (err) {
        console.error(`Netwerkfout bij scrapen van ${url}: ${err.message}`);
      }
    }

    if (!isHandmatig) {
      const expertSecties = [
        "OpenQuatt logboeken gebruiken een speciale deltamix encoding (device-psram-delta-json-v1). Waarden in de samples zijn geen absolute totalen, maar wijzigingen ten opzichte van de startstatus (t=0). De analyzer moet een lopende status bijhouden per kolom.",
        "De warmtepomp werkt via de Power House-strategie. Dit is vermogensgestuurd op basis van huisverlies (phouseHouse) en interne vraag (phouseReq). Er is GEEN vaste aanvoertemperatuur (supply target) zoals bij klassieke stooklijnen. Als de pomp minder kW levert dan de thermostaat vraagt, regelt de Cicero dat autonoom in omdat phouseHouse leidend is.",
        "Als de warmtepomp snel stopt (kort cyclen), vergelijk dan het gevraagde vermogen (strategyRequestedPower) met de laagste fysieke stand van de compressor (pmin in lowLoadDynamicThresholds). Levert de pomp op zijn laagste stand al te veel warmte bij zacht weer? Dan stopt de actuator logischerwijs via de off-drempel.",
        "De start en herstart van de warmtepomp wordt bepaald door de warmte-intentie (Heat Intent). Zodra de binnentemperatuur zakt onder het setpoint minus de comfort-band (standaard 0,1 graden), schiet de vraag via het fast_floor_w_ mechanisme direct omhoog naar het minimale startvermogen om een gezonde run te starten.",
        "Het compressor-niveau (hp1Compressor) is de stand die via Modbus-register 1999 naar de buitenunit wordt gestuurd. De gemeten frequentie (hp1Freq) is what de buitenunit daadwerkelijk doet. Er is geen vaste 48 Hz minimumlimiet in de code; de laagste stand van het modelanker is altijd 20 Hz."
      ];
      expertSecties.forEach(txt => alineas.push({ bron: "OpenQuatt SKILL Expert-Matrix", tekst: txt }));
    }

    const cloudflarePayload = [];

    // Genereer de embeddings en sla ze op in Vectorize [1.5]
    for (let i = 0; i < alineas.length; i++) {
      const item = alineas[i];
      try {
        const embeddingResponse = await env.AI.run("@cf/baai/bge-base-en-v1.5", { text: [item.tekst] });
        const vectorValues = embeddingResponse.data[0];

        if (vectorValues && vectorValues.length === 768) {
          const urlHash = btoa(item.bron).replace(/=/g, "").substring(0, 45); 
          const uniekeId = `${urlHash}_${i}`; // Bijvoorbeeld: aHR0cHM6..._0
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
