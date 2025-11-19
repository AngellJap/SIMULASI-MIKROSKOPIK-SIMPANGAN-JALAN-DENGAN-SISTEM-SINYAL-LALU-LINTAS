// SpeedLogger.js
// - Merekam posisi kendaraan tiap frame (menggunakan v.x / v.y / id fallback)
// - Saat finalizeVehicle dipanggil, menghitung semua kolom dan:
//     * membuat file CSV (auto-download)
//     * menyimpan hasil di memory
//     * merender/refresh tabel HTML pada #speed-table-container
//
// Usage:
//  - import { SpeedLogger } from './SpeedLogger.js'
//  - panggil SpeedLogger.logFrame(v, pxPerMeter) setiap frame
//  - panggil SpeedLogger.finalizeVehicle(v, pxPerMeter) sebelum menghapus vehicle
//  - container target harus ada: <div id="speed-table-container"></div>

export const SpeedLogger = (() => {
  const PX_PER_M_DEFAULT = 10;
  const MAX_SAMPLES = 30; // simpan sampai 30 sampel per kendaraan (configurable)
  const SAMPLE_MIN_ROWS = 10; // minimal baris per tabel yang diminta user

  // internal storage
  const activeLogs = {}; // key -> [{timestamp, x_px, y_px}, ...]
  const finished = [];   // list hasil { id, jenis, arah, v_individu, data: [...] }

  // 12 arah (format panjang) — urutan sesuai permintaan user
  const DIRECTIONS_12 = [
    "Utara → Timur",
    "Utara → Selatan",
    "Utara → Barat",
    "Timur → Selatan",
    "Timur → Barat",
    "Timur → Utara",
    "Selatan → Barat",
    "Selatan → Utara",
    "Selatan → Timur",
    "Barat → Utara",
    "Barat → Timur",
    "Barat → Selatan"
  ];

  // helper: get unique key for vehicle (prefer displayId then id)
  function vehKeyOf(v) {
    if (!v) return null;
    return String(v.displayId ?? v.id ?? v.vehicleId ?? (`veh_${Date.now()}`));
  }

  // helper: pretty cap
  function cap(s) { if (!s && s !== 0) return "-"; s = String(s); return s.charAt(0).toUpperCase() + s.slice(1); }

  // --------------------------
  // RECORD FRAME
  // --------------------------
  function logFrame(v, pxPerMeter = PX_PER_M_DEFAULT) {
    if (!v) return;
    const key = vehKeyOf(v);
    if (!key) return;
    if (!activeLogs[key]) activeLogs[key] = { samples: [], meta: buildMetaFromVehicle(v) };
    const arr = activeLogs[key].samples;
    const t = (typeof performance !== 'undefined' && performance.now) ? performance.now() / 1000 : Date.now() / 1000;
    const x_px = (typeof v.x === 'number') ? v.x : (typeof v.frontX === 'number' ? v.frontX : null);
    const y_px = (typeof v.y === 'number') ? v.y : (typeof v.frontY === 'number' ? v.frontY : null);

    arr.push({ timestamp: t, x_px, y_px });
    if (arr.length > MAX_SAMPLES) arr.splice(0, arr.length - MAX_SAMPLES);
  }

  function buildMetaFromVehicle(v) {
    if (!v) return { id: "-", jenis: "-", arah: "-" };
    const id = String(v.displayId ?? v.id ?? v.vehicleId ?? ("veh_" + (Date.now())));
    const jenis = (v.type ? v.type : (v.jenis ? v.jenis : "-"));
    const direction = cap(v.direction ?? "-");
    const route = cap(v.route ?? (v.turn ?? "-"));
    const arahLong = `${direction} → ${route}`;
    return { id, jenis, arah: arahLong };
  }

  // --------------------------
  // FINALIZE (pindah ke finished + export CSV + render)
  // --------------------------
  function finalizeVehicle(v, pxPerMeter = PX_PER_M_DEFAULT) {
    if (!v) return;
    const key = vehKeyOf(v);
    if (!key) return;

    const entry = activeLogs[key];
    if (!entry || !entry.samples || entry.samples.length === 0) {
      // nothing to finalize
      delete activeLogs[key];
      return;
    }

    // Use the last up-to MAX_SAMPLES samples (already windowed)
    const samples = entry.samples.slice(); // copy
    delete activeLogs[key];

    // Build rows per spec (ensure at least SAMPLE_MIN_ROWS rows by padding with placeholders)
    const rows = [];
    for (let i = 0; i < samples.length; i++) {
      const s = samples[i];
      rows.push({
        timestamp: s.timestamp,
        x_px: s.x_px,
        y_px: s.y_px,
        x_m: (s.x_px == null) ? null : (s.x_px / pxPerMeter),
        y_m: (s.y_px == null) ? null : (s.y_px / pxPerMeter),
        dx: null,
        dy: null,
        v_frame: null
      });
    }

    // compute dx/dy/v_frame starting from row 2
    let totalDist = 0;
    for (let i = 1; i < rows.length; i++) {
      const prev = rows[i - 1];
      const cur = rows[i];
      if (prev.x_m == null || cur.x_m == null) { cur.dx = null; cur.dy = null; cur.v_frame = null; continue; }
      const dx = cur.x_m - prev.x_m;
      const dy = cur.y_m - prev.y_m;
      const v_frame = Math.sqrt(dx * dx + dy * dy);
      cur.dx = dx;
      cur.dy = dy;
      cur.v_frame = v_frame;
      totalDist += v_frame;
    }

    // pad to minimal rows if needed (placeholders)
    while (rows.length < SAMPLE_MIN_ROWS) {
      rows.push({
        timestamp: null, x_px: null, y_px: null,
        x_m: null, y_m: null, dx: null, dy: null, v_frame: null
      });
    }

    // compute v_individu = totalDist / (t_last - t_first) (m/s)
    const t0 = (samples[0] && samples[0].timestamp) ? samples[0].timestamp : null;
    const t1 = (samples[samples.length - 1] && samples[samples.length - 1].timestamp) ? samples[samples.length - 1].timestamp : null;
    const dur = (t0 != null && t1 != null && t1 > t0) ? (t1 - t0) : null;
    const v_individu = (dur && dur > 0) ? (totalDist / dur) : null;

    const meta = entry.meta || buildMetaFromVehicle(v);
    const finishedEntry = {
      id: meta.id,
      jenis: meta.jenis,
      arah: meta.arah,
      v_individu,
      data: rows
    };

    finished.push(finishedEntry);

    // auto export CSV and render HTML
    try { exportSingleCSV(finishedEntry); } catch (e) { console.warn("SpeedLogger: exportSingleCSV failed", e); }
    try { renderAllToContainer(); } catch (e) { console.warn("SpeedLogger: renderAllToContainer failed", e); }
  }

  // --------------------------
  // CSV export
  // --------------------------
  function exportSingleCSV(entry) {
    if (!entry) return;
    const headerMeta = [
      ["ID Kendaraan", entry.id],
      ["Jenis kendaraan", entry.jenis],
      ["Arah datang – arah tujuan", entry.arah],
      ["Kecepatan individu (m/s)", (entry.v_individu == null) ? "-" : entry.v_individu],
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

  function sanitizeFilename(s) {
    return String(s).replace(/[^a-z0-9_\-\.]/gi, "_");
  }

  function downloadBlob(text, filename, mime) {
    try {
      const blob = new Blob([text], { type: mime || "application/octet-stream" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.warn("downloadBlob failed:", e);
    }
  }

  // --------------------------
  // HTML RENDERING
  // --------------------------
  // containerId default:
  const DEFAULT_CONTAINER_ID = "speed-table-container";

  // Build base container structure (12 tables placeholders)
  function ensureContainerStructure(containerEl) {
    if (!containerEl) return;
    // Add minimal CSS once
    if (!containerEl._speedLoggerStyled) {
      const style = document.createElement("style");
      style.textContent = `
        /* SpeedLogger table styles */
        #${containerEl.id} { font-family: Arial, sans-serif; gap: 12px; display: flex; flex-wrap: wrap; }
        #${containerEl.id} .sl-card { border: 1px solid #ddd; border-radius: 6px; padding: 8px; background: transparent; box-shadow: 0 1px 3px rgba(0,0,0,0.04); width: 48%; min-width: 360px; margin: 6px; }
        #${containerEl.id} .sl-card h4 { margin: 0 0 6px 0; font-size: 14px; }
        #${containerEl.id} table { width: 100%; border-collapse: collapse; font-size: 12px; }
        #${containerEl.id} th, #${containerEl.id} td { border: 1px solid #eee; padding: 6px; text-align: center; }
        #${containerEl.id} th { background: black; font-weight: 600; font-size: 12px; }
        #${containerEl.id} .sl-meta { display:flex; justify-content: space-between; align-items: center; gap:8px; margin-bottom:6px; }
        #${containerEl.id} .sl-actions { display:flex; gap:6px; }
        #${containerEl.id} .sl-empty { color:black; font-style:italic; }
        @media (max-width:800px) { #${containerEl.id} .sl-card { width: 100%; } }
      `;
      document.head.appendChild(style);
      containerEl._speedLoggerStyled = true;
    }

    // if placeholder not created yet, create 12 cards
    if (!containerEl._speedLoggerInit) {
      containerEl.innerHTML = ""; // clear
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
        btnRefresh.type = "button";
        btnRefresh.textContent = "Refresh";
        btnRefresh.addEventListener("click", () => renderAllToContainer(containerEl.id));
        const btnExportAll = document.createElement("button");
        btnExportAll.type = "button";
        btnExportAll.textContent = "Export Semua CSV (arah ini)";
        btnExportAll.addEventListener("click", () => exportDirectionCSV(dir));
        actions.appendChild(btnExportAll);
        actions.appendChild(btnRefresh);
        meta.appendChild(actions);

        card.appendChild(meta);

        const tableWrap = document.createElement("div");
        tableWrap.className = "sl-table-wrap";
        // initial placeholder table
        const p = document.createElement("div");
        p.className = "sl-empty";
        p.textContent = "Tunggu data kendaraan keluar (CSV dan tabel akan muncul otomatis).";
        tableWrap.appendChild(p);

        card.appendChild(tableWrap);
        containerEl.appendChild(card);
      }
      containerEl._speedLoggerInit = true;
    }
  }

  // Render all finished entries into their direction cards
  function renderAllToContainer(containerId = DEFAULT_CONTAINER_ID) {
    const containerEl = document.getElementById(containerId);
    if (!containerEl) return;
    ensureContainerStructure(containerEl);

    // group finished entries by direction (exact match)
    const groups = {};
    for (const dir of DIRECTIONS_12) groups[dir] = [];
    for (const e of finished) {
      const dir = (e.arah && typeof e.arah === 'string') ? e.arah : "Unknown";
      if (groups[dir]) groups[dir].push(e);
      else {
        // if unknown direction, create fallback group under its direction text if exists else push to first matching start
        const found = DIRECTIONS_12.find(d => d.startsWith((e.arah || "").split(" → ")[0]));
        (groups[found || DIRECTIONS_12[0]] || groups[DIRECTIONS_12[0]]).push(e);
      }
    }

    // for each card, render the most recent N entries (we will only show the latest entry table; can be extended)
    const cards = Array.from(containerEl.querySelectorAll(".sl-card"));
    for (const card of cards) {
      const dir = card.dataset.direction;
      const list = groups[dir] || [];
      const tableWrap = card.querySelector(".sl-table-wrap");
      const metaLeft = card.querySelector(".sl-meta-left");
      tableWrap.innerHTML = "";

      if (!list || list.length === 0) {
        metaLeft.innerHTML = `<span class="sl-empty">Belum ada data</span>`;
        const p = document.createElement("div");
        p.className = "sl-empty";
        p.textContent = "Tunggu data kendaraan keluar (CSV dan tabel akan muncul otomatis).";
        tableWrap.appendChild(p);
        continue;
      }

      // show most recent finished entries for this direction (descending by finish time approximated by last timestamp)
      const sorted = list.slice().sort((a, b) => {
        const at = a.data && a.data.length ? (a.data[a.data.length - 1].timestamp || 0) : 0;
        const bt = b.data && b.data.length ? (b.data[b.data.length - 1].timestamp || 0) : 0;
        return bt - at;
      });

      // meta
      metaLeft.innerHTML = `<div><strong>${sorted.length}</strong> kendaraan tercatat</div>`;

      // Render each finished entry as its own table (limit e.g. 3 latest per card)
      const maxShown = 3;
      for (let i = 0; i < Math.min(maxShown, sorted.length); i++) {
        const entry = sorted[i];
        const wrapper = document.createElement("div");
        wrapper.style.marginBottom = "10px";

        // header row with id & v_individu and single-download button
        const hdr = document.createElement("div");
        hdr.style.display = "flex";
        hdr.style.justifyContent = "space-between";
        hdr.style.alignItems = "center";
        hdr.style.marginBottom = "6px";

        const hdrLeft = document.createElement("div");
        hdrLeft.innerHTML = `<strong>${entry.id}</strong> — ${entry.jenis} — ${entry.arah}`;
        const hdrRight = document.createElement("div");
        const btn = document.createElement("button");
        btn.type = "button";
        btn.textContent = "Download CSV";
        btn.addEventListener("click", () => exportSingleCSV(entry));
        hdrRight.appendChild(btn);

        hdr.appendChild(hdrLeft);
        hdr.appendChild(hdrRight);
        wrapper.appendChild(hdr);

        // build table
        const tbl = document.createElement("table");
        const thead = document.createElement("thead");
        const trh = document.createElement("tr");
        ["ID Kendaraan","Jenis kendaraan","Arah datang – arah tujuan","Timestamp (s)","Posisi X (px)","Posisi Y (px)","Posisi X (m)","Posisi Y (m)","dx (m)","dy (m)","Kecepatan per baris (m/frame)"].forEach(h => {
          const th = document.createElement("th"); th.textContent = h; trh.appendChild(th);
        });
        thead.appendChild(trh);
        tbl.appendChild(thead);

        const tbody = document.createElement("tbody");
        // ensure at least SAMPLE_MIN_ROWS rows
        for (let r = 0; r < Math.max(SAMPLE_MIN_ROWS, entry.data.length); r++) {
          const row = entry.data[r] || { timestamp: null, x_px: null, y_px: null, x_m: null, y_m: null, dx: null, dy: null, v_frame: null };
          const tr = document.createElement("tr");
          const idCell = document.createElement("td"); idCell.textContent = entry.id; tr.appendChild(idCell);
          const jenisCell = document.createElement("td"); jenisCell.textContent = entry.jenis; tr.appendChild(jenisCell);
          const arahCell = document.createElement("td"); arahCell.textContent = entry.arah; tr.appendChild(arahCell);
          const tsCell = document.createElement("td"); tsCell.textContent = (row.timestamp == null ? "-" : (row.timestamp.toFixed ? row.timestamp.toFixed(3) : row.timestamp)); tr.appendChild(tsCell);
          const xpx = document.createElement("td"); xpx.textContent = (row.x_px == null ? "-" : row.x_px); tr.appendChild(xpx);
          const ypx = document.createElement("td"); ypx.textContent = (row.y_px == null ? "-" : row.y_px); tr.appendChild(ypx);
          const xm = document.createElement("td"); xm.textContent = (row.x_m == null ? "-" : Number(row.x_m).toFixed(3)); tr.appendChild(xm);
          const ym = document.createElement("td"); ym.textContent = (row.y_m == null ? "-" : Number(row.y_m).toFixed(3)); tr.appendChild(ym);
          const dxc = document.createElement("td"); dxc.textContent = (row.dx == null ? "-" : Number(row.dx).toFixed(4)); tr.appendChild(dxc);
          const dyc = document.createElement("td"); dyc.textContent = (row.dy == null ? "-" : Number(row.dy).toFixed(4)); tr.appendChild(dyc);
          const vf = document.createElement("td"); vf.textContent = (row.v_frame == null ? "-" : Number(row.v_frame).toFixed(4)); tr.appendChild(vf);

          tbody.appendChild(tr);
        }
        tbl.appendChild(tbody);

        // footer with v_individu
        const foot = document.createElement("div");
        foot.style.marginTop = "6px";
        foot.innerHTML = `<small>Kecepatan individu (m/s): <strong>${entry.v_individu == null ? "-" : Number(entry.v_individu).toFixed(4)}</strong></small>`;
        wrapper.appendChild(tbl);
        wrapper.appendChild(foot);

        tableWrap.appendChild(wrapper);
      } // end each entry
    } // end for cards
  }

  // Export CSV for a given direction (all finished entries in that direction)
  function exportDirectionCSV(directionString) {
    if (!directionString) return;
    const entries = finished.filter(e => e.arah === directionString);
    if (!entries || entries.length === 0) {
      alert(`Tidak ada data untuk arah: ${directionString}`);
      return;
    }
    // build single CSV containing all entries separated by blank lines
    const parts = [];
    for (const ent of entries) {
      const lines = [];
      lines.push(`ID Kendaraan,${ent.id}`);
      lines.push(`Jenis kendaraan,${ent.jenis}`);
      lines.push(`Arah datang – arah tujuan,${ent.arah}`);
      lines.push(`Kecepatan individu (m/s),${ent.v_individu == null ? "" : ent.v_individu}`);
      lines.push("");
      lines.push(["Timestamp (s)","Posisi X (px)","Posisi Y (px)","Posisi X (m)","Posisi Y (m)","dx (m)","dy (m)","Kecepatan per baris (m/frame)"].join(","));
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
    downloadBlob(csv, `speed_direction_${sanitizeFilename(directionString)}.csv`, "text/csv");
  }

  // --------------------------
  // Utilities & public API
  // --------------------------
  function getFinished() { return finished.slice(); }
  function clearFinished() { finished.length = 0; renderAllToContainer(); }
  function clearActive() { for (const k in activeLogs) delete activeLogs[k]; }

  // Public render call (manual)
  function renderInto(containerId = DEFAULT_CONTAINER_ID) {
    renderAllToContainer(containerId);
  }

  // Expose API
  return {
    logFrame,
    finalizeVehicle,
    getFinished,
    clearFinished,
    clearActive,
    renderInto,
    // configuration knobs (optional)
    setMaxSamples(n) { if (Number.isFinite(n) && n > 1) { /* no-op for now */ } },
    DIRECTIONS_12
  };
})();
