export default {
  async fetch(request, env) {
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      const body = await request.json();
      // We accepteren nu 'messages' voor de doorlopende chat-historie
      const { userProfile, logData, messages } = body;

      if (!env.GEMINI_API_KEY) {
        return new Response(JSON.stringify({ diagnose: "🚨 CONFIGURATIEFOUT: GEMINI_API_KEY ontbreekt." }), {
          headers: corsHeaders
        });
      }

      const systemInstruction = `
        Je bent de 'OpenHeatPumps AI Assistent'. Je analyseert een volledig .oqdebug JSON logbestand van een warmtepomp-controller en beantwoordt vragen van de gebruiker hierover.
        
        ANALYSEVOLGORDE:
        1. WARMTEVRAAG CONTROLEREN: Kijk naar 'roomTemperature' (binnentemperatuur) en 'roomTemperatureSetpoint' (gevraagde temperatuur). Is het setpoint LAGER dan of gelijk aan de kamertemperatuur? Dan is er GEEN warmtevraag.
        2. STATUS CONTROLEREN: Kijk naar 'controlModeLabel' of 'strategyActiveCode'. Als het systeem in 'Standby' of 'Idle' staat omdat er geen warmtevraag is, dan is een lage of nul-waterdoorstroming (hp1Flow) VOLKOMEN NORMAAL. Concludeer dat het systeem naar behoren stand-by staat.
        3. PAS BIJ ACTIEF BEDRIJF analyseer je de 'hp1Flow', 'boilerActive' (cv-ketel interactie) en 'requestReason'.
        
        Geef beknopte, technisch accurate antwoorden in het Nederlands. Begin de allereerste reactie DIRECT met de hoofdconclusie en maximaal 3 korte actiepunten. Blijf in de vervolggesprekken behulpzaam en reageer specifiek op de vragen van de gebruiker.
      `;

      // Bouw de contents-array op voor het Gemini chat-format [1.5]
      let contents = [];
      
      // Voeg de initiële log-context en de eerste prompt toe als het gesprek net start
      if (!messages || messages.length === 0) {
        const initieelBericht = `
          PROFIEL:
          - Woningtype: ${userProfile.woning_type || "onbekend"}
          - Afgiftesysteem: ${userProfile.afgiftesysteem || "onbekend"}
          - CV-Ketel: ${userProfile.cv_ketel || "onbekend"}
          - Thermostaat: ${userProfile.thermostaat || "onbekend"}

          VOLLEDIGE LOGDATA:
          ${JSON.stringify(logData)}
        `;
        contents.push({
          role: "user",
          parts: [{ text: systemInstruction + "\n\n" + initieelBericht }]
        });
      } else {
        // Als er al een chat-historie is, sturen we de eerdere berichten netjes mee [1.5]
        contents = messages;
      }

      const geminiUrl = "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent";

      const geminiResponse = await fetch(geminiUrl, {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          "x-goog-api-key": env.GEMINI_API_KEY 
        },
        body: JSON.stringify({ contents: contents })
      });

      const responseText = await geminiResponse.text();
      const geminiJson = JSON.parse(responseText);

      let aiText = "";
      if (geminiJson && geminiJson.candidates && geminiJson.candidates[0].content && geminiJson.candidates[0].content.parts) {
        aiText = geminiJson.candidates[0].content.parts[0].text;
      } else {
        aiText = `🚨 FOUTMELDING: ${JSON.stringify(geminiJson)}`;
      }

      return new Response(JSON.stringify({ diagnose: aiText }), {
        headers: corsHeaders
      });

    } catch (error) {
      return new Response(JSON.stringify({ diagnose: `🚨 SYSTEMISCHE CRASH: ${error.message}` }), {
        headers: corsHeaders
      });
    }
  }
};
