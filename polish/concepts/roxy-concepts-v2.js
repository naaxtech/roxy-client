// Shared drawing helpers for the Roxy v2 concept boards: one outline icon set and the Roxy O mark.
(function () {
  const P = {
    feed: '<path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-4.5v-6h-5v6H5a1 1 0 0 1-1-1z"/>',
    feedOn: '<path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-4.5v-6h-5v6H5a1 1 0 0 1-1-1z" fill="currentColor"/>',
    discover: '<circle cx="12" cy="12" r="8.5"/><path d="m15.5 8.5-2 5-5 2 2-5z"/>',
    discoverOn: '<circle cx="12" cy="12" r="8.5" fill="currentColor"/><path d="m15.5 8.5-2 5-5 2 2-5z" stroke="var(--pink-container)" fill="var(--pink-container)"/>',
    plus: '<path d="M12 6v12M6 12h12" stroke-width="2.4"/>',
    messages: '<path d="M20 12a8 8 0 0 1-11.6 7.1L4 20l1-4.2A8 8 0 1 1 20 12z"/>',
    messagesOn: '<path d="M20 12a8 8 0 0 1-11.6 7.1L4 20l1-4.2A8 8 0 1 1 20 12z" fill="currentColor"/>',
    you: '<circle cx="12" cy="8.5" r="4"/><path d="M4.5 20.5c1.4-3.6 4.3-5.5 7.5-5.5s6.1 1.9 7.5 5.5"/>',
    youOn: '<circle cx="12" cy="8.5" r="4" fill="currentColor"/><path d="M4.5 20.5c1.4-3.6 4.3-5.5 7.5-5.5s6.1 1.9 7.5 5.5z" fill="currentColor"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>',
    comment: '<path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v8a2.5 2.5 0 0 1-2.5 2.5H11l-4.5 3.5V17A2.5 2.5 0 0 1 4 14.5z"/>',
    share: '<path d="M4.5 12.5v6A1.5 1.5 0 0 0 6 20h12a1.5 1.5 0 0 0 1.5-1.5v-6M12 15V3.5M7.5 8 12 3.5 16.5 8"/>',
    save: '<path d="M6.5 4h11v16.5L12 16.5l-5.5 4z"/>',
    more: '<circle cx="5.5" cy="12" r="1.4" fill="currentColor"/><circle cx="12" cy="12" r="1.4" fill="currentColor"/><circle cx="18.5" cy="12" r="1.4" fill="currentColor"/>',
    back: '<path d="M15 4.5 7.5 12l7.5 7.5"/>',
    fwd: '<path d="M9 4.5 16.5 12 9 19.5"/>',
    close: '<path d="M6 6l12 12M18 6 6 18"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    lock: '<rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8.5 10.5V7.5a3.5 3.5 0 0 1 7 0v3"/>',
    eye: '<path d="M2.5 12C4 8.5 7.6 5.5 12 5.5s8 3 9.5 6.5c-1.5 3.5-5.1 6.5-9.5 6.5S4 15.5 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
    eyeoff: '<path d="M3 3l18 18M10.6 5.6A9.6 9.6 0 0 1 12 5.5c4.4 0 8 3 9.5 6.5-.5 1.2-1.3 2.4-2.3 3.4M6.5 6.9C4.7 8.2 3.3 10 2.5 12c1.5 3.5 5.1 6.5 9.5 6.5 1.5 0 2.9-.3 4.2-.9"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
    globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.4 2.4 3.5 5.3 3.5 8.5s-1.1 6.1-3.5 8.5c-2.4-2.4-3.5-5.3-3.5-8.5S9.6 5.9 12 3.5z"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8"/>',
    moon: '<path d="M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10z"/>',
    device: '<rect x="7" y="3" width="10" height="18" rx="2.5"/><path d="M11 18h2"/>',
    bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>',
    shield: '<path d="M12 3.5 19 6v5.5c0 4.2-2.9 7.7-7 9-4.1-1.3-7-4.8-7-9V6z"/>',
    send: '<path d="M4.5 12 20 4.5l-4 15.5-4.2-6.3z"/><path d="m11.8 13.7 3.4-4.2"/>',
    reactAdd: '<circle cx="11" cy="12.5" r="7.5"/><path d="M8.3 14.6c1.4 1.5 4 1.5 5.4 0"/><circle cx="8.8" cy="10.6" r=".9" fill="currentColor"/><circle cx="13.2" cy="10.6" r=".9" fill="currentColor"/><path d="M19.5 2.5v5M17 5h5"/>',
    pin: '<path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0C18.5 15.4 12 21 12 21z"/><circle cx="12" cy="10" r="2.3"/>',
    calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 9.5h17M8 3v4M16 3v4"/>',
    ticket: '<path d="M3.5 7.5A1.5 1.5 0 0 1 5 6h14a1.5 1.5 0 0 1 1.5 1.5v2.2a2.4 2.4 0 0 0 0 4.6v2.2A1.5 1.5 0 0 1 19 18H5a1.5 1.5 0 0 1-1.5-1.5v-2.2a2.4 2.4 0 0 0 0-4.6z"/><path d="M14.5 6.5v11" stroke-dasharray="1.6 2"/>',
    edit: '<path d="M4.5 19.5 5.5 15 15.8 4.7a2 2 0 0 1 2.9 0l.6.6a2 2 0 0 1 0 2.9L9 18.5z"/>',
    filter: '<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>',
    sliders: '<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>',
    image: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><circle cx="9" cy="10" r="1.8"/><path d="m4 18 5-5 4 4 2.5-2.5L20 19"/>',
    star: '<path d="M12 4l2.4 5 5.4.6-4 3.7 1.1 5.3L12 16l-4.9 2.6 1.1-5.3-4-3.7 5.4-.6z"/>',
    swap: '<path d="M7 7h12l-3-3M17 17H5l3 3"/>',
    info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 8v.01"/>',
    hand: '<path d="M8 13V6.5a1.5 1.5 0 0 1 3 0V12M11 11V5a1.5 1.5 0 0 1 3 0v6M14 11V6.5a1.5 1.5 0 0 1 3 0V14c0 3.6-2.4 6.5-6 6.5-2.4 0-3.8-1.1-5-3l-2-3.3a1.4 1.4 0 0 1 2.3-1.6L8 14"/>',
  };

  // The Roxy O: the O of the wordmark (ring) with a face in its counter.
  // mood: open | happy | rest | think
  function roxyO(size, mood, ring) {
    const s = 56;
    const ringFill = ring || 'var(--pink)';
    const face = '#FFFDFD', eye = '#1A1216';
    const smile = `<path d="M21.6 33.2q4.6 3.4 9.8-.8" fill="none" stroke="${eye}" stroke-width="2.6" stroke-linecap="round"/>`;
    let eyes = '';
    if (mood === 'happy') eyes = `<path d="M18.6 27.2q2.8-4 5.6 0M28.4 27.2q2.8-4 5.6 0" fill="none" stroke="${eye}" stroke-width="2.8" stroke-linecap="round"/>` + `<path d="M21.2 32q5.2 4.8 10.6-.4" fill="none" stroke="${eye}" stroke-width="2.8" stroke-linecap="round"/>`;
    else if (mood === 'rest' || mood === 'blink') eyes = `<path d="M18.8 25.4q2.7 3.1 5.4 0M28.6 25.4q2.7 3.1 5.4 0" fill="none" stroke="${eye}" stroke-width="2.8" stroke-linecap="round"/>` + smile;
    else if (mood === 'think') eyes = `<ellipse cx="25.4" cy="23" rx="2.8" ry="3.6" fill="${eye}"/><ellipse cx="34.2" cy="23" rx="2.8" ry="3.6" fill="${eye}"/><path d="M25.4 33h6.4" stroke="${eye}" stroke-width="2.6" stroke-linecap="round"/>`;
    else eyes = `<ellipse cx="21.4" cy="25" rx="2.8" ry="3.7" fill="${eye}"/><ellipse cx="30.8" cy="25" rx="2.8" ry="3.7" fill="${eye}"/>` + smile;
    return `<svg class="roxy-o" width="${size}" height="${size}" viewBox="0 0 ${s} ${s}" aria-label="Roxy AI"><circle cx="28" cy="28" r="28" fill="${ringFill}"/><circle cx="28" cy="28" r="18" fill="${face}"/>${eyes}</svg>`;
  }
  window.roxyO = roxyO;

  document.querySelectorAll('svg[data-i]').forEach((s) => {
    s.setAttribute('viewBox', '0 0 24 24');
    s.classList.add('icon');
    s.innerHTML = P[s.dataset.i] || '';
  });
  document.querySelectorAll('[data-o]').forEach((el) => {
    el.innerHTML = roxyO(+el.dataset.size || 56, el.dataset.o, el.dataset.ring);
  });
  // status bar glyphs
  document.querySelectorAll('.status .sys').forEach((s) => {
    s.innerHTML = '<svg width="17" height="11" viewBox="0 0 17 11"><rect x="0" y="7" width="3" height="4" rx="1" fill="currentColor"/><rect x="4.5" y="5" width="3" height="6" rx="1" fill="currentColor"/><rect x="9" y="2.5" width="3" height="8.5" rx="1" fill="currentColor"/><rect x="13.5" y="0" width="3" height="11" rx="1" fill="currentColor"/></svg><svg width="25" height="12" viewBox="0 0 25 12"><rect x=".5" y=".5" width="21" height="11" rx="3" fill="none" stroke="currentColor" opacity=".5"/><rect x="2" y="2" width="16" height="8" rx="2" fill="currentColor"/></svg>';
  });
  // nav bars: <nav class="nav" data-on="feed|discover|messages|you" data-dot="messages">
  document.querySelectorAll('nav.nav[data-on]').forEach((n) => {
    const on = n.dataset.on, dot = n.dataset.dot || '';
    const L = n.dataset.labels ? n.dataset.labels.split('|') : ['Feed', 'Discover', 'Create', 'Messages', 'You'];
    const slot = (k, label) => `<div class="slot ${on === k ? 'on' : ''}"><span class="ind ${dot === k ? 'dot' : ''}"><svg data-i="${on === k ? k + 'On' : k}"></svg></span>${label}</div>`;
    n.innerHTML = slot('feed', L[0]) + slot('discover', L[1]) +
      `<div class="slot"><span class="create" aria-label="${L[2]}"><svg data-i="plus" style="width:24px;height:24px"></svg></span><span style="position:absolute;width:1px;height:1px;overflow:hidden">${L[2]}</span></div>` +
      slot('messages', L[3]) + slot('you', L[4]);
    n.querySelectorAll('svg[data-i]').forEach((s) => { s.setAttribute('viewBox', '0 0 24 24'); s.classList.add('icon'); s.innerHTML = P[s.dataset.i] || ''; });
  });
})();
