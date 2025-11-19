// ======================================================================
// Summary.js — Final version (per permintaan)
// - Exports: initSummary(containerId), updateSummaryTable(), downloadSummaryCSV()
// - Input IDs expected:
//    motorn-<arah>-<i>, carn-<arah>-<i>, trukn-<arah>-<i>
//    arus-<arah>-<i> (opsional; jika ada gunakan sebagai total lajur, jika tidak fallback ke MC+LV+HV)
//    inNorth, inEast, inSouth, inWest
//    durCycleTotal, durAllRed, durYellow
//    fase-searah, fase-berhadapan, fase-berseberangan (active class)
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
            <tr style="background:#333;color:#fff;text-align:center;">
              <th>Arah</th>
              <th>Lajur</th>
              <th>Jumlah Lajur</th>
              <th>Lebar Lajur (m)</th>
              <th>MC (smp/jam)</th>
              <th>LV (smp/jam)</th>
              <th>HV (smp/jam)</th>
              <th>Total Arus (smp/jam)</th>
              <th>Truk (%)</th>
              <th>Fase</th>
              <th>Hijau (detik)</th>
              <th>1 Siklus (detik)</th>
              <th>Merah (detik)</th>
              <th>Arus Jenuh (smp/jam)</th>
              <th>SMP Hijau (smp)</th>
              <th>Kapasitas (smp/jam)</th>
              <th>Kapasitas TOTAL (smp/jam)</th>
              <th>Arus Lalu Lintas (smp/jam)</th>
              <th>Arus Lalu Lintas TOTAL (smp/jam)</th>
              <th>Panjang Antrian (m)</th>
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

/** readNumberById(id, fallback)
 * - reads .value or .textContent and returns numeric value or fallback
 */
