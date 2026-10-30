import openquattDocsSnapshot from "./openquatt_docs_snapshot.txt";
var backend_index_default = {
  // ====================================================================
  // 1. AUTOMATISCHE CRON-TRIGGER (Passieve herinnering )
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
      const { userProfile, logData, messages } = body;
      if (!env.GEMINI_API_KEY) {
        return new Response(JSON.stringify({ status: "error", diagnose: "\u{1F6A8} CONFIGURATIEFOUT: GEMINI_API_KEY ontbreekt." }), { headers: corsHeaders });
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

      const dynamischeKennisContext = openquattDocsSnapshot;
      const systemInstruction = `
                              Je bent de 'OpenHeatPumps AI Assistent'. 
                              
                              STRIKTE SLYSTEEM- EN HARDWARECONTEXT:
                              * Deze analyse betreft ALTIJD een Quatt warmtepomp (Hybrid Single of Duo) die lokaal wordt aangestuurd via de open-source OpenQuatt-controller (ESPHome / Q-edition hardware).
                              * De originele Quatt CiC-controller is ofwel volledig losgekoppeld, ofwel degradeerd tot een passieve Modbus-slave (via poort M2) om uitsluitend telemetrie door te geven aan de Quatt-app. 
                              * OpenQuatt is de ENIGE actieve en leidende regelaar van het complete warmtepompsysteem!
                              * Geef altijd een korte samenvatting in B1 NL van het .oqdebug JSON logbestand dat is meegezonden. Laat B1 NL onbenoemd
                              * Gebruik altijd de timestamps en werkelijke waarden uit het meegezonden .oqdebug JSON logbestand. GEEN fabulaties en gefantaseerde waarden en tijdstippen!
                              
                              STRIKTE GEBRUIKERSCONTEXT:
                              * Woningtype: ${userProfile?.woning_type || "Onbekend"}
                              * Afgiftesysteem: ${userProfile?.afgiftesysteem || "Onbekend"}
                              * Aanwezige CV-ketel: ${userProfile?.cv_ketel || "GEEN KETEL AANWEZIG"}
                              * Thermostaat: ${userProfile?.thermostaat || "Onbekend"}
                              
                              STRIKTE RAG INSTRUCTIE:
                              OpenQuatt werkt naar keuze VERMOGENSGESTUURD op basis van huisverlies (phouseHouse) en de actuele vraag (phouseReq) of op basis van een klassieke stooklijn
                              
                              DYNAMISCH GEPROMPTE KENNIS UIT DATABASE:
                              ${dynamischeKennisContext}
                            `;
      
      let contents = [];
      if (isEersteRun) {
        const initieelBericht = `GEBRUIKERSVRAAG/KLACHT:${actueleVraag}\n\nLOGDATA:\n${JSON.stringify(logData)}`;
        contents.push({ role: "user", parts: [{ text: initieelBericht }] });
      } else {
        contents = JSON.parse(JSON.stringify(messages));
        contents.unshift({ role: "user", parts: [{ text: `LOGDATA:\n${JSON.stringify(logData)}` }] });
      }
      
      const beschikbareModellen = ["gemini-3.8-flash", "gemini-3.6-flash", "gemini-3.1-flash-lite", "gemini-3.5-flash-lite", "gemini-3-flash-preview"];
      let primairModel = beschikbareModellen[Math.floor(Math.random() * beschikbareModellen.length)];
      const geminiPayload = {
        systemInstruction: { parts: [{ text: systemInstruction }] },
        contents
      };
      
      const { readable, writable } = new TransformStream();
      const writer = writable.getWriter();
      const encoder = new TextEncoder();
      
      ctx.waitUntil((async () => {
        let gebruiktModel = primairModel;
        try {
          const geselecteerdeDocs = [{ source: "OpenQuatt documentatie van de Github repository", text: dynamischeKennisContext }];
          await writer.write(encoder.encode(`---CONTEXT_DOCS_START---\n${JSON.stringify(geselecteerdeDocs)}\n---CONTEXT_DOCS_END---\n`));

                                        
          let geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${primairModel}:generateContent?key=${env.GEMINI_API_KEY}`;
          let geminiResponse = await fetch(geminiUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(geminiPayload)
          });
          let responseText = await geminiResponse.text();
          let geminiJson = responseText.trim().startsWith("{") ? JSON.parse(responseText) : null;
                                        
          if (!geminiResponse.ok || !geminiJson || geminiJson.error?.code === 429 || geminiJson.error?.code === 503) {
            const reserveModellen = beschikbareModellen.filter((m) => m !== primairModel);
            const reserveModel = reserveModellen[Math.floor(Math.random() * reserveModellen.length)];
            gebruiktModel = reserveModel;
            geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${reserveModel}:generateContent?key=${env.GEMINI_API_KEY}`;
            geminiResponse = await fetch(geminiUrl, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(geminiPayload)
            });
            responseText = await geminiResponse.text();
            geminiJson = responseText.trim().startsWith("{") ? JSON.parse(responseText) : null;
          }
                                        
          let pureAiText = geminiJson?.candidates?.[0]?.content?.parts?.[0]?.text;
          if (!pureAiText) {
            pureAiText = geminiJson?.error ? `\u{1F6A8} API FOUT: ${geminiJson.error.message}` : "\u{1F6A8} GEEN ANTWOORD GEGENEREERD.";
          }
                                        
          const finaleRespons = JSON.stringify({ model: gebruiktModel, diagnose: pureAiText });
          await writer.write(encoder.encode(`---FINAL_RESPONSE---\n${finaleRespons}`));
                                        
        } catch (streamErr) {
          console.error("Streaming Fatal Error:", streamErr.message);
          const crashPayload = JSON.stringify({ model: "Crash-pijp", diagnose: `\u{1F6A8} STREAM CRASH: ${streamErr.message}` });
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
      return new Response(JSON.stringify({ status: "error", model: "Crash-pijp", diagnose: `\u{1F6A8} SYSTEMISCHE CRASH: ${error.message}` }), { headers: corsHeaders });
    }
  }
};
export {
  backend_index_default as default
};
