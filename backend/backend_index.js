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

      // STAP 1: KRACHTIGE TEST OP GOOGLE API KEY
      if (!env.GEMINI_API_KEY || env.GEMINI_API_KEY === "") {
        return new Response(JSON.stringify({ diagnose: "🚨 CONFIGURATIEFOUT: De GEMINI_API_KEY ontbreekt of is niet goed opgeslagen in de Cloudflare Worker Settings Secrets!" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // STAP 2: KRACHTIGE TEST OP D1 DATABASE BINDING
      if (saveToDb && !env.D1_DB) {
        return new Response(JSON.stringify({ diagnose: "🚨 DATABASEFOUT: De database binding 'D1_DB' ontbreekt in de Cloudflare Worker instellingen, of de tabelnaam matcht niet!" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Sla anoniem op indien aangevinkt
      if (saveToDb) {
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
            "v0.49.1",
            "Q-edition",
            JSON.stringify(logData)
          ).run();
        } catch (dbErr) {
          // Als de database faalt, breken we niet af, maar melden we het direct in het AI vlak
          return new Response(JSON.stringify({ diagnose: `🚨 D1 DATABASE SCHRIJFFOUT: ${dbErr.message}. Controleer of de tabel openquatt_mvp_profiles bestaat.` }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }

      const systemInstruction = "Je bent de 'OpenQuatt Huisarts'. Analyseer de log en geef een beknopte diagnose in het Nederlands.";
      const userMessage = `Systeem: ${userProfile.woning_type}, Ketel: ${userProfile.cv_ketel}. Data: ${JSON.stringify(logData)}`;

      const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${env.GEMINI_API_KEY}`;
      
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
        return new Response(JSON.stringify({ diagnose: `🚨 GOOGLE AI STUDIO ERROR: ${geminiJson.error.message} (Code: ${geminiJson.error.code})` }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Haal de tekst veilig op uit de Google response structuur
      let aiText = "";
      try {
        aiText = geminiJson.candidates[0].content.parts[0].text;
      } catch (e) {
        aiText = `🚨 PARSEFOUT: Google stuurde een onverwachte structuur terug. Ruwe JSON: ${JSON.stringify(geminiJson)}`;
      }

      return new Response(JSON.stringify({ diagnose: aiText }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });

    } catch (error) {
      // Dit zorgt ervoor dat ELKE onverwachte crash direct als tekst op je website verschijnt!
      return new Response(JSON.stringify({ diagnose: `🚨 CRITICAL CORE ERROR: ${error.message}` }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }
};
