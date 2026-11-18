import openquattDocsSnapshot from "./openquatt_docs_snapshot.txt";

// ====================================================================
// HULPFUNCTIES VOOR TOKENBESPARING (SNAPSHOT & DELTA-LOG)
// ====================================================================
const maakCompacteDocs = (ruweDocs) => {
  if (!ruweDocs) return "";
  return ruweDocs
    .replace(/```[\s\(\S\)]*?```/g, "[codeblok weggelaten]")
    .split("\n")
    .filter(
      (regel) =>
        !regel.startsWith("issue #955") ||
        regel.includes("Samenvatting") ||
        regel.includes("Situation")
    )
    .join("\n");
};

const bereidLogVoorAi = (ruweLog) => {
  if (
    !ruweLog ||
    typeof ruweLog !== "object" ||
    !Array.isArray(ruweLog.samples) ||
    !Array.isArray(ruweLog.columns)
  ) {
    return ruweLog;
  }

  const cols = ruweLog.columns;
  const ruisNamen = new Set([
    "uptimeMs",
    "freeHeap",
    "freePsram",
    "minFreeHeap",
    "largestFreeHeapBlock",
    "warmupElapsed",
    "cicLastSuccessAge",
    "hp1FanSpeed",
    "hp2FanSpeed",
    "hp1AcVoltage",
    "hp2AcVoltage"
  ]);

  const kritiekeNamen = new Set([
    "controlModeLabel",
    "strategy",
    "openquattEnabled",
    "hp1Mode",
    "hp2Mode",
    "hp1Compressor",
    "hp2Compressor",
    "hp1Freq",
    "hp2Freq",
    "hp1Defrost",
    "hp2Defrost",
    "hp1Failures",
    "hp2Failures",
    "lowflowFaultActive",
    "flowMismatch",
    "cicDataStale",
    "otLinkProblem",
    "boilerActive",
    "boilerCommandActive",
    "phRunExtensionStatus",
    "waterSupplyTempFallbackActive",
    "pt1000ReadProblem",
    "cicJsonFeedOk",
    "waterSupplyTempEffectiveSource",
    "flowMode",
    "hp1CompressorStarts72h",
    "hp2CompressorStarts72h"
  ]);

  const ruisIdx = new Set(
    cols.map((naam, i) => (ruisNamen.has(naam) ? i : -1)).filter((i) => i >= 0)
  );
  const kritiekIdx = new Set(
    cols
      .map((naam, i) => (kritiekeNamen.has(naam) ? i : -1))
      .filter((i) => i >= 0)
  );

  const rondAf = (val) => {
    if (typeof val !== "number" || Number.isInteger(val)) return val;
    return Math.abs(val) >= 100
      ? Math.round(val)
      : Math.round(val * 100) / 100;
  };

  const gecomprimeerd = [];
  let laatsteBewaardTijd = -999;
  let wachtendeDeltas = new Map();

  for (let i = 0; i < ruweLog.samples.length; i++) {
    const [tijd, deltas] = ruweLog.samples[i];
    if (!Array.isArray(deltas)) continue;

    let heeftKritiekEvent = false;
    for (const [col, val] of deltas) {
      if (ruisIdx.has(col)) continue;
      if (kritiekIdx.has(col)) heeftKritiekEvent = true;
      wachtendeDeltas.set(col, rondAf(val));
    }

    const isBeginOfEind = i === 0 || i === ruweLog.samples.length - 1;
    const isTijdVoorPeriodiek = tijd - laatsteBewaardTijd >= 120;

    if (
      (heeftKritiekEvent || isBeginOfEind || isTijdVoorPeriodiek) &&
      wachtendeDeltas.size > 0
    ) {
      gecomprimeerd.push([tijd, Array.from(wachtendeDeltas.entries())]);
      wachtendeDeltas.clear();
      laatsteBewaardTijd = tijd;
    }
  }

  return {
    ...ruweLog,
    _compressie_info: `Gecomprimeerd van ${ruweLog.samples.length} naar ${gecomprimeerd.length} event- en 2-minuten-snapshots (alle statuswisselingen en storingen behouden).`,
    samples: gecomprimeerd
  };
};
var backend_index_default = {
  // ====================================================================
  // 1. AUTOMATISCHE CRON-TRIGGER (Passieve herinnering)
  // ====================================================================
  async scheduled(event, env, ctx) {
    console.log(
      "Dagelijkse cron-prikkel ontvangen. OpenQuatt snapshot draait mee in de actieve build."
    );
  },

  // ====================================================================
  // 2. HTTP-VERKEER AFHANDELEN (SHARE LINKS, DIAGNOSE & CHAT STREAMING)
  // ====================================================================
  async fetch(request, env, ctx) {
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);

    const stripAfbeeldingenVoorOpslag = (msgs) => {
      if (!Array.isArray(msgs)) return [];
      return msgs.map(m => ({
        ...m,
        parts: Array.isArray(m.parts) ? m.parts.map(p => p.inlineData ? { text: "[Afbeelding bijgevoegd door gebruiker]" } : p) : m.parts
      }));
    };

    const stuurNaarPrivateFeed = (payload) => {
      if (payload && Array.isArray(payload.messages)) payload.messages = stripAfbeeldingenVoorOpslag(payload.messages);
      if (payload?.entry && Array.isArray(payload.entry.messages)) payload.entry.messages = stripAfbeeldingenVoorOpslag(payload.entry.messages);
      if (!env.NEWSFEED_SERVICE) return;
      ctx.waitUntil(
        env.NEWSFEED_SERVICE.fetch("https://internal/event", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...payload,
            geo: {
              city: request.cf?.city || "Onbekend",
              region: request.cf?.region || "Onbekend",
              country: request.cf?.country || "NL"
            }
          })
        })
      );
    };

    // ROUTE A: Gedeelde analyse ophalen (GET /share?id=...)
    if (request.method === "GET" && url.pathname === "/share") {
      const shareId = url.searchParams.get("id");
      if (!shareId || !env.LOGS_KV) {
        return new Response(
          JSON.stringify({
            status: "error",
            melding: "Ongeldig ID of KV niet gekoppeld."
          }),
          { status: 400, headers: corsHeaders }
        );
      }
      const opgeslagenData = await env.LOGS_KV.get(`share:${shareId}`);
      if (!opgeslagenData) {
        return new Response(
          JSON.stringify({
            status: "error",
            melding: "Deze deellink is verlopen (max. 7 dagen) of bestaat niet."
          }),
          { status: 404, headers: corsHeaders }
        );
      }
      return new Response(opgeslagenData, {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // ROUTE B: Analyse opslaan voor een deelbare link (POST /share)
    if (request.method === "POST" && url.pathname === "/share") {
      try {
        if (!env.LOGS_KV) {
          return new Response(
            JSON.stringify({
              status: "error",
              melding: "KV storage niet geconfigureerd."
            }),
            { status: 500, headers: corsHeaders }
          );
        }
        const payload = await request.json();
        const shareId = crypto.randomUUID().slice(0, 8);
        await env.LOGS_KV.put(`share:${shareId}`, JSON.stringify(payload), {
          expirationTtl: 604800
        });

        stuurNaarPrivateFeed({
          existingShareId: shareId,
          entry: {
            tijdstip: new Date().toISOString(),
            type: "share",
            userProfile: payload.userProfile || {},
            laatsteVraag: "Analyse gedeeld via link",
            aiAntwoord: payload.aiAntwoord || "",
            messages: payload.messages || [],
            logData: payload.logData || null
          }
        });

        return new Response(JSON.stringify({ status: "success", id: shareId }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      } catch (err) {
        return new Response(
          JSON.stringify({ status: "error", melding: err.message }),
          { status: 500, headers: corsHeaders }
        );
      }
    }

    if (request.method === "GET") {
      return new Response(
        JSON.stringify({
          status: "success",
          melding:
            "OpenHeatPumps AI Engine Online. Scope: OpenQuatt Docs Snapshot-Context actief."
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    try {
      const body = await request.json();
      const { userProfile, logData, messages, preferredModel } = body;

      if (!env.GEMINI_API_KEY) {
        return new Response(
          JSON.stringify({
            status: "error",
            diagnose: "🚨 CONFIGURATIEFOUT: GEMINI_API_KEY ontbreekt."
          }),
          { headers: corsHeaders }
        );
      }

      let actueleVraag = "Analyseer dit bestand.";
      let isEersteRun = !messages || messages.length <= 1;
      if (Array.isArray(messages) && messages.length > 0) {
        const laatsteBericht = messages[messages.length - 1];
        if (laatsteBericht?.parts?.text) {
          actueleVraag = laatsteBericht.parts.text;
        } else if (laatsteBericht?.parts?.[0]?.text) {
          actueleVraag = laatsteBericht.parts[0].text;
        }
      }

      const compacteDocs = maakCompacteDocs(openquattDocsSnapshot);
      const isAlleenAfbeelding = !logData || logData._alleen_afbeelding === true;
      const logVoorAi = isAlleenAfbeelding ? { info: "Geen .oqdebug.json logbestand meegestuurd; analyseer op basis van de meegestuurde afbeelding(en) en gebruikersvraag." } : bereidLogVoorAi(logData);

      const systemInstruction = `Je bent de 'OpenHeatPumps AI Assistent'.

STRIKTE SYSTEEM- EN HARDWARECONTEXT:
* Deze analyse betreft ALTIJD een Quatt warmtepomp (Hybrid Single of Duo) die lokaal wordt aangestuurd via de open-source OpenQuatt-controller (ESPHome / Q-edition hardware).
* De originele Quatt CiC-controller is ofwel volledig losgekoppeld, ofwel degradeerd tot een passieve Modbus-slave (via poort M2) om uitsluitend telemetrie door te geven aan de Quatt-app.
* OpenQuatt is de ENIGE actieve en leidende regelaar van het complete warmtepompsysteem!
* Geef altijd een korte samenvatting in B1 NL van het .oqdebug JSON logbestand dat is meegezonden. Laat B1 NL onbenoemd.
* Gebruik altijd de timestamps en werkelijke waarden uit het meegezonden .oqdebug JSON logbestand. GEEN fabulaties en gefantaseerde waarden en tijdstippen!
* Configuratieveld installationTopology "single" of "double" geeft aan of deze Quatt warmtepomp een Quatt Single configuratie met 1 ODU, of een Quatt Duo configuratie met 2 ODU's betreft.
* Het logbestand gebruikt 'device-psram-delta-json-v1': de array 'columns' bevat de kolomnamen op index 0..N, 'initial' bevat de startwaarden op t=0, en elke stap in 'samples' bevat [offset_s, [[kolom_index, nieuwe_waarde], ...]] waarbij ongewijzigde kolommen hun vorige waarde behouden.

STRIKTE RAG INSTRUCTIE:
* OpenQuatt werkt naar keuze VERMOGENSGESTUURD op basis van huisverlies (phouseHouse) en de actuele vraag (phouseReq) of op basis van een klassieke stooklijn.
* Kijk bij actuele vragen altijd naar de inhoud van het logbestand en naar de openstaande issues en documentatie die hieronder zijn meegezonden als dynamische kennis context.
* De daadwerkelijke meetwaarden en statussen in het logbestand zijn altijd leidend: gebruik deze om een veronderstelling of suggestie van de gebruiker eerst feitelijk te bevestigen of te weerleggen voordat je erop voortborduurt.
* Geef bij technische vragen over registers, instellingen of opties GEEN eigen speculaties, adviezen of zelfbedachte verklaringen als die niet letterlijk in de OpenQuatt-documentatie staan. Vermeld dan uitsluitend wat de documentatie erover zegt.

DYNAMISCH GEPROMPTE KENNIS UIT DATABASE:
<openquatt_docs>
${compacteDocs}
</openquatt_docs>

--- EINDE DAGELIJKSE CONTEXT ---

LOGDATA:
${JSON.stringify(logVoorAi)}

--- EINDE LOGDATA ---

VISUELE BIJLAGEN (SCREENSHOTS / FOTOS):
* Als de gebruiker een screenshot of foto meestuurt (zoals OpenQuatt-instellingen, grafieken, thermostaat of bedrading), analyseer deze dan nauwkeurig en combineer de zichtbare instellingen/waarden met eventuele logdata en de OpenQuatt-documentatie.

STRIKTE GEBRUIKERSCONTEXT:
* Woningtype: ${userProfile?.woning_type || "Onbekend"}
* Afgiftesysteem: ${userProfile?.afgiftesysteem || "Onbekend"}
* Aanwezige CV-ketel: ${userProfile?.cv_ketel || "GEEN KETEL AANWEZIG"}
* Thermostaat: ${userProfile?.thermostaat || "Onbekend"}`;
      let contents = [];
      if (!messages || messages.length === 0) {
        const initieelBericht = `GEBRUIKERSVRAAG/KLACHT:${actueleVraag}`;
        contents.push({ role: "user", parts: [{ text: initieelBericht }] });
      } else {
        contents = JSON.parse(JSON.stringify(messages));
      }

      const hussel = (arr) => {
        const kopie = [...arr];
        for (let i = kopie.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [kopie[i], kopie[j]] = [kopie[j], kopie[i]];
        }
        return kopie;
      };

      const primaireModellen = hussel([
        "gemini-3.8-flash",
        "gemini-3.6-flash",
        "gemini-3-flash-preview"
      ]);
      const vangnetModellen = hussel([
        "gemini-3.1-flash-lite",
        "gemini-3.5-flash-lite"
      ]);
      let geschuddeModellen = [...primaireModellen, ...vangnetModellen];

      if (preferredModel && geschuddeModellen.includes(preferredModel)) {
        const overige = geschuddeModellen.filter((m) => m !== preferredModel);
        geschuddeModellen = [preferredModel, ...overige];
      }

      // Beperk tot max 3 pogingen (2 Flash + 1 Lite) om quota-uitputting te voorkomen
      const geselecteerdeModellen = [
        ...geschuddeModellen.filter((m) => !m.includes("lite")).slice(0, 2),
        ...geschuddeModellen.filter((m) => m.includes("lite")).slice(0, 1)
      ];

      const geminiPayload = {
        systemInstruction: { parts: [{ text: systemInstruction }] },
        contents
      };

      const { readable, writable } = new TransformStream();
      const writer = writable.getWriter();
      const encoder = new TextEncoder();

      ctx.waitUntil(
        (async () => {
          let gebruiktModel = geselecteerdeModellen[0];
          let geminiJson = null;

          try {
            const geselecteerdeDocs = [
              {
                source: "OpenQuatt documentatie van de Github repository",
                text: compacteDocs
              }
            ];
            await writer.write(
              encoder.encode(
                `---CONTEXT_DOCS_START---\n${JSON.stringify(geselecteerdeDocs)}\n---CONTEXT_DOCS_END---\n`
              )
            );

            const apiAttempts = [];
            let aantal429 = 0;

            for (const model of geselecteerdeModellen) {
              gebruiktModel = model;
              const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${env.GEMINI_API_KEY}`;              
              const geminiResponse = await fetch(geminiUrl, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(geminiPayload)
              });

              apiAttempts.push({ model, status: geminiResponse.status });

              const responseText = await geminiResponse.text();
              geminiJson = responseText.trim().startsWith("{")
                ? JSON.parse(responseText)
                : null;

              if (geminiResponse.ok && geminiJson && !geminiJson.error) {
                break;
              }

              if (geminiResponse.status === 429) {
                aantal429++;
                if (aantal429 >= 2) {
                  console.warn(
                    "Meerdere 429-limieten bereikt, breek fallback-keten af."
                  );
                  break;
                }
              }

              console.warn(
                `Model ${model} faalde (${geminiResponse.status}), schakel door naar volgende model...`
              );
            }

            const cachedTokens =
              geminiJson?.usageMetadata?.cachedContentTokenCount || 0;
            const promptTokens =
              geminiJson?.usageMetadata?.promptTokenCount || 0;
            console.log(
              `[Cache Status] Model: ${gebruiktModel} | Gecached: ${cachedTokens} / ${promptTokens} tokens`
            );

            let pureAiText =
              geminiJson?.candidates?.at(0)?.content?.parts?.at(0)?.text;
            if (!pureAiText) {
              const laatsteStatus = apiAttempts.at(-1)?.status;
              if (laatsteStatus === 429) {
                pureAiText =
                  "⏳ **De AI heeft het op dit moment erg druk (limiet bereikt).** Je logbestand is vrij uitgebreid. Wacht 1 minuut en probeer het dan opnieuw — vaker achter elkaar klikken helpt helaas niet.";
              } else if (laatsteStatus === 503) {
                pureAiText =
                  "⏳ **De AI-servers van Google zijn op dit moment tijdelijk overbelast.** Probeer je vraag over een paar tellen nog eens.";
              } else {
                pureAiText = geminiJson?.error
                  ? `🚨 API FOUT: ${geminiJson.error.message}`
                  : "🚨 GEEN ANTWOORD GEGENEREERD.";
              }
            }

            const finaleRespons = JSON.stringify({
              model: gebruiktModel,
              diagnose: pureAiText
            });
            await writer.write(
              encoder.encode(`---FINAL_RESPONSE---\n${finaleRespons}`)
            );

            stuurNaarPrivateFeed({
              apiAttempts,
              entry: {
                tijdstip: new Date().toISOString(),
                type: isEersteRun ? "startanalyse" : "vervolgvraag",
                model: gebruiktModel,
                cacheStats: { cachedTokens, promptTokens },
                userProfile,
                laatsteVraag: actueleVraag,
                aiAntwoord: pureAiText,
                messages,
                logData
              }
            });
          } catch (streamErr) {
            console.error("Streaming Fatal Error:", streamErr.message);
            const crashPayload = JSON.stringify({
              model: "Crash-pijp",
              diagnose: `🚨 STREAM CRASH: ${streamErr.message}`
            });
            await writer.write(
              encoder.encode(`---FINAL_RESPONSE---\n${crashPayload}`)
            );
          } finally {
            await writer.close();
          }
        })()
      );

      return new Response(readable, {
        headers: {
          ...corsHeaders,
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "no-cache",
          Connection: "keep-alive"
        }
      });
    } catch (error) {
      return new Response(
        JSON.stringify({
          status: "error",
          model: "Crash-pijp",
          diagnose: `🚨 SYSTEMISCHE CRASH: ${error.message}`
        }),
        { headers: corsHeaders }
      );
    }
  }
};

export { backend_index_default as default };
