const fs = require('fs');
const https = require('https');

function fetchOnce(url) {
  return new Promise((res, rej) => {
    https.get(url, { headers: { 'User-Agent': 'Node-Analyzer' } }, (r) => {
      let d = '';
      r.on('data', chunk => d += chunk);
      r.on('end', () => res(d));
    }).on('error', rej);
  });
}

async function fetchText(url, retries = 3) {
  for (let i = 1; i <= retries; i++) {
    try {
      return await fetchOnce(url);
    } catch (e) {
      if (i === retries) throw e;
      await new Promise(r => setTimeout(r, 600 * i));
    }
  }
}

async function fetchJson(url) {
  const txt = await fetchText(url);
  try { return JSON.parse(txt); }
  catch (e) { throw new Error('Geen JSON van ' + url); }
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

const oqBase = ['http://', 'openquatt', '.', 'local/'].join('');
const SPA_ROUTES = [
  ['Overzicht / Dashboard', '?view=overview'],
  ['Resultaten & grafieken', '?view=results'],
  ['Vooruitblik / Huisleren (Metingen)', '?view=learning'],
  ['Vooruitblik / Huisleren (Uitleg)', '?view=learning&section=explanation'],
  ['Vooruitblik / Huisleren (Voorspelling)', '?view=learning&section=forecast'],
  ['Vooruitblik / Huisleren (Configuratie)', '?view=learning&section=configuration'],
  ['Vooruitblik / Huisleren (Diagnose en data)', '?view=learning&section=diagnostics'],
  ['Regeling / Control Replay (Actueel)', '?view=control'],
  ['Regeling / Control Replay (Tijdlijn)', '?view=control&controlTab=timeline'],
  ['Regeling / Control Replay (Grafieken)', '?view=control&controlTab=graphs'],
  ['Diagnose / Trends', '?view=diagnosis'],
  ['Energie', '?view=energy'],
  ['Instellingen - Installatie (woning, afgiftesysteem, cv-ketel, flowbron, thermostaat)', '?view=settings&section=installation'],
  ['Instellingen - Verwarmen (Power House, stooklijn, kamertemperatuur, nachtverlaging)', '?view=settings&section=heating'],
  ['Instellingen - Koelen (koelregeling, dauwpunt, koelschema)', '?view=settings&section=cooling'],
  ['Instellingen - Integraties (Home Assistant, MQTT, weer, temperatuurbronnen)', '?view=settings&section=integrations'],
  ['Instellingen - Service (min. draaitijd, compressorlimieten, ontdooien, flowregeling/iPWM, opwarmen)', '?view=settings&section=service'],
  ['Instellingen - Systeem (firmware-updates, loggeschiedenis, herstarten)', '?view=settings&section=system'],
  ['Instellingen - Systeemrecorder (debug-logs opnemen en exporteren)', '?view=settings&section=system&modal=systeemrecorder'],
  ['Instellingen - Back-up & herstel', '?view=settings&section=backup'],
  ['Instellingen - Wijzigingsgeschiedenis', '?view=settings&section=changes'],
  ['Instellingen - Delen & privacy (telemetrie)', '?view=settings&section=sharing']
];

const SPA_DEEPLINKS_BLOCK = [
  '---OPENQUATT WEB-APP DEEPLINKS (SPA GUI)---',
  ...SPA_ROUTES.map(([label, q]) => `web-app/deeplinks: ${label} -> ${oqBase}${q}`)
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
