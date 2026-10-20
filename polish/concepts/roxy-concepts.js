// Shared drawing helpers for the Roxy concept boards: one outline icon set and the five-petal flower.
(function () {
  const P = {
    feed: '<path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-4.5v-6h-5v6H5a1 1 0 0 1-1-1z"/>',
    feedOn: '<path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-4.5v-6h-5v6H5a1 1 0 0 1-1-1z" fill="currentColor"/>',
    discover: '<circle cx="12" cy="12" r="8.5"/><path d="m15.5 8.5-2 5-5 2 2-5z"/>',
    plus: '<path d="M12 6.5v11M6.5 12h11" stroke-width="2.25"/>',
    messages: '<path d="M20 12a8 8 0 0 1-11.6 7.1L4 20l1-4.2A8 8 0 1 1 20 12z"/>',
    you: '<circle cx="12" cy="8.5" r="4"/><path d="M4.5 20.5c1.4-3.6 4.3-5.5 7.5-5.5s6.1 1.9 7.5 5.5"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>',
    comment: '<path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v8a2.5 2.5 0 0 1-2.5 2.5H11l-4.5 3.5V17A2.5 2.5 0 0 1 4 14.5z"/>',
    share: '<path d="M4.5 12.5v6A1.5 1.5 0 0 0 6 20h12a1.5 1.5 0 0 0 1.5-1.5v-6M12 15V3.5M7.5 8 12 3.5 16.5 8"/>',
    more: '<circle cx="5.5" cy="12" r="1.4" fill="currentColor"/><circle cx="12" cy="12" r="1.4" fill="currentColor"/><circle cx="18.5" cy="12" r="1.4" fill="currentColor"/>',
    back: '<path d="M15 4.5 7.5 12l7.5 7.5"/>',
    pin: '<path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0C18.5 15.4 12 21 12 21z"/><circle cx="12" cy="10" r="2.3"/>',
    calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 9.5h17M8 3v4M16 3v4"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    lock: '<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8.5 10.5V7.5a3.5 3.5 0 0 1 7 0v3"/>',
    save: '<path d="M6.5 4h11v16.5L12 16.5l-5.5 4z"/>',
    eyeoff: '<path d="M3 3l18 18M10.6 5.1A9.9 9.9 0 0 1 12 5c5 0 8.5 4.3 9.5 7-0.4 1.1-1.2 2.5-2.4 3.8M6.6 6.6C4.6 7.9 3.2 10 2.5 12c1 2.7 4.5 7 9.5 7 1.6 0 3-0.4 4.3-1.1"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
  };
  function flowerPath(c = 12, rIn = 4.6, rOut = 10.6, steps = 200) {
    const pts = [];
    for (let i = 0; i <= steps; i++) {
      const t = (i / steps) * Math.PI * 2;
      const k = Math.pow(Math.abs(Math.cos(2.5 * (t + Math.PI / 2))), 0.7);
      const r = rIn + (rOut - rIn) * k;
      pts.push((c + r * Math.cos(t)).toFixed(2) + ' ' + (c + r * Math.sin(t)).toFixed(2));
    }
    return 'M' + pts.join('L') + 'Z';
  }
  window.ROXY_FLOWER = flowerPath();
  document.querySelectorAll('svg[data-i]').forEach((s) => {
    s.setAttribute('viewBox', '0 0 24 24');
    s.classList.add('icon');
    s.innerHTML = P[s.dataset.i] || '';
  });
  document.querySelectorAll('svg[data-flower]').forEach((s) => {
    const mode = s.dataset.flower; // "fill" | "outline"
    s.setAttribute('viewBox', '0 0 24 24');
    const centre = s.dataset.centre || 'none';
    s.innerHTML = `<path d="${window.ROXY_FLOWER}" fill="${mode === 'fill' ? 'currentColor' : 'none'}" stroke="${s.dataset.stroke || 'currentColor'}" stroke-width="${s.dataset.sw || 1.6}" stroke-linejoin="round"/>` +
      (centre !== 'none' ? `<circle cx="12" cy="12" r="${s.dataset.cr || 2.2}" fill="${centre}"/>` : '');
  });
})();
