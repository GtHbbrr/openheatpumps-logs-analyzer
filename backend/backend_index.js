import openquattDocsSnapshot from "./openquatt_docs_snapshot.txt";

var backend_index_default = {
  // ====================================================================
  // 1. AUTOMATISCHE CRON-TRIGGER (Passieve herinnering)
  // ====================================================================
  async scheduled(event, env, ctx) {
    console.log("Dagelijkse cron-prikkel ontvangen. OpenQuatt snapshot draait mee in de actieve build.");
  },

  // ====================================================================
  // 2. HTTP-VERKEER AFHANDELEN (DIAGNOSE & CHAT STREAMING HANDLER)
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
      let isEersteRun = !messages || messages.length === 0;
      if (!isEersteRun) {
        const laatsteBericht = messages[messages.length - 1];
        if (laatsteBericht?.parts?.text) {
          actueleVraag = laatsteBericht.parts.text;
        } else if (laatsteBericht?.parts?.[0]?.text) {
          actueleVraag = laatsteBericht.parts[0].text;
        }
      }

      // ====================================================================
      // GELAAGDE OPBOUW VOOR MAXIMALE IMPLICIT CACHING:
      // Laag 1: Vaste systeemregels + dagelijkse docs snapshot (gedeeld over alle gebruikers)
      // Laag 2: Logdata (ongewijzigd tijdens de volledige chatsessie)
      // Laag 3: Gebruikerscontext (mag tijdens het gesprek wijzigen zonder cache te breken)
      // ====================================================================
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
      if (isEersteRun) {
        const initieelBericht = `GEBRUIKERSVRAAG/KLACHT:${actueleVraag}`;
        contents.push({ role: "user", parts: [{ text: initieelBericht }] });
      } else {
        contents = JSON.parse(JSON.stringify(messages));
      }

      // Echte willekeurige hussel (Fisher-Yates) over alle beschikbare modellen
      const geschuddeModellen = [
        "gemini-3.8-flash",
        "gemini-3.6-flash",
        "gemini-3.1-flash-lite",
        "gemini-3.5-flash-lite",
        "gemini-3-flash-preview"
      ];
      for (let i = geschuddeModellen.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [geschuddeModellen[i], geschuddeModellen[j]] = [geschuddeModellen[j], geschuddeModellen[i]];
      }

      // Optioneel: houd het eerder succesvolle model uit deze chatsessie vooraan voor maximale cache-hits
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
        let gebruiktModel = geschuddeModellen[0];
        let geminiJson = null;

        try {
          const geselecteerdeDocs = [{
            source: "OpenQuatt documentatie van de Github repository",
            text: dynamischeKennisContext
          }];
          await writer.write(encoder.encode(`---CONTEXT_DOCS_START---\n${JSON.stringify(geselecteerdeDocs)}\n---CONTEXT_DOCS_END---\n`));

          // Probeer de geschudde modellen één voor één tot er eentje slaagt
          for (const model of geschuddeModellen) {
            gebruiktModel = model;
            const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${env.GEMINI_API_KEY}`;
            const geminiResponse = await fetch(geminiUrl, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(geminiPayload)
            });

            const responseText = await geminiResponse.text();
            geminiJson = responseText.trim().startsWith("{") ? JSON.parse(responseText) : null;

            if (geminiResponse.ok && geminiJson && !geminiJson.error) {
              break;
            }
            console.warn(`Model ${model} faalde (${geminiResponse.status}), schakel door naar volgende model...`);
          }

          // Log de implicit cache statistieken in Cloudflare Workers logs
          const cachedTokens = geminiJson?.usageMetadata?.cachedContentTokenCount || 0;
          const promptTokens = geminiJson?.usageMetadata?.promptTokenCount || 0;
          console.log(`[Cache Status] Model: ${gebruiktModel} | Gecached: ${cachedTokens} / ${promptTokens} tokens`);

          let pureAiText = geminiJson?.candidates?.[0]?.content?.parts?.[0]?.text;
          if (!pureAiText) {
            pureAiText = geminiJson?.error
              ? `🚨 API FOUT: ${geminiJson.error.message}`
              : "🚨 GEEN ANTWOORD GEGENEREERD.";
          }

          const finaleRespons = JSON.stringify({ model: gebruiktModel, diagnose: pureAiText });
          await writer.write(encoder.encode(`---FINAL_RESPONSE---\n${finaleRespons}`));

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
