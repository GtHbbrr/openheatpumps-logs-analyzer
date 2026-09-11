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

    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405, headers: corsHeaders });
    }

    try {
      const body = await request.json();
      const { userProfile, logData, saveToDb } = body;

      // 1. Controleer of de API Key aanwezig is
      if (!env.GEMINI_API_KEY) {
        return new Response(JSON.stringify({ diagnose: "🚨 CONFIGURATIEFOUT: GEMINI_API_KEY ontbreekt in Worker Secrets!" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      let firmwareVersion = "v0.49.1";
      let hardwareProfile = "Q-edition";
      
      if (logData && Array.isArray(logData.initial)) {
        const fwRow = logData.initial.find(i => i && i.name === "projectVersionText");
        if (fwRow && fwRow.value) firmwareVersion = fwRow.value;
        const hwRow = logData.initial.find(i => i && i.name === "hardwareProfileText");
        if (hwRow && hwRow.value) hardwareProfile = hwRow.value;
      }

      // 2. D1 Database Opslag
      if (saveToDb && env.D1_DB) {
        try {
          const uuid = crypto.randomUUID();
          await env.D1_DB.prepare(`
            INSERT INTO openquatt_mvp_profiles (id, woning_type, afgiftesysteem, cv_ketel, thermostaat, firmware_version, hardware_profile, raw_log_json)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `).bind(
            uuid,
            userProfile.woning_type || "onbekend",
            userProfile.afgiftesysteem || "onbekend",
            userProfile.cv_ketel || "onbekend",
            userProfile.thermostaat || "onbekend",
            firmwareVersion,
            hardwareProfile,
            JSON.stringify(logData)
          ).run();
        } catch (dbErr) {
          console.error("D1 Error:", dbErr.message);
        }
      }

      // 3. Systeemprompt en Gebruikersdata samenvoegen
      const systemInstruction = "Je bent de 'OpenQuatt Huisarts'. Je analyseert een .oqdebug JSON logbestand van een open-source warmtepomp-controller. Kijk specifiek naar 'controlModeLabel' (status), 'requestReason' (foutmeldingen), 'hp1Flow' (waterdoorstroming) en 'boilerActive' (cv-ketel status). Geef een heldere diagnose in begrijpelijk Nederlands. Begin DIRECT met de hoofdconclusie. Geef maximaal 3 concrete actiepunten op basis van de opgegeven hardware.";

      const userMessage = `
        PROFIEL VAN DE GEBRUIKER:
        - Woningtype: ${userProfile.woning_type || "onbekend"}
        - Afgiftesysteem: ${userProfile.afgiftesysteem || "onbekend"}
        - CV-Ketel: ${userProfile.cv_ketel || "onbekend"}
        - Thermostaat: ${userProfile.thermostaat || "onbekend"}

        RUWE LOGDATA:
        ${JSON.stringify(logData)}
      `;

      // 4. De Officiële Google AI Studio v1 REST-endpoint [1.5]
      const geminiUrl = `https://googleapis.com{env.GEMINI_API_KEY}`;
      
      // DE CORRECTE JSON STRUCTUUR CONFORM GOOGLE RELEASES [1.5]
      const payload = {
        contents: [
          {
            parts: [
              { text: systemInstruction + "\n\n" + userMessage }
            ]
          }
        ]
      };

      const geminiResponse = await fetch(geminiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      const geminiJson = await geminiResponse.json();
      
      // Vang API-storingen van Google direct op
      if (geminiJson.error) {
        return new Response(JSON.stringify({ diagnose: `🚨 GOOGLE AI STUDIO ERROR: ${geminiJson.error.message} (Code: ${geminiJson.error.code})` }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Veilige extractie van de tekst via de officiële object-tree [1.5]
      let aiText = "";
      if (geminiJson && geminiJson.candidates && geminiJson.candidates[0] && geminiJson.candidates[0].content && geminiJson.candidates[0].content.parts && geminiJson.candidates[0].content.parts[0]) {
        aiText = geminiJson.candidates[0].content.parts[0].text;
      } else {
        aiText = `🚨 PARSEFOUT: Onverwachte response-structuur. Ruwe JSON: ${JSON.stringify(geminiJson)}`;
      }

      return new Response(JSON.stringify({ diagnose: aiText }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });

    } catch (error) {
      return new Response(JSON.stringify({ diagnose: `🚨 CRITICAL CORE ERROR: ${error.message}` }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }
};
