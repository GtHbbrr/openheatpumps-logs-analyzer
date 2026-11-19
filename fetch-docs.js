const fs = require('fs');
const https = require('https');

function fetchJson(url) {
  return new Promise((res, rej) => {
    https.get(url, { headers: { 'User-Agent': 'Node-Analyzer' } }, (r) => {
      let d = '';
      r.on('data', chunk => d += chunk);
      r.on('end', () => {
        try { res(JSON.parse(d)); }
        catch (e) { rej(new Error('Geen JSON van ' + url)); }
      });
    }).on('error', rej);
  });
}

function fetchText(url) {
  return new Promise((res, rej) => {
    https.get(url, { headers: { 'User-Agent': 'Node-Analyzer' } }, (r) => {
      let d = '';
      r.on('data', chunk => d += chunk);
      r.on('end', () => res(d));
    }).on('error', rej);
  });
}

const ALLOWED_DEV_DOCS = new Set([
  'docs/development/verwarmingsregeling.md',
  'docs/development/koelregeling.md',
  'docs/development/power-house-learning-sources.md',
  'docs/development/power-house-autotuning-development.md',
  'docs/development/controlled-warmup-architecture.md',
  'docs/development/nvs-persistence.md',
  'docs/development/netwerkdiagnostiek.md',
  'docs/development/system-overview.md',
  'docs/development/control-replay-firmware.md'
]);

const SPA_DEEPLINKS_BLOCK = [
  '---OPENQUATT WEB-APP DEEPLINKS (SPA GUI)---',
  'web-app/deeplinks: Overzicht / Dashboard -> http://openquatt.local',
  'web-app/deeplinks: Resultaten & grafieken -> http://openquatt.local',
  'web-app/deeplinks: Vooruitblik / Huisleren (Metingen) -> http://openquatt.local',
  'web-app/deeplinks: Vooruitblik / Huisleren (Uitleg) -> http://openquatt.local&section=explanation',
  'web-app/deeplinks: Vooruitblik / Huisleren (Voorspelling) -> http://openquatt.local&section=forecast',
  'web-app/deeplinks: Vooruitblik / Huisleren (Configuratie) -> http://openquatt.local&section=configuration',
  'web-app/deeplinks: Vooruitblik / Huisleren (Diagnose en data) -> http://openquatt.local&section=diagnostics',
  'web-app/deeplinks: Regeling / Control Replay (Actueel) -> http://openquatt.local',
  'web-app/deeplinks: Regeling / Control Replay (Tijdlijn) -> http://openquatt.local&controlTab=timeline',
  'web-app/deeplinks: Regeling / Control Replay (Grafieken) -> http://openquatt.local&controlTab=graphs',
  'web-app/deeplinks: Diagnose / Trends -> http://openquatt.local',
  'web-app/deeplinks: Energie -> http://openquatt.local',
  'web-app/deeplinks: Instellingen - Installatie (woning, afgiftesysteem, cv-ketel, flowbron, thermostaat) -> http://openquatt.local',
  'web-app/deeplinks: Instellingen - Verwarmen (Power House, stooklijn, kamertemperatuur, nachtverlaging) -> http://openquatt.local',
  'web-app/deeplinks: Instellingen - Koelen (koelregeling, dauwpunt, koelschema) -> http://openquatt.local',
  'web-app/deeplinks: Instellingen - Integraties (Home Assistant, MQTT, weer, temperatuurbronnen) -> http://openquatt.local',
  'web-app/deeplinks: Instellingen - Service (min. draaitijd, compressorlimieten, ontdooien, flowregeling/iPWM, opwarmen) -> http://openquatt.local',
  'web-app/deeplinks: Instellingen - Systeem (firmware-updates, loggeschiedenis, herstarten) -> http://openquatt.local',
  'web-app/deeplinks: Instellingen - Systeemrecorder (debug-logs opnemen en exporteren) -> http://openquatt.local&modal=systeemrecorder',
  'web-app/deeplinks: Instellingen - Back-up & herstel -> http://openquatt.local',
  'web-app/deeplinks: Instellingen - Wijzigingsgeschiedenis -> http://openquatt.local',
  'web-app/deeplinks: Instellingen - Delen & privacy (telemetrie) -> http://openquatt.local'
].join('\n\n') + '\n\n';