function readNumberById(id, fallback = 0) {
  const el = document.getElementById(id);
  if (!el) return fallback;
  // use value if present, else textContent
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
   2. Core formulas (easily editable)
   - If you want to change formulas manually, edit here.
   =========================== */

// lane width default (meters)
const LANE_WIDTH_M = 3;

/** hitungWaktuHijau(fase, siklus, durAllRed, durYellow)
 *  per spesifikasi:
 *  - searah: hijau = siklus/4 - durAllRed - durYellow
 *  - berhadapan/berseberangan: hijau = siklus/2 - durAllRed - durYellow
 */
function hitungWaktuHijau(fase, siklus, durAllRed, durYellow) {
  if (fase === "searah") return siklus / 4 - durAllRed - durYellow;
  return siklus / 2 - durAllRed - durYellow;
}

/** hitungWaktuMerah(fase, siklus)
 *  per spesifikasi:
 *  - searah: merah = 3/4 * siklus
 *  - berhadapan/berseberangan: merah = 1/2 * siklus
 *  (all-red & yellow ignored in merah)
 */
function hitungWaktuMerah(fase, siklus) {
  if (fase === "searah") return (3 / 4) * siklus;
  return (1 / 2) * siklus;
}

/** hitungArusJenuhPerLajur(persenTruk)
 *  S = 1900 * 0.92 * (1/(1 + trukFraction*(2-1))) * 1 * 1 * 1 * 0.9
 *  persenTruk is in percent (0..100)
 */
function hitungArusJenuhPerLajur(persenTruk) {
  const frac = (persenTruk || 0) / 100;
  return 1900 * 0.92 * (1 / (1 + frac * 1)) * 1 * 1 * 1 * 0.9;
}

/** hitungQPerLajur(MC, LV, HV)
 *  Q = LV + 1.3*HV + 0.2*MC
 */
function hitungQPerLajur(MC = 0, LV = 0, HV = 0) {
  return LV + 1.3 * HV + 0.2 * MC;
}

/** hitungSmpHijauPerLajur(totalArusLajur, waktuMerah)
 *  smpHijau = totalArusLajur * waktuMerah / 3600
 */
function hitungSmpHijauPerLajur(totalArusLajur, waktuMerah) {
  return (totalArusLajur * waktuMerah) / 3600;
}

/** hitungKapasitasPerLajur(S_perLajur, waktuHijau, siklus)
 *  Kapasitas per LAJUR = S * waktuHijau / siklus
 */
function hitungKapasitasPerLajur(S_perLajur, waktuHijau, siklus) {
  if (!siklus || siklus <= 0) return 0;
  return (S_perLajur * waktuHijau) / siklus;
}

/** hitungPanjangAntrianPerLajur(smpHijau, lebarLajur)
 *  panjang = smpHijau * 20 / lebarLajur
 */
function hitungPanjangAntrianPerLajur(smpHijau, lebarLajur = LANE_WIDTH_M) {
  if (!lebarLajur) return 0;
  return (smpHijau * 20) / lebarLajur;
}

/* ===========================
   3. Main: updateSummaryTable
   - builds rowsByDir (per arah) with per-lajur details
   =========================== */
export function updateSummaryTable() {
  const tbody = document.getElementById("summary-tbody");
  if (!tbody) return;
  tbody.innerHTML = "";

  // directions
  const directions = [
    { key: "utara", selectId: "inNorth", label: "Utara" },
    { key: "timur", selectId: "inEast", label: "Timur" },
    { key: "selatan", selectId: "inSouth", label: "Selatan" },
    { key: "barat", selectId: "inWest", label: "Barat" }
  ];

  const MAX_LANES = 5; // always render 1..5
  const laneWidth = LANE_WIDTH_M;

  // read cycle & phase
  const siklus = readNumberById("durCycleTotal", 60);
  const durAllRed = readNumberById("durAllRed", 0);
  const durYellow = readNumberById("durYellow", 0);
  const fase = getPhase();

  // per-direction results container
  const rowsByDir = [];

  // loop directions
  directions.forEach(dir => {
    const jumlahLajur = Math.max(0, parseInt(document.getElementById(dir.selectId)?.value || 0));

    // precompute green & red for the given phase (same for lajur in same direction)
    let waktuHijau = hitungWaktuHijau(fase, siklus, durAllRed, durYellow);
    if (waktuHijau <= 0) waktuHijau = 0.001; // prevent divide by zero
    const waktuMerah = hitungWaktuMerah(fase, siklus);

    // per-lajur array
    const lanes = [];
    // totals per direction (for total columns)
    let totalKapasitasArah = 0;
    let totalArusLL_Arah = 0; // arus lalu lintas total per arah (sum of Q per lajur)
    // we will also count active lajur to compute totals from only active lajur
    let activeLajurCount = 0;

    for (let i = 1; i <= MAX_LANES; i++) {
      // read inputs for this lajur
      const idMC = `motorn-${dir.key}-${i}`;
      const idLV = `carn-${dir.key}-${i}`;
      const idHV = `trukn-${dir.key}-${i}`;
      const idArus = `arus-${dir.key}-${i}`; // optional total lajur input

      const MC = readNumberById(idMC, 0);
      const LV = readNumberById(idLV, 0);
      const HV = readNumberById(idHV, 0);

      // totalArusLajur preference: use arus-... if exists & non-zero, else fallback to MC+LV+HV
      let totalArusLajur = null;
      const arusInputEl = document.getElementById(idArus);
      if (arusInputEl) {
        const rawArus = readNumberById(idArus, null);
        if (rawArus !== null && rawArus !== 0) totalArusLajur = rawArus;
      }
      if (totalArusLajur === null) {
        // fallback to MC+LV+HV
        const sumComp = MC + LV + HV;
        totalArusLajur = sumComp > 0 ? sumComp : 0;
      }

      // if lajur has no input (all zeros) AND it's beyond jumlahLajur, mark as inactive
      const isActive = (i <= jumlahLajur) && (MC !== 0 || LV !== 0 || HV !== 0 || (document.getElementById(idArus) && readNumberById(idArus, 0) !== 0));
      if (i <= jumlahLajur && (MC !== 0 || LV !== 0 || HV !== 0 || readNumberById(idArus, 0) !== 0)) activeLajurCount++;

      // composition based on components
      const compSum = MC + LV + HV;
      const persenTruk = compSum > 0 ? roundNum((HV / compSum) * 100, 2) : 0;

      // per-lajur calculations:
      // Arus Jenuh per lajur (S)
      const S_lajur = hitungArusJenuhPerLajur(persenTruk);

      // SMP Hijau per lajur
      const smpHijau_lajur = hitungSmpHijauPerLajur(totalArusLajur, waktuMerah);

      // Kapasitas per lajur
      const kapasitas_lajur = hitungKapasitasPerLajur(S_lajur, waktuHijau, siklus);

      // Arus Lalu Lintas per lajur (Q)
      const arusLL_lajur = hitungQPerLajur(MC, LV, HV);

      // Panjang antrian per lajur
      const panjang_lajur = hitungPanjangAntrianPerLajur(smpHijau_lajur, laneWidth);

      // accumulate totals per direction for only active lajur
      if (i <= jumlahLajur) {
        totalKapasitasArah += kapasitas_lajur;
        totalArusLL_Arah += arusLL_lajur;
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
        panjang_lajur
      });
    } // end per lajur loop

    // store aggregated info per direction
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
      totalArusLL_Arah: roundNum(totalArusLL_Arah, 2)
    });
  }); // end directions

  // cache rows for CSV
  window.__summary_cache = window.__summary_cache || {};
  window.__summary_cache.rowsByDir = rowsByDir;

  // render table
  renderTable(rowsByDir);
}

