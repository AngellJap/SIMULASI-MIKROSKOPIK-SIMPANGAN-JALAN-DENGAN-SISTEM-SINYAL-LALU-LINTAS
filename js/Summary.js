// ======================================================================
// Summary.js — Final version (Revisi Lengkap Arus & Antrian Nyata)
// ======================================================================

/* ===========================
   0. Exported init function
   =========================== */
export function initSummary(containerId = "summary-root") {
  const container = document.getElementById(containerId);
  if (!container) {
    console.warn(`Summary.initSummary: container #${containerId} not found.`);
    return;
  }

  container.classList.add("summary-root-panel");
  container.innerHTML = `
    <div id="summary-inner">
      <h3 style="margin:8px 0;">📊 Ringkasan Simulasi (Per Arah)</h3>
      <div style="margin-bottom:8px;">
        <button id="summary-refresh-btn" style="padding:6px 10px; margin-right:8px;">Refresh</button>
        <button id="summary-download-btn" style="padding:6px 10px;">Download CSV</button>
      </div>
      <div class="summary-InOutpanel" style="overflow-x:auto;">
        <table id="summary-table" style="width:100%; border-collapse:collapse;">
          <thead>
            <tr style="background:#333; color:#fff; text-align:center;">
              <th style="border:1px solid #999; padding:4px;">Arah</th>
              <th style="border:1px solid #999; padding:4px;">Lajur</th>
              <th style="border:1px solid #999; padding:4px;">Jumlah Lajur</th>
              <th style="border:1px solid #999; padding:4px;">Lebar Lajur (m)</th>
              <th style="border:1px solid #999; padding:4px;">MC (smp/jam)</th>
              <th style="border:1px solid #999; padding:4px;">LV (smp/jam)</th>
              <th style="border:1px solid #999; padding:4px;">HV (smp/jam)</th>
              <th style="border:1px solid #999; padding:4px;">Total Arus (smp/jam)</th>
              <th style="border:1px solid #999; padding:4px;">Truk (%)</th>
              <th style="border:1px solid #999; padding:4px;">Fase</th>
              <th style="border:1px solid #999; padding:4px;">Hijau (detik)</th>
              <th style="border:1px solid #999; padding:4px;">1 Siklus (detik)</th>
              <th style="border:1px solid #999; padding:4px;">Merah (detik)</th>
              <th style="border:1px solid #999; padding:4px;">Arus Jenuh (smp/jam)</th>
              <th style="border:1px solid #999; padding:4px;">SMP Hijau (smp)</th>
              <th style="border:1px solid #999; padding:4px;">Kapasitas (smp/jam)</th>
              <th style="border:1px solid #999; padding:4px;">Kapasitas TOTAL (smp/jam)</th>
              
              <th style="border:1px solid #999; padding:4px;">Arus LL (Teori)</th>
              <th style="border:1px solid #999; padding:4px;">Arus LL TOTAL (Teori)</th>

              <!-- KOLOM REAL-TIME (Biru Muda) -->
              <th style="border:1px solid #999; padding:4px; background:#e6f7ff; color:#000;">Arus LL Nyata (smp/jam)</th>
              <th style="border:1px solid #999; padding:4px; background:#e6f7ff; color:#000;">Total Arus Nyata (smp/jam)</th>

              <th style="border:1px solid #999; padding:4px;">Panjang Antrian (Teori)</th>

              <!-- KOLOM REAL-TIME (Merah Muda) -->
              <th style="border:1px solid #999; padding:4px; background:#fff1f0; color:#000;">Panjang Antrian Nyata (m)</th>
            </tr>
          </thead>
          <tbody id="summary-tbody"></tbody>
        </table>
      </div>
    </div>
  `;

  // wire buttons
  document.getElementById("summary-refresh-btn")?.addEventListener("click", () => updateSummaryTable());
  document.getElementById("summary-download-btn")?.addEventListener("click", () => downloadSummaryCSV());

  // auto-update on relevant changes
  window.addEventListener("change", (ev) => {
    const id = ev.target?.id || "";
    if (/(motorn-|carn-|trukn-|arus-|inNorth|inEast|inSouth|inWest|durCycleTotal|durAllRed|durYellow|fase-)/i.test(id)) {
      updateSummaryTable();
    }
  }, { capture: true });

  window.addEventListener("input", (ev) => {
    const id = ev.target?.id || "";
    if (/(motorn-|carn-|trukn-|arus-|trukpct-)/i.test(id)) {
      updateSummaryTable();
    }
  }, { capture: true });

  // initial render
  updateSummaryTable();
}

