// ReportExporter.js
// Export Excel (.xlsx) single-sheet summary report
// Requires SheetJS (XLSX) available globally (via CDN or bundler import)

export function initReportExporter(options = {}) {
  // options.containerId: id elemen tempat tombol ditaruh (default: "summary-root")
  // options.buttonId: id tombol (default: "download-excel-btn")
  const containerId = options.containerId || "summary-root";
  const buttonId = options.buttonId || "download-excel-btn";
  const container = document.getElementById(containerId);
  if (!container) {
    console.warn("ReportExporter: container not found:", containerId);
    return;
  }

  // create button if not exist
  if (!document.getElementById(buttonId)) {
    const btn = document.createElement("button");
    btn.id = buttonId;
    btn.type = "button";
    btn.textContent = "📥 Download Hasil Excel";
    btn.style.padding = "6px 10px";
    btn.style.marginLeft = "8px";
    // append near container's first child toolbar if exists
    const toolbar = container.querySelector("div") || container;
    toolbar.appendChild(btn);
    btn.addEventListener("click", () => {
      try {
        generateExcelReport();
      } catch (err) {
        console.error("generateExcelReport failed", err);
        alert("Gagal membuat report: " + err.message);
      }
    });
  }
}

// Helper: parse numeric safely
function readNumberById(id, fallback = 0) {
  const el = document.getElementById(id);
  if (!el) return fallback;
  const raw = (el.value !== undefined && el.value !== null && el.value !== '') ? el.value : el.textContent;
  const v = parseFloat(String(raw).replace(/,/g, ''));
  return Number.isFinite(v) ? v : fallback;
}

// Helper: read config values (similar to ConfigManager)
function collectInputs() {
  const cfg = {};
  cfg.tanggal = (new Date()).toLocaleString('id-ID');
  cfg.simulasi = "Simpang 4 Lengan Mikroskopik";
  cfg.geometri = {
    radius: document.getElementById('customRange') ? document.getElementById('customRange').value : null,
    lajur: {
      utara: { masuk: document.getElementById('inNorth') ? document.getElementById('inNorth').value : null, keluar: document.getElementById('outNorth') ? document.getElementById('outNorth').value : null },
      timur: { masuk: document.getElementById('inEast') ? document.getElementById('inEast').value : null, keluar: document.getElementById('outEast') ? document.getElementById('outEast').value : null },
      selatan: { masuk: document.getElementById('inSouth') ? document.getElementById('inSouth').value : null, keluar: document.getElementById('outSouth') ? document.getElementById('outSouth').value : null },
      barat: { masuk: document.getElementById('inWest') ? document.getElementById('inWest').value : null, keluar: document.getElementById('outWest') ? document.getElementById('outWest').value : null }
    }
  };

  cfg.sinyal = {
    siklus: document.getElementById('durCycleTotal') ? document.getElementById('durCycleTotal').value : null,
    kuning: document.getElementById('durYellow') ? document.getElementById('durYellow').value : null,
    merah_semua: document.getElementById('durAllRed') ? document.getElementById('durAllRed').value : null,
    ltor: document.getElementById('ltsorGlobalSwitch') ? document.getElementById('ltsorGlobalSwitch').checked : null,
    fase: (document.querySelector('.fase-btn.active') ? document.querySelector('.fase-btn.active').innerText : null)
  };

  // traffic inputs: grab whatever pattern exists: use Summary's approach of motorn-/carn-/trukn- for up to 5 lajur
  const arahList = ['utara', 'timur', 'selatan', 'barat'];
  cfg.lalu_lintas = {};
  arahList.forEach(dir => {
    cfg.lalu_lintas[dir] = [];
    for (let i = 1; i <= 5; i++) {
      const MC = readNumberById(`motorn-${dir}-${i}`, 0);
      const LV = readNumberById(`carn-${dir}-${i}`, 0);
      const HV = readNumberById(`trukn-${dir}-${i}`, 0);
      const total = (MC + LV + HV) || null;
      const jumlahLajur = parseInt(document.getElementById(dir === 'utara' ? 'inNorth' : dir === 'timur' ? 'inEast' : dir === 'selatan' ? 'inSouth' : 'inWest')?.value || 0);
      const active = i <= jumlahLajur;
      cfg.lalu_lintas[dir].push({
        lajur: i,
        active,
        MC, LV, HV, total
      });
    }
  });

  return cfg;
}

