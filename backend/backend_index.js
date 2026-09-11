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
      const { userProfile, logData } = body;

      // STRIKT MEDISCH COMPORTEMENT VOOR DE OPENQUATT HUISARTS
      const systemInstruction = `
        Je bent de 'OpenQuatt Huisarts'. Je analyseert een VOLLEDIG .oqdebug JSON logbestand van een warmtepomp.
        
        STRIKTE DIAGNOSEVOLGORDE (Voorkom oppervlakkige hallucinaties):
        1. EERST WARMTEVRAAG CONTROLEREN: Kijk naar 'roomTemperature' (binnentemperatuur) en 'roomTemperatureSetpoint' (gevraagde temperatuur). Is het setpoint LAGER dan of gelijk aan de kamertemperatuur? Dan is er GEEN warmtevraag.
        2. STATUS CONTROLEREN: Kijk naar 'controlModeLabel' of 'strategyActiveCode'. Als het systeem in 'Standby', 'Stand-by' of 'Idle' staat omdat er geen warmtevraag is, dan is een lage waterdoorstroming (hp1Flow) VOLKOMEN NORMAAL. Concludeer dan DIRECT dat het systeem naar behoren rust en stand-by staat.
        3. PAS BIJ ACTIEF BEDRIJF (Compressor aan, warmtevraag actief) analyseer je de 'hp1Flow' (waterdoorstroming), 'boilerActive' (cv-ketel interactie) en 'requestReason'.
        
        Geef je diagnose in helder Nederlands. Begin DIRECT met de hoofdconclusie op basis van deze logica. Geef maximaal 3 korte, relevante actiepunten.
      `;

      const userMessage = `
        PROFIEL:
        - Woningtype: ${userProfile.woning_type || "onbekend"}
        - Afgiftesysteem: ${userProfile.afgiftesysteem || "onbekend"}
        - CV-Ketel: ${userProfile.cv_ketel || "onbekend"}
        - Thermostaat: ${userProfile.thermostaat || "onbekend"}

        VOLLEDIGE RECENTE LOGDATA:
        ${JSON.stringify(logData)}
      `;

      // We roepen het stabiele, grote model aan met de complete payload
      const geminiUrl = "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent";

      const geminiResponse = await fetch(geminiUrl, {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          "x-goog-api-key": env.GEMINI_API_KEY 
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: systemInstruction + "\n\n" + userMessage }] }]
        })
      });

      const responseText = await geminiResponse.text();
      const geminiJson = JSON.parse(responseText);

      let aiText = "";
      if (geminiJson && geminiJson.candidates && geminiJson.candidates[0].content && geminiJson.candidates[0].content.parts) {
        aiText = geminiJson.candidates[0].content.parts[0].text;
      } else {
        aiText = `🚨 FOUTMELDING VAN GOOGLE: ${JSON.stringify(geminiJson)}`;
      }

      return new Response(JSON.stringify({ diagnose: aiText }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });

    } catch (error) {
      return new Response(JSON.stringify({ diagnose: `🚨 SYSTEMISCHE CRASH: ${error.message}` }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }
  }
};