(async () => {
  try {
    console.log('Uitlezen OpenQuatt docs-structuur via API...');

    const rawHost = ['https://raw.', 'git', 'hub', 'user', 'content', '.', 'com'].join('');
    const apiHost = ['https://api.', 'git', 'hub', '.', 'com'].join('');

    const subUrl = rawHost + '/OpenQuatt/OpenQuatt/main/openquatt/oq_substitutions_common.yaml';
    const subYaml = await fetchText(subUrl);
    const versionMatch = subYaml.match(/project_version:\s*"?([^"\s]+)"?/);
    const fwVersion = versionMatch ? versionMatch[1] : 'onbekend';
    const fetchTimestamp = new Date().toISOString();

    const apiUrl = apiHost + '/repos/OpenQuatt/OpenQuatt/git/trees/main?recursive=1';
    const tree = await fetchJson(apiUrl);
    const mdFiles = tree.tree.filter(
      f => f.path.startsWith('docs/') &&
           f.path.endsWith('.md') &&
           f.type === 'blob' &&
           !f.path.endsWith('AGENTS.md') &&
           (!f.path.startsWith('docs/development/') || ALLOWED_DEV_DOCS.has(f.path))
    );
    console.log(mdFiles.length + ' .md bestanden geselecteerd (incl. ' + ALLOWED_DEV_DOCS.size + ' architectuurdocs uit development/)');

    console.log('Ophalen openstaande issues...');
    const issuesUrl = apiHost + '/repos/OpenQuatt/OpenQuatt/issues?state=open&per_page=100';
    const issues = await fetchJson(issuesUrl);
    const openIssues = issues.filter(i => !i.pull_request);
    console.log(openIssues.length + ' openstaande issues gevonden (PR\'s uitgesloten)');

    let out = '[OpenQuatt docs snapshot | fw: ' + fwVersion + ' | fetched: ' + fetchTimestamp + ']\n\n';

    if (openIssues.length > 0) {
      out += '---OPEN ISSUES---\n\n';
      for (const issue of openIssues) {
        const labels = issue.labels.map(l => l.name).join(', ');
        const labelStr = labels ? ' (' + labels + ')' : '';
        const header = 'issue #' + issue.number + labelStr + ': ' + issue.title;
        if (issue.body) {
          issue.body.split(/\n\s*\n/).forEach(t => {
            const clean = t.replace(/[*_>`]/g, ' ').replace(/\s+/g, ' ').trim();
            if (clean.length > 50 && !clean.includes('javascript') && !clean.includes('css')) {
              out += header + ' - ' + clean + '\n\n';
            }
          });
        } else {
          out += header + '\n\n';
        }
      }
    }

    for (const f of mdFiles) {
      console.log('Ophalen en opschonen: ' + f.path);
      const rawUrl = rawHost + '/OpenQuatt/OpenQuatt/main/' + f.path;
      const txt = await fetchText(rawUrl);
      txt.split(/\n\s*\n/).forEach(t => {
        const clean = t.replace(/[*_>]/g, ' ').replace(/\s+/g, ' ').trim();
        if (clean.length > 50 && !clean.includes('javascript') && !clean.includes('css')) {
          out += f.path.slice(5) + ': ' + clean + '\n\n';
        }
      });
    }

    out += SPA_DEEPLINKS_BLOCK;

    fs.writeFileSync('backend/openquatt_docs_snapshot.txt', out, 'utf8');
    const chunkCount = out.split('\n\n').filter(Boolean).length - 1;
    console.log('\n✅ VOLTOOID: backend/openquatt_docs_snapshot.txt bijgewerkt');
    console.log('   OpenQuatt fw: ' + fwVersion + ' | fetched: ' + fetchTimestamp);
    console.log('   ' + out.length + ' bytes, ' + chunkCount + ' chunks');
  } catch (e) {
    console.error('🚨 Fout:', e.message);
    process.exit(1);
  }
})();