/* ===========================
   4. Render Table (DOM)
   - respects column order requested
   - Kapasitas TOTAL & Arus Lalu Lintas TOTAL displayed on first row (rowspan)
   =========================== */
function renderTable(rowsByDir) {
  const tbody = document.getElementById("summary-tbody");
  if (!tbody) return;
  tbody.innerHTML = "";

  rowsByDir.forEach(dir => {
    const lanes = dir.lanes;
    const rowSpan = lanes.length; // 5

    lanes.forEach((ln, idx) => {
      const tr = document.createElement("tr");

      // 1. Arah (rowspan)
      if (idx === 0) tr.appendChild(makeTd(dir.arah, true, rowSpan));

      // 2. Lajur (per-row)
      tr.appendChild(makeTd(ln.lajur));

      // 3. Jumlah Lajur (rowspan)
      if (idx === 0) tr.appendChild(makeTd(dir.jumlahLajur, true, rowSpan));

      // 4. Lebar Lajur (m) (rowspan)
      if (idx === 0) tr.appendChild(makeTd(dir.laneWidth + " m", true, rowSpan));

      // 5. MC
      tr.appendChild(makeTd(ln.MC !== 0 ? roundNum(ln.MC, 2) : "-"));

      // 6. LV
      tr.appendChild(makeTd(ln.LV !== 0 ? roundNum(ln.LV, 2) : "-"));

      // 7. HV
      tr.appendChild(makeTd(ln.HV !== 0 ? roundNum(ln.HV, 2) : "-"));

      // 8. Total Arus (per lajur)
      tr.appendChild(makeTd(ln.totalArusLajur ? roundNum(ln.totalArusLajur, 2) : "-"));

      // 9. Truk (% per lajur)
      tr.appendChild(makeTd(ln.active ? (roundNum(ln.persenTruk,2) + "%") : "-"));

      // 10. Fase (rowspan)
      if (idx === 0) tr.appendChild(makeTd(dir.fase, true, rowSpan));

      // 11. Hijau (detik) (rowspan)
      if (idx === 0) tr.appendChild(makeTd(roundNum(dir.waktuHijau, 2), true, rowSpan));

      // 12. 1 Siklus (detik) (rowspan)
      if (idx === 0) tr.appendChild(makeTd(roundNum(dir.siklus, 2), true, rowSpan));

      // 13. Merah (detik) (rowspan)
      if (idx === 0) tr.appendChild(makeTd(roundNum(dir.waktuMerah, 2), true, rowSpan));

      // 14. Arus Jenuh (smp/jam) per lajur
      tr.appendChild(makeTd(ln.active ? roundNum(ln.S_lajur, 2) : "-"));

      // 15. SMP Hijau (per lajur)
      tr.appendChild(makeTd(ln.smpHijau_lajur ? roundNum(ln.smpHijau_lajur, 3) : "-"));

      // 16. Kapasitas per lajur
      tr.appendChild(makeTd(ln.active ? roundNum(ln.kapasitas_lajur, 2) : "-"));

      // 17. Kapasitas TOTAL (per arah) - shown in first row only
      if (idx === 0) tr.appendChild(makeTd(dir.totalKapasitasArah ?? 0, true, rowSpan));

      // 18. Arus Lalu Lintas (per lajur)
      tr.appendChild(makeTd(ln.arusLL_lajur ? roundNum(ln.arusLL_lajur, 2) : "-"));

      // 19. Arus Lalu Lintas TOTAL (per arah) - first row only
      if (idx === 0) tr.appendChild(makeTd(dir.totalArusLL_Arah ?? 0, true, rowSpan));

      // 20. Panjang Antrian (m) per lajur
      tr.appendChild(makeTd(ln.panjang_lajur ? roundNum(ln.panjang_lajur, 2) : "-"));

      tbody.appendChild(tr);
    });
  });
}

