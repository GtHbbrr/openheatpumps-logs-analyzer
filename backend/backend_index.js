export default {
  // 1. AUTOMATISCHE CRON-TRIGGER (Elke nacht om 03:00 uur UTC)
  async scheduled(event, env, ctx) {
    ctx.waitUntil(this.voerIngestieUit(env));
  },

  // 2. HTTP-VERKEER AFHANDELEN (DIAGNOSE & CHAT)
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
      return new Response(JSON.stringify({ 
        status: "success", 
        melding: "OpenHeatPumps AI Engine Online. Scope: LSV v0.55. Dagelijkse Cron actief." 
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // HANDEL "POST" VERZOEKEN AF
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

      // FREE TIER OPTIMALISATIE: Alleen Vectorize doorzoeken bij de ALLEREERSTE run!
      if (!messages || messages.length === 0) {
        if (env.VECTOR_INDEX && env.AI) {
          try {
            const Response = await env.AI.run("@cf/baai/bge-base-en-v1.5", { text: [actueleVraag] });
            const queryVector = embeddingResponse.data[0]; // GECORRIGEERD naar platte array
            const vectorMatches = await env.VECTOR_INDEX.query(queryVector, { topK: 3, returnMetadata: true });
            
            dynamischeKennisContext = vectorMatches.matches
              .map(match => `[Geverifieerde Richtlijn uit ${match.metadata.source}]: ${match.metadata.text}`)
              .join("\n");
          } catch (ragErr) {
            console.error("Vectorize Query Error:", ragErr.message);
          }
        }
      }

      const systemInstruction = `
        Je bent de 'OpenHeatPumps AI Assistent'. Je analyseert .oqdebug JSON logbestanden van OpenQuatt warmtepomp-controllers (Last Stable Version v0.55).
        
        STRIKTE GEBRUIKERSCONTEXT:
        * Woningtype: ${userProfile?.woning_type || "Onbekend"}
        * Afgiftesysteem: ${userProfile?.afgiftesysteem || "Onbekend"}
        * Aanwezige CV-ketel: ${userProfile?.cv_ketel || "GEEN KETEL AANWEZIG"}
        * Thermostaat: ${userProfile?.thermostaat || "Onbekend"}
        
        STRIKTE RAG INSTRUCTIE:
        OpenQuatt werkt VERMOGENSGESTUURD op basis van huisverlies (phouseHouse) en de actuele vraag (phouseReq). Er is GEEN sprake van een klassieke stooklijn of vast aanvoerdoel!
        
        DYNAMISCH GEPROMPTE KENNIS UIT DATABASE (ALLEEN BIJ RUN 1):
        ${dynamischeKennisContext || "Gebruik de algemene OpenQuatt v0.55 regels."}
      `;

      // FREE TIER OPTIMALISATIE: Voorkom prompt-stapeling bij vervolgvragen (TPM Besparing)
      let contents = [];
      if (!messages || messages.length === 0) {
        const initieelBericht = `LOGDATA:\n${JSON.stringify(logData)}`;
        contents.push({ role: "user", parts: [{ text: systemInstruction + "\n\n" + initieelBericht }] });
      } else {
        contents = JSON.parse(JSON.stringify(messages)); // Schone duplicatie van de reeds gevulde historie
      }

      // MODEL-ROTATIE EN FAILOVER MOTOR
      const beschikbareModellen = ["gemini-3.8-flash", "gemini-3.6-flash", "gemini-3.1-flash-lite", "gemini-2.5-flash"];
      let gekozenIndex = Math.floor(Math.random() * beschikbareModellen.length);
      let primairModel = beschikbareModellen[gekozenIndex];
      let reserveModel = undefined;

      let geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${primairModel}:generateContent`;
      let geminiResponse; let responseText; let geminiJson = null;

      try {
        geminiResponse = await fetch(geminiUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY },
          body: JSON.stringify({ contents: contents })
        });
        responseText = await geminiResponse.text();
        if (responseText.trim().startsWith("{")) { geminiJson = JSON.parse(responseText); }
      } catch (e) { console.warn(`Eerste poging met ${primairModel} mislukt.`); }

      // FAILOVER ACTIVEREN BIJ DRUKTE / QUOTA LIMITS
      if (!geminiResponse || !geminiResponse.ok || !geminiJson || geminiJson.error?.code === 429 || geminiJson.error?.code === 503) {
        const reserveModellen = beschikbareModellen.filter(m => m !== primairModel);
        reserveModel = reserveModellen[Math.floor(Math.random() * reserveModellen.length)];
        geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${reserveModel}:generateContent`;
        
        try {
          geminiResponse = await fetch(geminiUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY },
            body: JSON.stringify({ contents: contents })
          });
          responseText = await geminiResponse.text();
          if (responseText.trim().startsWith("{")) { geminiJson = JSON.parse(responseText); }
        } catch (e) { geminiJson = { error: { message: e.message } }; }
      }

      let gebruiktModel = typeof reserveModel !== 'undefined' ? reserveModel : primairModel;
      let statusType = "success"; let pureAiText = "";

      if (geminiJson && geminiJson.candidates && geminiJson.candidates[0]?.content?.parts[0]?.text) {
        pureAiText = geminiJson.candidates[0].content.parts[0].text;
      } else {
        statusType = "error"; pureAiText = geminiJson?.error ? `🚨 API FOUT: ${geminiJson.error.message}` : "🚨 GEEN OUTPUT GEGENEREERD.";
      }

      return new Response(JSON.stringify({ status: statusType, model: gebruiktModel, diagnose: pureAiText }), { headers: corsHeaders });
    } catch (error) {
      return new Response(JSON.stringify({ status: "error", model: "Crash-pijp", diagnose: `🚨 SYSTEMISCHE CRASH: ${error.message}` }), { headers: corsHeaders });
    }
  },

  // ====================================================================
  // 3. GEAUTOMATISEERDE RECHTTREEKSE INGESTIE-MOTOR (DAGELIJKSE MAP-LOOP)
  // ====================================================================
  async voerIngestieUit(env) {
    if (!env.VECTOR_INDEX || !env.AI) {
      throw new Error("Cloudflare AI of Vectorize binding ontbreekt.");
    }

    const githubRepo = "OpenQuatt/OpenQuatt";
    const targetBranch = "main"; // Gelinkt aan de Last Stable Version (v0.55) distributie
    const alineas = [];

    // A. MAP-LOOP: Vraag de complete mappenstructuur recursief op via de GitHub Trees API
    try {
      const treeUrl = `https://api.github.com/repos/${githubRepo}/git/trees/${targetBranch}?recursive=1`;
      const treeResponse = await fetch(treeUrl, {
        headers: { "User-Agent": "OpenHeatPumps-Log-Analyzer-Ingest" }
      });

      if (!treeResponse.ok) {
        throw new Error(`GitHub API boomstructuur niet bereikbaar: Status ${treeResponse.status}`);
      }

      const treeJson = await treeResponse.json();
      
      // Isoleer alle bestanden die in 'docs/' of submappen staan en eindigen op '.md'
      const markdownBestanden = treeJson.tree.filter(file => 
        file.path.startsWith("docs/") && 
        file.path.endsWith(".md") && 
        file.type === "blob"
      );

      // B. CONTENT FETCH LOOP: Download en chunk elk Markdown-bestand automatisch
      for (const bestand of markdownBestanden) {
        const rawUrl = `https://raw.githubusercontent.com/${githubRepo}/${targetBranch}/${bestand.path}`;
        
        try {
          const res = await fetch(rawUrl, {
            headers: { "User-Agent": "OpenHeatPumps-Log-Analyzer-Ingest" }
          });
          
          if (!res.ok) continue;
          const markdownTekst = await res.text();

          // Splits tekst op dubbele regeleinden (paragrafen)
          const secties = markdownTekst
            .split(/\n\s*\n/)
            .map(t => t.replace(/[\#\*\_>]/g, ' ').replace(/\s+/g, ' ').trim()) // Zuiver Markdown-karakters op
            .filter(t => t.length > 50 && !t.includes("javascript") && !t.includes("css"));

          secties.forEach(txt => alineas.push({ bron: bestand.path, tekst: txt }));
        } catch (fileErr) {
          console.error(`Fout bij downloaden van ${bestand.path}: ${fileErr.message}`);
        }
      }
    } catch (apiErr) {
      console.error(`🚨 Algemene GitHub API- of netwerkfout: ${apiErr.message}`);
      return `Ingestie afgebroken: ${apiErr.message}`;
    }

    // C. EXPERT SKILLS: Voeg de 5 onmisbare wetten voor log-interpretatie toe aan de hoop
    const expertSecties = [
      "OpenQuatt logboeken gebruiken een speciale deltamix encoding (device-psram-delta-json-v1). Waarden in de samples zijn geen absolute totalen, maar wijzigingen ten opzichte van de startstatus (t=0). De analyzer moet een lopende status bijhouden per kolom.",
      "De warmtepomp werkt via de Power House-strategie. Dit is vermogensgestuurd op basis van huisverlies (phouseHouse) en interne vraag (phouseReq). Er is GEEN vaste aanvoertemperatuur (supply target) zoals bij klassieke stooklijnen. Als de pomp minder kW levert dan de thermostaat vraagt, regelt de Cicero dat autonoom in omdat phouseHouse leidend is.",
      "Als de warmtepomp snel stopt (kort cyclen), vergelijk dan het gevraagde vermogen (strategyRequestedPower) met de laagste fysieke stand van de compressor (pmin in lowLoadDynamicThresholds). Levert de pomp op zijn laagste stand al te veel warmte bij zacht weer? Dan stopt de actuator logischerwijs via de off-drempel.",
      "De start en herstart van de warmtepomp wordt bepaald door de warmte-intentie (Heat Intent). Zodra de binnentemperatuur zakt onder het setpoint minus de comfort-band (standaard 0,1 graden), schiet de vraag via het fast_floor_w_ mechanisme direct omhoog naar het minimale startvermogen om een gezonde run te starten.",
      "Het compressor-niveau (hp1Compressor) is de stand die via Modbus-register 1999 naar de buitenunit wordt gestuurd. De gemeten frequentie (hp1Freq) is what de buitenunit daadwerkelijk doet. Er is geen vaste 48 Hz minimumlimiet in de code; de laagste stand van het modelanker is altijd 20 Hz."
    ];
    expertSecties.forEach(txt => alineas.push({ bron: "OpenQuatt SKILL Expert-Matrix", tekst: txt }));

    // D. EMBEDDINGS BEREKENEN & PAYLOAD GENEREREN
    const cloudflarePayload = [];

    for (let i = 0; i < alineas.length; i++) {
      const item = alineas[i];
      try {
        const embeddingResponse = await env.AI.run("@cf/baai/bge-base-en-v1.5", {
          text: [item.tekst]
        });
        
        // REPARATIE: Direct de array uit .data trekken (Voorkomt de .data crash)
        const vectorValues = embeddingResponse.data[0];

        if (vectorValues && vectorValues.length === 768) {
          // Genereer een stabiele ID op basis van het bestandspad om duplicatie te blokkeren
          const pathHash = btoa(item.bron).replace(/=/g, "").substring(0, 30);
          const uniekeId = `doc_${pathHash}_${i}`;

          cloudflarePayload.push({
            id: uniekeId,
            values: vectorValues,
            metadata: {
              source: item.bron.startsWith("docs") ? `v0.55 Repo: ${item.bron}` : item.bron,
              text: item.tekst
            }
          });
        }
      } catch (e) {
        console.error(`Sectie i=${i} embedding-fout: ${e.message}`);
      }
    }

    // E. REPARATIE BULK-UPSERT: Verfris de database zonder duplicate-errors te genereren
    if (cloudflarePayload.length > 0) {
      await env.VECTOR_INDEX.upsert(cloudflarePayload);
      return `Succesvol een geautomatiseerde synchronisatie uitgevoerd. ${cloudflarePayload.length} secties up-to-date gebracht in Vectorize!`;
    }
    return "Geen geschikte documentatie-secties gevonden.";
  }
};
