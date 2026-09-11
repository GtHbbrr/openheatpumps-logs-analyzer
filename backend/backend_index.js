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

      let firmwareVersion = "v0.49.1";
      let hardwareProfile = "Q-edition";
      
      if (logData && Array.isArray(logData.initial)) {
        const fwRow = logData.initial.find(i => i && i.name === "projectVersionText");
        if (fwRow && fwRow.value) firmwareVersion = fwRow.value;
        
        const hwRow = logData.initial.find(i => i && i.name === "hardwareProfileText");
        if (hwRow && hwRow.value) hardwareProfile = hwRow.value;
      }

      if (saveToDb) {
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
      }

      const systemInstruction = "Je bent de 'OpenQuatt Huisarts'. Je analyseert een .oqdebug JSON logbestand van een open-source warmtepomp-controller. Kijk specifiek naar 'controlModeLabel' (status), 'requestReason' (foutmeldingen), 'hp1Flow' (waterdoorstroming) en 'boilerActive' (cv-ketel status). Geef een heldere diagnose in begrijpelijk Nederlands. Begin DIRECT met de hoofdconclusie. Geef maximaal 3 concrete actiepunten op basis van de opgegeven hardware.";

      const userMessage = `
        PROFIEL VAN DE GEBRUIKER:
        - Woningtype: ${userProfile.woning_type}
        - Afgiftesysteem: ${userProfile.afgiftesysteem}
        - CV-Ketel: ${userProfile.cv_ketel}
        - Thermostaat: ${userProfile.thermostaat}

        RUWE LOGDATA:
        ${JSON.stringify(logData)}
      `;

      const geminiUrl = `https://googleapis.com{env.GEMINI_API_KEY}`;
      
      const geminiResponse = await fetch(geminiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{
            role: "user",
            parts: [{ text: systemInstruction + "\n\n" + userMessage }]
          }]
        })
      });

      const geminiJson = await geminiResponse.json();
      
      if (geminiJson.error) {
        return new Response(JSON.stringify({ diagnose: `Google AI Studio Fout: ${geminiJson.error.message}` }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Volledig veilige check op de JSON-structuur van Google Gemini zonder dubbele vraagtekens
      let aiText = "Gemini gaf geen resultaat terug. Controleer of de API-key klopt.";
      if (geminiJson && geminiJson.candidates && geminiJson.candidates[0] && geminiJson.candidates[0].content && geminiJson.candidates[0].content.parts && geminiJson.candidates[0].content.parts[0]) {
        aiText = geminiJson.candidates[0].content.parts[0].text;
      } else {
        aiText = `Foutieve response-structuur ontvangen. Ruwe data van Google: ${JSON.stringify(geminiJson)}`;
      }

      return new Response(JSON.stringify({ diagnose: aiText }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });

    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }
};
