export default {
  // ====================================================================
  // 1. AUTOMATISCHE CRON-TRIGGER (Elke nacht om 03:00 uur UTC)
  // ====================================================================
  async scheduled(event, env, ctx) {
    ctx.waitUntil(this.voerIngestieUit(env));
  },

  // ====================================================================
  // 2. GEAUTOMATISEERDE RECHTSTREEKSE INGESTIE-MOTOR (DAGELIJKSE MAP-LOOP)
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
      const treeUrl = `https://github.com{githubRepo}/git/trees/${targetBranch}?recursive=1`;
      const treeResponse = await fetch(treeUrl, {
        headers: { "User-Agent": "OpenHeatPumps-Log-Analyzer-Ingest" }
      });

      if (!treeResponse.ok) {
        throw new Error(`GitHub API boomstructuur niet bereikbaar: Status ${treeResponse.status}`);
      }

      const treeJson = await treeResponse.json();
      
      // AANGESCHERPTE FILTER: Exclueer development-docs, testverslagen en meta-AGENTS.md bestanden
      const markdownBestanden = treeJson.tree.filter(file => 
        file.path.startsWith("docs/") && 
        file.path.endsWith(".md") && 
        file.type === "blob" &&
        !file.path.startsWith("docs/development/") &&
        !file.path.endsWith("AGENTS.md")
      );

      // B. CONTENT FETCH LOOP: Download en chunk elk Markdown-bestand automatisch
      for (const bestand of markdownBestanden) {
        const rawUrl = `https://githubusercontent.com{githubRepo}/${targetBranch}/${bestand.path}`;
        
        try {
          const res = await fetch(rawUrl, {
            headers: { "User-Agent": "OpenHeatPumps-Log-Analyzer-Ingest" }
          });
          
          if (!res.ok) continue;
          const markdownTekst = await res.text();

          // Splits tekst op dubbele regeleinden (paragrafen)
          const secties = markdownTekst
            .split(/\n\s*\n/)
            // REPARATIE: We slopen # en | niet meer! Alleen *, _ en > gaan weg voor loepzuivere tabellen.
            .map(t => t.replace(/[\*\_>]/g, ' ').replace(/\s+/g, ' ').trim()) 
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

    // C. EXPERT SKILLS: Volledig verwijderd uit de database om prompt-vervuiling en 
    // foutieve tabel-matches in Vectorize te voorkomen. Ze staan nu permanent in de systemInstruction!
    
    // D. EMBEDDINGS BEREKENEN & PAYLOAD GENEREREN
    const cloudflarePayload = [];

    for (let i = 0; i < alineas.length; i++) {
      const item = alineas[i];
      try {
        const embeddingResponse = await env.AI.run("@cf/baai/bge-base-en-v1.5", {
          text: [item.tekst]
        });
        
        const vectorValues = embeddingResponse.data[0];

        if (vectorValues && vectorValues.length === 768) {
          // Genereer een stabiele ID op basis van het bestandspad om duplicatie te blokkeren
          const pathHash = btoa(item.bron).replace(/=/g, "").substring(0, 30);
          const uniekeId = `doc_${pathHash}_${i}`;

          cloudflarePayload.push({
            id: uniekeId,
            values: vectorValues,
            metadata: {
              source: `v0.55 Repo: ${item.bron}`,
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
  },

  // ====================================================================
  // 3. HTTP-VERKEER AFHANDELEN (DIAGNOSE & CHAT STREAMING HANDLER)
  // ====================================================================
  async fetch(request, env, ctx) {
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

    try {
      const body = await request.json();
      const { userProfile, logData, messages } = body;

      if (!env.GEMINI_API_KEY) {
        return new Response(JSON.stringify({ status: "error", diagnose: "🚨 CONFIGURATIEFOUT: GEMINI_API_KEY ontbreekt." }), { headers: corsHeaders });
      }

      // ====================================================================
      // A. BEPAAL DYNAMISCH DE RELEVANTE VRAAG (EERSTE RUN OF VERVOLGVRAAG)
      // ====================================================================
      let actueleVraag = "Analyseer dit bestand.";
      let isEersteRun = !messages || messages.length === 0;
      
      if (!isEersteRun) {
        const laatsteBericht = messages[messages.length - 1];
        if (laatsteBericht && laatsteBericht.parts && laatsteBericht.parts[0] && laatsteBericht.parts[0].text) {
          actueleVraag = laatsteBericht.parts[0].text;
        } else if (laatsteBericht && laatsteBericht.parts && laatsteBericht.parts.text) {
          actueleVraag = laatsteBericht.parts.text;
        }
      }

      let dynamischeKennisContext = "";
      let vectorMatches = null;

      // FREE TIER OPTIMALISATIE: Alleen Vectorize doorzoeken bij de ALLEREERSTE run!
      if (isEersteRun && env.VECTOR_INDEX && env.AI) {
        try {
          const embeddingResponse = await env.AI.run("@cf/baai/bge-base-en-v1.5", { text: [actueleVraag] });
          const queryVector = embeddingResponse.data;       
          vectorMatches = await env.VECTOR_INDEX.query(queryVector, { topK: 3, returnMetadata: true });
          
          dynamischeKennisContext = vectorMatches.matches
            .map(match => `[Geverifieerde Richtlijn uit ${match.metadata.source}]: ${match.metadata.text}`)
            .join("\n");
        } catch (ragErr) {
          console.error("Vectorize Query Error:", ragErr.message);
        }
      }

      // INTEGRATIE FIX: De 5 onmisbare regelexpert wetten hardcoded in de systeemprompt verankerd!
      const systemInstruction = `
        Je bent de 'OpenHeatPumps AI Assistent'. Je analyseert .oqdebug JSON logbestanden van OpenQuatt warmtepomp-controllers (Last Stable Version v0.55).
        
        STRIKTE GEBRUIKERSCONTEXT:
        * Woningtype: ${userProfile?.woning_type || "Onbekend"}
        * Afgiftesysteem: ${userProfile?.afgiftesysteem || "Onbekend"}
        * Aanwezige CV-ketel: ${userProfile?.cv_ketel || "GEEN KETEL AANWEZIG"}
        * Thermostaat: ${userProfile?.thermostaat || "Onbekend"}
        
        5 ONMISBARE REGELEXPERT WETTEN VOOR LOG-INTERPRETATIE:
        1. OpenQuatt logboeken gebruiken een speciale deltamix encoding (device-psram-delta-json-v1). Waarden in de samples zijn geen absolute totalen, maar wijzigingen ten opzichte van de startstatus (t=0). Houd een lopende status bij per kolom om de waarden correct te interpreteren.
        2. De warmtepomp werkt via de Power House-strategie. Dit is vermogensgestuurd op basis van huisverlies (phouseHouse) en interne vraag (phouseReq). Er is GEEN vaste aanvoertemperatuur (supply target) of klassieke stooklijn! Als de pomp minder kW levert dan de thermostaat vraagt, regelt de Cicero dat autonoom in omdat phouseHouse leidend is.
        3. Als de warmtepomp snel stopt (kort cyclen / pendelen), vergelijk dan het gevraagde vermogen (strategyRequestedPower) met de laagste fysieke stand van de compressor (pmin in lowLoadDynamicThresholds). Levert de pomp op his laagste stand al te veel warmte bij zacht weer? Dan stopt de actuator via de off-drempel.
        4. De start en herstart van de warmtepomp wordt bepaald door de warmte-intentie (Heat Intent). Zodra de binnentemperatuur zakt onder het setpoint minus de comfort-band (standaard 0,1 graden), schiet de vraag via het fast_floor_w_ mechanisme direct omhoog naar het minimale startvermogen.
        5. Het compressor-niveau (hp1Compressor) is de stand die via Modbus-register 1999 naar de buitenunit wordt gestuurd. De gemeten frequentie (hp1Freq) is what de buitenunit daadwerkelijk doet. De laagste stand van het modelanker is altijd 20 Hz (er is geen vaste 48 Hz minimumlimiet).

        DYNAMISCH GEPROMPTE KENNIS UIT DATABASE:
        ${isEersteRun ? (dynamischeKennisContext || "Gebruik de algemene OpenQuatt v0.55 handleidingen.") : "Gebruik de specifieke geverifieerde richtlijnen die aan het begin van deze chatgeschiedenis zijn meegegeven."}
      `;

      let contents = [];
      if (isEersteRun) {
        const initieelBericht = `GEBRUIKERSVRAAG/KLACHT:\n${actueleVraag}\n\nLOGDATA:\n${JSON.stringify(logData)}`;
        contents.push({ role: "user", parts: [{ text: initieelBericht }] });
      } else {
        contents = JSON.parse(JSON.stringify(messages));
      }

      // MODEL-ROTATIE LOGICA
      const beschikbareModellen = ["gemini-3.8-flash", "gemini-3.6-flash", "gemini-3.1-flash-lite", "gemini-3.5-flash-lite", "gemini-3-flash-preview"];
      let primairModel = beschikbareModellen[Math.floor(Math.random() * beschikbareModellen.length)];

      // REPARATIE: Officiële Gemini Parameter scheiding (Fix van de Cloudflare AI-agent)
      const geminiPayload = {
        systemInstruction: { parts: [{ text: systemInstruction }] },
        contents: contents
      };

      // HTTP STREAM APPARATUUR OPZETTEN
      const { readable, writable } = new TransformStream();
      const writer = writable.getWriter();
      const encoder = new TextEncoder();

      ctx.waitUntil((async () => {
        let gebruiktModel = primairModel;
        try {
          // STAP 1: Duw DIRECT de RAG-context naar buiten over de actieve verbinding (Binnen <500ms!)
          const geselecteerdeDocs = vectorMatches?.matches?.map(match => ({
            source: match.metadata.source,
            text: match.metadata.text
          })) || [];

          await writer.write(encoder.encode(`---CONTEXT_DOCS_START---\n${JSON.stringify(geselecteerdeDocs)}\n---CONTEXT_DOCS_END---\n`));

          // STAP 2: Roep de zware Gemini API run aan
          let geminiUrl = `https://googleapis.com{primairModel}:generateContent?key=${env.GEMINI_API_KEY}`;
          let geminiResponse = await fetch(geminiUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(geminiPayload)
          });

          let responseText = await geminiResponse.text();
          let geminiJson = responseText.trim().startsWith("{") ? JSON.parse(responseText) : null;

          // STAP 3: Failover motor activeren bij free-tier overbelasting (429/503)
          if (!geminiResponse.ok || !geminiJson || geminiJson.error?.code === 429 || geminiJson.error?.code === 503) {
            const reserveModellen = beschikbareModellen.filter(m => m !== primairModel);
            const reserveModel = reserveModellen[Math.floor(Math.random() * reserveModellen.length)];
            gebruiktModel = reserveModel;
            
            geminiUrl = `https://googleapis.com{reserveModel}:generateContent?key=${env.GEMINI_API_KEY}`;
            geminiResponse = await fetch(geminiUrl, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(geminiPayload)
            });
            responseText = await geminiResponse.text();
            geminiJson = responseText.trim().startsWith("{") ? JSON.parse(responseText) : null;
          }

          let pureAiText = geminiJson?.candidates[0]?.content?.parts[0]?.text;
          if (!pureAiText) {
            pureAiText = geminiJson?.error ? `🚨 API FOUT: ${geminiJson.error.message}` : "🚨 GEEN ANTWOORD GEGENERERD.";
          }

          // STAP 4: Schrijf de eindreproductie naar de stream
          const finaleRespons = JSON.stringify({ model: gebruiktModel, diagnose: pureAiText });
          await writer.write(encoder.encode(`---FINAL_RESPONSE---\n${finaleRespons}`));

        } catch (streamErr) {
          console.error("Streaming Fatal Error:", streamErr.message);
          const crashPayload = JSON.stringify({ model: "Crash-pijp", diagnose: `🚨 STREAM CRASH: ${streamErr.message}` });
          await writer.write(encoder.encode(`---FINAL_RESPONSE---\n${crashPayload}`));
        } finally {
          await writer.close();
        }
      })());

      return new Response(readable, { 
        headers: { 
          ...corsHeaders, 
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "no-cache",
          "Connection": "keep-alive"
        } 
      });

    } catch (error) {
      return new Response(JSON.stringify({ status: "error", model: "Crash-pijp", diagnose: `🚨 SYSTEMISCHE CRASH: ${error.message}` }), { headers: corsHeaders });
    }
  }
};
  