/* ===========================
   1. Helper functions
   =========================== */

function readNumberById(id, fallback = 0) {
  const el = document.getElementById(id);
  if (!el) return fallback;
  const raw = (el.value !== undefined && el.value !== null && el.value !== '') ? el.value : el.textContent;
  const v = parseFloat(String(raw).replace(/,/g, ''));
  return Number.isFinite(v) ? v : fallback;
}

function roundNum(v, d = 2) {
  const p = Math.pow(10, d);
  return Math.round((Number(v) || 0) * p) / p;
}

function getPhase() {
  if (document.getElementById("fase-searah")?.classList.contains("active")) return "searah";
  if (document.getElementById("fase-berhadapan")?.classList.contains("active")) return "berhadapan";
  if (document.getElementById("fase-berseberangan")?.classList.contains("active")) return "berseberangan";
  return "searah";
}

/* ===========================
   2. Core formulas
   =========================== */

const LANE_WIDTH_M = 3;

function hitungWaktuHijau(fase, siklus, durAllRed, durYellow) {
  if (fase === "searah") return siklus / 4 - durAllRed - durYellow;
  return siklus / 2 - durAllRed - durYellow;
}

function hitungWaktuMerah(fase, siklus) {
  if (fase === "searah") return (3 / 4) * siklus;
  return (1 / 2) * siklus;
}

function hitungArusJenuhPerLajur(persenTruk) {
  const frac = (persenTruk || 0) / 100;
  return 1900 * 0.92 * (1 / (1 + frac * 1)) * 1 * 1 * 1 * 0.9;
}

function hitungQPerLajur(MC = 0, LV = 0, HV = 0) {
  return LV + 1.3 * HV + 0.2 * MC;
}

function hitungSmpHijauPerLajur(totalArusLajur, waktuMerah) {
  return (totalArusLajur * waktuMerah) / 3600;
}

function hitungKapasitasPerLajur(S_perLajur, waktuHijau, siklus) {
  if (!siklus || siklus <= 0) return 0;
  return (S_perLajur * waktuHijau) / siklus;
}

function hitungPanjangAntrianPerLajur(smpHijau, lebarLajur = LANE_WIDTH_M) {
  if (!lebarLajur) return 0;
  return (smpHijau * 20) / lebarLajur;
}

/* ===========================
   3. Main: updateSummaryTable
   =========================== */
export function updateSummaryTable(config, realTimeData = {}) {
  const tbody = document.getElementById("summary-tbody");
  if (!tbody) return;

  // directions
  const directions = [
    { key: "utara", selectId: "inNorth", label: "Utara" },
    { key: "timur", selectId: "inEast", label: "Timur" },
    { key: "selatan", selectId: "inSouth", label: "Selatan" },
    { key: "barat", selectId: "inWest", label: "Barat" }
  ];

  const MAX_LANES = 5; 
  const laneWidth = LANE_WIDTH_M;

  const siklus = readNumberById("durCycleTotal", 60);
  const durAllRed = readNumberById("durAllRed", 0);
  const durYellow = readNumberById("durYellow", 0);
  const fase = getPhase();

  const rowsByDir = [];

  directions.forEach(dir => {
    const jumlahLajur = Math.max(0, parseInt(document.getElementById(dir.selectId)?.value || 0));

    let waktuHijau = hitungWaktuHijau(fase, siklus, durAllRed, durYellow);
    if (waktuHijau <= 0) waktuHijau = 0.001;
    const waktuMerah = hitungWaktuMerah(fase, siklus);

    const lanes = [];
    let totalKapasitasArah = 0;
    let totalArusLL_Arah = 0;
    let totalArusNyataArah = 0;

    for (let i = 1; i <= MAX_LANES; i++) {
      const idMC = `motorn-${dir.key}-${i}`;
      const idLV = `carn-${dir.key}-${i}`;
      const idHV = `trukn-${dir.key}-${i}`;
      const idArus = `arus-${dir.key}-${i}`;

      const MC = readNumberById(idMC, 0);
      const LV = readNumberById(idLV, 0);
      const HV = readNumberById(idHV, 0);

      let totalArusLajur = null;
      const arusInputEl = document.getElementById(idArus);
      if (arusInputEl) {
        const rawArus = readNumberById(idArus, null);
        if (rawArus !== null && rawArus !== 0) totalArusLajur = rawArus;
      }
      if (totalArusLajur === null) {
        const sumComp = MC + LV + HV;
        totalArusLajur = sumComp > 0 ? sumComp : 0;
      }

      const compSum = MC + LV + HV;
      const persenTruk = compSum > 0 ? roundNum((HV / compSum) * 100, 2) : 0;

      const S_lajur = hitungArusJenuhPerLajur(persenTruk);
      const smpHijau_lajur = hitungSmpHijauPerLajur(totalArusLajur, waktuMerah);
      const kapasitas_lajur = hitungKapasitasPerLajur(S_lajur, waktuHijau, siklus);
      const arusLL_lajur = hitungQPerLajur(MC, LV, HV);
      const panjang_lajur = hitungPanjangAntrianPerLajur(smpHijau_lajur, laneWidth);

      // Ambil Data Real-Time
      const keyData = `${dir.label}-${i}`; 
      const stats = realTimeData[keyData] || { flow: 0, queue: 0 };

      if (i <= jumlahLajur) {
        totalKapasitasArah += kapasitas_lajur;
        totalArusLL_Arah += arusLL_lajur;
        totalArusNyataArah += stats.flow;
      }

      lanes.push({
        lajur: i,
        active: (i <= jumlahLajur),
        MC, LV, HV,
        totalArusLajur,
        persenTruk,
        S_lajur,
        smpHijau_lajur,
        kapasitas_lajur,
        arusLL_lajur,
        panjang_lajur,
        arusNyata_lajur: stats.flow, 
        antrianNyata_lajur: stats.queue
      });
    }

    rowsByDir.push({
      arah: dir.label,
      key: dir.key,
      jumlahLajur,
      laneWidth,
      fase,
      waktuHijau,
      siklus,
      waktuMerah,
      lanes,
      totalKapasitasArah: roundNum(totalKapasitasArah, 2),
      totalArusLL_Arah: roundNum(totalArusLL_Arah, 2),
      totalArusNyataArah: roundNum(totalArusNyataArah, 0)
    });
  });

  window.__summary_cache = window.__summary_cache || {};
  window.__summary_cache.rowsByDir = rowsByDir;

 renderTable(rowsByDir);
}