/* ===========================
   5. small helpers for rendering & CSV
   =========================== */

function makeTd(value, rowspan = false, span = 1) {
  const td = document.createElement("td");
  td.style.padding = "6px";
  td.style.textAlign = "center";
  td.style.border = "1px solid rgba(255,255,255,0.06)";
  td.textContent = (value === undefined || value === null || value === "") ? "-" : String(value);
  if (rowspan) {
    td.rowSpan = span;
    td.style.verticalAlign = "middle";
  }
  return td;
}

/* ===========================
   6. CSV Export (downloadSummaryCSV)
   =========================== */

export function downloadSummaryCSV() {
  const cache = window.__summary_cache || {};
  const rowsByDir = cache.rowsByDir || [];
  if (!rowsByDir.length) {
    alert("Tidak ada data summary untuk diunduh.");
    return;
  }

  const header = [
    "Arah","Lajur","JumlahLajur","LebarLajur(m)",
    "MC(smp/jam)","LV(smp/jam)","HV(smp/jam)","TotalArus(smp/jam)","Truk(%)",
    "Fase","Hijau(detik)","Siklus(detik)","Merah(detik)",
    "ArusJenuh(smp/jam)","SMPHijau(smp)","Kapasitas(smp/jam)","KapasitasTotal(smp/jam)",
    "ArusLaluLintas(smp/jam)","ArusLaluLintasTotal(smp/jam)","PanjangAntrian(m)"
  ];
  const lines = [header.join(",")];

  rowsByDir.forEach(dir => {
    dir.lanes.forEach(ln => {
      lines.push([
        dir.arah,
        ln.lajur,
        dir.jumlahLajur,
        dir.laneWidth,
        ln.MC,
        ln.LV,
        ln.HV,
        ln.totalArusLajur,
        ln.persenTruk,
        dir.fase,
        roundNum(dir.waktuHijau,2),
        roundNum(dir.siklus,2),
        roundNum(dir.waktuMerah,2),
        roundNum(ln.S_lajur,2),
        roundNum(ln.smpHijau_lajur,3),
        roundNum(ln.kapasitas_lajur,2),
        roundNum(dir.totalKapasitasArah,2),
        roundNum(ln.arusLL_lajur,2),
        roundNum(dir.totalArusLL_Arah,2),
        roundNum(ln.panjang_lajur,2)
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

/* ===========================
   NOTES / TIPS
   - Jika beberapa nilai tampil '-', periksa ID input yang terkait.
   - Untuk ubah rumus: edit fungsi di bagian 2 (Core formulas).
   - Untuk membuat kapasitas total dihitung berbeda, ubah akumulasi totalKapasitasArah di loop per arah.
   - Lebar lajur default di LANE_WIDTH_M (ubah di atas jika ingin 3 -> 2.75 dsb)
   =========================== */
