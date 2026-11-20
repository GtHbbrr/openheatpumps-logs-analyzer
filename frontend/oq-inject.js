(() => {
  const existing = document.getElementById('oq-ai-drawer');
  if (existing) {
    const hidden = existing.style.display === 'none';
    existing.style.display = hidden ? 'block' : 'none';
    document.body.style.marginRight = hidden ? '440px' : '0';
    return;
  }

  document.body.style.transition = 'margin-right 0.2s ease';
  document.body.style.marginRight = '440px';

  const aside = document.createElement('aside');
  aside.id = 'oq-ai-drawer';
  aside.style.cssText = 'position:fixed;top:0;right:0;width:440px;max-width:100vw;height:100vh;z-index:99999;border-left:1px solid #1f2937;background:#030712;box-shadow:-8px 0 24px rgba(0,0,0,.45)';

  const closeBtn = document.createElement('button');
  closeBtn.textContent = '✕';
  closeBtn.title = 'Sluit AI zijpaneel';
  closeBtn.style.cssText = 'position:absolute;top:6px;right:10px;z-index:100000;background:#1f2937;color:#d1d5db;border:1px solid #374151;border-radius:4px;padding:2px 7px;font-size:12px;cursor:pointer';
  closeBtn.onclick = () => {
    aside.style.display = 'none';
    document.body.style.marginRight = '0';
  };

  const baseUrl = ['https://', 'openheatpumps', '.nl'].join('');
  const iframe = document.createElement('iframe');
  iframe.src = baseUrl + '/?embed=1';
  iframe.style.cssText = 'width:100%;height:100%;border:0';

  aside.appendChild(closeBtn);
  aside.appendChild(iframe);
  document.body.appendChild(aside);

  window.addEventListener('message', async (e) => {
    if (e.data?.type === 'OQ_EMBED_READY') {
      try {
        const res = await fetch('/openquatt/debug-recording/download?last_minutes=15');
        if (res.ok) {
          const logData = await res.json();
          iframe.contentWindow.postMessage({ type: 'OQ_LOGDATA', logData }, baseUrl);
          return;
        }
      } catch (_) {}
      console.warn('Kon live logdata niet automatisch ophalen van openquatt.local.');
    } else if (e.data?.type === 'OQ_NAVIGATE' && e.data.href) {
      const u = new URL(e.data.href);
      history.pushState({}, '', u.search);
      window.dispatchEvent(new PopStateEvent('popstate'));
    }
  });
})();
