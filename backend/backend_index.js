export default {
  async fetch(request, env) {
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    // 1. Handhaaf direct CORS voor de preflight check
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    if (request.method !== "POST") {
      return new Response(JSON.stringify({ diagnose: "🚨 SYSTEM LOCK: Alleen POST-verzoeken zijn toegestaan." }), { 
        status: 405, 
        headers: corsHeaders 
      });
    }

    try {
      const body = await request.json();
      const { userProfile, logData } = body;

      // Kwalitatieve controle op de Gemini API Key
      if (!env.GEMINI_API_KEY) {
        return new Response(JSON.stringify({ diagnose: "🚨 RUNTIME ERROR [LOKALISATIE: WORKER]: De GEMINI_API_KEY is niet gevonden in de Cloudflare Environment Secrets." }), {
          headers: corsHeaders
        });
      }

      // Compacte payload-extractie om Google 413/Payload Too Large HTML te voorkomen
      // We sturen alleen de essentiële systeeminformatie mee in plaats van megabytes aan ruwe arrays
      const gecomprimeerdeData = {
        woning: userProfile,
        firmware: logData.initial?.find(i => i?.name === "projectVersionText")?.value || "v0.49.1",
        hardware: logData.initial?.find(i => i?.name === "hardwareProfileText")?.value || "Q-edition",
        recente_samples: Array.isArray(logData.samples) ? logData.samples.slice(-10) : "Geen samples gevonden"
      };

      const systemInstruction = "Je bent de 'OpenQuatt Huisarts'. Analyseer de systeemparameters en geef een beknopte diagnose in het Nederlands. Begin direct met de conclusie.";
      const geminiUrl = "https://googleapis.com/v1/models/gemini-1.5-flash:generateContent";

      // 2. Voer de daadwerkelijke fetch naar Google uit [1.5]
      const geminiResponse = await fetch(geminiUrl, {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          "x-goog-api-key": env.GEMINI_API_KEY 
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: `${systemInstruction}\n\nData:\n${JSON.stringify(gecomprimeerdeData)}` }] }]
        })
      });

      const httpStatus = geminiResponse.status;
      const responseText = await geminiResponse.text();

      // TRACERING A: Controleer of Google HTML antwoordt
      if (responseText.trim().startsWith("<")) {
        return new Response(JSON.stringify({ 
          diagnose: `🚨 DEFECT GEDETECTEERD [BRON: GOOGLE AI GATEWAY]\n- HTTP Status: ${httpStatus}\n\nGoogle stuurde een HTML-beveiligingspagina. Dit betekent dat de API-sleutel (beginnend met AQ.) mogelijk niet is geautoriseerd voor REST-verzoeken binnen de EU, of dat het project in AI Studio onvoldoende rechten heeft.` 
        }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      const geminiJson = JSON.parse(responseText);

      if (geminiJson.error) {
        return new Response(JSON.stringify({ 
          diagnose: `🚨 GOOGLE API COGNITIEVE FOUT:\n- Melding: ${geminiJson.error.message}\n- Code: ${geminiJson.error.code}` 
        }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      const aiText = geminiJson.candidates?.[0]?.content?.parts?.[0]?.text || "Geen diagnose gegenereerd.";
      return new Response(JSON.stringify({ diagnose: aiText }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });

    } catch (error) {
      // TRACERING B & C: Vangt crashes van de Worker zelf óf WAF-blokkades op
      return new Response(JSON.stringify({ 
        diagnose: `🚨 DEFECT GEDETECTEERD [BRON: CLOUDFLARE INFRASTRUCTUUR]\n- Type: Core Runtime Crash\n- Logmelding: ${error.message}\n\nAls deze melding direct verschijnt, blokkeert de Cloudflare WAF/Firewall het verzoek omdat de .oqdebug JSON te groot is of verdachte variabelen bevat. Schakel de WAF inspectie voor deze Worker uit in het dashboard.` 
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }
  }
};
