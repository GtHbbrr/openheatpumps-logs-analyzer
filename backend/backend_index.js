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

      if (!env.GEMINI_API_KEY) {
        return new Response(JSON.stringify({ diagnose: "🚨 INTERNE WORKER CONFIGURATIEFOUT: GEMINI_API_KEY is niet gevuld in de Worker Secrets van het Cloudflare Dashboard." }), {
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

      const systemInstruction = "Je bent de 'OpenQuatt Huisarts'. Je analyseert een .oqdebug JSON logbestand van een open-source warmtepomp-controller. Kijk specifiek naar 'controlModeLabel' (status), 'requestReason' (foutmeldingen), 'hp1Flow' (waterdoorstroming) en 'boilerActive' (cv-ketel status). Geef een heldere diagnose in begrijpelijk Nederlands. Begin DIRECT met de hoofdconclusie. Geef maximaal 3 concrete actiepunten.";

      const userMessage = `
        PROFIEL VAN DE GEBRUIKER:
        - Woningtype: ${userProfile.woning_type || "onbekend"}
        - Afgiftesysteem: ${userProfile.afgiftesysteem || "onbekend"}
        - CV-Ketel: ${userProfile.cv_ketel || "onbekend"}
        - Thermostaat: ${userProfile.thermostaat || "onbekend"}

        RUWE LOGDATA:
        ${JSON.stringify(logData)}
      `;

      // GEBRUIK HET NIEUWE GEMINI-2.5-FLASH MODEL VOOR REST API'S
      const geminiUrl = `https://googleapis.com{env.GEMINI_API_KEY}`;
      
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

      // DIEPE DEBUGGER: Vang de ruwe HTTP-status direct op
      const httpStatus = geminiResponse.status;
      const geminiJson = await geminiResponse.json();
      
      // Als Google een error-object teruggeeft, dumpen we ALLES live naar de UI
      if (geminiJson.error || httpStatus !== 200) {
        const gedetailleerdeFout = `
          🚨 DIEPE GOOGLE API FOUT DETECTIE:
          - HTTP Status van Google: ${httpStatus}
          - Foutmelding: ${geminiJson.error?.message || "Geen specifieke melding"}
          - Status: ${geminiJson.error?.status || "UNKNOWN"}
          - Code: ${geminiJson.error?.code || httpStatus}
          
          RUWE GOOGLE DEBUGBOX:
          ${JSON.stringify(geminiJson)}
        `;
        return new Response(JSON.stringify({ diagnose: gedetailleerdeFout }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Veilige extractie van de tekst
      let aiText = "";
      if (geminiJson && geminiJson.candidates && geminiJson.candidates[0] && geminiJson.candidates[0].content && geminiJson.candidates[0].content.parts && geminiJson.candidates[0].content.parts[0]) {
        aiText = geminiJson.candidates[0].content.parts[0].text;
      } else {
        aiText = `🚨 PARSEFOUT IN WORKER: Google stuurde een onbekende JSON-boom terug. Ruwe data: ${JSON.stringify(geminiJson)}`;
      }

      return new Response(JSON.stringify({ diagnose: aiText }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });

    } catch (error) {
      return new Response(JSON.stringify({ diagnose: `🚨 CRITIEKE WORKER KERNFOUT: ${error.message}` }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }
};
