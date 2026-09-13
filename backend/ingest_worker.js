export default {
  // Dit blok wordt automatisch getriggerd door de Cloudflare Cron (of via een test-URL )
  async scheduled(event, env, ctx) {
    ctx.waitUntil(this.ingestOpenQuattDocs(env));
  },

  async fetch(request, env) {
    // Test-ingang: als je naar de URL van deze worker surft, start de synchronisatie direct
    await this.ingestOpenQuattDocs(env);
    return new Response("🚀 Synchronisatie met live OpenQuatt-documentatie succesvol afgerond!");
  },

  async ingestOpenQuattDocs(env) {
    if (!env.VECTOR_INDEX || !env.AI) {
      console.error("🚨 Cloudflare AI of Vectorize binding ontbreekt.");
      return;
    }

    try {
      const url = "https://openquatt.github.io/OpenQuatt/problemen-oplossen.html";
      const response = await fetch(url);
      const html = await response.text();

      // MVP-HTML Parser: We vissen de belangrijkste alinea's (<p>) uit de live documentatie
      // In een latere sprint breiden we dit uit met een volwaardige HTML-parser
      const alineas = html
        .split("<p>")
        .map(p => p.split("</p>")[0].replace(/<[^>]*>/g, '').trim())
        .filter(text => text.length > 40 && !text.includes("javascript"));

      console.log(`Live documentatie opgehaald. ${alineas.length} secties gevonden voor vectorisatie.`);

      const cloudflarePayload = [];

      for (let i = 0; i < alineas.length; i++) {
        const tekstSectie = alineas[i];

        // Bereken de vector (768 dimensies) direct binnen Cloudflare [1.5]
        const embeddingResponse = await env.AI.run("@cf/baai/bge-base-en-v1.5", {
          text: [tekstSectie]
        });
        
        // De response van Cloudflare AI bevat de getallenreeks direct in .data[0] [1.5]
        const vectorValues = embeddingResponse.data[0];

        cloudflarePayload.push({
          id: `live_doc_${i}`,
          values: vectorValues,
          metadata: {
            source: "OpenQuatt Live Documentatie",
            text: tekstSectie
          }
        });
      }

      // Schiet de dynamisch gegenereerde vectoren in één bulk-actie in Cloudflare Vectorize
      if (cloudflarePayload.length > 0) {
        await env.VECTOR_INDEX.upsert(cloudflarePayload);
        console.log("✅ Vectorize succesvol gesynchroniseerd met de live documentatie!");
      }

    } catch (error) {
      console.error("🚨 Fout tijdens live ingestie:", error.message);
    }
  }
};