/* ===========================
   4. Render Table (DOM)
   =========================== */
function renderTable(rowsByDir) {
  const tbody = document.getElementById("summary-tbody");
  if (!tbody) return;
  tbody.innerHTML = "";

  rowsByDir.forEach(dir => {
    const lanes = dir.lanes;
    const rowSpan = lanes.length; 

    lanes.forEach((ln, idx) => {
      const tr = document.createElement("tr");

      // 1. Arah (Rowspan)
      if (idx === 0) tr.appendChild(makeTd(dir.arah, true, rowSpan));
      // 2. Lajur
      tr.appendChild(makeTd(ln.lajur));
      // 3. Jumlah Lajur (Rowspan)
      if (idx === 0) tr.appendChild(makeTd(dir.jumlahLajur, true, rowSpan));
      // 4. Lebar Lajur (Rowspan)
      if (idx === 0) tr.appendChild(makeTd(dir.laneWidth + " m", true, rowSpan));

      // ... Kolom input MC/LV/HV/Total/Truk% ...
      tr.appendChild(makeTd(ln.MC !== 0 ? roundNum(ln.MC, 2) : "-"));
      tr.appendChild(makeTd(ln.LV !== 0 ? roundNum(ln.LV, 2) : "-"));
      tr.appendChild(makeTd(ln.HV !== 0 ? roundNum(ln.HV, 2) : "-"));
      tr.appendChild(makeTd(ln.totalArusLajur ? roundNum(ln.totalArusLajur, 2) : "-"));
      tr.appendChild(makeTd(ln.active ? (roundNum(ln.persenTruk, 2) + "%") : "-"));

      // ... Kolom Fase/Waktu (Rowspan) ...
      if (idx === 0) tr.appendChild(makeTd(dir.fase, true, rowSpan));
      if (idx === 0) tr.appendChild(makeTd(roundNum(dir.waktuHijau, 2), true, rowSpan));
      if (idx === 0) tr.appendChild(makeTd(roundNum(dir.siklus, 2), true, rowSpan));
      if (idx === 0) tr.appendChild(makeTd(roundNum(dir.waktuMerah, 2), true, rowSpan));

      // ... Kolom Kalkulasi Teori ...
      tr.appendChild(makeTd(ln.active ? roundNum(ln.S_lajur, 0) : "-")); // Arus Jenuh
      tr.appendChild(makeTd(ln.smpHijau_lajur ? roundNum(ln.smpHijau_lajur, 2) : "-")); // SMP Hijau
      tr.appendChild(makeTd(ln.active ? roundNum(ln.kapasitas_lajur, 0) : "-")); // Kapasitas
      
      // Kapasitas TOTAL (Rowspan)
      if (idx === 0) tr.appendChild(makeTd(roundNum(dir.totalKapasitasArah, 0), true, rowSpan));

      // Arus LL Teori per lajur
      tr.appendChild(makeTd(ln.arusLL_lajur ? roundNum(ln.arusLL_lajur, 0) : "-"));
      // Arus LL Total Teori (Rowspan)
      if (idx === 0) tr.appendChild(makeTd(roundNum(dir.totalArusLL_Arah, 0), true, rowSpan));

      // =========================================================
      // KOLOM BARU: ARUS NYATA & ANTRIAN NYATA
      // =========================================================
      
      // 1. Arus LL Nyata (Per Lajur)
      // Tampilkan hanya jika lajur aktif, background biru muda
      const valArusNyata = (ln.active && ln.arusNyata_lajur !== undefined) ? roundNum(ln.arusNyata_lajur, 0) : "-";
      tr.appendChild(makeTd(valArusNyata, false, 1, "#e6f7ff"));

      // 2. Total Arus Nyata (Per Arah - Rowspan)
      if (idx === 0) {
        const valTotalArus = roundNum(dir.totalArusNyataArah, 0);
        tr.appendChild(makeTd(valTotalArus, true, rowSpan, "#e6f7ff"));
      }

      // 3. Panjang Antrian Teori
      tr.appendChild(makeTd(ln.panjang_lajur ? roundNum(ln.panjang_lajur, 1) : "-"));

      // 4. Panjang Antrian Nyata (Per Lajur) - Background merah muda
      const valAntrianNyata = (ln.active && ln.antrianNyata_lajur !== undefined) ? roundNum(ln.antrianNyata_lajur, 1) : 0;
      tr.appendChild(makeTd(valAntrianNyata, false, 1, "#fff1f0"));

      tbody.appendChild(tr);
    });
  });
}

