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

(async () => {
  try {
    console.log('Uitlezen OpenQuatt docs-structuur via API...');

    // Haal de OpenQuatt firmware-versie op uit oq_substitutions_common.yaml
    const subUrl = 'https://raw.githubusercontent.com/OpenQuatt/OpenQuatt/main/openquatt/oq_substitutions_common.yaml';
    const subYaml = await fetchText(subUrl);
    const versionMatch = subYaml.match(/project_version:\s*"?([^"\s]+)"?/);
    const fwVersion = versionMatch ? versionMatch[1] : 'onbekend';
    const fetchTimestamp = new Date().toISOString();

    const apiUrl = 'https://api.github.com/repos/OpenQuatt/OpenQuatt/git/trees/main?recursive=1';
    const tree = await fetchJson(apiUrl);
    const mdFiles = tree.tree.filter(
      f => f.path.startsWith('docs/') &&
           f.path.endsWith('.md') &&
           f.type === 'blob' &&
           !f.path.startsWith('docs/development/') &&
           !f.path.endsWith('AGENTS.md')
    );
    console.log(mdFiles.length + ' .md bestanden gevonden (development/ en AGENTS.md uitgesloten)');

    // Eerste regel met firmware-versie en timestamp
    let out = '[OpenQuatt docs snapshot | fw: ' + fwVersion + ' | fetched: ' + fetchTimestamp + ']\n\n';

    for (const f of mdFiles) {
      console.log('Ophalen en opschonen: ' + f.path);
      const rawUrl = 'https://raw.githubusercontent.com/OpenQuatt/OpenQuatt/main/' + f.path;
      const txt = await fetchText(rawUrl);
      txt.split(/\n\s*\n/).forEach(t => {
        const clean = t.replace(/[*_>]/g, ' ').replace(/\s+/g, ' ').trim();
        if (clean.length > 50 && !clean.includes('javascript') && !clean.includes('css')) {
          out += f.path.slice(5) + ': ' + clean + '\n\n';
        }
      });
    }

    // Haal openstaande issues op (uitgezonderd PR's)
    console.log('\nOphalen openstaande issues...');
    const issuesUrl = 'https://api.github.com/repos/OpenQuatt/OpenQuatt/issues?state=open&per_page=100';
    const issues = await fetchJson(issuesUrl);
    const openIssues = issues.filter(i => !i.pull_request);

    console.log(openIssues.length + ' openstaande issues gevonden (PR\'s uitgesloten)');

    if (openIssues.length > 0) {
      out += '\n---OPEN ISSUES---\n\n';
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

    fs.writeFileSync('backend/openquatt_docs_snapshot.txt', out, 'utf8');
    const chunkCount = out.split('\n\n').filter(Boolean).length - 1;
    console.log('\n✅ VOLTOOID: backend/openquatt_docs_snapshot.txt bijgewerkt');
    console.log('   OpenQuatt fw: ' + fwVersion + ' | fetched: ' + fetchTimestamp);
    console.log('   ' + out.length + ' bytes, ' + chunkCount + ' chunks');
    console.log('   ' + openIssues.length + ' open issues toegevoegd');
  } catch (e) {
    console.error('🚨 Fout:', e.message);
    process.exit(1);
  }
})();
