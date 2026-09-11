export default {
  async fetch(request, env) {
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*", // Pas dit in productie aan naar je eigen domein OpenHeatpumps.nl
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

      // 1. Extraheer basismeta-data veilig uit de log (indien aanwezig)
      const firmwareVersion = logData.initial?.find(i => i[0] === 5)?.[1] || "v0.49.1";
      const hardwareProfile = logData.initial?.find(i => i[0] === 8)?.[1] || "Q-edition";

      // 2. Sla de testdata anoniem op in D1 (Flexibele JSON-blob)
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

      // 3. Bouw de gerichte 'Huisarts' prompt voor Google Gemini op
      const systemInstruction = `
        Je bent de 'OpenQuatt Huisarts'. Je analyseert een .oqdebug JSON logbestand van een open-source warmtepomp-controller.
        Je krijgt specifieke woning- en systeemkenmerken van de gebruiker mee.
        
        GEBRUIK DE VOLGENDE RICHTLIJNEN:
        1. Match de indices uit de 'samples' of 'initial' arrays met de namen in de 'columns' array om de waarden te begrijpen.
        2. Kijk specifiek naar 'controlModeLabel' (status), 'requestReason' (foutmeldingen zoals 'flow too low'), 'hp1Flow' (waterdoorstroming) en 'boilerActive' (cv-ketel status).
        3. Geef een heldere, beknopte diagnose in begrijpelijk Nederlands. Begin DIRECT met de hoofdconclusie (bijv. 'Je warmtepomp staat in stand-by' of 'Er is sprake van pendelgedrag').
        4. Focus specifiek op bekende pijnpunten: Intergas ketels die snel aanspringen door een hoog minimaal vermogen, Nest thermostaten met hun 'True Radiant' gedrag, of Tado configuraties.
        5. Geef maximaal 3 concrete, praktische actiepunten of verklaringen op basis van de OpenQuatt CODEX en stel een behandelplan op (bijv. kom over 3 dagen terug met een nieuwe log voor controle).
      `;

      const userMessage = `
        PROFIEL VAN DE GEBRUIKER:
        - Woningtype: ${userProfile.woning_type}
        - Afgiftesysteem: ${userProfile.afgiftesysteem}
        - CV-Ketel: ${userProfile.cv_ketel}
        - Thermostaat: ${userProfile.thermostaat}

        RUWE LOGDATA (.OQDEBUG):
        ${JSON.stringify(logData)}
      `;

      // 4. Aanroep naar Google Gemini API (Gemini 1.5 Flash is ideaal voor tekst/JSON data)
      const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${env.GEMINI_API_KEY}`;
      
      const geminiResponse = await fetch(geminiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemInstruction }] },
          contents: [{ parts: [{ text: userMessage }] }]
        })
      });

      const geminiJson = await geminiResponse.json();
      const aiText = geminiJson.candidates?.[0]?.content?.parts?.[0]?.text || "Fout bij het genereren van AI diagnose.";

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
