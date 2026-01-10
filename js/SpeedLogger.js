// SpeedLogger.js — FINAL OPTIMIZED VERSION
// Perbaikan Performa:
// 1. Sampling Rate diturunkan (100ms -> 500ms) untuk menghemat memori.
// 2. Auto-render tabel dimatikan (hanya render saat tombol Refresh ditekan) untuk mencegah lag.
// 3. Fitur hitung Delay & Rekapitulasi tetap utuh dan akurat.

export const SpeedLogger = (() => {
  // ----- Config -----
  const PX_PER_M_DEFAULT = 10;        // default px per meter (1 m = 10 px)
  const MAX_SAMPLES = 600;            // kapasitas sampel
  const SAMPLE_MIN_ROWS = 30;         // rows displayed per vehicle in table
  const DEFAULT_CONTAINER_ID = "speed-table-container";

  // ----- Internal storage -----
  const activeLogs = {};   // key -> { samples: [ {timestamp,x_px,y_px} ], meta }
  const finished = [];     // finished entries (aggregated results)

  const DIRECTIONS_12 = [
    "Utara → Selatan","Utara → Timur","Utara → Barat",
    "Timur → Barat","Timur → Selatan","Timur → Utara",
    "Selatan → Utara","Selatan → Barat","Selatan → Timur",
    "Barat → Timur","Barat → Utara","Barat → Selatan"
  ];

  // ----- Utilities -----
  function nowSec() {
    if (typeof performance !== "undefined" && performance.now) return performance.now() / 1000;
    return Date.now() / 1000;
  }

  function vehKeyOf(v) {
    if (!v) return null;
    return String(v.displayId ?? v.id ?? v.vehicleId ?? (`veh_${Date.now()}`));
  }

  function cap(s) { if (s == null) return "-"; s = String(s); return s.charAt(0).toUpperCase() + s.slice(1); }

  function sanitizeFilename(s) { return String(s).replace(/[^a-z0-9_\-\.]/gi, "_"); }

  // Normalizes short direction tokens to full Indonesian names
  function normalizeDirection(d) {
    if (!d) return "-";
    const s = String(d).toLowerCase();
    if (s.startsWith("u") || s === "utara") return "Utara";
    if (s.startsWith("t") || s === "timur") return "Timur";
    if (s.startsWith("s") || s === "selatan") return "Selatan";
    if (s.startsWith("b") || s === "barat") return "Barat";
    return cap(d);
  }

  // ----- Maneuver mapping (canvas exitDir -> actual target) -----
  function mapExitDirForManeuver(from, exitDirCanvas) {
    if (!from || !exitDirCanvas) return "-";
    const f = normalizeDirection(from);
    const e = normalizeDirection(exitDirCanvas);

    const map = {
      "Utara":  { "Timur": "Timur", "Selatan": "Selatan", "Barat": "Barat" },
      "Timur":  { "Selatan": "Selatan", "Barat": "Barat", "Utara": "Utara" },
      "Selatan":{ "Barat": "Barat",   "Utara": "Utara",  "Timur": "Timur" },
      "Barat":  { "Utara": "Utara",   "Timur": "Timur",  "Selatan":"Selatan" }
    };

    return map[f]?.[e] ?? "-";
  }

  function determineManeuver(from, to) {
    if (!from || !to) return null;
    const f = from.toLowerCase();
    const t = to.toLowerCase();

    if ((f === "utara"  && t === "selatan") ||
        (f === "selatan" && t === "utara")   ||
        (f === "timur"   && t === "barat")   ||
        (f === "barat"   && t === "timur"))
      return "straight";

    if ((f === "utara"  && t === "barat")   ||
        (f === "barat"  && t === "selatan") ||
        (f === "selatan" && t === "timur")  ||
        (f === "timur"  && t === "utara"))
      return "right";

    if ((f === "utara"  && t === "timur")   ||
        (f === "timur"  && t === "selatan") ||
        (f === "selatan" && t === "barat")  ||
        (f === "barat"  && t === "utara"))
      return "left";

    return null;
  }

  // Build metadata from vehicle object (used when first observed)
  function buildMetaFromVehicle(v) {
    if (!v) return { id: "-", jenis: "-", arah: "-", maneuver: "-" };
    const id = String(v.displayId ?? v.id ?? v.vehicleId ?? ("veh_" + Date.now()));
    const jenis = v.type ?? v.jenis ?? "-";
    const from = normalizeDirection(v.direction);
    // prefer explicit exitDir from vehicle (vehmov sets v.exitDir), fallback to v.route/turn
    const mappedTo = (typeof v.exitDir === "string" && v.exitDir.length > 0) ? mapExitDirForManeuver(from, v.exitDir) : (v.route ? normalizeDirection(v.route) : (v.turn ? normalizeDirection(v.turn) : "-"));
    const to = (mappedTo === "-" && typeof v.route === "string") ? normalizeDirection(v.route) : mappedTo;
    const arahLong = `${from} → ${to}`;
    const maneuver = determineManeuver(from, to);
    return { id, jenis, arah: arahLong, maneuver };
  }

  // ----- Public lifecycle helpers -----
  function onSpawn(vehicle, simTimeMs = (Date.now())) {
    if (!vehicle) return;
    const x = (typeof vehicle.x === 'number') ? vehicle.x : (typeof vehicle.frontX === 'number' ? vehicle.frontX : 0);
    const y = (typeof vehicle.y === 'number') ? vehicle.y : (typeof vehicle.frontY === 'number' ? vehicle.frontY : 0);
    
    vehicle._enteredCanvas = false;
    vehicle._entryTimeMs = null;
    vehicle._exitTimeMs = null;
    vehicle._vlog = {
      lastPos: { x, y },
      lastTimeMs: simTimeMs,
      distanceAccumPx: 0,
      totalStopDurationMs: 0,
      stopStartedAtMs: null
    };
  }

  function logFrame(v, pxPerMeter = PX_PER_M_DEFAULT) {
    if (!v) return;
    const key = vehKeyOf(v); if (!key) return;
    if (!activeLogs[key]) activeLogs[key] = { samples: [], meta: buildMetaFromVehicle(v) };
    const arr = activeLogs[key].samples;

    const t_ms = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    const x_px = (typeof v.x === 'number') ? v.x : (typeof v.frontX === 'number' ? v.frontX : null);
    const y_px = (typeof v.y === 'number') ? v.y : (typeof v.frontY === 'number' ? v.frontY : null);

    // --- Detect first time vehicle enters canvas ---
    const CANVAS_WIDTH = window.simCanvas?.width ?? 800;
    const CANVAS_HEIGHT = window.simCanvas?.height ?? 800;

    const insideCanvas = (
      x_px >= 0 && x_px <= CANVAS_WIDTH &&
      y_px >= 0 && y_px <= CANVAS_HEIGHT
    );

    if (!v._enteredCanvas) {
      if (insideCanvas) {
        v._enteredCanvas = true;
        v._entryTimeMs = t_ms;   // ✅ waktu masuk PERTAMA KALI
      } else {
        return;
      }
    }

    // --- OPTIMASI 1: Sample Interval dinaikkan jadi 500ms ---
    const SAMPLE_INTERVAL_MS = 500; 
    
    if (!activeLogs[key]._lastSampleTimeMs) {
      activeLogs[key]._lastSampleTimeMs = t_ms;
    } else {
      if (t_ms - activeLogs[key]._lastSampleTimeMs < SAMPLE_INTERVAL_MS) {
        return; 
      }
      activeLogs[key]._lastSampleTimeMs = t_ms;
    }

    arr.push({ timestamp_ms: t_ms, x_px, y_px });

    // keep array bounded to MAX_SAMPLES
    if (arr.length > MAX_SAMPLES) arr.splice(0, arr.length - MAX_SAMPLES);
  }

  // ----- finalizeVehicle: compute distances, durations, speeds -----
  function finalizeVehicle(v, pxPerMeter = PX_PER_M_DEFAULT) {
    v._exitTimeMs = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    
    if (!v) return;
    const key = vehKeyOf(v); if (!key) return;
    const entry = activeLogs[key];
    if (!entry || !entry.samples || entry.samples.length < 2) { 
        delete activeLogs[key]; return; 
    }

    // copy and delete active log
    const samples = entry.samples.slice();
    delete activeLogs[key];

    // convert to rows with meters and times (seconds)
    const rows = [];
    for (let i = 0; i < samples.length; i++) {
      const s = samples[i];
      rows.push({
        timestamp_ms: s.timestamp_ms,
        timestamp_s: (s.timestamp_ms == null ? null : (s.timestamp_ms / 1000)),
        x_px: s.x_px, y_px: s.y_px,
        x_m: (s.x_px == null) ? null : (s.x_px / pxPerMeter),
        y_m: (s.y_px == null) ? null : (s.y_px / pxPerMeter),
        dx: null, dy: null, dist_m: null, v_frame_mps: null
      });
    }

    // accumulate per-step distances and instantaneous speeds
    let totalDist = 0;
    let maxSpeed_mps = 0;
    for (let i = 1; i < rows.length; i++) {
      const prev = rows[i-1], cur = rows[i];
      if (prev.x_m == null || cur.x_m == null || prev.timestamp_s == null || cur.timestamp_s == null) {
        cur.dx = null; cur.dy = null; cur.dist_m = null; cur.v_frame_mps = null;
        continue;
      }
      const dx = cur.x_m - prev.x_m;
      const dy = cur.y_m - prev.y_m;
      const dist_m = Math.hypot(dx, dy);
      const dt_s = cur.timestamp_s - prev.timestamp_s;
      const v_mps = (dt_s > 0.001) ? (dist_m / dt_s) : 0;

      cur.dx = dx; cur.dy = dy; cur.dist_m = dist_m; cur.v_frame_mps = v_mps;

      totalDist += dist_m;
      if (v_mps > maxSpeed_mps) maxSpeed_mps = v_mps;
    }

    // pad rows up to SAMPLE_MIN_ROWS for table consistency
    while (rows.length < SAMPLE_MIN_ROWS) {
      rows.push({ timestamp_ms: null, timestamp_s: null, x_px: null, y_px: null, x_m: null, y_m: null, dx: null, dy: null, dist_m: null, v_frame_mps: null });
    }

    // Hitung durasi (pake _entryTimeMs dan _exitTimeMs jika ada)
    let travelTimeSec = 0;
    if (v._entryTimeMs && v._exitTimeMs) {
        travelTimeSec = (v._exitTimeMs - v._entryTimeMs) / 1000;
    } else {
        const t0 = samples[0].timestamp_ms;
        const t1 = samples[samples.length - 1].timestamp_ms;
        travelTimeSec = (t1 - t0) / 1000;
    }
    if (travelTimeSec <= 0) travelTimeSec = 0.001;

    const v_individu_mps = (travelTimeSec > 0) ? (totalDist / travelTimeSec) : 0;
    const v_kmh = v_individu_mps * 3.6;

    // meta
    const meta = entry.meta || buildMetaFromVehicle(v);

    // === HITUNG TUNDAAN (DELAY) DISINI ===
    
    // FFS (Kecepatan Arus Bebas) referensi MKJI (m/s)
    const FFS_REF = { motor: 9.72 /*35kmh*/, mobil: 8.33 /*30kmh*/, truk: 5.56 /*20kmh*/ };
    
    const j = (meta.jenis || "").toLowerCase();
    let ffs = FFS_REF.mobil; 
    if (j.includes("motor")) ffs = FFS_REF.motor;
    else if (j.includes("truk") || j.includes("truck")) ffs = FFS_REF.truk;

    // Rumus Tundaan: Waktu Aktual - (Jarak / Kec. Bebas)
    const waktuIdeal = totalDist / ffs;
    let delay = travelTimeSec - waktuIdeal;
    if (delay < 0) delay = 0;

    // finished entry
    const finishedEntry = {
      id: meta.id,
      jenis: meta.jenis,
      arah: meta.arah,
      maneuver: meta.maneuver,
      v_individu: v_individu_mps, // m/s
      v_kmh: v_kmh,               // km/h
      data: rows,
      totalDistM: (isFinite(totalDist) ? Number(totalDist) : null),
      totalTimeSec: (isFinite(travelTimeSec) ? Number(travelTimeSec) : null),
      ffs_mps: ffs,
      delaySec: (isFinite(delay) ? delay : null) // Hasil perhitungan delay disimpan di sini
    };

    finished.push(finishedEntry);

    // --- OPTIMASI 2: MATIKAN AUTO-RENDER ---
    // Jangan render tabel setiap kali kendaraan keluar agar simulasi tidak stutter.
    // User wajib menekan tombol "Refresh" di UI untuk melihat data.
    
    // try { renderAllToContainer(); } catch(e) { console.warn("Render error:", e); }
  }

  // ----- Aggregation & Rekap (computeRekapAllDirections) -----
  // Produces stats per each of DIRECTIONS_12 and per vehicle type
  function computeRekapAllDirections() {

    const out = {};
    const initStat = () => ({ count:0, sum:0, sumKmh:0, avg:null, avgKmh:null });

    for (const dir of DIRECTIONS_12) {
      out[dir] = {
        motor: initStat(), mobil: initStat(), truk: initStat(),
        customAvg: null, customAvgKmh: null,
        delaySeconds: null, 
        rawDelays: []
      };
    }

    // === STEP 1: kumpulkan speed & delay per kendaraan ===
    for (const e of finished) {
      const dir = e.arah;
      if (!dir || !out[dir]) continue;

      const jenis = (e.jenis || "").toLowerCase();
      let grp = out[dir].mobil;
      if (jenis.includes("motor")) grp = out[dir].motor;
      else if (jenis.includes("truk")) grp = out[dir].truk;

      // Speed stats
      grp.count++;
      grp.sum += (e.v_individu || 0);
      grp.sumKmh += (e.v_kmh || 0);

      // Delay stats (ambil dari property delaySec yang sudah dihitung di finalizeVehicle)
      if (typeof e.delaySec === 'number' && isFinite(e.delaySec)) {
        out[dir].rawDelays.push(e.delaySec);
      }
    }

    // === STEP 2: hitung rata-rata ===
    for (const dir of Object.keys(out)) {
      const d = out[dir];
      
      const calc = (o) => { o.avg = o.count? o.sum/o.count : null; o.avgKmh = o.count? o.sumKmh/o.count : null; };
      calc(d.motor); calc(d.mobil); calc(d.truk);

      // Hitung customAvg (rata-rata dari jenis yang tersedia)
      const values = [d.motor.avg, d.mobil.avg, d.truk.avg].filter(v => v != null);
      if (values.length) {
        const avg = values.reduce((a,b)=>a+b,0) / values.length;
        d.customAvg = avg;
        d.customAvgKmh = avg * 3.6;
      }

      // Rata-rata Tundaan per Arah
      if (d.rawDelays.length > 0) {
        d.delaySeconds = d.rawDelays.reduce((a,b)=>a+b,0) / d.rawDelays.length;
      }
    }

    return out;
  }

  // ----- Rendering & CSV export -----
  // Minimal but usable UI renderer into an HTML container
  function ensureContainerStructure(containerEl) {
    if (!containerEl) return;
    if (!containerEl._sl_style) {
      const style = document.createElement("style");
      style.textContent = `
        #${containerEl.id} { font-family: Arial, sans-serif; gap: 12px; display:flex; flex-wrap:wrap; }
        #${containerEl.id} .sl-card { border:1px solid #ddd; border-radius:6px; padding:8px; background:transparent; box-shadow:0 1px 3px rgba(0,0,0,0.04); width:48%; min-width:360px; margin:6px; color:#000; }
        #${containerEl.id} .sl-rekap-card { width:100%; min-width:680px; }
        #${containerEl.id} table { width:100%; border-collapse:collapse; font-size:12px; }
        #${containerEl.id} th, #${containerEl.id} td { border:1px solid #eee; padding:6px; text-align:center; vertical-align:middle; }
        #${containerEl.id} th { background:#000; color:#fff; font-weight:600; }
        #${containerEl.id} .sl-empty { color:#fff; font-size:11px; font-style:italic; }
        #${containerEl.id} .unit-sub { font-size:0.85em; color:#666; display:block; margin-top:2px; }
      `;
      document.head.appendChild(style);
      containerEl._sl_style = true;
    }

    if (!containerEl._sl_init) {
      containerEl.innerHTML = "";
      const rekCard = document.createElement("div");
      rekCard.className = "sl-card sl-rekap-card";
      rekCard.innerHTML = `<h4>Rekap Kecepatan Semua Lengan (m/s & km/jam)</h4><div class="sl-rekap-wrap"><div class="sl-empty">Belum ada data rekap (Klik Refresh)</div></div>`;
      containerEl.appendChild(rekCard);

      for (const dir of DIRECTIONS_12) {
        const card = document.createElement("div"); card.className = "sl-card";
        card.dataset.direction = dir;
        const title = document.createElement("h4"); title.textContent = dir; card.appendChild(title);
        const meta = document.createElement("div"); meta.className = "sl-meta";
        const metaLeft = document.createElement("div"); metaLeft.className = "sl-meta-left"; metaLeft.innerHTML = `<span class="sl-empty">Belum ada data</span>`;
        meta.appendChild(metaLeft);
        const actions = document.createElement("div"); actions.className = "sl-actions";
        const btnExport = document.createElement("button"); btnExport.type="button"; btnExport.textContent="Export CSV"; btnExport.addEventListener("click", ()=> exportDirectionCSV(dir));
        const btnRefresh = document.createElement("button"); btnRefresh.type="button"; btnRefresh.textContent="Refresh"; btnRefresh.addEventListener("click", ()=> renderAllToContainer(containerEl.id));
        actions.appendChild(btnExport); actions.appendChild(btnRefresh);
        meta.appendChild(actions);
        card.appendChild(meta);
        const wrap = document.createElement("div"); wrap.className = "sl-table-wrap"; wrap.innerHTML = `<div class="sl-empty">Tunggu data kendaraan keluar.</div>`;
        card.appendChild(wrap);
        containerEl.appendChild(card);
      }
      containerEl._sl_init = true;
    }
  }

  function renderRekapTable(containerEl) {
    if (!containerEl) containerEl = document.getElementById(DEFAULT_CONTAINER_ID);
    if (!containerEl) return;
    ensureContainerStructure(containerEl);
    const rekCard = containerEl.querySelector(".sl-rekap-card");
    if (!rekCard) return;
    const wrap = document.createElement("div"); wrap.className = "sl-rekap-wrap";
    wrap.innerHTML = "";

    const rekap = computeRekapAllDirections();

    const tbl = document.createElement("table");
    const thead = document.createElement("thead");
    const trh = document.createElement("tr");

    ["Arah","Motor","Mobil","Truk","Rata-rata","FFS Motor","FFS Mobil","FFS Truk","Tundaan (s)"]
      .forEach(h => {
        const th = document.createElement("th");
        th.textContent = h;
        trh.appendChild(th);
      });

    thead.appendChild(trh);
    tbl.appendChild(thead);

    const tbody = document.createElement("tbody");
    const createDualCell = (vMs, vKmh) => {
      const td = document.createElement("td");
      if (vMs == null) { td.textContent = "-"; return td; }
      const main = document.createElement("span");
      main.innerHTML = `<b>${vKmh.toFixed(2)} km/jam</b>`;
      const sub = document.createElement("span");
      sub.className = "unit-sub";
      sub.textContent = `(${vMs.toFixed(2)} m/s)`;
      td.appendChild(main);
      td.appendChild(sub);
      return td;
    };

    for (const dir of DIRECTIONS_12) {
      const s = rekap[dir];
      const tr = document.createElement("tr");
      const tdDir = document.createElement("td"); tdDir.textContent = dir; tr.appendChild(tdDir);
      
      tr.appendChild(createDualCell(s.motor.avg, s.motor.avgKmh));
      tr.appendChild(createDualCell(s.mobil.avg, s.mobil.avgKmh));
      tr.appendChild(createDualCell(s.truk.avg, s.truk.avgKmh));
      tr.appendChild(createDualCell(s.customAvg, s.customAvgKmh));
      
      const tdFFSm = document.createElement("td"); tdFFSm.textContent = "35 km/jam"; tr.appendChild(tdFFSm);
      const tdFFSc = document.createElement("td"); tdFFSc.textContent = "30 km/jam"; tr.appendChild(tdFFSc);
      const tdFFSt = document.createElement("td"); tdFFSt.textContent = "20 km/jam"; tr.appendChild(tdFFSt);

      // Tampilkan Delay
      const tdDelay = document.createElement("td"); 
      if (s.delaySeconds !== null) {
          tdDelay.innerHTML = `<b>${s.delaySeconds.toFixed(2)} s</b>`;
          if (s.delaySeconds > 0) tdDelay.style.color = "red";
      } else {
          tdDelay.textContent = "-";
      }
      tr.appendChild(tdDelay);
      
      tbody.appendChild(tr);
    }
    tbl.appendChild(tbody);

    const actions = document.createElement("div"); actions.style.marginTop="8px"; actions.style.textAlign="right";
    const btnCSV = document.createElement("button"); btnCSV.type="button"; btnCSV.textContent="Export Rekap CSV"; btnCSV.addEventListener("click", ()=> exportRekapCSV());
    actions.appendChild(btnCSV);
    wrap.appendChild(tbl); wrap.appendChild(actions);

    rekCard.querySelectorAll(".sl-rekap-wrap").forEach(n => n.remove());
    rekCard.appendChild(wrap);
  }

  function renderAllToContainer(containerId = DEFAULT_CONTAINER_ID) {
    const containerEl = document.getElementById(containerId);
    if (!containerEl) return;
    ensureContainerStructure(containerEl);

    // group finished by arah
    const groups = {};
    for (const d of DIRECTIONS_12) groups[d] = [];
    for (const e of finished) {
      const dir = (e.arah && typeof e.arah === 'string') ? e.arah : null;
      if (!dir) continue;
      if (groups[dir]) groups[dir].push(e);
      else {
        // best effort: match by origin
        const origin = (e.arah || "").split("→")[0]?.trim();
        const found = DIRECTIONS_12.find(d => d.startsWith(origin));
        if (found) groups[found].push(e);
      }
    }

    renderRekapTable(containerEl);

    const cards = Array.from(containerEl.querySelectorAll(".sl-card")).filter(c => !c.classList.contains("sl-rekap-card"));
    for (const card of cards) {
      const dir = card.dataset.direction;
      const list = groups[dir] || [];
      const tableWrap = card.querySelector(".sl-table-wrap");
      const metaLeft = card.querySelector(".sl-meta-left");
      tableWrap.innerHTML = "";
      if (!list || list.length === 0) {
        metaLeft.innerHTML = `<span class="sl-empty">Belum ada data</span>`;
        tableWrap.innerHTML = `<div class="sl-empty">Tunggu data kendaraan keluar (Klik Refresh).</div>`;
        continue;
      }
      metaLeft.innerHTML = `<div><strong>${list.length}</strong> kendaraan tercatat</div>`;
      const sorted = list.slice().sort((a,b)=> (b.totalTimeSec||0) - (a.totalTimeSec||0));
      const maxShown = 3;
      for (let i=0;i<Math.min(maxShown, sorted.length); i++) {
        const entry = sorted[i];
        const wrapper = document.createElement("div"); wrapper.style.marginBottom="10px";
        const hdr = document.createElement("div"); hdr.style.display="flex"; hdr.style.justifyContent="space-between";
        hdr.innerHTML = `<div><strong>${entry.id}</strong> — ${entry.jenis} — ${entry.arah}</div>`;
        const btn = document.createElement("button"); btn.type="button"; btn.textContent="CSV"; btn.addEventListener("click", ()=> exportSingleCSV(entry));
        hdr.appendChild(btn); wrapper.appendChild(hdr);

        const tbl = document.createElement("table");
        const thead = document.createElement("thead"); const trh = document.createElement("tr");
        ["ID","Time(s)","X(m)","Y(m)","Perpindahan(m)"].forEach(h => { const th=document.createElement("th"); th.textContent=h; trh.appendChild(th); });
        thead.appendChild(trh); tbl.appendChild(thead);
        const tbody = document.createElement("tbody");
        for (let r=0;r<Math.max(SAMPLE_MIN_ROWS, entry.data.length); r++) {
          const row = entry.data[r] || { timestamp_s:null, x_m:null, y_m:null, dist_m:null, v_frame_mps:null };
          const tr = document.createElement("tr");
          const td1 = document.createElement("td"); td1.textContent = entry.id; tr.appendChild(td1);
          const td2 = document.createElement("td"); td2.textContent = (row.timestamp_s ? row.timestamp_s.toFixed(3) : "-"); tr.appendChild(td2);
          const td3 = document.createElement("td"); td3.textContent = (row.x_m != null ? Number(row.x_m).toFixed(2) : "-"); tr.appendChild(td3);
          const td4 = document.createElement("td"); td4.textContent = (row.y_m != null ? Number(row.y_m).toFixed(2) : "-"); tr.appendChild(td4);
          const td5 = document.createElement("td"); td5.textContent = (row.dist_m != null ? Number(row.dist_m).toFixed(3) : "-"); tr.appendChild(td5);
          tbody.appendChild(tr);
        }
        tbl.appendChild(tbody);
        const foot = document.createElement("div"); foot.style.marginTop="6px"; foot.innerHTML = `<small>Kecepatan Individu: <strong>${entry.v_individu==null? "-" : Number(entry.v_individu).toFixed(2)} m/s</strong> (${entry.v_kmh==null?"-":Number(entry.v_kmh).toFixed(2)} km/jam) — Jarak: ${entry.totalDistM==null?"-":Number(entry.totalDistM).toFixed(2)} m — Waktu: ${entry.totalTimeSec==null?"-":Number(entry.totalTimeSec).toFixed(2)} s — Delay: ${entry.delaySec==null?"-":entry.delaySec.toFixed(2)} s</small>`;
        wrapper.appendChild(tbl); wrapper.appendChild(foot); tableWrap.appendChild(wrapper);
      }
    }
  }

  // ----- CSV exports -----
  function exportSingleCSV(entry) {
    if (!entry) return;
    const rows = [];
    const headerMeta = [
      ["ID Kendaraan", entry.id],
      ["Jenis kendaraan", entry.jenis],
      ["Arah", entry.arah],
      ["Kecepatan individu (m/s)", (entry.v_individu==null?"-":entry.v_individu)],
      ["Kecepatan individu (km/jam)", (entry.v_kmh==null?"-":entry.v_kmh)],
      ["Total Jarak (m)", (entry.totalDistM==null?"":entry.totalDistM)],
      ["Total Waktu (s)", (entry.totalTimeSec==null?"":entry.totalTimeSec)],
      ["Tundaan (s)", (entry.delaySec==null?"":entry.delaySec)],
      []
    ];
    headerMeta.forEach(r=>rows.push(r.join(",")));
    rows.push(["Timestamp (s)","Posisi X (px)","Posisi Y (px)","Posisi X (m)","Posisi Y (m)","dx (m)","dy (m)","Dist per step (m)","Kecepatan (m/s)"].join(","));
    for (const r of entry.data) {
      rows.push([
        (r.timestamp_s==null?"":(r.timestamp_s.toFixed? r.timestamp_s.toFixed(3): r.timestamp_s)),
        (r.x_px==null?"":r.x_px),
        (r.y_px==null?"":r.y_px),
        (r.x_m==null?"":(Number(r.x_m).toFixed(3))),
        (r.y_m==null?"":(Number(r.y_m).toFixed(3))),
        (r.dx==null?"":(Number(r.dx).toFixed(4))),
        (r.dy==null?"":(Number(r.dy).toFixed(4))),
        (r.dist_m==null?"":(Number(r.dist_m).toFixed(4))),
        (r.v_frame_mps==null?"":(Number(r.v_frame_mps).toFixed(4)))
      ].join(","));
    }
    const csv = rows.join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `speed_${sanitizeFilename(entry.id)}.csv`;
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  }

  function exportRekapCSV() {
    const rekap = computeRekapAllDirections();
    const lines = [];
    lines.push(["Arah","Motor(m/s)","Mobil(m/s)","Truk(m/s)","Rata2(km/jam)","Tundaan(detik)"].join(","));
    for (const dir of DIRECTIONS_12) {
      const s = rekap[dir];
      lines.push([
          dir,
          (s.motor.avg||0).toFixed(2),
          (s.mobil.avg||0).toFixed(2),
          (s.truk.avg||0).toFixed(2),
          (s.customAvgKmh||0).toFixed(2),
          (s.delaySeconds||0).toFixed(2)
      ].join(","));
    }
    const csv = lines.join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "speed_rekap.csv"; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  }

  function exportDirectionCSV(directionString) {
    if (!directionString) return;
    const entries = finished.filter(e => e.arah === directionString);
    if (!entries || entries.length === 0) { alert(`Tidak ada data untuk arah: ${directionString}`); return; }
    // join CSV for these entries
    const parts = [];
    for (const ent of entries) {
      const rows = [];
      rows.push(`ID Kendaraan,${ent.id}`);
      rows.push(`Jenis,${ent.jenis}`);
      rows.push(`Arah,${ent.arah}`);
      rows.push(`Kecepatan individu (m/s),${ent.v_individu==null?"":ent.v_individu}`);
      rows.push(`Total Jarak (m),${ent.totalDistM==null?"":ent.totalDistM}`);
      rows.push(`Tundaan (s),${ent.delaySec==null?"":ent.delaySec}`);
      rows.push("");
      rows.push(["Timestamp (s)","Posisi X (px)","Posisi Y (px)","Posisi X (m)","Posisi Y (m)","dx (m)","dy (m)","Dist(m)","Kecepatan (m/s)"].join(","));
      for (const r of ent.data) {
        rows.push([
          (r.timestamp_s==null?"":(r.timestamp_s.toFixed? r.timestamp_s.toFixed(3): r.timestamp_s)),
          (r.x_px==null?"":r.x_px),
          (r.y_px==null?"":r.y_px),
          (r.x_m==null?"":(Number(r.x_m).toFixed(3))),
          (r.y_m==null?"":(Number(r.y_m).toFixed(3))),
          (r.dx==null?"":(Number(r.dx).toFixed(4))),
          (r.dy==null?"":(Number(r.dy).toFixed(4))),
          (r.dist_m==null?"":(Number(r.dist_m).toFixed(4))),
          (r.v_frame_mps==null?"":(Number(r.v_frame_mps).toFixed(4)))
        ].join(","));
      }
      parts.push(rows.join("\n"));
    }
    const csv = parts.join("\n\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `speed_dir_${sanitizeFilename(directionString)}.csv`; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  }

  // ----- Public API -----
  function getFinished() { return finished.slice(); }
  function clearFinished() { finished.length = 0; renderAllToContainer(); }
  function clearActive() { for (const k in activeLogs) delete activeLogs[k]; }
  function renderInto(containerId = DEFAULT_CONTAINER_ID) { renderAllToContainer(containerId); }
  function getRekapData() { return computeRekapAllDirections(); }

  return {
    onSpawn, logFrame, finalizeVehicle, getFinished, clearFinished, clearActive, renderInto,
    getRekapData, exportRekapCSV, computeRekapAllDirections, DIRECTIONS_12
  };
})();

// window fallback for older code
if (typeof window !== "undefined") window.SpeedLogger = SpeedLogger;