/* ===========================
   5. Small helpers for rendering & CSV
   =========================== */

function makeTd(value, rowspan = false, span = 1, bg = null) {
  const td = document.createElement("td");
  td.style.padding = "6px";
  td.style.textAlign = "center";
  td.style.border = "1px solid rgba(0,0,0,0.2)"; 
  td.style.color = "#000";
  
  if (bg) td.style.backgroundColor = bg;
  
  td.textContent = (value === undefined || value === null || value === "") ? "-" : String(value);
  if (rowspan) {
    td.rowSpan = span;
    td.style.verticalAlign = "middle";
  }
  return td;
}

export function downloadSummaryCSV() {
  const cache = window.__summary_cache || {};
  const rowsByDir = cache.rowsByDir || [];
  if (!rowsByDir.length) {
    alert("Tidak ada data summary untuk diunduh.");
    return;
  }

  const header = [
    "Arah","Lajur","JumlahLajur","LebarLajur(m)",
    "MC","LV","HV","TotalArus","Truk(%)",
    "Fase","Hijau","Siklus","Merah",
    "ArusJenuh","SMPHijau","Kapasitas","KapasitasTotal",
    "ArusLL(Teori)","ArusLLTotal(Teori)",
    "ArusLL(Nyata)","ArusLLTotal(Nyata)",
    "PanjangAntrian(Teori)","PanjangAntrian(Nyata)"
  ];
  const lines = [header.join(",")];

  rowsByDir.forEach(dir => {
    dir.lanes.forEach(ln => {
      lines.push([
        dir.arah, ln.lajur, dir.jumlahLajur, dir.laneWidth,
        ln.MC, ln.LV, ln.HV, ln.totalArusLajur, ln.persenTruk,
        dir.fase, roundNum(dir.waktuHijau,2), roundNum(dir.siklus,2), roundNum(dir.waktuMerah,2),
        roundNum(ln.S_lajur,2), roundNum(ln.smpHijau_lajur,3), roundNum(ln.kapasitas_lajur,2), roundNum(dir.totalKapasitasArah,2),
        roundNum(ln.arusLL_lajur,2), roundNum(dir.totalArusLL_Arah,2),
        // Data Nyata di CSV
        roundNum(ln.arusNyata_lajur, 0), roundNum(dir.totalArusNyataArah, 0),
        roundNum(ln.panjang_lajur,2), roundNum(ln.antrianNyata_lajur, 1)
      ].join(","));
    });
  });

  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `summary_simulasi_${(new Date()).toISOString().slice(0,19).replace(/[:T]/g,"-")}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
}