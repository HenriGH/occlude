(() => {
  // AndroidX supplies this channel only to the exact allowed HTTPS origin.
  const host = window.OccludeHost;
  if (!host || window !== window.top) return;
  let insets = { top: 0, right: 0, bottom: 0, left: 0 };
  let lastDark;
  const send = value => host.postMessage(JSON.stringify(value));
  function apply() {
    const root = document.documentElement;
    if (!root) return;
    root.dataset.androidHost = '';
    const ratio = window.devicePixelRatio || 1;
    for (const side of ['top', 'right', 'bottom', 'left']) {
      const pixels = insets[side];
      if (Number.isFinite(pixels) && pixels >= 0) root.style.setProperty(`--safe-${side}`, `${pixels / ratio}px`);
    }
    const dark = root.classList.contains('dark');
    if (dark !== lastDark) { lastDark = dark; send({ type: 'appearance', dark }); }
  }
  host.onmessage = event => {
    let message;
    try { message = JSON.parse(event.data); } catch { return; }
    if (message.type === 'insets' && message.insets) { insets = message.insets; apply(); }
  };
  const start = () => {
    if (!document.documentElement) return false;
    apply();
    new MutationObserver(apply).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    send({ type: 'ready' });
    return true;
  };
  if (!start()) {
    const observer = new MutationObserver(() => { if (start()) observer.disconnect(); });
    observer.observe(document, { childList: true });
  }
  window.addEventListener('resize', apply);
})();
