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
      const { userProfile, logData } = body;

      if (!env.GEMINI_API_KEY) {
        return new Response(JSON.stringify({ diagnose: "🚨 INTERNE WORKER CONFIGURATIEFOUT: GEMINI_API_KEY ontbreekt in de Cloudflare Worker Secrets!" }), {
          headers: corsHeaders
        });
      }

      // Compacte extractie van data om Google payload limieten te omzeilen
      const gecomprimeerdeData = {
        woning: userProfile,
        firmware: logData.initial?.find(i => i?.name === "projectVersionText")?.value || "v0.49.1",
        hardware: logData.initial?.find(i => i?.name === "hardwareProfileText")?.value || "Q-edition",
        recente_samples: Array.isArray(logData.samples) ? logData.samples.slice(-15) : "Geen samples gevonden"
      };

      const systemInstruction = "Je bent de 'OpenQuatt Huisarts'. Je analyseert de parameters van een open-source warmtepomp-controller. Kijk naar flow, status en eventuele waarschuwingen. Geef een heldere diagnose in het Nederlands. Begin direct met de hoofdconclusie. Geef maximaal 3 korte actiepunten.";

      const geminiUrl = "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent";

      const geminiResponse = await fetch(geminiUrl, {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          "x-goog-api-key": env.GEMINI_API_KEY 
        },
        body: JSON.stringify({
          contents: [{
            parts: [{ text: `${systemInstruction}\n\nData:\n${JSON.stringify(gecomprimeerdeData)}` }]
          }]
        })
      });

      const httpStatus = geminiResponse.status;
      const responseText = await geminiResponse.text();

      // DEBUG-TRACERING: Mocht Google alsnog HTML of een 404 sturen, trekken we direct de lijst met werkende modellen los!
      if (responseText.trim().startsWith("<") || httpStatus === 404) {
        const listResponse = await fetch("https://generativelanguage.googleapis.com/v1/models", {
          method: "GET",
          headers: { "x-goog-api-key": env.GEMINI_API_KEY }
        });
        const listData = await listResponse.json();

        return new Response(JSON.stringify({ 
          diagnose: `🚨 BRON-INSPECTIE ACTIEF [HTTP ${httpStatus}]: Het aangeroepen model is retired of niet beschikbaar in de EU.\n\nBESCHIKBARE MODELLEN VOOR JOUW API-KEY:\n${JSON.stringify(listData.models?.map(m => m.name) || listData)}` 
        }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      const geminiJson = JSON.parse(responseText);

      if (geminiJson.error) {
        return new Response(JSON.stringify({ 
          diagnose: `🚨 GOOGLE API FOUT: ${geminiJson.error.message}` 
        }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      // VEILIGE TEXT EXTRACTIE ZONDER SYNTAX CRASHES [1.5]
      let aiText = "";
      if (geminiJson && geminiJson.candidates && geminiJson.candidates[0] && geminiJson.candidates[0].content && geminiJson.candidates[0].content.parts && geminiJson.candidates[0].content.parts[0]) {
        aiText = geminiJson.candidates[0].content.parts[0].text;
      } else {
        aiText = `🚨 PARSEFOUT IN WORKER: Google stuurde een onbekende JSON-boom terug. Ruwe data: ${responseText}`;
      }

      return new Response(JSON.stringify({ diagnose: aiText }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });

    } catch (error) {
      return new Response(JSON.stringify({ 
        diagnose: `🚨 SYSTEMISCHE CRASH: ${error.message}` 
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }
  }
};