// Build per-arah output using Summary cache + SpeedLogger rekap
function collectOutputsPerArah() {
  const out = {};
  const arahList = [
    { key: "utara", label: "Utara" },
    { key: "timur", label: "Timur" },
    { key: "selatan", label: "Selatan" },
    { key: "barat", label: "Barat" }
  ];

  // Summary.js stores rowsByDir in window.__summary_cache.rowsByDir
  const rowsCache = (window.__summary_cache && window.__summary_cache.rowsByDir) ? window.__summary_cache.rowsByDir : null;

  // SpeedLogger rekap
  const SLogger = (typeof window.SpeedLogger !== 'undefined') ? window.SpeedLogger : (typeof SpeedLogger !== 'undefined' ? SpeedLogger : null);
  const rekapSpeeds = (SLogger && typeof SLogger.getRekapData === 'function') ? SLogger.getRekapData() : null;

  // For each arah, gather:
  // - arusNyata (smp/jam) => from rowsCache totalArusNyataArah
  // - kecepatan rata-rata (km/jam) => compute average from rekapSpeeds for OD entries starting with that arah
  // - delay rata-rata (detik) => average delaySeconds from rekapSpeeds for OD entries starting with that arah (converted to sec)
  // - panjang antrian nyata (m) => sum of lanes' antrianNyata_lajur in Summary cache (if available)
  arahList.forEach(dir => {
    const label = dir.label;
    out[dir.key] = { arusNyata: null, kecepatanKmh: null, delaySec: null, panjangAntrianM: null };

    // find in rowsCache
    if (Array.isArray(rowsCache)) {
      const found = rowsCache.find(r => r.key === dir.key || r.arah === label);
      if (found) {
        out[dir.key].arusNyata = Number(found.totalArusNyataArah || 0);
        // compute panjang antrian nyata total across lanes
        const lanes = found.lanes || [];
        let sumQueue = 0;
        let anyQueue = false;
        lanes.forEach(l => {
          if (typeof l.antrianNyata_lajur === 'number') {
            sumQueue += Number(l.antrianNyata_lajur);
            anyQueue = true;
          }
        });
        out[dir.key].panjangAntrianM = anyQueue ? Number(sumQueue) : null;
      }
    }

    // speeds & delay from rekapSpeeds
    if (rekapSpeeds) {
      // rekapSpeeds keys like "Utara → Selatan"
      const keys = Object.keys(rekapSpeeds).filter(k => k && k.startsWith(label + " →"));
      // aggregate average speed (km/h) using customAvgKmh if available else all.avgKmh
      const speeds = [];
      const delays = [];
      for (const k of keys) {
        const entry = rekapSpeeds[k];
        if (!entry) continue;
        // prefer customAvgKmh then all.avgKmh
        const kmh = (entry.customAvgKmh != null) ? entry.customAvgKmh : (entry.all.avgKmh != null ? entry.all.avgKmh : null);
        if (kmh != null && !isNaN(kmh)) speeds.push(Number(kmh));
        if (entry.delaySeconds != null && !isNaN(entry.delaySeconds)) delays.push(Number(entry.delaySeconds));
      }
      if (speeds.length > 0) out[dir.key].kecepatanKmh = speeds.reduce((a,b)=>a+b,0)/speeds.length;
      if (delays.length > 0) out[dir.key].delaySec = delays.reduce((a,b)=>a+b,0)/delays.length;
    }
  });

  return out;
}

// Format numeric rounding helper
function roundNum(v, d = 2) {
  if (v == null || !isFinite(v)) return null;
  const p = Math.pow(10, d);
  return Math.round(Number(v) * p) / p;
}


