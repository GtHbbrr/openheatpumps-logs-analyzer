// REPARATIE: De OpenQuatt-documentatie wordt direct als platte tekst meegecompileerd uit het universele snapshot
import openquattDocsSnapshot from "./openquatt_docs_snapshot.txt"; 

export default {
  // ====================================================================
  // 1. AUTOMATISCHE CRON-TRIGGER (Passieve herinnering)
  // ====================================================================
  async scheduled(event, env, ctx) {
    // Omdat we geen embeddings meer berekenen in Cloudflare, is deze cron
    // in de runtime leeg. De documentatie zit permanent verankerd in de build.
    console.log("Dagelijkse cron-prikkel ontvangen. OpenQuatt snapshot draait mee in de actieve build.");
  },

  // ====================================================================
  // 2. HTTP-VERKEER AFHANDELEN (DIAGNOSE & CHAT STREAMING HANDLER)
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
        melding: "OpenHeatPumps AI Engine Online. Scope: OpenQuatt Docs Snapshot-Context actief." 
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    try {
      const body = await request.json();
      const { userProfile, logData, messages } = body;

      if (!env.GEMINI_API_KEY) {
        return new Response(JSON.stringify({ status: "error", diagnose: "🚨 CONFIGURATIEFOUT: GEMINI_API_KEY ontbreeken." }), { headers: corsHeaders });
      }

      // ====================================================================
      // A. BEPAAL DYNAMISCH DE RELEVANTE VRAAG (EERSTE RUN OF VERVOLGVRAAG)
      // ====================================================================
      let actueleVraag = "Analyseer dit bestand.";
      let isEersteRun = !messages || messages.length === 0;
      
      if (!isEersteRun) {
        const laatsteBericht = messages[messages.length - 1];
        if (laatsteBericht && laatsteBericht.parts && laatsteBericht.parts && laatsteBericht.parts.text) {
          actueleVraag = laatsteBericht.parts.text;
        } else if (laatsteBericht && laatsteBericht.parts && laatsteBericht.parts.text) {
          actueleVraag = laatsteBericht.parts.text;
        }
      }

      // We zetten de complete openquattDocsSnapshot tekst direct door naar de systeemprompt.
      const dynamischeKennisContext = openquattDocsSnapshot;

      // GEOPTIMALISEERDE SYSTEEMPROMPT MET STRIKTE OPENQUATT HARDWARE-CONTEXT
      const systemInstruction = `
        Je bent de 'OpenHeatPumps AI Assistent'. 
        
        STRIKTE SLYSTEEM- EN HARDWARECONTEXT:
        * Deze analyse betreft ALTIJD een Quatt warmtepomp (Hybrid Single of Duo) die lokaal wordt aangestuurd via de open-source OpenQuatt-controller (ESPHome / Q-edition hardware).
        * De originele Quatt CiC-controller is ofwel volledig losgekoppeld, ofwel degradeerd tot een passieve Modbus-slave (via poort M2) om uitsluitend telemetrie door te geven aan de Quatt-app. 
        * OpenQuatt is de ENIGE actieve en leidende regelaar van het complete warmtepompsysteem!
        * Je analyseert uitsluitend technische .oqdebug JSON logbestanden van deze OpenQuatt-controller (versie zoals in de logdata).
        
        STRIKTE GEBRUIKERSCONTEXT:
        * Woningtype: ${userProfile?.woning_type || "Onbekend"}
        * Afgiftesysteem: ${userProfile?.afgiftesysteem || "Onbekend"}
        * Aanwezige CV-ketel: ${userProfile?.cv_ketel || "GEEN KETEL AANWEZIG"}
        * Thermostaat: ${userProfile?.thermostaat || "Onbekend"}
        
        STRIKTE RAG INSTRUCTIE:
        OpenQuatt werkt naar keuze VERMOGENSGESTUURD op basis van huisverlies (phouseHouse) en de actuele vraag (phouseReq) of op basis van een klassieke stooklijn
        
        DYNAMISCH GEPROMPTE KENNIS UIT DATABASE:
        ${isEersteRun ? dynamischeKennisContext : "Gebruik de specifieke geverifieerde richtlijnen die aan het begin van deze chatgeschiedenis zijn meegegeven."}
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
          // STAP 1: Stuur direct een signaal dat de documenten-scroller klaarstaat
          // Omdat we de complete snapshot meesturen, geven we aan de front-end door 
          // dat de volledige OpenQuatt bibliotheek succesvol is geladen!
          const geselecteerdeDocs = [{ source: "Volledige OpenQuatt Repository-Snapshot", text: "Alle handleidingen en tabellen succesvol geladen in het AI-brein." }];
          await writer.write(encoder.encode(`---CONTEXT_DOCS_START---\n${JSON.stringify(geselecteerdeDocs)}\n---CONTEXT_DOCS_END---\n`));

          // STAP 2: Roep de zware Gemini API run aan
          let geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${primairModel}:generateContent?key=${env.GEMINI_API_KEY}`;
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
            
            geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${reserveModel}:generateContent?key=${env.GEMINI_API_KEY}`;
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
  
