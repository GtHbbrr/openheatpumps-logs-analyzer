import openquattDocsSnapshot from "./openquatt_docs_snapshot.txt";

var backend_index_default = {
  // ====================================================================
  // 1. AUTOMATISCHE CRON-TRIGGER (Passieve herinnering)
  // ====================================================================
  async scheduled(event, env, ctx) {
    console.log("Dagelijkse cron-prikkel ontvangen. OpenQuatt snapshot draait mee in de actieve build.");
  },

  // ====================================================================
  // 2. HTTP-VERKEER AFHANDELEN (SHARE LINKS, DIAGNOSE & CHAT STREAMING)
  // ====================================================================
  async fetch(request, env, ctx) {
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);

    const stuurNaarPrivateFeed = (payload) => {
      if (!env.NEWSFEED_SERVICE) return;
      ctx.waitUntil(
        env.NEWSFEED_SERVICE.fetch("https://internal/event", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...payload,
            geo: {
              city: request.cf?.city || "Onbekend",
              region: request.cf?.region || "Onbekend",
              country: request.cf?.country || "NL"
            }
          })
        })
      );
    };    

    // ROUTE A: Gedeelde analyse ophalen (GET /share?id=...)
    if (request.method === "GET" && url.pathname === "/share") {
      const shareId = url.searchParams.get("id");
      if (!shareId || !env.LOGS_KV) {
        return new Response(JSON.stringify({ status: "error", melding: "Ongeldig ID of KV niet gekoppeld." }), { status: 400, headers: corsHeaders });
      }
      const opgeslagenData = await env.LOGS_KV.get(`share:${shareId}`);
      if (!opgeslagenData) {
        return new Response(JSON.stringify({ status: "error", melding: "Deze deellink is verlopen (max. 7 dagen) of bestaat niet." }), { status: 404, headers: corsHeaders });
      }
      return new Response(opgeslagenData, { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ROUTE B: Analyse opslaan voor een deelbare link (POST /share)
    if (request.method === "POST" && url.pathname === "/share") {
      try {
        if (!env.LOGS_KV) {
          return new Response(JSON.stringify({ status: "error", melding: "KV storage niet geconfigureerd." }), { status: 500, headers: corsHeaders });
        }
        const payload = await request.json();
        const shareId = crypto.randomUUID().slice(0, 8);
        await env.LOGS_KV.put(`share:${shareId}`, JSON.stringify(payload), { expirationTtl: 604800 });

        stuurNaarPrivateFeed({
          existingShareId: shareId,
          entry: {
            tijdstip: new Date().toISOString(),
            type: "share",
            userProfile: payload.userProfile || {},
            laatsteVraag: "Analyse gedeeld via link",
            aiAntwoord: payload.aiAntwoord || "",
            messages: payload.messages || [],
            logData: payload.logData || null
          }
        });

        
        return new Response(JSON.stringify({ status: "success", id: shareId }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      } catch (err) {
        return new Response(JSON.stringify({ status: "error", melding: err.message }), { status: 500, headers: corsHeaders });
      }
    }

    if (request.method === "GET") {
      return new Response(JSON.stringify({
        status: "success",
        melding: "OpenHeatPumps AI Engine Online. Scope: OpenQuatt Docs Snapshot-Context actief."
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    try {
      const body = await request.json();
      const { userProfile, logData, messages, preferredModel } = body;

      if (!env.GEMINI_API_KEY) {
        return new Response(JSON.stringify({
          status: "error",
          diagnose: "🚨 CONFIGURATIEFOUT: GEMINI_API_KEY ontbreekt."
        }), { headers: corsHeaders });
      }

      let actueleVraag = "Analyseer dit bestand.";
      let isEersteRun = !messages || messages.length <= 1;
      if (Array.isArray(messages) && messages.length > 0) {
        const laatsteBericht = messages[messages.length - 1];
        if (laatsteBericht?.parts?.text) {
          actueleVraag = laatsteBericht.parts.text;
        } else if (laatsteBericht?.parts?.[0]?.text) {
          actueleVraag = laatsteBericht.parts[0].text;
        }
      }

      const dynamischeKennisContext = openquattDocsSnapshot;
      const systemInstruction = `Je bent de 'OpenHeatPumps AI Assistent'.

STRIKTE SYSTEEM- EN HARDWARECONTEXT:
* Deze analyse betreft ALTIJD een Quatt warmtepomp (Hybrid Single of Duo) die lokaal wordt aangestuurd via de open-source OpenQuatt-controller (ESPHome / Q-edition hardware).
* De originele Quatt CiC-controller is ofwel volledig losgekoppeld, ofwel degradeerd tot een passieve Modbus-slave (via poort M2) om uitsluitend telemetrie door te geven aan de Quatt-app.
* OpenQuatt is de ENIGE actieve en leidende regelaar van het complete warmtepompsysteem!
* Geef altijd een korte samenvatting in B1 NL van het .oqdebug JSON logbestand dat is meegezonden. Laat B1 NL onbenoemd.
* Gebruik altijd de timestamps en werkelijke waarden uit het meegezonden .oqdebug JSON logbestand. GEEN fabulaties en gefantaseerde waarden en tijdstippen!
* Configuratieveld installationTopology "single" of "double" geeft aan of deze Quatt warmtepomp een Quatt Single configuratie met 1 ODU, of een Quatt Duo configuratie met 2 ODU's betreft.
* Het logbestand gebruikt 'device-psram-delta-json-v1': de array 'columns' bevat de kolomnamen op index 0..N, 'initial' bevat de startwaarden op t=0, en elke stap in 'samples' bevat [offset_s, [[kolom_index, nieuwe_waarde], ...]] waarbij ongewijzigde kolommen hun vorige waarde behouden.

STRIKTE RAG INSTRUCTIE:
* OpenQuatt werkt naar keuze VERMOGENSGESTUURD op basis van huisverlies (phouseHouse) en de actuele vraag (phouseReq) of op basis van een klassieke stooklijn.
* Kijk bij actuele vragen altijd naar de inhoud van het logbestand en naar de openstaande issues en documentatie die hieronder zijn meegezonden als dynamische kennis context.
* Geef bij technische vragen over registers, instellingen of opties GEEN eigen speculaties, adviezen of zelfbedachte verklaringen als die niet letterlijk in de OpenQuatt-documentatie staan. Vermeld dan uitsluitend wat de documentatie erover zegt.

DYNAMISCH GEPROMPTE KENNIS UIT DATABASE:
<openquatt_docs>
${dynamischeKennisContext}
</openquatt_docs>

--- EINDE DAGELIJKSE CONTEXT ---

LOGDATA:
${JSON.stringify(logData)}

--- EINDE LOGDATA ---

STRIKTE GEBRUIKERSCONTEXT:
* Woningtype: ${userProfile?.woning_type || "Onbekend"}
* Afgiftesysteem: ${userProfile?.afgiftesysteem || "Onbekend"}
* Aanwezige CV-ketel: ${userProfile?.cv_ketel || "GEEN KETEL AANWEZIG"}
* Thermostaat: ${userProfile?.thermostaat || "Onbekend"}`;
      let contents = [];
      if (!messages || messages.length === 0) {
        const initieelBericht = `GEBRUIKERSVRAAG/KLACHT:${actueleVraag}`;
        contents.push({ role: "user", parts: [{ text: initieelBericht }] });
      } else {
        contents = JSON.parse(JSON.stringify(messages));
      }

      // Helper om een array willekeurig te husselen (Fisher-Yates)
      const hussel = (arr) => {
        const kopie = [...arr];
        for (let i = kopie.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [kopie[i], kopie[j]] = [kopie[j], kopie[i]];
        }
        return kopie;
      };

      // Volwaardige Flash-modellen eerst, Lite-modellen als laatste vangnet
      const primaireModellen = hussel(["gemini-3.8-flash", "gemini-3.6-flash", "gemini-3-flash-preview"]);
      const vangnetModellen = hussel(["gemini-3.1-flash-lite", "gemini-3.5-flash-lite"]);
      const geschuddeModellen = [...primaireModellen, ...vangnetModellen];

      // Houd het eerder succesvolle model uit deze chatsessie vooraan voor maximale cache-hits
      if (preferredModel && geschuddeModellen.includes(preferredModel)) {
        const overige = geschuddeModellen.filter((m) => m !== preferredModel);
        geschuddeModellen.splice(0, geschuddeModellen.length, preferredModel, ...overige);
      }

      const geminiPayload = {
        systemInstruction: { parts: [{ text: systemInstruction }] },
        contents
      };

      const { readable, writable } = new TransformStream();
      const writer = writable.getWriter();
      const encoder = new TextEncoder();

      ctx.waitUntil((async () => {
        let gebruiktModel = geschuddeModellen;
        let geminiJson = null;

        try {
          const geselecteerdeDocs = [{
            source: "OpenQuatt documentatie van de Github repository",
            text: dynamischeKennisContext
          }];
          await writer.write(encoder.encode(`---CONTEXT_DOCS_START---\n${JSON.stringify(geselecteerdeDocs)}\n---CONTEXT_DOCS_END---\n`));

          const apiAttempts = [];

          for (const model of geschuddeModellen) {
            gebruiktModel = model;
            const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${env.GEMINI_API_KEY}`;
            const geminiResponse = await fetch(geminiUrl, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(geminiPayload)
            });

            apiAttempts.push({ model, status: geminiResponse.status });

            const responseText = await geminiResponse.text();
            geminiJson = responseText.trim().startsWith("{") ? JSON.parse(responseText) : null;

            if (geminiResponse.ok && geminiJson && !geminiJson.error) {
              break;
            }
            console.warn(`Model ${model} faalde (${geminiResponse.status}), schakel door naar volgende model...`);
          }

          const cachedTokens = geminiJson?.usageMetadata?.cachedContentTokenCount || 0;
          const promptTokens = geminiJson?.usageMetadata?.promptTokenCount || 0;
          console.log(`[Cache Status] Model: ${gebruiktModel} | Gecached: ${cachedTokens} / ${promptTokens} tokens`);

          let pureAiText = geminiJson?.candidates?.at(0)?.content?.parts?.at(0)?.text;          
          if (!pureAiText) {
            pureAiText = geminiJson?.error
              ? `🚨 API FOUT: ${geminiJson.error.message}`
              : "🚨 GEEN ANTWOORD GEGENEREERD.";
          }

          const finaleRespons = JSON.stringify({ model: gebruiktModel, diagnose: pureAiText });
          await writer.write(encoder.encode(`---FINAL_RESPONSE---\n${finaleRespons}`));

          // TEST-LOGGING IN CLOUDFLARE KV (Indien ingeschakeld via env.ENABLE_TEST_LOGGING === "true")
          stuurNaarPrivateFeed({
            apiAttempts,
            entry: {
              tijdstip: new Date().toISOString(),
              type: isEersteRun ? "startanalyse" : "vervolgvraag",
              model: gebruiktModel,
              cacheStats: { cachedTokens, promptTokens },
              userProfile,
              laatsteVraag: actueleVraag,
              aiAntwoord: pureAiText,
              messages,
              logData
            }
          });

        } catch (streamErr) {
          console.error("Streaming Fatal Error:", streamErr.message);
          const crashPayload = JSON.stringify({
            model: "Crash-pijp",
            diagnose: `🚨 STREAM CRASH: ${streamErr.message}`
          });
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
      return new Response(JSON.stringify({
        status: "error",
        model: "Crash-pijp",
        diagnose: `🚨 SYSTEMISCHE CRASH: ${error.message}`
      }), { headers: corsHeaders });
    }
  }
};

export {
  backend_index_default as default
};
