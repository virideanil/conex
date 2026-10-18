/* conex client: map + live speed test + "better internet nearby, right now". */
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const el = {
    phase: $('phase'), big: $('bigValue'), unit: $('bigUnit'), bar: $('bar'), start: $('startBtn'),
    where: $('where'), rDown: $('rDown'), rUp: $('rUp'), rLat: $('rLat'), rJit: $('rJit'),
    better: $('better'), betterList: $('betterList'), betterMeta: $('betterMeta'),
    feed: $('feed'), feedCount: $('feedCount'), online: $('onlineCount'), wsDot: $('wsDot'),
    message: $('message'), digest: $('digest'), verified: $('verified'), panel: $('panel'), grip: $('grip'),
    locate: $('locateBtn'),
  };

  const CLIENT_ID = (() => {
    try {
      const k = 'conex.client';
      let v = localStorage.getItem(k);
      if (!v) { v = Math.random().toString(36).slice(2, 12); localStorage.setItem(k, v); }
      return v;
    } catch { return Math.random().toString(36).slice(2, 12); }
  })();

  // ---------- map ----------
  const map = L.map('map', { zoomControl: false, attributionControl: true }).setView([20, 0], 2);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(map);
  L.control.zoom({ position: 'bottomleft' }).addTo(map);

  const layers = {
    results: L.layerGroup().addTo(map),
    others: L.layerGroup().addTo(map),
    spots: L.layerGroup().addTo(map),
  };

  const state = {
    pos: null, // {lat,lng,accuracy,source}
    centered: false,
    testing: false,
    last: null,
    results: new Map(), // id -> {result, marker}
    others: new Map(), // id -> {presence, marker}
  };

  const meIcon = (testing) => L.divIcon({ className: '', html: `<div class="me-marker${testing ? ' testing' : ''}"></div>`, iconSize: [16, 16], iconAnchor: [8, 8] });
  const meMarker = L.marker([0, 0], { icon: meIcon(false), zIndexOffset: 1000, interactive: false });
  let accuracyCircle = null;

  function setPosition(lat, lng, accuracy, source) {
    state.pos = { lat, lng, accuracy, source };
    if (!map.hasLayer(meMarker)) meMarker.addTo(map);
    meMarker.setLatLng([lat, lng]);
    if (accuracy && accuracy < 5000) {
      if (!accuracyCircle) accuracyCircle = L.circle([lat, lng], { radius: accuracy, color: '#62b5ff', weight: 1, fillOpacity: 0.05, interactive: false }).addTo(map);
      else accuracyCircle.setLatLng([lat, lng]).setRadius(accuracy);
    }
    if (!state.centered) { map.setView([lat, lng], 15); state.centered = true; }
    el.where.textContent = source === 'gps'
      ? `you: ${lat.toFixed(5)}, ${lng.toFixed(5)} (±${Math.round(accuracy || 0)} m, live)`
      : `you: ${lat.toFixed(5)}, ${lng.toFixed(5)} (set by tap)`;
    sendPresence('idle', 0);
    refreshNearby();
  }

  if ('geolocation' in navigator) {
    navigator.geolocation.watchPosition(
      (p) => { if (!state.pos || state.pos.source === 'gps') setPosition(p.coords.latitude, p.coords.longitude, p.coords.accuracy, 'gps'); },
      () => { if (!state.pos) el.where.textContent = 'location unavailable — tap the map to set where you are'; },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
    );
  } else {
    el.where.textContent = 'no geolocation — tap the map to set where you are';
  }
  map.on('click', (e) => { if (!state.testing) setPosition(e.latlng.lat, e.latlng.lng, null, 'tap'); });
  el.locate.addEventListener('click', () => { if (state.pos) map.flyTo([state.pos.lat, state.pos.lng], Math.max(map.getZoom(), 15)); });
  el.grip.addEventListener('click', () => el.panel.classList.toggle('collapsed'));

  // ---------- helpers ----------
  const fmt = (n, d = 1) => (n == null || !Number.isFinite(n) ? '—' : n.toFixed(d));
  const ago = (ts) => {
    const s = Math.max(0, (Date.now() - ts) / 1000);
    if (s < 60) return `${Math.round(s)}s ago`;
    if (s < 3600) return `${Math.round(s / 60)}m ago`;
    if (s < 86400) return `${Math.round(s / 3600)}h ago`;
    return `${Math.round(s / 86400)}d ago`;
  };
  const speedColor = (mbps) => (mbps >= 100 ? '#5ee0a0' : mbps >= 25 ? '#b5e05e' : mbps >= 5 ? '#ffb454' : '#ff6b6b');
  const distLabel = (km) => (km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(2)} km`);

  function setGauge(phase, value, unit, progress) {
    el.phase.textContent = phase;
    el.big.textContent = value == null ? '—' : fmt(value, value >= 100 ? 0 : 1);
    el.unit.textContent = unit;
    el.bar.style.width = `${Math.round(progress * 100)}%`;
  }

  // ---------- realtime ----------
  let ws = null;
  let wsTimer = null;
  function connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${proto}://${location.host}/ws`);
    ws.onopen = () => { el.wsDot.classList.add('on'); if (state.pos) sendPresence(state.testing ? 'testing' : 'idle', 0); };
    ws.onclose = () => { el.wsDot.classList.remove('on'); clearTimeout(wsTimer); wsTimer = setTimeout(connect, 2000); };
    ws.onerror = () => ws.close();
    ws.onmessage = (ev) => {
      let msg; try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.type === 'hello') { el.online.textContent = `${msg.online} online`; (msg.presence || []).forEach(upsertOther); }
      else if (msg.type === 'online') el.online.textContent = `${msg.online} online`;
      else if (msg.type === 'presence') upsertOther(msg.presence);
      else if (msg.type === 'leave') removeOther(msg.id);
      else if (msg.type === 'result') { addResult(msg.result, true); if (!state.testing) refreshBetter(); }
    };
  }
  let lastPresence = 0;
  function sendPresence(phase, value, force) {
    if (!ws || ws.readyState !== 1 || !state.pos) return;
    const now = Date.now();
    if (!force && now - lastPresence < 400) return;
    lastPresence = now;
    ws.send(JSON.stringify({ type: 'presence', id: CLIENT_ID, lat: state.pos.lat, lng: state.pos.lng, phase, value }));
  }

  function upsertOther(p) {
    if (!p || p.id === CLIENT_ID) return;
    let o = state.others.get(p.id);
    if (p.phase === 'idle') { if (o) { layers.others.removeLayer(o.marker); state.others.delete(p.id); } return; }
    if (!o) {
      o = { marker: L.marker([p.lat, p.lng], { icon: L.divIcon({ className: '', html: '<div class="other-marker"></div>', iconSize: [14, 14], iconAnchor: [7, 7] }) }).addTo(layers.others) };
      state.others.set(p.id, o);
    }
    o.presence = p;
    o.marker.setLatLng([p.lat, p.lng]);
    o.marker.bindTooltip(`${p.phase}: ${fmt(p.value)} ${p.phase === 'latency' ? 'ms' : 'Mbps'}`, { permanent: true, direction: 'top', offset: [0, -8], className: 'live-tip' });
  }
  function removeOther(id) {
    const o = state.others.get(id);
    if (o) { layers.others.removeLayer(o.marker); state.others.delete(id); }
  }
  setInterval(() => { // stale presence sweeps itself away
    for (const [id, o] of state.others) if (Date.now() - (o.presence?.ts || 0) > 20000) removeOther(id);
  }, 5000);

  // ---------- results on the map ----------
  function addResult(r, live) {
    if (state.results.has(r.id)) return;
    const marker = L.circleMarker([r.lat, r.lng], {
      radius: 7, color: '#fff', weight: 1, fillColor: speedColor(r.download), fillOpacity: 0.85,
    }).addTo(layers.results);
    marker.bindPopup(() => `<b>${fmt(r.download)} Mbps</b> down · ${fmt(r.upload)} up<br>${fmt(r.latency, 0)} ms latency · ${fmt(r.jitter, 0)} ms jitter<br><span style="color:#8a96a3">${ago(r.ts)}${r.source === 'seed' ? ' · demo point' : ''}${r.verified ? ' · ✓ message verified' : ''}</span>`);
    state.results.set(r.id, { result: r, marker });
    renderFeed(live ? r.id : null);
  }
  function renderFeed(highlightId) {
    const list = [...state.results.values()].map((x) => x.result).sort((a, b) => b.ts - a.ts).slice(0, 12);
    el.feedCount.textContent = state.results.size ? `· ${state.results.size} results` : '';
    el.feed.innerHTML = '';
    for (const r of list) {
      const li = document.createElement('li');
      if (r.id === highlightId) li.classList.add('live');
      li.innerHTML = `<span><span style="color:${speedColor(r.download)}">●</span> ${r.client === CLIENT_ID ? 'you' : r.source === 'seed' ? 'demo' : 'someone'} · ${ago(r.ts)}</span><span class="sp">${fmt(r.download)} ↓ ${fmt(r.upload)} ↑ ${fmt(r.latency, 0)}ms</span>`;
      li.addEventListener('click', () => { map.flyTo([r.lat, r.lng], Math.max(map.getZoom(), 15)); state.results.get(r.id)?.marker.openPopup(); });
      el.feed.appendChild(li);
    }
  }
  setInterval(() => { // fade older markers so the map reads as "right now"
    const now = Date.now();
    for (const { result, marker } of state.results.values()) {
      const age = now - result.ts;
      marker.setStyle({ fillOpacity: age > 3600e3 ? 0.25 : age > 900e3 ? 0.5 : 0.85 });
    }
    renderFeed();
  }, 30000);

  async function refreshNearby() {
    if (!state.pos) return;
    try {
      const res = await fetch(`/api/results?lat=${state.pos.lat}&lng=${state.pos.lng}&radius=25`, { cache: 'no-store' });
      const list = await res.json();
      list.forEach((r) => addResult(r, false));
    } catch { /* offline */ }
  }

  // ---------- better spots ----------
  const spotLines = [];
  async function refreshBetter() {
    if (!state.pos) return;
    const baseline = state.last?.download ?? 0;
    const res = await fetch(`/api/better?lat=${state.pos.lat}&lng=${state.pos.lng}&download=${baseline}&radius=2&window=60`, { cache: 'no-store' });
    const data = await res.json();
    layers.spots.clearLayers();
    spotLines.length = 0;
    el.betterList.innerHTML = '';
    el.better.classList.remove('hidden');
    el.betterMeta.textContent = `within ${data.radiusKm} km · last ${data.windowMin} min`;
    if (!data.spots.length) {
      const li = document.createElement('li');
      li.className = 'none';
      li.textContent = baseline
        ? `Nothing measured nearby in the last hour beats your ${fmt(baseline)} Mbps. You're the best spot we know of right now.`
        : 'No fresh measurements nearby yet. Run a test to put this place on the map.';
      el.betterList.appendChild(li);
      return;
    }
    data.spots.forEach((s, i) => {
      const n = i + 1;
      const marker = L.marker([s.lat, s.lng], { icon: L.divIcon({ className: '', html: `<div class="spot-marker">${n}</div>`, iconSize: [24, 24], iconAnchor: [12, 12] }) }).addTo(layers.spots);
      marker.bindPopup(`<b>#${n}: ${fmt(s.download)} Mbps</b> down · ${fmt(s.upload)} up · ${fmt(s.latency, 0)} ms<br>${distLabel(s.distanceKm)} ${s.direction} of you · ${s.samples} sample${s.samples > 1 ? 's' : ''} · ${ago(Date.now() - s.ageMs)}`);
      const line = L.polyline([[state.pos.lat, state.pos.lng], [s.lat, s.lng]], { color: '#5ee0a0', weight: 2, dashArray: '4 6', opacity: 0.7, interactive: false }).addTo(layers.spots);
      spotLines.push(line);
      const li = document.createElement('li');
      li.innerHTML = `<span class="n">${n}</span><span class="what"><span>${fmt(s.download)} Mbps ↓ · ${fmt(s.upload)} ↑ · ${fmt(s.latency, 0)} ms</span><small>${distLabel(s.distanceKm)} ${s.direction} · ${ago(Date.now() - s.ageMs)} · ${s.samples} sample${s.samples > 1 ? 's' : ''}</small></span><span class="gain">${s.gain ? `${s.gain.toFixed(1)}×` : ''}</span>`;
      li.addEventListener('click', () => { map.flyTo([s.lat, s.lng], Math.max(map.getZoom(), 16)); marker.openPopup(); });
      el.betterList.appendChild(li);
    });
  }

  // ---------- speed test engine ----------
  const PING_COUNT = 12;
  const DOWN_MS = 8000, UP_MS = 8000, STREAMS = 4;
  const DOWN_REQ_BYTES = 32 * 1024 * 1024;
  const UP_CHUNK_BYTES = 4 * 1024 * 1024;
  const WARMUP_MS = 1000;

  const median = (a) => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

  async function measureLatency() {
    const samples = [];
    for (let i = 0; i < PING_COUNT; i++) {
      const t0 = performance.now();
      await fetch(`/api/ping?r=${Math.random()}`, { cache: 'no-store' });
      const dt = performance.now() - t0;
      if (i > 0) samples.push(dt); // first one pays for connection setup
      setGauge('latency', dt, 'ms', (i + 1) / PING_COUNT);
      sendPresence('latency', dt);
    }
    const lat = median(samples);
    let jitter = 0;
    for (let i = 1; i < samples.length; i++) jitter += Math.abs(samples[i] - samples[i - 1]);
    jitter = samples.length > 1 ? jitter / (samples.length - 1) : 0;
    return { latency: lat, jitter };
  }

  // Runs `worker` on STREAMS parallel lanes for `durationMs`, calling `onBytes`
  // as data moves. Returns the Mbps computed after the warmup window.
  async function runLanes(durationMs, phase, makeLane) {
    const ctl = new AbortController();
    const t0 = performance.now();
    let total = 0;
    let warmBytes = 0, warmT = null;
    const window = []; // [t, total] for the instantaneous reading
    const onBytes = (n) => {
      total += n;
      const t = performance.now();
      if (warmT === null && t - t0 >= WARMUP_MS) { warmT = t; warmBytes = total; }
      window.push([t, total]);
      while (window.length && t - window[0][0] > 700) window.shift();
    };
    const ticker = setInterval(() => {
      const t = performance.now();
      const elapsed = t - t0;
      let inst = 0;
      if (window.length > 1) {
        const [ta, ba] = window[0]; const [tb, bb] = window[window.length - 1];
        if (tb > ta) inst = ((bb - ba) * 8) / ((tb - ta) / 1000) / 1e6;
      }
      setGauge(phase, inst, 'Mbps', Math.min(1, elapsed / durationMs));
      sendPresence(phase, inst);
    }, 200);
    const lanes = Array.from({ length: STREAMS }, () => makeLane(ctl.signal, onBytes).catch(() => {}));
    await new Promise((r) => setTimeout(r, durationMs));
    ctl.abort();
    clearInterval(ticker);
    await Promise.allSettled(lanes);
    const tEnd = performance.now();
    const bytes = warmT === null ? total : total - warmBytes;
    const secs = ((warmT === null ? tEnd - t0 : tEnd - warmT)) / 1000;
    return secs > 0 ? (bytes * 8) / secs / 1e6 : 0;
  }

  const downloadLane = async (signal, onBytes) => {
    while (!signal.aborted) {
      const res = await fetch(`/api/download?bytes=${DOWN_REQ_BYTES}&r=${Math.random()}`, { cache: 'no-store', signal });
      const reader = res.body.getReader();
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        onBytes(value.byteLength);
      }
    }
  };

  // Upload sends the same SHAKE256 bytes back: we fetch block 0 once, then
  // repeat it, so the server can verify the message survived the trip.
  let uploadBlob = null;
  async function uploadPayload() {
    if (uploadBlob) return uploadBlob;
    const res = await fetch('/api/download?bytes=65536', { cache: 'no-store' });
    const block = await res.arrayBuffer();
    uploadBlob = new Blob(Array.from({ length: UP_CHUNK_BYTES / 65536 }, () => block), { type: 'application/octet-stream' });
    return uploadBlob;
  }
  let lastVerified = null;
  const uploadLane = (blob) => (signal, onBytes) => new Promise((resolve, reject) => {
    const next = () => {
      if (signal.aborted) return resolve();
      const xhr = new XMLHttpRequest();
      let seen = 0;
      xhr.open('POST', `/api/upload?r=${Math.random()}`);
      xhr.setRequestHeader('Content-Type', 'application/octet-stream');
      xhr.upload.onprogress = (e) => { onBytes(e.loaded - seen); seen = e.loaded; };
      xhr.onload = () => { try { lastVerified = JSON.parse(xhr.responseText).verified; } catch {} next(); };
      xhr.onerror = () => reject(new Error('upload failed'));
      xhr.onabort = () => resolve();
      signal.addEventListener('abort', () => xhr.abort(), { once: true });
      xhr.send(blob);
    };
    next();
  });

  async function runTest() {
    if (state.testing) return;
    if (!state.pos) { el.where.textContent = 'tap the map to set where you are first'; return; }
    state.testing = true;
    el.start.disabled = true;
    el.better.classList.add('hidden');
    meMarker.setIcon(meIcon(true));
    [el.rDown, el.rUp, el.rLat, el.rJit].forEach((x) => (x.textContent = '—'));
    try {
      const { latency, jitter } = await measureLatency();
      el.rLat.textContent = fmt(latency, 0); el.rJit.textContent = fmt(jitter, 0);

      const download = await runLanes(DOWN_MS, 'download', downloadLane);
      el.rDown.textContent = fmt(download);

      const blob = await uploadPayload();
      const upload = await runLanes(UP_MS, 'upload', uploadLane(blob));
      el.rUp.textContent = fmt(upload);
      el.verified.textContent = lastVerified == null ? '—' : lastVerified ? 'yes' : 'no';

      setGauge('done', download, 'Mbps', 1);
      state.last = { download, upload, latency, jitter };
      const body = { ...state.last, lat: state.pos.lat, lng: state.pos.lng, accuracy: state.pos.accuracy, verified: !!lastVerified, client: CLIENT_ID };
      const res = await fetch('/api/results', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (res.ok) addResult(await res.json(), true);
      await refreshBetter();
    } catch (err) {
      setGauge('error', null, '', 0);
      el.where.textContent = `test failed: ${err.message}`;
    } finally {
      state.testing = false;
      el.start.disabled = false;
      el.start.textContent = 'Test again';
      meMarker.setIcon(meIcon(false));
      sendPresence('idle', 0, true);
    }
  }
  el.start.addEventListener('click', runTest);

  // ---------- boot ----------
  fetch('/api/info', { cache: 'no-store' }).then((r) => r.json()).then((info) => {
    el.message.textContent = info.message;
    el.digest.textContent = info.digest;
  }).catch(() => {});
  connect();
  refreshNearby();
})();