// MAIN: generate Excel workbook & trigger download
export function generateExcelReport() {
  if (typeof XLSX === 'undefined') {
    alert("Library XLSX tidak ditemukan. Tambahkan <script src='https://cdn.sheetjs.com/xlsx-latest/package/dist/xlsx.full.min.js'></script>");
    return;
  }

  const cfg = collectInputs();
  const outPerArah = collectOutputsPerArah();

  // Build sheet as array-of-arrays (AoA) for nicer control and merges
  const aoa = [];

  // Header (big merged)
  aoa.push([ "LAPORAN HASIL SIMULASI MIKROSKOPIK PERSIMPANGAN JALAN BERSINYAL 4 LENGAN" ]);
  aoa.push([]);
  aoa.push([ `Tanggal Simulasi: ${cfg.tanggal}` ]);
  aoa.push([ `Mode Simulasi: ${cfg.simulasi}` ]);
  aoa.push([ `Fase Operasi: ${cfg.sinyal.fase || "-"}` ]);
  aoa.push([ `Siklus (detik): ${cfg.sinyal.siklus || "-" }    Kuning: ${cfg.sinyal.kuning || "-"}    Merah Semua: ${cfg.sinyal.merah_semua || "-" }    LTOR: ${cfg.sinyal.ltor ? "Aktif":"Tidak"} ` ]);
  aoa.push([]);
  aoa.push([ "INPUT GEOMETRI & LALU LINTAS" ]);
  aoa.push([ "Arah", "Jumlah Lajur (masuk)", "MC (smp/jam)", "LV (smp/jam)", "HV (smp/jam)", "Total (smp/jam)" ]);

  // input rows per direction (aggregate per arah)
  const arahOrder = ['utara','timur','selatan','barat'];
  arahOrder.forEach(key => {
    const rows = cfg.lalu_lintas[key] || [];
    const jumlahLajur = rows.filter(r => r.active).length || 0;
    // aggregate MC LV HV across active lanes
    let MC = 0, LV = 0, HV = 0;
    rows.forEach(r => {
      if (r.active) { MC += Number(r.MC || 0); LV += Number(r.LV || 0); HV += Number(r.HV || 0); }
    });
    const total = (MC + LV + HV) || "";
    aoa.push([ key.charAt(0).toUpperCase() + key.slice(1), jumlahLajur, MC || "-", LV || "-", HV || "-", total || "-" ]);
  });

  aoa.push([]);
  aoa.push([ "HASIL OUTPUT SIMULASI (REALTIME)" ]);
  aoa.push([ "Arah", "Arus Nyata (smp/jam)", "Kecepatan Rata-Rata (km/jam)", "Waktu Tunda Rata-rata (detik)", "Panjang Antrian Nyata (m)" ]);

  arahOrder.forEach(key => {
    const label = key.charAt(0).toUpperCase() + key.slice(1);
    const v = outPerArah[key] || {};
    aoa.push([
      label,
      v.arusNyata != null ? roundNum(v.arusNyata,0) : "-",
      v.kecepatanKmh != null ? roundNum(v.kecepatanKmh,2) : "-",
      v.delaySec != null ? roundNum(v.delaySec,2) : "-",
      v.panjangAntrianM != null ? roundNum(v.panjangAntrianM,2) : "-"
    ]);
  });

  aoa.push([]);
  aoa.push([ "RINGKASAN KENDARAAN" ]);
  // get finished vehicles count and averages if SpeedLogger available
  const SLogger = (typeof window.SpeedLogger !== 'undefined') ? window.SpeedLogger : (typeof SpeedLogger !== 'undefined' ? SpeedLogger : null);
  let finishedCount = 0;
  let avgKmhAll = null;
  let avgDelayAll = null;
  if (SLogger && typeof SLogger.getFinished === 'function') {
    try {
      const finished = SLogger.getFinished();
      finishedCount = finished.length;
      // compute avg km/h
      const kmhs = finished.map(f => (f.v_kmh != null && isFinite(f.v_kmh)) ? Number(f.v_kmh) : null).filter(x => x != null);
      if (kmhs.length>0) avgKmhAll = kmhs.reduce((a,b)=>a+b,0)/kmhs.length;
      // delay per vehicle not provided individually; we can try to compute average delay from rekap if available
      const rekap = (SLogger && typeof SLogger.getRekapData === 'function') ? SLogger.getRekapData() : null;
      if (rekap) {
        // collect all delaySeconds
        const delays = [];
        Object.keys(rekap).forEach(k => { if (rekap[k] && rekap[k].delaySeconds != null) delays.push(rekap[k].delaySeconds); });
        if (delays.length>0) avgDelayAll = delays.reduce((a,b)=>a+b,0)/delays.length;
      }
    } catch (err) {
      console.warn("ReportExporter: failed to read SpeedLogger finished", err);
    }
  }

  aoa.push([ "Jumlah Kendaraan Tercatat", finishedCount ]);
  aoa.push([ "Kecepatan Rata-rata seluruh kendaraan (km/jam)", avgKmhAll != null ? roundNum(avgKmhAll,2) : "-" ]);
  aoa.push([ "Delay rata-rata (detik) - global (dari rekap)", avgDelayAll != null ? roundNum(avgDelayAll,2) : "-" ]);

  // Build worksheet
  const ws = XLSX.utils.aoa_to_sheet(aoa);

  // Apply merges for big header and section titles (positions based on AOA indices)
  // Merge header row (row 1) across columns A:E (0-based indices)
  ws['!merges'] = ws['!merges'] || [];
  function mergeCells(r1,c1,r2,c2) { ws['!merges'].push({ s:{r:r1,c:c1}, e:{r:r2,c:c2} }); }

  // First header (row 0) merge across A-F (0..5)
  mergeCells(0,0,0,5);
  // Section titles merge single row across A-F for clarity (we search AOAs to find positions)
  // INPUT GEOMETRI header (we know it's at index 7)
  mergeCells(7,0,7,5);
  // HASIL... header (we know position: find index)
  // find row index for "HASIL OUTPUT SIMULASI (REALTIME)"
  let hasilIdx = aoa.findIndex(r => r && r[0] && String(r[0]).toString().startsWith("HASIL OUTPUT SIMULASI"));
  if (hasilIdx >= 0) mergeCells(hasilIdx,0,hasilIdx,5);
  // RINGKASAN KENDARAAN
  let ringkIdx = aoa.findIndex(r => r && r[0] && String(r[0]).toString().startsWith("RINGKASAN KENDARAAN"));
  if (ringkIdx >= 0) mergeCells(ringkIdx,0,ringkIdx,5);

  // Column widths
  ws['!cols'] = [{wpx:120},{wpx:110},{wpx:110},{wpx:110},{wpx:140},{wpx:110}];

  // Create workbook
  const wb = XLSX.utils.book_new();
  const sheetName = "Laporan_Simulasi";
  XLSX.utils.book_append_sheet(wb, ws, sheetName);

  // prepare filename
  const now = new Date();
  const fn = `laporan_simulasi_${now.toISOString().slice(0,19).replace(/[:T]/g,"-")}.xlsx`;

  // write file
  XLSX.writeFile(wb, fn);
}
