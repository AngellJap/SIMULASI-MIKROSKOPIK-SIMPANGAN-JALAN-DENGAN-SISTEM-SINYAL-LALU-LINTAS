// SpeedLogger.js
// (modified) + Rekap Semua Lengan + Dual Units (m/s & km/jam)

export const SpeedLogger = (() => {
  const PX_PER_M_DEFAULT = 10;
  const MAX_SAMPLES = 30;
  const SAMPLE_MIN_ROWS = 10;

  const activeLogs = {};
  const finished = [];

  const DIRECTIONS_12 = [
    "Utara → Selatan", "Utara → Timur", "Utara → Barat",
    "Timur → Barat", "Timur → Selatan", "Timur → Utara",
    "Selatan → Utara", "Selatan → Barat", "Selatan → Timur",
    "Barat → Timur", "Barat → Utara", "Barat → Selatan"
  ];

  function onSpawn(vehicle, simTimeMs) {
if (!vehicle) return;
const x = (typeof vehicle.x === 'number') ? vehicle.x : (typeof vehicle.frontX === 'number' ? vehicle.frontX : 0);
const y = (typeof vehicle.y === 'number') ? vehicle.y : (typeof vehicle.frontY === 'number' ? vehicle.frontY : 0);


vehicle._vlog = {
lastPos: { x, y },
lastTime: simTimeMs,
distance: 0,
stopStartTime: null,
totalStopDuration: 0
};
}

  function vehKeyOf(v) { if (!v) return null; return String(v.displayId ?? v.id ?? v.vehicleId ?? (`veh_${Date.now()}`)); }
  function cap(s) { if (!s && s !== 0) return "-"; s = String(s); return s.charAt(0).toUpperCase() + s.slice(1); }

  function logFrame(v, pxPerMeter = PX_PER_M_DEFAULT) {
    if (!v) return;
    const key = vehKeyOf(v); if (!key) return;
    if (!activeLogs[key]) activeLogs[key] = { samples: [], meta: buildMetaFromVehicle(v) };
    const arr = activeLogs[key].samples;
    const t = (typeof performance !== 'undefined' && performance.now) ? performance.now() / 1000 : Date.now() / 1000;
    const x_px = (typeof v.x === 'number') ? v.x : (typeof v.frontX === 'number' ? v.frontX : null);
    const y_px = (typeof v.y === 'number') ? v.y : (typeof v.frontY === 'number' ? v.frontY : null);
    arr.push({ timestamp: t, x_px, y_px });
    if (arr.length > MAX_SAMPLES) arr.splice(0, arr.length - MAX_SAMPLES);
  }
  
//
// ----------- PATCH SPEEDLOGGER UNTUK 12 TABEL ASAL-TUJUAN -----------
//

function normalizeDirection(d) {
    if (!d) return "-";
    const s = String(d).toLowerCase();
    if (s.startsWith("u")) return "Utara";
    if (s.startsWith("t")) return "Timur";
    if (s.startsWith("s")) return "Selatan";
    if (s.startsWith("b")) return "Barat";
    return "-";
}

/**
 * Pemeta exitDir canvas → arah manuver sebenarnya.
 * Tujuannya untuk memperbaiki kasus: belok tetapi tercatat lurus.
 * 
 * KUNCI:
 * - from = arah kendaraan datang (Utara/Timur/Selatan/Barat)
 * - exitDirCanvas = v.exitDir dari vehmov.js (arah canvas)
 * 
 * Output = arah tujuan manuver
 */
function mapExitDirForManeuver(from, exitDirCanvas) {
    if (!from || !exitDirCanvas) return "-";

    const f = normalizeDirection(from);
    const e = normalizeDirection(exitDirCanvas);

    // Semua kombinasi manuver di persimpangan 4 lengan
    const map = {
        "Utara":  { "Timur": "Timur", "Selatan": "Selatan", "Barat": "Barat" },
        "Timur":  { "Selatan": "Selatan", "Barat": "Barat", "Utara": "Utara" },
        "Selatan":{ "Barat": "Barat",   "Utara": "Utara",  "Timur": "Timur" },
        "Barat":  { "Utara": "Utara",   "Timur": "Timur",  "Selatan":"Selatan" }
    };

    // Kembalikan arah tujuan sesuai manuver
    return map[f]?.[e] ?? "-";
}


/**
 * Membangun meta data untuk satu kendaraan pada saat exit.
 */
function buildMetaFromVehicle(v) {
    if (!v)
        return { id: "-", jenis: "-", arah: "-", maneuver: "-" };

    const id = String(v.displayId ?? v.id ?? v.vehicleId ?? ("veh_" + Date.now()));
    const jenis = v.type ?? v.jenis ?? "-";

    // Arah asal: selalu aman
    const from = normalizeDirection(v.direction);

    // Tujuan: dipetakan dari from + exitDirCanvas
    const to = mapExitDirForManeuver(from, v.exitDir);

    const arahLong = `${from} → ${to}`;
    const maneuver = determineManeuver(from, to);

    return { id, jenis, arah: arahLong, maneuver };
}

/**
 * Menentukan manuver kendaraan berdasarkan asal–tujuan.
 */
function determineManeuver(from, to) {
    if (!from || !to) return null;

    const f = from.toLowerCase();
    const t = to.toLowerCase();

    // Lurus
    if ((f === "utara"  && t === "selatan") ||
        (f === "selatan" && t === "utara")   ||
        (f === "timur"   && t === "barat")   ||
        (f === "barat"   && t === "timur"))
        return "straight";

    // Belok kanan
    if ((f === "utara"  && t === "barat")   ||
        (f === "barat"  && t === "selatan") ||
        (f === "selatan" && t === "timur")  ||
        (f === "timur"  && t === "utara"))
        return "right";

    // Belok kiri
    if ((f === "utara"  && t === "timur")   ||
        (f === "timur"  && t === "selatan") ||
        (f === "selatan" && t === "barat")  ||
        (f === "barat"  && t === "utara"))
        return "left";

    return null;
}

//
// ----------- END PATCH -----------
//

  function finalizeVehicle(v, pxPerMeter = PX_PER_M_DEFAULT) {
    if (!v) return;
    const key = vehKeyOf(v); if (!key) return;
    const entry = activeLogs[key];
    if (!entry || !entry.samples || entry.samples.length === 0) { delete activeLogs[key]; return; }

    const samples = entry.samples.slice();
    delete activeLogs[key];

    const rows = [];
    for (let i = 0; i < samples.length; i++) {
      const s = samples[i];
      rows.push({
        timestamp: s.timestamp,
        x_px: s.x_px, y_px: s.y_px,
        x_m: (s.x_px == null) ? null : (s.x_px / pxPerMeter),
        y_m: (s.y_px == null) ? null : (s.y_px / pxPerMeter),
        dx: null, dy: null, v_frame: null
      });
    }

    let totalDist = 0;
    for (let i = 1; i < rows.length; i++) {
      const prev = rows[i - 1], cur = rows[i];
      if (prev.x_m == null || cur.x_m == null) { cur.dx = null; cur.dy = null; cur.v_frame = null; continue; }
      const dx = cur.x_m - prev.x_m;
      const dy = cur.y_m - prev.y_m;
      const v_frame = Math.sqrt(dx * dx + dy * dy);
      cur.dx = dx; cur.dy = dy; cur.v_frame = v_frame;
      totalDist += v_frame;
    }

    while (rows.length < SAMPLE_MIN_ROWS) {
      rows.push({ timestamp: null, x_px: null, y_px: null, x_m: null, y_m: null, dx: null, dy: null, v_frame: null });
    }

    const t0 = (samples[0] && samples[0].timestamp) ? samples[0].timestamp : null;
    const t1 = (samples[samples.length - 1] && samples[samples.length - 1].timestamp) ? samples[samples.length - 1].timestamp : null;
    const dur = (t0 != null && t1 != null && t1 > t0) ? (t1 - t0) : null;
    
    // 1. Hitung m/s
    const v_individu = (dur && dur > 0) ? (totalDist / dur) : null;
    
    // 2. Hitung km/jam (v_individu * 3.6)
    const v_kmh = (v_individu != null) ? (v_individu * 3.6) : null;

    const meta = entry.meta || buildMetaFromVehicle(v);
    
    const freeFlowKmh = v.freeFlowKmh ?? null;

    // Simpan kedua unit ke dalam finished entry
    const finishedEntry = { 
      id: meta.id, 
      jenis: meta.jenis, 
      arah: meta.arah, 
      v_individu: v_individu, // tetap m/s sebagai base
      v_kmh: v_kmh,           // unit tambahan
       freeFlowKmh: freeFlowKmh,
      data: rows 
    };
    finished.push(finishedEntry);

    try { renderAllToContainer(); } catch (e) { console.warn("SpeedLogger: renderAllToContainer failed", e); }
  }

  // --- CSV helpers ---
  function exportSingleCSV(entry) {
    if (!entry) return;
    const headerMeta = [
      ["ID Kendaraan", entry.id],
      ["Jenis kendaraan", entry.jenis],
      ["Arah datang – arah tujuan", entry.arah],
      ["Kecepatan individu (m/s)", (entry.v_individu == null) ? "-" : entry.v_individu],
      ["Kecepatan individu (km/jam)", (entry.v_kmh == null) ? "-" : entry.v_kmh], // Tambahan di CSV
      []
    ];
    const headerCols = ["Timestamp (s)", "Posisi X (px)", "Posisi Y (px)", "Posisi X (m)", "Posisi Y (m)", "dx (m)", "dy (m)", "Kecepatan per baris (m/frame)"];
    const rows = [];
    headerMeta.forEach(r => rows.push(r.join(",")));
    rows.push(headerCols.join(","));
    for (let i = 0; i < entry.data.length; i++) {
      const r = entry.data[i];
      rows.push([
        (r.timestamp == null ? "" : r.timestamp.toFixed ? r.timestamp.toFixed(3) : r.timestamp),
        (r.x_px == null ? "" : r.x_px),
        (r.y_px == null ? "" : r.y_px),
        (r.x_m == null ? "" : (Number(r.x_m).toFixed(3))),
        (r.y_m == null ? "" : (Number(r.y_m).toFixed(3))),
        (r.dx == null ? "" : (Number(r.dx).toFixed(4))),
        (r.dy == null ? "" : (Number(r.dy).toFixed(4))),
        (r.v_frame == null ? "" : (Number(r.v_frame).toFixed(4)))
      ].join(","));
    }
    const csvText = rows.join("\n");
    const filename = `speed_${sanitizeFilename(entry.id)}.csv`;
    downloadBlob(csvText, filename, "text/csv");
  }

  function sanitizeFilename(s) { return String(s).replace(/[^a-z0-9_\-\.]/gi, "_"); }
  function downloadBlob(text, filename, mime) {
    try {
      const blob = new Blob([text], { type: mime || "application/octet-stream" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) { console.warn("downloadBlob failed:", e); }
  }

  // --- HTML rendering ---
  const DEFAULT_CONTAINER_ID = "speed-table-container";

  function ensureContainerStructure(containerEl) {
    if (!containerEl) return;
    if (!containerEl._speedLoggerStyled) {
      const style = document.createElement("style");
      style.textContent = `
        /* SpeedLogger table styles */
        #${containerEl.id} { font-family: Arial, sans-serif; gap: 12px; display: flex; flex-wrap: wrap; }
        #${containerEl.id} .sl-card { border: 1px solid #ddd; border-radius: 6px; padding: 8px; background: transparent; box-shadow: 0 1px 3px rgba(0,0,0,0.04); width: 48%; min-width: 360px; margin: 6px; }
        #${containerEl.id} .sl-card h4 { margin: 0 0 6px 0; font-size: 14px; }
        #${containerEl.id} table { width: 100%; border-collapse: collapse; font-size: 12px; }
        #${containerEl.id} th, #${containerEl.id} td { border: 1px solid #eee; padding: 6px; text-align: center; vertical-align: middle; }
        #${containerEl.id} th { background: black; color: white; font-weight: 600; font-size: 12px; }
        #${containerEl.id} .sl-meta { display:flex; justify-content: space-between; align-items: center; gap:8px; margin-bottom:6px; }
        #${containerEl.id} .sl-actions { display:flex; gap:6px; }
        #${containerEl.id} .sl-empty { color:black; font-style:italic; }
        /* Unit formatting */
        #${containerEl.id} .unit-sub { font-size: 0.85em; color: #eee; display: block; margin-top: 2px; }
        /* rekap-specific */
        #${containerEl.id} .sl-rekap-card { width: 100%; min-width: 680px; }
        @media (max-width:800px) { #${containerEl.id} .sl-card { width: 100%; } #${containerEl.id} .sl-rekap-card { min-width: auto; } }
      `;
      document.head.appendChild(style);
      containerEl._speedLoggerStyled = true;
    }

    if (!containerEl._speedLoggerInit) {
      containerEl.innerHTML = "";
      const rekCard = document.createElement("div");
      rekCard.className = "sl-card sl-rekap-card";
      rekCard.dataset.rekap = "all";
      rekCard.id = `${containerEl.id}_rekap_all`;
      rekCard.innerHTML = `<h4>Rekap Kecepatan Semua Lengan (m/s & km/jam)</h4><div class="sl-rekap-wrap"><div class="sl-empty">Belum ada data rekap</div></div>`;
      containerEl.appendChild(rekCard);

      for (let i = 0; i < DIRECTIONS_12.length; i++) {
        const dir = DIRECTIONS_12[i];
        const card = document.createElement("div");
        card.className = "sl-card";
        card.dataset.direction = dir;
        const title = document.createElement("h4");
        title.textContent = dir;
        card.appendChild(title);

        const meta = document.createElement("div");
        meta.className = "sl-meta";
        const metaLeft = document.createElement("div");
        metaLeft.className = "sl-meta-left";
        metaLeft.innerHTML = `<span class="sl-empty">Belum ada data</span>`;
        meta.appendChild(metaLeft);

        const actions = document.createElement("div");
        actions.className = "sl-actions";
        const btnRefresh = document.createElement("button");
        btnRefresh.type = "button"; btnRefresh.textContent = "Refresh";
        btnRefresh.addEventListener("click", () => renderAllToContainer(containerEl.id));
        const btnExportAll = document.createElement("button");
        btnExportAll.type = "button"; btnExportAll.textContent = "Export CSV";
        btnExportAll.addEventListener("click", () => exportDirectionCSV(dir));
        actions.appendChild(btnExportAll); actions.appendChild(btnRefresh);
        meta.appendChild(actions);

        card.appendChild(meta);
        const tableWrap = document.createElement("div"); tableWrap.className = "sl-table-wrap";
        const p = document.createElement("div"); p.className = "sl-empty";
        p.textContent = "Tunggu data kendaraan keluar.";
        tableWrap.appendChild(p);
        card.appendChild(tableWrap);
        containerEl.appendChild(card);
      }
      containerEl._speedLoggerInit = true;
    }
  }

  // Compute rekap (NOW ACCUMULATES BOTH m/s AND km/h)
// Compute rekap (enhanced: calculates FFS, distance and delay in seconds)
function computeRekapAllDirections() {
    // helper init
    const initStat = () => ({
        count: 0,
        sum: 0,        // sum in m/s
        sumKmh: 0,     // sum in km/h
        avg: null,     // avg in m/s
        avgKmh: null,  // avg in km/h
        ffsSum: 0,     // sum of free-flow speeds (km/h)
        ffsCount: 0,
        ffsAvg: null   // avg free-flow (km/h)
    });

    const out = {};
    for (const dir of DIRECTIONS_12) {
        out[dir] = {
            motor: initStat(),
            mobil: initStat(),
            truk: initStat(),
            all: initStat(),
            customAvg: null,       // observed average (m/s) across available categories
            customAvgKmh: null,    // observed average in km/h
            distanceMeters: null,  // average entry->exit distance (m)
            delaySeconds: null     // computed delay (s)
        };
    }

    // ---- accumulate finished entries ----
    for (const e of finished) {
        const dir = (e.arah && typeof e.arah === "string") ? e.arah : null;
        if (!dir || !out[dir]) continue;

        const type = (e.jenis || "").toString().toLowerCase();
        const v = (typeof e.v_individu === "number" && isFinite(e.v_individu)) ? e.v_individu : null; // m/s
        const vK = (typeof e.v_kmh === "number" && isFinite(e.v_kmh)) ? e.v_kmh : null; // km/h
        const ffs = (typeof e.freeFlowKmh === "number" && isFinite(e.freeFlowKmh)) ? e.freeFlowKmh : null; // km/h

        if (v == null) continue; // skip entries without measured speed

        const add = (statObj) => {
            statObj.count += 1;
            statObj.sum += v;
            if (vK != null) statObj.sumKmh += vK;
            if (ffs != null) { statObj.ffsSum += ffs; statObj.ffsCount++; }
        };

        if (type.startsWith("motor") || type === "motor" || type === "mc") {
            add(out[dir].motor);
        } else if (type.startsWith("truk") || type === "truk" || type === "hv") {
            add(out[dir].truk);
        } else {
            add(out[dir].mobil);
        }

        // always add to aggregate 'all'
        add(out[dir].all);
    }

    // ---- compute averages and derived metrics (distance + delay) ----
    // Helper: map Indonesian direction -> key used in laneCoordinates
    const dirNameToKey = (name) => {
        if (!name) return null;
        const n = String(name).toLowerCase();
        if (n.startsWith("u")) return "utara";
        if (n.startsWith("t")) return "timur";
        if (n.startsWith("s")) return "selatan";
        if (n.startsWith("b")) return "barat";
        return null;
    };

    // Helper: compute average euclidean distance (meters) between all entry points of 'fromKey' and all exit points of 'toKey'
    function computeAvgDistanceMeters(fromName, toName) {
        try {
            const globalLC = (typeof laneCoordinates !== 'undefined' && laneCoordinates) ? laneCoordinates
                            : (typeof window !== 'undefined' ? window.laneCoordinates : null);
            if (!globalLC || !globalLC.entry || !globalLC.exit) return null;

            const fromKey = dirNameToKey(fromName);
            const toKey = dirNameToKey(toName);
            if (!fromKey || !toKey) return null;

            const entryObj = globalLC.entry || {};
            const exitObj = globalLC.exit || {};

            // collect points arrays
            const entries = Object.keys(entryObj)
                .filter(k => k.startsWith(fromKey + "_"))
                .map(k => entryObj[k])
                .filter(p => p && typeof p.x === 'number' && typeof p.y === 'number');

            const exits = Object.keys(exitObj)
                .filter(k => k.startsWith(toKey + "_"))
                .map(k => exitObj[k])
                .filter(p => p && typeof p.x === 'number' && typeof p.y === 'number');

            if (entries.length === 0 || exits.length === 0) return null;

            // compute distances for all combinations, average them
            let sum = 0;
            let cnt = 0;
            for (const a of entries) {
                for (const b of exits) {
                    const dx = a.x - b.x;
                    const dy = a.y - b.y;
                    const d_px = Math.hypot(dx, dy);
                    // pixel -> meter conversion: try to detect PX_PER_M:
                    const pxPerM = (typeof PX_PER_M_DEFAULT !== 'undefined') ? PX_PER_M_DEFAULT
                                   : ((typeof window !== 'undefined' && window.PX_PER_M) ? window.PX_PER_M : 10);
                    const d_m = d_px / pxPerM;
                    if (isFinite(d_m) && d_m > 0) {
                        sum += d_m;
                        cnt++;
                    }
                }
            }
            if (cnt === 0) return null;
            return sum / cnt;
        } catch (err) {
            console.warn("computeAvgDistanceMeters failed:", err);
            return null;
        }
    }

    // for each direction compute averages and FFS & customAvg
    for (const dir of Object.keys(out)) {
        const rec = out[dir];

        // compute avg values for categories
        for (const k of ["motor", "mobil", "truk", "all"]) {
            const s = rec[k];
            s.avg = (s.count > 0) ? (s.sum / s.count) : null;
            s.avgKmh = (s.count > 0) ? (s.sumKmh / s.count) : null;
            s.ffsAvg = (s.ffsCount > 0) ? (s.ffsSum / s.ffsCount) : null;
        }

        // customAvg: average among available category avgs (motor,mobil,truk) in m/s
        const m = rec.motor.avg, c = rec.mobil.avg, t = rec.truk.avg;
        const vals = [m, c, t].filter(v => v !== null);
        if (vals.length > 0) {
            const avgMs = vals.reduce((a, b) => a + b, 0) / vals.length;
            rec.customAvg = avgMs;
            rec.customAvgKmh = avgMs * 3.6;
        } else {
            rec.customAvg = null;
            rec.customAvgKmh = null;
        }

        // compute distance (meters) from laneCoordinates for this direction label
        // dir string is like "Utara → Selatan"
        const parts = dir.split("→").map(p => p.trim());
        if (parts.length === 2) {
            const fromName = parts[0];
            const toName = parts[1];
            const distMeters = computeAvgDistanceMeters(fromName, toName);
            rec.distanceMeters = (distMeters == null ? null : Number(distMeters));
        } else {
            rec.distanceMeters = null;
        }

        // decide observed speed (m/s) and free-flow speed (m/s) to compute delay
        // prefer customAvg (m/s) as observed; fallback to rec.all.avg
        const vObsMs = (rec.customAvg != null) ? rec.customAvg : rec.all.avg;
        const vObsKmh = (vObsMs != null) ? (vObsMs * 3.6) : (rec.customAvgKmh || rec.all.avgKmh || null);

        // choose free-flow km/h: prefer rec.all.ffsAvg, fallback to category ffs if needed
        let ffsKmh = rec.all.ffsAvg;
        if (ffsKmh == null) {
            // try to find any category ffsAvg
            ffsKmh = rec.motor.ffsAvg ?? rec.mobil.ffsAvg ?? rec.truk.ffsAvg ?? null;
        }

        if (vObsMs == null || ffsKmh == null || rec.distanceMeters == null || rec.distanceMeters <= 0) {
            rec.delaySeconds = null;
        } else {
            const vObs = Number(vObsMs);                         // m/s
            const vFf = Number(ffsKmh) / 3.6;                    // km/h -> m/s
            if (vObs <= 0 || vFf <= 0) {
                rec.delaySeconds = null;
            } else {
                // delay = L/v_obs - L/v_ff  (seconds)
                const L = Number(rec.distanceMeters);
                const delay = L / vObs - L / vFf;
                // If delay is extremely small negative due to rounding, clamp to 0
                rec.delaySeconds = (isFinite(delay) ? (delay < 0 && delay > -1e-6 ? 0 : delay) : null);
            }
        }
    }

    return out;
}

  // Render Rekap Table (Displays both units in one cell)
  function renderRekapTable(containerEl) {
    if (!containerEl) {
      containerEl = document.getElementById(DEFAULT_CONTAINER_ID);
      if (!containerEl) return;
    }
    ensureContainerStructure(containerEl);
    const rekCard = containerEl.querySelector(".sl-rekap-card");
    if (!rekCard) return;
    const wrap = rekCard.querySelector(".sl-rekap-wrap") || document.createElement("div");
    wrap.className = "sl-rekap-wrap";
    wrap.innerHTML = "";

    const rekap = computeRekapAllDirections();

    const tbl = document.createElement("table");
    const thead = document.createElement("thead");
    const trh = document.createElement("tr");
    ["Arah", "Motor", "Mobil", "Truk", "Rata-rata", "Kecepatan Bebas Hambatan", "Tundaan (detik)"]
    .forEach(h => { 
        const th = document.createElement("th"); 
        th.textContent = h; 
        trh.appendChild(th); 
});
    thead.appendChild(trh); tbl.appendChild(thead);

    const tbody = document.createElement("tbody");
    
    // Helper formatter
    const fmtDual = (valMs, valKmh) => {
      if (valMs == null) return "-";
      // Format: "10.123 m/s <br> (36.44 km/j)"
      return `${valMs.toFixed(2)} m/s`;
    };
    // Helper to create cell with dual units nicely formatted
    const createDualCell = (valMs, valKmh) => {
        const td = document.createElement("td");
        if (valMs == null) {
            td.textContent = "-";
        } else {
            // Main value (m/s)
            const main = document.createElement("span");
            main.textContent = valMs.toFixed(2) + " m/s";
            main.style.fontWeight = "bold";
            // Sub value (km/h)
            const sub = document.createElement("span");
            sub.className = "unit-sub"; // defined in CSS
            sub.textContent = `(${valKmh.toFixed(2)} km/jam)`;
            
            td.appendChild(main);
            td.appendChild(sub);
        }
        return td;
    };

    for (const dir of DIRECTIONS_12) {
      const s = rekap[dir];
      const tr = document.createElement("tr");
      
      const tdDir = document.createElement("td"); 
      tdDir.textContent = dir; 
      tr.appendChild(tdDir);

      tr.appendChild(createDualCell(s.motor.avg, s.motor.avgKmh));
      tr.appendChild(createDualCell(s.mobil.avg, s.mobil.avgKmh));
      tr.appendChild(createDualCell(s.truk.avg, s.truk.avgKmh));
      tr.appendChild(createDualCell(s.customAvg, s.customAvgKmh));
      const tdFFS = document.createElement("td");
if (s.all.ffsAvg != null) {
    tdFFS.textContent = s.all.ffsAvg.toFixed(2) + " km/jam";
} else {
    tdFFS.textContent = "-";
}
tr.appendChild(tdFFS);

// Kolom Tundaan (detik)
const tdDelay = document.createElement("td");
if (s.delaySeconds != null) {
    tdDelay.textContent = s.delaySeconds.toFixed(2) + " dtk";
} else {
    tdDelay.textContent = "-";
}
tr.appendChild(tdDelay);

      tbody.appendChild(tr);
    }
    tbl.appendChild(tbody);

    const actionsDiv = document.createElement("div");
    actionsDiv.style.display = "flex"; actionsDiv.style.justifyContent = "flex-end"; actionsDiv.style.gap = "8px"; actionsDiv.style.marginTop = "8px";
    const btnExport = document.createElement("button"); btnExport.type = "button"; btnExport.textContent = "Export Rekap CSV";
    btnExport.addEventListener("click", () => exportRekapCSV());
    actionsDiv.appendChild(btnExport);

    wrap.appendChild(tbl);
    wrap.appendChild(actionsDiv);
    
    rekCard.querySelectorAll(".sl-rekap-wrap").forEach(n => n.remove());
    rekCard.appendChild(wrap);
  }

  // Export Rekap CSV (Columns added for km/h)
  function exportRekapCSV() {
    const rekap = computeRekapAllDirections();
    const lines = [];
    // Header extended
    lines.push(["Arah","Jenis","Jumlah","Total(m/s)","Rata-rata(m/s)","Rata-rata(km/jam)"].join(","));
    
    for (const dir of DIRECTIONS_12) {
      const s = rekap[dir];
      const pushRow = (label, obj) => {
        lines.push([
            dir, 
            label, 
            obj.count, 
            (obj.sum || 0).toFixed(3), 
            (obj.avg == null ? "" : obj.avg.toFixed(3)),
            (obj.avgKmh == null ? "" : obj.avgKmh.toFixed(3))
        ].join(","));
      };

      pushRow("Motor", s.motor);
      pushRow("Mobil", s.mobil);
      pushRow("Truk", s.truk);
      // Untuk "Semua" di sini kita pakai s.all (total agregat) atau customAvg sesuai kebutuhan.
      // Di sini kita pakai s.all (rata-rata aritmatika seluruh kendaraan)
      pushRow("Semua Kendaraan", s.all); 
      lines.push(""); 
    }
    const csv = lines.join("\n");
    downloadBlob(csv, "speed_rekap_dual_units.csv", "text/csv");
  }

  function renderAllToContainer(containerId = DEFAULT_CONTAINER_ID) {
    const containerEl = document.getElementById(containerId);
    if (!containerEl) return;
    ensureContainerStructure(containerEl);

    const groups = {};
    for (const dir of DIRECTIONS_12) groups[dir] = [];
    for (const e of finished) {
      const dir = (e.arah && typeof e.arah === 'string') ? e.arah : "Unknown";
      if (groups[dir]) groups[dir].push(e);
      else {
        const found = DIRECTIONS_12.find(d => d.startsWith((e.arah || "").split(" → ")[0]));
        (groups[found || DIRECTIONS_12[0]] || groups[DIRECTIONS_12[0]]).push(e);
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
        const p = document.createElement("div"); p.className = "sl-empty";
        p.textContent = "Tunggu data kendaraan keluar.";
        tableWrap.appendChild(p);
        continue;
      }

      const sorted = list.slice().sort((a, b) => {
        const at = a.data && a.data.length ? (a.data[a.data.length - 1].timestamp || 0) : 0;
        const bt = b.data && b.data.length ? (b.data[b.data.length - 1].timestamp || 0) : 0;
        return bt - at;
      });

      metaLeft.innerHTML = `<div><strong>${sorted.length}</strong> kendaraan tercatat</div>`;

      const maxShown = 3;
      for (let i = 0; i < Math.min(maxShown, sorted.length); i++) {
        const entry = sorted[i];
        const wrapper = document.createElement("div"); wrapper.style.marginBottom = "10px";

        const hdr = document.createElement("div");
        hdr.style.display = "flex"; hdr.style.justifyContent = "space-between"; hdr.style.alignItems = "center"; hdr.style.marginBottom = "6px";
        const hdrLeft = document.createElement("div");
        hdrLeft.innerHTML = `<strong>${entry.id}</strong> — ${entry.jenis}`;
        const hdrRight = document.createElement("div");
        const btn = document.createElement("button"); btn.type = "button"; btn.textContent = "CSV"; btn.addEventListener("click", () => exportSingleCSV(entry));
        hdrRight.appendChild(btn); hdr.appendChild(hdrLeft); hdr.appendChild(hdrRight);
        wrapper.appendChild(hdr);

        const tbl = document.createElement("table");
        const thead = document.createElement("thead");
        const trh = document.createElement("tr");
        ["ID", "Time(s)", "X(m)", "Y(m)", "Perpindahan(m)"].forEach(h => { const th = document.createElement("th"); th.textContent = h; trh.appendChild(th); });
        thead.appendChild(trh); tbl.appendChild(thead);

        const tbody = document.createElement("tbody");
        // Show simplified rows for UI
        for (let r = 0; r < Math.max(SAMPLE_MIN_ROWS, entry.data.length); r++) {
          const row = entry.data[r] || { timestamp: null, x_m: null, y_m: null, v_frame: null };
          const tr = document.createElement("tr");
          const td1 = document.createElement("td"); td1.textContent = entry.id; tr.appendChild(td1);
          const td2 = document.createElement("td"); td2.textContent = (row.timestamp ? row.timestamp.toFixed(3) : "-"); tr.appendChild(td2);
          const td3 = document.createElement("td"); td3.textContent = (row.x_m ? Number(row.x_m).toFixed(2) : "-"); tr.appendChild(td3);
          const td4 = document.createElement("td"); td4.textContent = (row.y_m ? Number(row.y_m).toFixed(2) : "-"); tr.appendChild(td4);
          const td5 = document.createElement("td"); td5.textContent = (row.v_frame ? Number(row.v_frame).toFixed(3) : "-"); tr.appendChild(td5);
          tbody.appendChild(tr);
        }
        tbl.appendChild(tbody);

        // Footer with DUAL UNITS
        const foot = document.createElement("div"); foot.style.marginTop = "6px";
        const vMs = entry.v_individu == null ? "-" : Number(entry.v_individu).toFixed(2);
        const vKmh = entry.v_kmh == null ? "-" : Number(entry.v_kmh).toFixed(2);
        
        foot.innerHTML = `
            <small>
                Kecepatan Individu: <strong>${vMs} m/s</strong> 
                <span style="color:white; margin-left:6px;">(${vKmh} km/jam)</span>
            </small>
        `;
        wrapper.appendChild(tbl); wrapper.appendChild(foot);
        tableWrap.appendChild(wrapper);
      }
    }
  }

  function exportDirectionCSV(directionString) {
    if (!directionString) return;
    const entries = finished.filter(e => e.arah === directionString);
    if (!entries || entries.length === 0) { alert(`Tidak ada data untuk arah: ${directionString}`); return; }
    const parts = [];
    for (const ent of entries) {
      const lines = [];
      lines.push(`ID Kendaraan,${ent.id}`);
      lines.push(`Jenis kendaraan,${ent.jenis}`);
      lines.push(`Arah,${ent.arah}`);
      lines.push(`Kecepatan Individu(m/s),${ent.v_individu == null ? "" : ent.v_individu}`);
      lines.push(`Kecepatan Individu(km/jam),${ent.v_kmh == null ? "" : ent.v_kmh}`); // Tambahan
      lines.push("");
      lines.push(["Timestamp (s)","Posisi X (px)","Posisi Y (px)","Posisi X (m)","Posisi Y (m)","dx (m)","dy (m)","Kecepatan (m/frame)"].join(","));
      for (const r of ent.data) {
        lines.push([
          (r.timestamp == null ? "" : (r.timestamp.toFixed ? r.timestamp.toFixed(3) : r.timestamp)),
          (r.x_px == null ? "" : r.x_px),
          (r.y_px == null ? "" : r.y_px),
          (r.x_m == null ? "" : (Number(r.x_m).toFixed(3))),
          (r.y_m == null ? "" : (Number(r.y_m).toFixed(3))),
          (r.dx == null ? "" : (Number(r.dx).toFixed(4))),
          (r.dy == null ? "" : (Number(r.dy).toFixed(4))),
          (r.v_frame == null ? "" : (Number(r.v_frame).toFixed(4)))
        ].join(","));
      }
      parts.push(lines.join("\n"));
    }
    const csv = parts.join("\n\n");
    downloadBlob(csv, `speed_dir_${sanitizeFilename(directionString)}.csv`, "text/csv");
  }

  function getFinished() { return finished.slice(); }
  function clearFinished() { finished.length = 0; renderAllToContainer(); }
  function clearActive() { for (const k in activeLogs) delete activeLogs[k]; }
  function renderInto(containerId = DEFAULT_CONTAINER_ID) { renderAllToContainer(containerId); }
  function getRekapData() { return computeRekapAllDirections(); }
  function exportRekapCSV_public() { exportRekapCSV(); }

  return {
    logFrame, finalizeVehicle, getFinished, clearFinished, clearActive, renderInto,
    getRekapData, exportRekapCSV: exportRekapCSV_public,
    setMaxSamples(n) { if (Number.isFinite(n) && n > 1) { /* no-op */ } },
    DIRECTIONS_12
  };
})();
