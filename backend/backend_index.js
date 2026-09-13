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

      if (messages && messages.length > 0 && env.VECTOR_INDEX && env.AI) {
        const gebruikersVraag = messages[messages.length - 1].parts.text;

        try {
          // Bereken de vector lokaal binnen Cloudflare AI (768 dimensies)
          const embeddingResponse = await env.AI.run("@cf/baai/bge-base-en-v1.5", {
            text: [gebruikersVraag]
          });
          
          // GECORRIGEERD: Cloudflare AI geeft de resultaten terug in data[0]
          const queryVector = embeddingResponse.data[0];

          // Doorzoek de Cloudflare Vectorize-index
          const vectorMatches = await env.VECTOR_INDEX.query(queryVector, { topK: 2, returnMetadata: true });
          
          dynamischeKennisContext = vectorMatches.matches
            .map(match => `[Bron: OpenQuatt Richtlijn]: ${match.metadata.text}`)
            .join("\n");
        } catch (ragErr) {
          console.error("Vectorize Query Error:", ragErr.message);
        }
      }

      const systemInstruction = `
        Je bent de 'OpenHeatPumps AI Assistent'. Je analyseert een volledig .oqdebug JSON logbestand van een warmtepomp-controller en beantwoordt vragen.
        
        STRIKTE RAG INSTRUCTIE:
        Hieronder wordt dynamisch opgehaalde kennis uit de officiële OpenQuatt-handleiningen meegegeven. 
        Je MOET deze informatie als absolute, leidende waarheid beschouwen. Als de bron stelt dat iets NIET kan (zoals handmatige pompregeling), blijf dan strikt feitelijk en verzin geen Home Assistant knoppen of poorten.

        DYNAMISCH OPGEHAALDE OPENQUATT KENNIS (RAG):
        ${dynamischeKennisContext || "Geen specifieke documentatie-matches gevonden voor deze vraag. Baseer je antwoord strikt op de logdata."}

        ANALYSEVOLGORDE VOOR DE EERSTE RUN:
        1. WARMTEVRAAG CONTROLEREN: Binnentemperatuur vs setpoint. Setpoint lager? Dan is rust (Stand-by) normaal.
        2. STATUS CONTROLEREN: In 'Standby' is een nul-flow of lage waterdoorstroming (hp1Flow) het normale, gewenste gedrag.
      `;

      let contents = [];
      if (!messages || messages.length === 0) {
        const initieelBericht = `PROFIEL: ${JSON.stringify(userProfile)}\n\nLOGDATA:\n${JSON.stringify(logData)}`;
        contents.push({ role: "user", parts: [{ text: systemInstruction + "\n\n" + initieelBericht }] });
      } else {
        contents = messages;
        contents.parts.text = systemInstruction + "\n\n" + (contents.parts.text.split("\n\n").slice(1).join("\n\n") || "");
      }

      const geminiUrl = "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent";;
      const geminiResponse = await fetch(geminiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY },
        body: JSON.stringify({ contents: contents })
      });

      const responseText = await geminiResponse.text();
      const geminiJson = JSON.parse(responseText);
      const aiText = geminiJson.candidates?.[0]?.content?.parts?.[0]?.text || "Geen resultaat gegenereerd.";

      return new Response(JSON.stringify({ diagnose: aiText }), { headers: corsHeaders });

    } catch (error) {
      return new Response(JSON.stringify({ diagnose: `🚨 SYSTEMISCHE CRASH: ${error.message}` }), { headers: corsHeaders });
    }
  },

  // 3. DE GEAUTOMATISEERDE RECHTTREEKSE INGESTIE-MOTOR (GEERD OP LOKALE EMBEDDINGS)
  async voerIngestieUit(env) {
    if (!env.VECTOR_INDEX || !env.AI) {
      throw new Error("Cloudflare AI of Vectorize binding ontbreekt in deze omgeving.");
    }

    const url = "https://openquatt.github.io/OpenQuatt/problemen-oplossen.html";
    const response = await fetch(url);
    const html = await response.text();

    // Splits op paragrafen en strip de HTML-tags er netjes van af
    const alineas = html
      .split("<p>")
      .map(p => p.split("</p>")[0].replace(/<[^>]*>/g, '').trim())
      .filter(text => text.length > 50 && !text.includes("javascript") && !text.includes("css"));

    const cloudflarePayload = [];

    for (let i = 0; i < alineas.length; i++) {
      const tekstSectie = alineas[i];

      try {
        // Genereer de wiskundige embedding lokaal via Cloudflare Workers AI
        const embeddingResponse = await env.AI.run("@cf/baai/bge-base-en-v1.5", {
          text: [tekstSectie]
        });
        
        // GECORRIGEERD: Cloudflare Workers AI geeft embeddings terug in de data[0] array matrix
        const vectorValues = embeddingResponse.data[0];

        if (vectorValues && vectorValues.length === 768) {
          cloudflarePayload.push({
            id: `live_doc_${i}`,
            values: vectorValues,
            metadata: {
              source: "OpenQuatt Live Documentatie",
              text: tekstSectie
            }
          });
        }
      } catch (e) {
        console.error(`Sectie ${i} kon niet worden omgezet: ${e.message}`);
      }
    }

    if (cloudflarePayload.length > 0) {
      // Sla de geschoonde vectoren direct op in de Cloudflare Vectorize Index
      await env.VECTOR_INDEX.insert(cloudflarePayload);
      return `Succesvol ${cloudflarePayload.length} documentatie-secties gevectoriseerd en opgeslagen!`;
    }

    return "Geen geschikte alineas gevonden om te importeren.";
  }
};
