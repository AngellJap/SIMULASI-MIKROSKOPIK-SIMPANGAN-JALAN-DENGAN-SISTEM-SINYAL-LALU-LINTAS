/**
 * main.js (revisi: memindahkan logika gerak kendaraan ke vehmov.js)
 * - Menambahkan objek laneCoordinates untuk menyimpan posisi (x, y) dari setiap lajur.
 * - Mengubah drawEntryLaneNumbers dan drawExitLaneNumbers agar menyimpan koordinat selain menggambarnya.
 * - Spawn & movement kendaraan didelegasikan ke vehmov.js (createVehMovController).
 * - MEMPERBAIKI URUTAN PENAMAAN LAJUR KELUAR UTARA DAN TIMUR
 * - Modifikasi: Menambahkan 'Belok Kiri Jalan Terus' (Global Switch)
 */

import { drawUtara } from './InfrastrukturJalan/utara.js';
import { drawTimur } from './InfrastrukturJalan/timur.js';
import { drawSelatan } from './InfrastrukturJalan/selatan.js';
import { drawBarat } from './InfrastrukturJalan/barat.js';
import { drawTurningRadius } from './InfrastrukturJalan/drawTurningRadius.js';
import { drawTengah } from './InfrastrukturJalan/tengah.js';
import { LampuLaluLintas } from './LampuLaluLintas.js';
import { getLaneButtonPositions } from './InfrastrukturJalan/drawArrow.js';
import { drawLaneCenters, drawVehicle } from "./vehicle.js";
import { createVehMovController } from './vehmov.js'; // <-- controller baru
import { updateAntrian, getRealTimeTrafficStats } from './antrian.js';
import createSiklusLampu from './SiklusLampu.js';
import { initSummary, updateSummaryTable } from './Summary.js';
import { SpeedLogger } from "./SpeedLogger.js";
import initPhaseModel from './phaseModel.js';
import { downloadKonfigurasi, uploadKonfigurasi } from './ConfigManager.js';
import { initReportExporter } from './ReportExporter.js';

document.addEventListener('DOMContentLoaded', init);

// 1. Listener Tombol Download
    const btnDownload = document.getElementById('btnExportJson');
    if (btnDownload) {
        btnDownload.addEventListener('click', downloadKonfigurasi);
    }

    // 2. Listener Input Upload
    const inputUpload = document.getElementById('inputImportJson');
    if (inputUpload) {
        inputUpload.addEventListener('change', uploadKonfigurasi);
    }
// === LTOR GLOBAL SWITCH ===
document.getElementById("ltsorGlobalSwitch")
   .addEventListener("change", (e) => {
        const val = e.target.checked;   // true = LTOR, false = NLTOR

         // beritahu SiklusLampu.js
        if (siklus && typeof siklus.setLTOR === 'function') {
            siklus.setLTOR(val);
        }

        // beritahu LampuLaluLintas utama (jika ada)
        if (window.lampu) {
            lampu.ltor = val;
        }

        // redraw diagram
        siklusLampu.draw();
   });

// ===== LISTENER UNTUK PHASE MODEL =====
document.addEventListener("laneArrowsUpdated", (ev) => {
  const updated = ev.detail.laneArrows;
  console.log("PhaseModel → laneArrows updated:", updated);

  // paksa main.js refresh config untuk spawn lane
  if (typeof rebuildSpawnLanes === "function") {
    rebuildSpawnLanes(updated);     // ★ penting: panggil ulang builder spawn
  }

  // update tampilan UI select (in/out tetap locked)
  updateLaneArrowIndicators(updated);
});

// optional: saat model berubah
document.addEventListener("phaseModelChanged", (ev) => {
  console.log("PhaseModel aktif:", ev.detail);
});

// perbarui arrow indikator pada UI (kalau kamu punya panelnya)
function updateLaneArrowIndicators(laneArrows) {
  ["utara","timur","selatan","barat"].forEach(dir => {
    const a1 = document.getElementById(dir + "-lane1-arrow");
    const a2 = document.getElementById(dir + "-lane2-arrow");
    if (a1) a1.textContent = laneArrows[dir][0];
    if (a2) a2.textContent = laneArrows[dir][1];
  });
}

// dipanggil jika arrow berubah, supaya spawning mengikuti fase
function rebuildSpawnLanes(arrows) {
  console.log("Rebuild spawn lane using arrows:", arrows);
  window.laneArrows = arrows;   // overwrite
  // kalau kamu punya fungsi lain, panggil disini:
  if (typeof rebuildLaneInputs === "function") rebuildLaneInputs();
}

// Global references agar bisa diakses fungsi resetSimulation
// SIMULASI TIMER (global)
let lampu = null;
let vehController = null;
let siklus = null;
let lastTimestamp = 0;
let running = false;
let simSpeed = 1;
let phaseMode = "searah"; // default
// --- VARIABEL GLOBAL TAMBAHAN ---
let realTrafficStats = {
  startTime: null,
  counts: {}
};

// ===== SIMULATION TIMER =====
let simTimerStart = null;
let simTimerElapsedMs = 0;

// Format HH:MM:SS
function formatSimTime(ms) {
    const totalSec = Math.floor(ms / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    return (
        String(h).padStart(2, '0') + ":" +
        String(m).padStart(2, '0') + ":" +
        String(s).padStart(2, '0')
    );
}

function resetRealStats() {
  realTrafficStats.startTime = Date.now();
  realTrafficStats.counts = {};
}
// --------------------------------

window.exportSpeedData = () => {
    const out = SpeedLogger.getFinished();
    console.log("HASIL KECEPATAN:", out);
    return out;
};
setInterval(() => {
    console.log("Speed log:", SpeedLogger.getFinished());
}, 5000);

// Objek untuk menyimpan koordinat lajur masuk dan keluar
const laneCoordinates = {
    entry: {},
    exit: {}
};

// ------------------- Struktur data per-lajur -------------------
// laneTrafficConfig[arah] = array of lanes [{ flow, motorPct, mobilPct, trukPct, carPct, truckPct }, ...]
let laneTrafficConfig = {
    utara: [],
    timur: [],
    selatan: [],
    barat: []
};
// ---------------------------------------------------------------------

// Ganti fungsi generateSpeedTables yang error dengan ini:
function generateSpeedTables() {
  try {
    // Gunakan fungsi dari SpeedLogger yang sudah di-import
    if (SpeedLogger && typeof SpeedLogger.renderInto === 'function') {
      SpeedLogger.renderInto("speed-table-container");
    } else {
      console.warn("SpeedLogger not ready");
    }
  } catch (e) {
    console.warn("generateSpeedTables failed:", e);
  }
}

function init() {
    const canvas = document.getElementById('simCanvas');
    const vehicleCanvas = document.getElementById('vehicleCanvas');
    if (!canvas || !vehicleCanvas) {
        console.error("main.js: simCanvas atau vehicleCanvas tidak ditemukan di DOM.");
        return;
    }

// Sinkronisasi: saat lampu direset → reset juga diagram siklus
window.addEventListener("resetCycleCanvas", (e) => {
  console.log("🔁 Reset cycleCanvas triggered:", e.detail);
  if (typeof resetCycleDiagram === "function") {
    resetCycleDiagram(); // fungsi ini ada di modul siklus animasi (cycleCanvas)
  }
});

    const cycleCanvas = document.getElementById('cycleCanvas');
    let siklusLocal = null;

 if (cycleCanvas) {
      const durAllRedEl = document.getElementById('durAllRed');
      const durYellowEl = document.getElementById('durYellow');
      const durCycleTotalEl = document.getElementById('durCycleTotal');
      const durAllRed = durAllRedEl ? parseFloat(durAllRedEl.value) || 0 : 0;
      const durYellow = durYellowEl ? parseFloat(durYellowEl.value) || 0 : 0;
      const durCycleTotal = durCycleTotalEl ? parseFloat(durCycleTotalEl.value) || 60 : 60;

      siklusLocal = createSiklusLampu({
        canvas: cycleCanvas,
        cycleTotalSec: durCycleTotal,
        allRedSec: durAllRed,
        yellowSec: durYellow
      });

['durAllRed', 'durYellow', 'durCycleTotal'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('change', () => {
          const red = document.getElementById('durAllRed') ? parseFloat(document.getElementById('durAllRed').value) || 0 : 0;
          const yellow = document.getElementById('durYellow') ? parseFloat(document.getElementById('durYellow').value) || 0 : 0;
          const total = document.getElementById('durCycleTotal') ? parseFloat(document.getElementById('durCycleTotal').value) || 60 : 60;
          if (siklusLocal && typeof siklusLocal.setParams === 'function') siklusLocal.setParams(total, red, yellow);
        });
      });
    }
    siklus = siklusLocal;

    const ctx = canvas.getContext('2d');
    const vctx = vehicleCanvas.getContext('2d');

    // Pastikan layer kendaraan sama ukuran dengan layout canvas
    vehicleCanvas.width = canvas.width;
    vehicleCanvas.height = canvas.height;

    const $ = id => document.getElementById(id) || null;

    // Ambil nilai default radius dari slider (jika ada) sehingga cache dapat dikembalikan ke nilai persis awal
    const radiusSliderEl = $('customRange');
    const parsedSliderDefault = radiusSliderEl ? parseFloat(radiusSliderEl.value) : NaN;
    const sliderInitial = Number.isFinite(parsedSliderDefault) ? parsedSliderDefault : 3.28;

    const config = {
        utara: { in: 2, out: 2 },
        timur: { in: 2, out: 2 },
        selatan: { in: 2, out: 2 },
        barat: { in: 2, out: 2 },
        skala_px: 10,
        radiusValue: sliderInitial
    };

    // koordinat pusat canvas (dipakai vehmov untuk control point kalau perlu)
    config.cx = canvas.width / 2;
    config.cy = canvas.height / 2;

    lampu = new LampuLaluLintas("simCanvas");
    // pastikan siklus diagram menggunakan lampu utama sebagai sumber kebenaran
    try {
      if (typeof siklusLocal !== 'undefined' && siklusLocal && typeof siklusLocal.syncWithLampu === 'function') {
        siklusLocal.syncWithLampu(lampu);
      }
    } catch(e) { console.warn('syncWithLampu failed', e); }

    const configTraffic = {
        utara: { flow: 500, truckPct: 20 },
        timur: { flow: 500, truckPct: 20 },
        selatan: { flow: 500, truckPct: 20 },
        barat: { flow: 500, truckPct: 20 },
    };

// === TAMBAHAN MODEL 3 FASE ===
// Inisialisasi default mode fase searah
try {
  siklus.setPhaseMode("searah");
  lampu.setPhaseMode("searah", false);
  setActivePhaseButton("searah");
} catch (e) { console.warn("Init phaseMode gagal:", e); }

// Fungsi bantu: menandai tombol aktif di UI
function setActivePhaseButton(mode) {
  const map = {
    searah: document.getElementById("fase-searah"),
    berhadapan: document.getElementById("fase-berhadapan"),
    berseberangan: document.getElementById("fase-berseberangan"),
  };
  Object.values(map).forEach(el => { if (el) el.classList.remove("active"); });
  const activeEl = map[mode];
  if (activeEl) activeEl.classList.add("active");
}

// Event listener untuk tombol 3 model fase
[
  ["fase-searah", "searah"],
  ["fase-berhadapan", "berhadapan"],
  ["fase-berseberangan", "berseberangan"],
].forEach(([id, mode]) => {
  const btn = document.getElementById(id);
  if (btn) {
    btn.addEventListener("click", () => {
      console.log(`[UI] Ganti mode fase -> ${mode}`);
      try {
        phaseMode = mode;
        lampu.setPhaseMode(mode, true); // langsung potong fase aktif
        siklus.setPhaseMode(mode);
        setActivePhaseButton(mode);

        // Hitung durasi hijau otomatis
        const allRed = Number(document.getElementById("durAllRed").value);
        const yellow = Number(document.getElementById("durYellow").value);
        const total = Number(document.getElementById("durCycleTotal").value);
        let green;
        if (mode === "searah") green = (total / 4) - allRed - yellow;
        else green = (total / 2) - allRed - yellow;
        if (green <= 0) {
          alert("Durasi fase terlalu singkat — nilai hijau diatur minimum 1 detik.");
          green = 1;
        }
        document.getElementById("displayGreenCalc").textContent =
          `Hijau (${mode}): ${green.toFixed(1)} detik`;
      } catch (e) {
        console.warn("Gagal mengubah mode fase:", e);
      }
    });
  }
});
// === TAMBAHAN MODEL 3 FASE SELESAI ===

// === INISIALISASI MODEL FASE 1-7 ===
try {
    initPhaseModel({
        config,
        laneArrows,
        lampu,
        siklus,
        updateConfig,
        drawLayout
    });
} catch(e) {
    console.warn("initPhaseModel gagal:", e);
}

    const MAX_FLOW_PER_LANE = 600;
    function getMaxFlow(arah) { return (config[arah] && config[arah].in) * MAX_FLOW_PER_LANE; }

    const arrowTypes = ["left", "straight", "right", "left_straight", "straight_right", "left_right", "left_straight_right"];
    const arrowImages = {};
    const loadImagePromises = arrowTypes.map(type => new Promise(resolve => {
        const img = new Image();
        img.onload = () => { arrowImages[type] = img; resolve({ type, ok: true }); };
        img.onerror = () => { console.warn(`arrow image failed: ${type}`); resolve({ type, ok: false }); };
        img.src = `js/arrowIcons/${type}.png`;
    }));

    let laneArrows = { utara: [], timur: [], selatan: [], barat: [] };
    let exitLaneNumbers = { utara: [], timur: [], selatan: [], barat: [] };
    function updateExitLaneNumbers() {
        ["utara", "timur", "selatan", "barat"].forEach(arah => {
            const totalOut = (config[arah] && config[arah].out) ? config[arah].out : 0;
            exitLaneNumbers[arah] = [];
            for (let i = 0; i < totalOut; i++) exitLaneNumbers[arah].push(i + 1);
        });
    }

    function populateDropdown(id) {
        const select = $(id);
        if (!select) return;
        select.innerHTML = '';
        for (let i = 1; i <= 5; i++) {
            const opt = document.createElement('option');
            opt.value = i; opt.textContent = i;
            select.appendChild(opt);
        }
        select.value = 2;
    }
    ['inNorth', 'outNorth', 'inEast', 'outEast', 'inSouth', 'outSouth', 'inWest', 'outWest'].forEach(populateDropdown);
    
    // event listener untuk switch & dropdown
    [
      'inNorth', 'outNorth', 'inEast', 'outEast', 'inSouth', 'outSouth', 'inWest', 'outWest',
      'ltsorGlobalSwitch'
    ].forEach(id => {
        const el = $(id);
        if (el) el.addEventListener('change', updateConfig);
    });

    // ==================== MERGING SWITCH HANDLER ====================
// Sinkronkan nilai toggle Merging (Yes/No) ke config.merging global
const mergingEl = document.getElementById("mergingSwitch");
if (mergingEl) {
  // nilai awal (default Yes bila checked)
  config.merging = mergingEl.checked ?? true;

  console.log(`[init] merging = ${config.merging ? "Yes" : "No"}`);

  mergingEl.addEventListener("change", () => {
    config.merging = mergingEl.checked;
    if (config.merging) {
      console.log("[UI] Merging = Yes → kendaraan boleh bertemu di jalur keluar yang sama");
    } else {
      console.log("[UI] Merging = No → kendaraan dari arah berbeda ditahan di belakang stop line");
    }
  });
}

// Pastikan LTOR global juga tersinkron (jika ada di UI)
const ltorEl = document.getElementById("ltorGlobalSwitch");
if (ltorEl) {
  config.ltorGlobal = ltorEl.checked ?? true;
  ltorEl.addEventListener("change", () => {
    config.ltorGlobal = ltorEl.checked;
    console.log(`[UI] LTOR Global = ${config.ltorGlobal ? "Aktif" : "Nonaktif"}`);
  });
}

    const radiusSlider = $('customRange');
    const radiusValueDisplay = $('rangeVal');

   // ---------- CACHE / LOCKING MECHANISM ----------
    let initialCaptured = false;
    let initialLaneCoordinates = null;
    let initialConfigSnapshot = null;
    let laneCoordinatesLocked = false;
    const defaultRadius = sliderInitial;
    function deepClone(obj) { return JSON.parse(JSON.stringify(obj)); }
    function configsEqual(a, b) {
        if (!a || !b) return false;
        const dirs = ["utara", "timur", "selatan", "barat"];
        for (const d of dirs) {
            if ((a[d]?.in || 0) !== (b[d]?.in || 0)) return false;
            if ((a[d]?.out || 0) !== (b[d]?.out || 0)) return false;
        }
        return true;
    }
    if (radiusSlider) {
        config.radiusValue = parseFloat(radiusSlider.value);
        if (radiusValueDisplay) radiusValueDisplay.textContent = radiusSlider.value;
        radiusSlider.addEventListener("input", function() {
            const newVal = parseFloat(this.value);
            config.radiusValue = newVal;
            if (radiusValueDisplay) radiusValueDisplay.textContent = this.value;
            const epsilon = 0.0001;
            const isAtDefault = Math.abs(newVal - defaultRadius) < epsilon;
            if (isAtDefault && initialCaptured && configsEqual(config, initialConfigSnapshot)) {
                laneCoordinatesLocked = true;
                if (initialLaneCoordinates) {
                    laneCoordinates.entry = deepClone(initialLaneCoordinates.entry || {});
                    laneCoordinates.exit = deepClone(initialLaneCoordinates.exit || {});
                }
            } else {
                laneCoordinatesLocked = false;
            }
            try { lampu.updatePosition(config); } catch (e) { }
            drawLayout();
            if (typeof vehController?.setLaneCoordinates === 'function') {
                vehController.setLaneCoordinates(laneCoordinates);
            }
        });
    }
    // (Akhir kode cache)

      const directionSelect = $('directionSelect');
    const flowSlider = $('trafficFlowSlider');
    const flowValue = $('flowValue');
    const truckSlider = $('truckPercentageSlider');
    const truckValue = $('truckPercentageValue');

    function updateTrafficUI() {
        const arah = directionSelect ? directionSelect.value : 'utara';
        const maxFlow = getMaxFlow(arah);
        if (flowSlider) {
            flowSlider.max = maxFlow;
            configTraffic[arah].flow = Math.min(configTraffic[arah].flow, maxFlow);
            flowSlider.value = configTraffic[arah].flow;
            if (flowValue) flowValue.textContent = `${flowSlider.value} smp/jam (maks: ${maxFlow})`;
        }
        if (truckSlider && truckValue) {
            truckSlider.value = configTraffic[arah].truckPct;
            truckValue.textContent = `${truckSlider.value}%`;
        }
    }
    updateTrafficUI();

    if (directionSelect) directionSelect.addEventListener("change", updateTrafficUI);
    if (flowSlider) flowSlider.addEventListener("input", () => {
        const arah = directionSelect ? directionSelect.value : 'utara';
        configTraffic[arah].flow = parseInt(flowSlider.value);
        if (flowValue) flowValue.textContent = `${flowSlider.value} smp/jam (maks: ${flowSlider.max})`;
        distributeDirectionFlowToLanes(arah);
    });
    if (truckSlider) truckSlider.addEventListener("input", () => {
        const arah = directionSelect ? directionSelect.value : 'utara';
        configTraffic[arah].truckPct = parseInt(truckSlider.value);
        if (truckValue) flowValue.textContent = `${truckSlider.value}%`;
        distributeDirectionTruckPctToLanes(arah);
    });

     // ------------------- FUNGSI BARU: manage laneTrafficConfig -------------------

    function buildDefaultLaneTrafficConfig() {
        ["utara","timur","selatan","barat"].forEach(arah => {
            const lanes = config[arah]?.in || 0;
            const totalFlow = configTraffic[arah]?.flow ?? 500;
            const truckPct = configTraffic[arah]?.truckPct ?? 20;
            laneTrafficConfig[arah] = [];
            const base = Math.floor(totalFlow / Math.max(1, lanes));
            for (let i = 0; i < lanes; i++) {
                const mobilVal = Math.round((100 - truckPct) / 2);
                const laneObj = {
                    flow: base,
                    motorPct: Math.round(mobilVal),
                    mobilPct: Math.round(mobilVal),
                    trukPct: truckPct
                };
                // aliases for compatibility with different naming in vehmov
                laneObj.carPct = laneObj.mobilPct;
                laneObj.truckPct = laneObj.trukPct;
                laneTrafficConfig[arah].push(laneObj);
            }
            let remainder = totalFlow - base * lanes;
            let idx = 0;
            while (remainder > 0 && lanes > 0) {
                laneTrafficConfig[arah][idx % lanes].flow += 1;
                remainder--; idx++;
            }
        });
    }

    function rebuildLaneTrafficConfig() {
        ["utara","timur","selatan","barat"].forEach(arah => {
            const lanes = Math.max(0, (config[arah] && config[arah].in) ? config[arah].in : 0);
            if (!Array.isArray(laneTrafficConfig[arah])) laneTrafficConfig[arah] = [];
            while (laneTrafficConfig[arah].length < lanes) {
                const obj = { flow: 0, motorPct: 40, mobilPct: 40, trukPct: 20 };
                obj.carPct = obj.mobilPct; obj.truckPct = obj.trukPct;
                laneTrafficConfig[arah].push(obj);
            }
            while (laneTrafficConfig[arah].length > lanes) laneTrafficConfig[arah].pop();
        });
    }

    function distributeDirectionFlowToLanes(arah) {
        const lanes = config[arah]?.in || 0;
        if (lanes <= 0) return;
        const total = configTraffic[arah]?.flow ?? 0;
        const base = Math.floor(total / lanes);
        for (let i = 0; i < lanes; i++) {
            if (!laneTrafficConfig[arah][i]) laneTrafficConfig[arah][i] = { flow: 0, motorPct: 40, mobilPct: 40, trukPct: 20 };
            laneTrafficConfig[arah][i].flow = base;
        }
        let rem = total - base * lanes;
        let j = 0;
        while (rem > 0) { laneTrafficConfig[arah][j % lanes].flow += 1; rem--; j++; }
        const truck = configTraffic[arah]?.truckPct ?? 20;
        for (let i = 0; i < lanes; i++) {
            const tr = laneTrafficConfig[arah][i].trukPct ?? truck;
            laneTrafficConfig[arah][i].trukPct = tr;
            const remainPct = Math.max(0, 100 - tr);
            laneTrafficConfig[arah][i].motorPct = Math.round(remainPct/2);
            laneTrafficConfig[arah][i].mobilPct = remainPct - laneTrafficConfig[arah][i].motorPct;
            // aliases:
            laneTrafficConfig[arah][i].carPct = laneTrafficConfig[arah][i].mobilPct;
            laneTrafficConfig[arah][i].truckPct = laneTrafficConfig[arah][i].trukPct;
        }
        if (typeof vehController?.setLaneTrafficConfig === 'function') {
            try { vehController.setLaneTrafficConfig(laneTrafficConfig); } catch (e) { console.warn("setLaneTrafficConfig failed:", e); }
        }
    }

    function distributeDirectionTruckPctToLanes(arah) {
        const lanes = config[arah]?.in || 0;
        const truck = configTraffic[arah]?.truckPct ?? 20;
        for (let i = 0; i < lanes; i++) {
            if (!laneTrafficConfig[arah][i]) laneTrafficConfig[arah][i] = { flow: 0, motorPct: 40, mobilPct: 40, trukPct: truck };
            laneTrafficConfig[arah][i].trukPct = truck;
            const remainPct = Math.max(0, 100 - truck);
            laneTrafficConfig[arah][i].motorPct = Math.round(remainPct/2);
            laneTrafficConfig[arah][i].mobilPct = remainPct - laneTrafficConfig[arah][i].motorPct;
            // aliases
            laneTrafficConfig[arah][i].carPct = laneTrafficConfig[arah][i].mobilPct;
            laneTrafficConfig[arah][i].truckPct = laneTrafficConfig[arah][i].trukPct;
        }
        if (typeof vehController?.setLaneTrafficConfig === 'function') {
            try { vehController.setLaneTrafficConfig(laneTrafficConfig); } catch (e) { console.warn("setLaneTrafficConfig failed:", e); }
        }
    }

    // ------------------- Normalisasi pembantu -------------------
    // Mengembalikan 3 integer yang jumlahnya 100 (jika semua 0 -> default [33,33,34])
    function normalizeThree(a,b,c){
        const raw = [Number(a)||0, Number(b)||0, Number(c)||0];
        const sum = raw[0]+raw[1]+raw[2];
        if(sum === 0) return [33,33,34];
        const floats = raw.map(v => (v / sum) * 100);
        const floors = floats.map(f => Math.floor(f));
        let rem = 100 - (floors[0] + floors[1] + floors[2]);
        const fracs = floats.map((f,i)=>({i, frac: f - floors[i]}));
        fracs.sort((x,y)=> y.frac - x.frac);
        const result = floors.slice();
        for(let k=0;k<rem;k++){
          result[fracs[k].i] += 1;
        }
        return result;
    }

    // ------------------- BACA PER-LAJUR DARI DOM (ROBUST) -------------------
    // - Mencari pola id (backwards compatibility)
    // - Jika tidak ada id, fallback ke DOM dinamis '#laneInputsContainer' dengan .lane-row
    function readLaneTrafficInputs() {
        console.debug('[main] readLaneTrafficInputs called');
        rebuildLaneTrafficConfig();

        // helper untuk mencari elemen id pola (kembali kompatibel)
        const findElByPatterns = (patterns) => {
            for (const id of patterns) {
                const el = document.getElementById(id);
                if (el) return el;
            }
            return null;
        };

        const directions = ['utara','timur','selatan','barat'];
        const directionSelectEl = document.getElementById('directionSelect');
        const currentDirShown = directionSelectEl ? directionSelectEl.value : null;
        const laneInputsContainer = document.getElementById('laneInputsContainer');

        directions.forEach(arah => {
            const lanes = config[arah]?.in || 0;
            // ensure array exists
            if (!Array.isArray(laneTrafficConfig[arah])) laneTrafficConfig[arah] = [];
            for (let idx = 0; idx < lanes; idx++) {
                const laneIndex1 = idx + 1;
                // default fallback values
                let flow = laneTrafficConfig[arah][idx]?.flow || 0;
                let motor = laneTrafficConfig[arah][idx]?.motorPct ?? 50;
                let mobil = laneTrafficConfig[arah][idx]?.mobilPct ?? 30;
                let truk = laneTrafficConfig[arah][idx]?.trukPct ?? 20;

                try {
                    // 1) Coba pola ID umum (backwards compatible)
                    const synonyms = { utara:['utara','north'], timur:['timur','east'], selatan:['selatan','south'], barat:['barat','west'] }[arah];
                    const possibleFlowIds = [
                        `${arah}_lane${laneIndex1}_flow`, `${arah}_lane_${laneIndex1}_flow`, `${synonyms[0]}_lane${laneIndex1}_flow`,
                        `${synonyms[1]}_lane${laneIndex1}_flow`, `${arah}_lane${laneIndex1}Flow`, `${synonyms[0]}_lane${laneIndex1}_flow`
                    ];
                    const possibleMotorIds = [
                        `${arah}_lane${laneIndex1}_motor`, `${arah}_lane${laneIndex1}_motorPct`, `${arah}_lane${laneIndex1}_motor_pct`,
                        `${synonyms[0]}_lane${laneIndex1}_motor`
                    ];
                    const possibleMobilIds = [
                        `${arah}_lane${laneIndex1}_mobil`, `${arah}_lane${laneIndex1}_carPct`, `${arah}_lane${laneIndex1}_mobilPct`,
                        `${synonyms[0]}_lane${laneIndex1}_mobil`
                    ];
                    const possibleTrukIds = [
                        `${arah}_lane${laneIndex1}_truk`, `${arah}_lane${laneIndex1}_truckPct`, `${arah}_lane${laneIndex1}_trukPct`,
                        `${synonyms[0]}_lane${laneIndex1}_truk`
                    ];

                    const elFlow = findElByPatterns(possibleFlowIds);
                    const elMotor = findElByPatterns(possibleMotorIds);
                    const elMobil = findElByPatterns(possibleMobilIds);
                    const elTruk = findElByPatterns(possibleTrukIds);

                    if (elFlow) {
                        const v = parseFloat(elFlow.value);
                        if (!Number.isNaN(v)) flow = Math.max(0, Math.round(v));
                    }
                    if (elMotor) {
                        const v = parseFloat(elMotor.value);
                        if (!Number.isNaN(v)) motor = v;
                    }
                    if (elMobil) {
                        const v = parseFloat(elMobil.value);
                        if (!Number.isNaN(v)) mobil = v;
                    }
                    if (elTruk) {
                        const v = parseFloat(elTruk.value);
                        if (!Number.isNaN(v)) truk = v;
                    }

                    // 2) Jika elemen-per-lajur tidak ada sebagai id, coba baca dari laneInputsContainer
                    //    BUT: laneInputsContainer umumnya hanya berisi lajur untuk arah yang dipilih (currentDirShown)
                    if ((!elFlow && !elMotor && !elMobil && !elTruk) && laneInputsContainer && currentDirShown === arah) {
                        // ambil semua .lane-row di container — urutannya sesuai lajur 1..N
                        const rows = Array.from(laneInputsContainer.querySelectorAll('.lane-row'));
                        if (rows[idx]) {
                            const row = rows[idx];
                            // flow: number input yang bukan .ratio-input (prioritas dataset.field==='flow' kalau ada)
                            const flowByDataset = row.querySelector('input[data-field="flow"]');
                            const flowCandidate = flowByDataset || row.querySelector('input[type="number"]:not(.ratio-input)');
                            if (flowCandidate) {
                                const v = parseFloat(flowCandidate.value);
                                if (!Number.isNaN(v)) flow = Math.max(0, Math.round(v));
                            }
                            // ratio inputs: class .ratio-input OR inputs with dataset fields motorPct/carPct/truckPct
                            let motorByDataset = row.querySelector('input[data-field="motorPct"].ratio-input') || row.querySelector('input[data-field="motorPct"]');
                            let mobilByDataset = row.querySelector('input[data-field="carPct"].ratio-input') || row.querySelector('input[data-field="carPct"]');
                            let trukByDataset  = row.querySelector('input[data-field="truckPct"].ratio-input') || row.querySelector('input[data-field="truckPct"]');

                            // fallback: find first three .ratio-input in row
                            const ratioInputs = row.querySelectorAll('input.ratio-input');
                            if (!motorByDataset && ratioInputs.length >= 1) motorByDataset = ratioInputs[0];
                            if (!mobilByDataset && ratioInputs.length >= 2) mobilByDataset = ratioInputs[1];
                            if (!trukByDataset && ratioInputs.length >= 3) trukByDataset = ratioInputs[2];

                            if (motorByDataset) {
                                const v = parseFloat(motorByDataset.value);
                                if (!Number.isNaN(v)) motor = v;
                            }
                            if (mobilByDataset) {
                                const v = parseFloat(mobilByDataset.value);
                                if (!Number.isNaN(v)) mobil = v;
                            }
                            if (trukByDataset) {
                                const v = parseFloat(trukByDataset.value);
                                if (!Number.isNaN(v)) truk = v;
                            }
                        }
                    }

                    // 3) Jika tidak ada input sama sekali untuk rasio: gunakan fallback global truck slider atau configTraffic
                    if (!elMotor && !elMobil && !elTruk) {
                        const globalTruckSlider = document.getElementById('truckPercentageSlider') || document.getElementById('truckSlider') || null;
                        if (globalTruckSlider) {
                            const tp = parseFloat(globalTruckSlider.value) || configTraffic[arah]?.truckPct || 20;
                            truk = tp;
                            const remain = Math.max(0, 100 - truk);
                            motor = Math.round(remain / 2);
                            mobil = remain - motor;
                        } else {
                            const tp = configTraffic[arah]?.truckPct ?? 20;
                            truk = tp;
                            const remain = Math.max(0, 100 - tp);
                            motor = Math.round(remain / 2);
                            mobil = remain - motor;
                        }
                    }

                    // 4) Normalisasi bobot agar total = 100 (menggunakan normalizeThree)
                    const [nm, nc, nt] = normalizeThree(motor, mobil, truk);
                    // Set kembali ke laneTrafficConfig dengan pembulatan & safety clamp
                    const laneObj = {
                        flow: Math.max(0, Math.round(Number(flow || 0))),
                        motorPct: Math.max(0, Math.round(Number(nm || 0))),
                        mobilPct: Math.max(0, Math.round(Number(nc || 0))),
                        trukPct: Math.max(0, Math.round(Number(nt || 0)))
                    };
                    // compatibility aliases:
                    laneObj.carPct = laneObj.mobilPct;
                    laneObj.truckPct = laneObj.trukPct;

                    laneTrafficConfig[arah][idx] = laneObj;

                    console.debug(`[main] lane ${arah} #${idx+1} => flow=${laneObj.flow}, motor=${laneObj.motorPct}, mobil=${laneObj.mobilPct}, truk=${laneObj.trukPct}`);
                } catch (err) {
                    console.warn(`[main] readLaneTrafficInputs: failed to parse lane ${arah} #${idx+1}`, err);
                }
            }
        });

        // Notify vehController (kirim salinan yang berisi alias agar vehmov tak tergantung satu nama properti)
        try {
            // deep clone to avoid accidental mutation by vehController
            const payload = JSON.parse(JSON.stringify(laneTrafficConfig));
            // ensure aliases on payload as well
            Object.keys(payload).forEach(arah => {
                (payload[arah] || []).forEach(lane => {
                    if (lane.mobilPct !== undefined && lane.carPct === undefined) lane.carPct = lane.mobilPct;
                    if (lane.trukPct !== undefined && lane.truckPct === undefined) lane.truckPct = lane.trukPct;
                });
            });
            if (typeof vehController?.setLaneTrafficConfig === 'function') {
                vehController.setLaneTrafficConfig(payload);
                console.log('[main] sent laneTrafficConfig -> vehController', payload);
            } else {
                // still store locally (already done above)
                console.debug('[main] vehController.setLaneTrafficConfig not available yet; laneTrafficConfig updated locally.');
            }
        } catch (e) {
            console.warn("vehController.setLaneTrafficConfig failed:", e);
        }
    }

    // Attach listeners: memonitor input yang relevan (baik id lama maupun input dinamis)
    function attachPerLaneInputListeners() {
        // 1) Add generic change listeners to all inputs/selects that likely affect traffic config
        const all = Array.from(document.querySelectorAll('input, select'));
        all.forEach(el => {
            const id = el.id || '';
            if (/(utara|timur|selatan|barat|north|east|south|west|lane|flow|motor|mobil|truk|truck|Pct|pct|percentage|ratio|bobot)/i.test(id) || el.classList.contains('ratio-input') || (el.closest && el.closest('.lane-row'))) {
                el.addEventListener('change', () => {
                    // read only the currently visible direction rows (and update laneTrafficConfig)
                    readLaneTrafficInputs();
                });
                // also on input for immediate feedback
                el.addEventListener('input', () => readLaneTrafficInputs());
            }
        });

        // 2) Observe dynamic insertion/removal inside #laneInputsContainer (rendered by index.html)
        const container = document.getElementById('laneInputsContainer');
        if (container && typeof MutationObserver !== 'undefined') {
            const mo = new MutationObserver((mutations) => {
                // attach listeners to newly added inputs inside rows
                mutations.forEach(m => {
                    m.addedNodes.forEach(node => {
                        if (!(node instanceof HTMLElement)) return;
                        const inputs = Array.from(node.querySelectorAll ? node.querySelectorAll('input, select') : []);
                        inputs.forEach(inp => {
                            if (!inp._laneListenerAttached) {
                                inp.addEventListener('change', readLaneTrafficInputs);
                                inp.addEventListener('input', readLaneTrafficInputs);
                                inp._laneListenerAttached = true;
                            }
                        });
                    });
                });
            });
            mo.observe(container, { childList: true, subtree: true });
        }
    }

    // ------------------- END FUNGSI BARU -------------------

    function updateConfig() {
        const inNorth = $('inNorth'), outNorth = $('outNorth'),
            inEast = $('inEast'), outEast = $('outEast'),
            inSouth = $('inSouth'), outSouth = $('outSouth'),
            inWest = $('inWest'), outWest = $('outWest');

        if (inNorth) config.utara.in = parseInt(inNorth.value);
        if (outNorth) config.utara.out = parseInt(outNorth.value);
        if (inEast) config.timur.in = parseInt(inEast.value);
        if (outEast) config.timur.out = parseInt(outEast.value);
        if (inSouth) config.selatan.in = parseInt(inSouth.value);
        if (outSouth) config.selatan.out = parseInt(outSouth.value);
        if (inWest) config.barat.in = parseInt(inWest.value);
        if (outWest) config.barat.out = parseInt(outWest.value);

       // --- Membaca status switch ---
        config.ltsorGlobal = $('ltsorGlobalSwitch')?.checked ?? false;
        config.merging = $('mergingSwitch')?.checked ?? true;

        laneArrows.utara = Array((config.utara.in || 0)).fill("straight");
        laneArrows.timur = Array((config.timur.in || 0)).fill("straight");
        laneArrows.selatan = Array((config.selatan.in || 0)).fill("straight");
        laneArrows.barat = Array((config.barat.in || 0)).fill("straight");

        updateExitLaneNumbers();
        try { lampu.updatePosition(config); } catch (e) { }
        updateTrafficUI();

        // Jika user mengganti konfigurasi lajur, buang cache awal
        if (initialCaptured && !configsEqual(config, initialConfigSnapshot)) {
            initialCaptured = false;
            initialLaneCoordinates = null;
            initialConfigSnapshot = null;
            laneCoordinatesLocked = false;
        }

        // (BARU) rekonstruksi laneTrafficConfig & baca ulang per-lajur
        rebuildLaneTrafficConfig();
        readLaneTrafficInputs();

        // [MODIFIKASI] Beritahu siklus diagram tentang panah baru (dari reset default)
        if (siklus && typeof siklus.setLaneArrows === 'function') {
            siklus.setLaneArrows(laneArrows);
        }

        drawLayout();

        // inform vehController about updated lane coordinates & traffic
        if (typeof vehController?.setLaneCoordinates === 'function') {
            vehController.setLaneCoordinates(laneCoordinates);
        }
        if (typeof vehController?.setLaneTrafficConfig === 'function') {
            try { vehController.setLaneTrafficConfig(laneTrafficConfig); } catch (e) { console.warn("vehController.setLaneTrafficConfig failed:", e); }
        }
    }

    canvas.addEventListener('click', function(event) {
                try {
                    const rect = canvas.getBoundingClientRect();
                    const x = event.clientX - rect.left;
                    const y = event.clientY - rect.top;
                    ["utara", "timur", "selatan", "barat"].forEach(arah => {
                        const positions = getLaneButtonPositions(ctx, config, arah) || [];
                        const targetSize = 25;
                        positions.forEach((pos, i) => {
                            let finalWidth = targetSize, finalHeight = targetSize;
                            const img = arrowImages[laneArrows[arah] && laneArrows[arah][i]];
                            if (img && img.complete) {
                                const aspectRatio = img.width / img.height || 1;
                                if (arah === "selatan" || arah === "utara") { finalWidth = targetSize; finalHeight = finalWidth / aspectRatio; } else { finalHeight = targetSize; finalWidth = finalHeight * aspectRatio; }
                            }
                            const boxX = pos.x - finalWidth / 2;
                            const boxY = pos.y - finalHeight / 2;
                            if (x >= boxX && x <= boxX + finalWidth && y >= boxY && y <= boxY + finalHeight) {
                                const currentType = laneArrows[arah][i];
                                const currentIndex = arrowTypes.indexOf(currentType);
                                const nextIndex = (currentIndex + 1) % arrowTypes.length;
                                laneArrows[arah][i] = arrowTypes[nextIndex];
                                
                                // [MODIFIKASI] Kirim data panah terbaru ke SiklusLampu
                                if (siklus && typeof siklus.setLaneArrows === 'function') {
                                    siklus.setLaneArrows(laneArrows);
                                }
                                
                                drawLayout();
                                if (typeof vehController?.setLaneCoordinates === 'function') vehController.setLaneCoordinates(laneCoordinates);
                            }
                        });
                    });
                } catch (e) {
                    console.error("click handler failed:", e);
                }
            });

    // ... (Fungsi-fungsi intersect... tidak diubah) ...
    function intersectVerticalLineCircle(x0, cx, cy, r) {
        const dx = x0 - cx;
        const sq = r * r - dx * dx;
        if (sq < 0) return null;
        const s = Math.sqrt(Math.max(0, sq));
        const y1 = cy - s;
        const y2 = cy + s;
        return [y1, y2].sort((a, b) => a - b);
    }
    function intersectHorizontalLineCircle(y0, cx, cy, r) {
        const dy = y0 - cy;
        const sq = r * r - dy * dy;
        if (sq < 0) return null;
        const s = Math.sqrt(Math.max(0, sq));
        const x1 = cx - s;
        const x2 = cx + s;
        return [x1, x2].sort((a, b) => a - b);
    }
    function pickIntersectionWithin(segmentStart, segmentEnd, intersections) {
        if (!intersections || intersections.length === 0) return null;
        const increasing = segmentEnd >= segmentStart;
        if (increasing) {
            const cand = intersections.filter(v => v >= segmentStart - 0.0001 && v <= segmentEnd + 0.0001);
            if (cand.length === 0) return null;
            return Math.min(...cand);
        } else {
            const cand = intersections.filter(v => v <= segmentStart + 0.0001 && v >= segmentEnd - 0.0001);
            if (cand.length === 0) return null;
            return Math.max(...cand);
        }
    }

    /* Draw entry lane numbers (BLUE) - unchanged except storing coords */
        function drawEntryLaneNumbers(ctx, config) {
            ctx.fillStyle = "blue";
            ctx.font = "14px Arial";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            const OFFSET = -40;
            laneCoordinates.entry = laneCoordinates.entry || {};
            if (laneCoordinatesLocked && initialLaneCoordinates && initialLaneCoordinates.entry) {
                Object.keys(laneCoordinates.entry).forEach(k => delete laneCoordinates.entry[k]);
                Object.keys(initialLaneCoordinates.entry).forEach(k => {
                    const p = initialLaneCoordinates.entry[k];
                    ctx.fillText(k.split('_')[1], p.x, p.y);
                    laneCoordinates.entry[k] = { x: p.x, y: p.y };
                });
                return;
            }
            ["utara", "timur", "selatan", "barat"].forEach(arah => {
                Object.keys(laneCoordinates.entry).forEach(k => {
                    if (k.startsWith(arah + "_")) delete laneCoordinates.entry[k];
                });
            });
            ["utara", "timur", "selatan", "barat"].forEach(arah => {
                const positions = getLaneButtonPositions(ctx, config, arah) || [];
                positions.forEach((pos, i) => {
                    let dx = 0, dy = 0;
                    if (arah === 'utara') dy = -OFFSET;
                    else if (arah === 'timur') dx = OFFSET;
                    else if (arah === 'selatan') dy = OFFSET;
                    else if (arah === 'barat') dx = -OFFSET;
                    const finalX = pos.x + dx;
                    const finalY = pos.y + dy;
                    ctx.fillText(i + 1, finalX, finalY);
                    laneCoordinates.entry[`${arah}_${i + 1}`] = { x: finalX, y: finalY };
                });
            });
        }

    /* drawExitLaneNumbers (unchanged logic) */
    function drawExitLaneNumbers(ctx, config) {
        ctx.fillStyle = "red";
        ctx.font = "14px Arial";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        if (laneCoordinatesLocked && initialLaneCoordinates && initialLaneCoordinates.exit) {
            Object.keys(laneCoordinates.exit).forEach(k => delete laneCoordinates.exit[k]);
            Object.keys(initialLaneCoordinates.exit).forEach(k => {
                const p = initialLaneCoordinates.exit[k];
                ctx.fillText(k.split('_')[1], p.x, p.y);
                laneCoordinates.exit[k] = { x: p.x, y: p.y };
            });
            return;
        }
        const skala = config.skala_px * 3;
        const centerX = ctx.canvas.width / 2;
        const centerY = ctx.canvas.height / 2;
        const radiusOffset = config.radiusValue * config.skala_px;
        const U_in_px = (config.utara.in || 0) * skala;
        const U_out_px = (config.utara.out || 0) * skala;
        const T_in_px = (config.timur.in || 0) * skala;
        const T_out_px = (config.timur.out || 0) * skala;
        const S_in_px = (config.selatan.in || 0) * skala;
        const S_out_px = (config.selatan.out || 0) * skala;
        const B_in_px = (config.barat.in || 0) * skala;
        const B_out_px = (config.barat.out || 0) * skala;
        const sq = radiusOffset || 0.0001;
        const c1 = { x: centerX - U_out_px - sq, y: centerY - B_in_px - sq, r: sq };
        const c2 = { x: centerX + U_in_px + sq, y: centerY - T_out_px - sq, r: sq };
        const c3 = { x: centerX + S_out_px + sq, y: centerY + T_in_px + sq, r: sq };
        const c4 = { x: centerX - S_in_px - sq, y: centerY + B_out_px + sq, r: sq };
        const circles = [c1, c2, c3, c4];
        laneCoordinates.exit = laneCoordinates.exit || {};
        ["utara", "timur", "selatan", "barat"].forEach(arah => {
            Object.keys(laneCoordinates.exit).forEach(k => {
                if (k.startsWith(arah + "_")) delete laneCoordinates.exit[k];
            });
        });
        { // UTARA
            const totalKeluar = config.utara.out || 0;
            const startY = 0;
            const endY_Keluar = centerY - (B_in_px) - radiusOffset;
            for (let i = 0; i < totalKeluar; i++) {
                const laneCenterX = centerX - (i + 0.5) * skala;
                let candidateYs = [];
                for (const c of circles) {
                    const inter = intersectVerticalLineCircle(laneCenterX, c.x, c.y, c.r);
                    if (inter) candidateYs.push(...inter);
                }
                const yIntersect = pickIntersectionWithin(startY, endY_Keluar, candidateYs);
                const visibleY = (yIntersect !== null) ? yIntersect : endY_Keluar;
                const offsetY = 0;
                const finalX = laneCenterX;
                const finalY = visibleY + offsetY;
                ctx.fillText(i + 1, finalX, finalY);
                laneCoordinates.exit[`utara_${i + 1}`] = { x: finalX, y: finalY };
            }
        }
        { // SELATAN
            const totalKeluar = config.selatan.out || 0;
            const startY_Keluar = centerY + (T_in_px) + radiusOffset;
            const endY = ctx.canvas.height;
            for (let i = 0; i < totalKeluar; i++) {
                const laneCenterX = centerX + (i + 0.5) * skala;
                let candidateYs = [];
                for (const c of circles) {
                    const inter = intersectVerticalLineCircle(laneCenterX, c.x, c.y, c.r);
                    if (inter) candidateYs.push(...inter);
                }
                const yIntersect = pickIntersectionWithin(startY_Keluar, endY, candidateYs);
                const visibleY = (yIntersect !== null) ? yIntersect : startY_Keluar;
                const offsetY = 0;
                const finalX = laneCenterX;
                const finalY = visibleY + offsetY;
                ctx.fillText(i + 1, finalX, finalY);
                laneCoordinates.exit[`selatan_${i + 1}`] = { x: finalX, y: finalY };
            }
        }
        { // TIMUR
            const totalKeluar = config.timur.out || 0;
            const startX_Keluar = centerX + (config.utara.in * skala) + radiusOffset;
            const endX = ctx.canvas.width;
            for (let i = 0; i < totalKeluar; i++) {
                const laneCenterY = centerY - (i + 0.5) * skala;
                let candidateXs = [];
                for (const c of circles) {
                    const inter = intersectHorizontalLineCircle(laneCenterY, c.x, c.y, c.r);
                    if (inter) candidateXs.push(...inter);
                }
                const xIntersect = pickIntersectionWithin(startX_Keluar, endX, candidateXs);
                const visibleX = (xIntersect !== null) ? xIntersect : startX_Keluar;
                const offsetX = 0;
                const finalX = visibleX + offsetX;
                const finalY = laneCenterY;
                ctx.fillText(i + 1, finalX, finalY);
                laneCoordinates.exit[`timur_${i + 1}`] = { x: finalX, y: finalY };
            }
        }
        { // BARAT
            const totalKeluar = config.barat.out || 0;
            const startX = 0;
            const endX_Keluar = centerX - (config.selatan.in * skala) - radiusOffset;
            for (let i = 0; i < totalKeluar; i++) {
                const laneCenterY = centerY + (i + 0.5) * skala;
                let candidateXs = [];
                for (const c of circles) {
                    const inter = intersectHorizontalLineCircle(laneCenterY, c.x, c.y, c.r);
                    if (inter) candidateXs.push(...inter);
                }
                const xIntersect = pickIntersectionWithin(startX, endX_Keluar, candidateXs);
                const visibleX = (xIntersect !== null) ? xIntersect : endX_Keluar;
                const offsetX = 0;
                const finalX = visibleX + offsetX;
                const finalY = laneCenterY;
                ctx.fillText(i + 1, finalX, finalY);
                laneCoordinates.exit[`barat_${i + 1}`] = { x: finalX, y: finalY };
            }
        }
    }

    function drawLayout() {
        try {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            try { lampu.updatePosition(config); } catch (e) { }
            drawUtara(ctx, config);
            drawSelatan(ctx, config);
            drawTimur(ctx, config);
            drawBarat(ctx, config);
            drawTengah(ctx, config);
            if (!isNaN(config.radiusValue)) {
                try { drawTurningRadius(ctx, config, config.radiusValue); } catch (e) { console.warn("drawTurningRadius failed:", e); }
            }

            ["utara", "timur", "selatan", "barat"].forEach(arah => {
                const positions = getLaneButtonPositions(ctx, config, arah) || [];
                const targetSize = 25;
                positions.forEach((pos, i) => {
                    const type = (laneArrows[arah] && laneArrows[arah][i]) || "straight";
                    const img = arrowImages[type];
                    if (img && img.complete) {
                        const aspectRatio = img.width / img.height || 1;
                        let finalWidth, finalHeight;
                        if (arah === "utara" || arah === "selatan") { finalWidth = targetSize; finalHeight = finalWidth / aspectRatio; } else { finalHeight = targetSize; finalWidth = finalHeight * aspectRatio; }
                        ctx.save();
                        if (arah === "utara") { ctx.translate(pos.x, pos.y); ctx.rotate(Math.PI); ctx.translate(-pos.x, -pos.y); }
                        else if (arah === "timur") { ctx.translate(pos.x, pos.y); ctx.rotate(-Math.PI / 2); ctx.translate(-pos.x, -pos.y); }
                        else if (arah === "barat") { ctx.translate(pos.x, pos.y); ctx.rotate(Math.PI / 2); ctx.translate(-pos.x, -pos.y); }
                        ctx.drawImage(img, pos.x - finalWidth / 2, pos.y - finalHeight / 2, finalWidth, finalHeight);
                        ctx.restore();
                    } else {
                        ctx.fillStyle = "#666";
                        ctx.fillRect(pos.x - 6, pos.y - 6, 12, 12);
                    }
                });
            });

            // Draw exit/entry labels and update laneCoordinates
            drawExitLaneNumbers(ctx, config);
            drawEntryLaneNumbers(ctx, config);

            try { lampu.draw(); } catch (e) { }

            if (!initialCaptured) {
                const hasEntries = Object.keys(laneCoordinates.entry || {}).length > 0;
                const hasExits = Object.keys(laneCoordinates.exit || {}).length > 0;
                if (hasEntries || hasExits) {
                    initialLaneCoordinates = deepClone(laneCoordinates);
                    initialConfigSnapshot = {
                        utara: { in: config.utara.in, out: config.utara.out },
                        timur: { in: config.timur.in, out: config.timur.out },
                        selatan: { in: config.selatan.in, out: config.selatan.out },
                        barat: { in: config.barat.in, out: config.barat.out }
                    };
                    initialCaptured = true;
                    const epsilon = 0.0001;
                    if (Math.abs(config.radiusValue - defaultRadius) < epsilon) {
                        laneCoordinatesLocked = true;
                    }
                }
            }
        } catch (e) {
            console.error("drawLayout error:", e);
        }
    }

    // ---------- vehmov controller init (menggantikan spawn & vehicles lama) ----------
    updateExitLaneNumbers();

    // inisialisasi laneTrafficConfig awal (bila belum ada)
    buildDefaultLaneTrafficConfig();
    readLaneTrafficInputs();
    attachPerLaneInputListeners();

    // --- NEW: listen for custom event dispatched by UI and for container input/change
    document.addEventListener('laneInputsUpdated', () => {
        try {
            console.log('[main] laneInputsUpdated event received — re-reading per-lane inputs');
            readLaneTrafficInputs();
        } catch (e) {
            console.warn('[main] readLaneTrafficInputs failed on laneInputsUpdated:', e);
        }
    });
    const laneContainerEl = document.getElementById('laneInputsContainer');
    if (laneContainerEl) {
        laneContainerEl.addEventListener('input', (e) => {
            if (e.target && (e.target.matches('input') || e.target.matches('select'))) {
                readLaneTrafficInputs();
            }
        });
        laneContainerEl.addEventListener('change', (e) => {
            if (e.target && (e.target.matches('input') || e.target.matches('select'))) {
                readLaneTrafficInputs();
            }
        });
    }
    // --- END NEW LISTENERS ---

    vehController = createVehMovController({
            config,
            laneCoordinates,
            exitLaneNumbers,
            trafficConfig: configTraffic,
            laneTrafficConfig: laneTrafficConfig,
            laneArrows,
            canvasSize: { width: canvas.width, height: canvas.height },
            baseSpeed: 0.10
        });

if (typeof vehController?.setLaneTrafficConfig === 'function') {
        try { vehController.setLaneTrafficConfig(laneTrafficConfig); } catch (e) { console.warn("initial setLaneTrafficConfig failed:", e); }
    }

    const resetBtn = document.getElementById("resetBtn");
    if (resetBtn) resetBtn.addEventListener("click", resetSimulation);

    drawLayout();
    if (typeof vehController.setLaneCoordinates === 'function') {
        vehController.setLaneCoordinates(laneCoordinates);
    }

    ['utara','timur','selatan','barat'].forEach(arah => {
        vehController.scheduleNextSpawn(arah, performance.now());
    });

    // ---------- animate / loop ----------
    let lastTimestamp = performance.now();
    function animate(timestamp) {
        const deltaTime = timestamp - lastTimestamp;
        lastTimestamp = timestamp;
        // ================= TIMER UPDATE (HH:MM:SS) =================
if (typeof simTimerStart === 'undefined') {
    // variabel global auto-dibuat
    window.simTimerStart = null;
    window.simTimerElapsedMs = 0;
}

if (simTimerStart === null) {
    simTimerStart = timestamp;   // mulai timer pertama kali
}

simTimerElapsedMs = timestamp - simTimerStart;

// update ke UI
const timerDiv = document.getElementById("sim-timer");
if (timerDiv) timerDiv.textContent = formatSimTime(simTimerElapsedMs);
// =============================================================

        let vehiclesBefore = [];
        if (typeof vehController !== 'undefined' && vehController) {
             vehiclesBefore = vehController.getVehicles();
        }
        
        // tick lampu dulu sehingga siklus membaca state yang paling up-to-date
        try { lampu.tick(deltaTime); } catch (e) { }
        if (siklus) {
          siklus.update(deltaTime);
          siklus.draw();
        }
        drawLayout();
        if (typeof vehController.setLaneCoordinates === 'function') {
            vehController.setLaneCoordinates(laneCoordinates);
        }
        vctx.clearRect(0, 0, vehicleCanvas.width, vehicleCanvas.height);
        try { drawLaneCenters(vctx, config); } catch (e) { }

        for (const arah of ['utara','timur','selatan','barat']) {
            if (timestamp >= (vehController.nextSpawnTimes[arah] || 0)) {
                vehController.spawnRandomVehicle(arah);
                vehController.scheduleNextSpawn(arah, timestamp);
            }
        }

        // 2) run car-following / antrian logic
        try {
            // INI PENTING: 'config' yang berisi status switch diteruskan ke antrian.js
            updateAntrian(vehiclesBefore, laneCoordinates, lampu, deltaTime, config, laneArrows);

        } catch (e) {
            console.warn("updateAntrian failed:", e);
        }

    // 1. Inisialisasi Waktu
if (!realTrafficStats.startTime) realTrafficStats.startTime = Date.now();
        const nowMs = Date.now();
        const elapsedSec = (nowMs - realTrafficStats.startTime) / 1000;
        
        // Data sementara untuk frame ini yang akan dikirim ke Summary
        let currentFlowData = {}; 

        try {
            // 1. AMBIL DATA KENDARAAN TERBARU
            let activeVehicles = [];
                        if (vehController && typeof vehController.getVehicles === 'function') {
                             activeVehicles = vehController.getVehicles();
                        }
            
                        // 2. Ambil referensi Stop Line (titik acuan)
                        // laneCoordinates.entry berisi { "utara_1": {x,y}, "timur_2": {x,y}, ... }
                        const entryCoords = (laneCoordinates && laneCoordinates.entry) ? laneCoordinates.entry : {};
                        
                        // 3. Panggil fungsi hitung di antrian.js
                        const rtStats = getRealTimeTrafficStats(activeVehicles, entryCoords, laneCoordinates); 
            
                        // 4. Akumulasi Hitungan Kendaraan Lewat (SMP)
                        if (rtStats && rtStats.crossingEvents) {
                            rtStats.crossingEvents.forEach(evt => {
                                // Normalisasi Key: "Utara-1"
                                const dirStr = evt.direction.charAt(0).toUpperCase() + evt.direction.slice(1);
                                const key = `${dirStr}-${evt.lane}`; 
                                
                                // Faktor SMP (Motor=0.2, Truk=1.3, Mobil=1.0)
                                let factor = 1.0;
                                const type = (evt.type || "").toLowerCase();
                                if (type.includes("motor")) factor = 0.2; // acuan MKJI
                                else if (type.includes("truk")) factor = 1.3;
            
                                if (!realTrafficStats.counts[key]) realTrafficStats.counts[key] = 0;
                                realTrafficStats.counts[key] += factor;
                            });
                        }
            
                        // 5. Hitung Flow Rate (smp/jam) & Ambil Queue (meter)
                        const elapsedHours = elapsedSec / 3600;
                        
                        ["Utara", "Timur", "Selatan", "Barat"].forEach(dirLabel => {
                            const dirKey = dirLabel.toLowerCase(); 
                            // Cek jumlah lajur aktif
                            const numLanes = (config[dirKey] && config[dirKey].in) ? config[dirKey].in : 1;
            
                            for (let i = 1; i <= numLanes; i++) {
                                const key = `${dirLabel}-${i}`;
                                
                                // a. Flow Rate: Total SMP / Jam Berjalan
                                const totalSmp = realTrafficStats.counts[key] || 0;
                                // Hindari spike di detik-detik awal (min 2 detik)
                                const flowPerHour = elapsedSec > 2 ? (totalSmp / elapsedHours) : 0;
                                
                                // b. Queue: Ambil snapshot langsung dari antrian.js
                                const queueM = (rtStats && rtStats.queues) ? (rtStats.queues[key] || 0) : 0;
                                
                                currentFlowData[key] = { 
                                    flow: flowPerHour, 
                                    queue: queueM 
                                };
                            }
                        });
            
                        // 6. Kirim ke Summary Table
                        if (typeof updateSummaryTable === 'function') {
                            updateSummaryTable(config, currentFlowData);
                        }
            
                    } catch (errCalc) {
                        console.warn("Error calculating real stats:", errCalc);
                    }
            
                    // ====================================================
                    // [D] LANJUT KE UPDATE POSISI KENDARAAN
                    // ====================================================
            
                    // 3) update vehicle positions
                    try {
                        vehController.update(deltaTime);
                    } catch (e) {
                        console.warn("vehController.update failed:", e);
                    }
            
                    // 4) draw vehicles
                    const vehiclesFromCtrl = vehController.getVehicles();
                    vehiclesFromCtrl.forEach(vehicle => {
                        vctx.save();
                        vctx.translate(vehicle.x, vehicle.y);
                        if (typeof vehicle.angle === "number") {
                            vctx.rotate(vehicle.angle);
                        } else {
                            if (vehicle.direction === 'timur') vctx.rotate(-Math.PI / 2);
                            else if (vehicle.direction === 'barat') vctx.rotate(Math.PI / 2);
                            else if (vehicle.direction === 'utara') vctx.rotate(Math.PI);
                        }
                        drawVehicle(vctx, { x: 0, y: 0, type: vehicle.type });
                        if (vehicle.id) {
                            vctx.fillStyle = "yellow";
                            vctx.font = "bold 12px Arial";
                            vctx.textAlign = "center";
                            vctx.textBaseline = "bottom";
                            let offset = 6;
                            if (vehicle.type === "truk") offset = 10;
                            else if (vehicle.type === "mobil") offset = 8;
                            vctx.fillText(vehicle.id, 0, -vehicle.lengthPx / 2 - 6);
                        }
                        vctx.restore();
                    });
            
                    // 5) DRAW DEBUG visuals
                    if (typeof vehController.drawDebugPaths === 'function') {
                        try { vehController.drawDebugPaths(vctx); } catch (e) { console.warn("drawDebugPaths failed:", e); }
                    }
                    if (typeof vehController.drawDebugPoints === 'function') {
                        try { vehController.drawDebugPoints(vctx); } catch (e) { console.warn("drawDebugPoints failed:", e); }
                    }
                    if (typeof vehController.drawDebugBoxes === 'function') {
                        try { vehController.drawDebugBoxes(vctx); } catch (e) { console.warn("drawDebugBoxes failed:", e); }
                    }
            
                    requestAnimationFrame(animate);
                }
            
Promise.all(loadImagePromises).then(() => {
    try {
        updateConfig();

        // Summary UI wajib dibuat dulu sebelum Exporter
        initSummary('summary-root');
        updateSummaryTable(config);

        // Setelah summary sudah ada → baru buat tombol export
        initReportExporter({
            containerId: "summary-root",
            buttonId: "download-excel-btn"
        });

        lampu.updatePosition(config);

        // Jangan lupa jalankan animasi simulasi setelah semua UI siap
        requestAnimationFrame(animate);

    } catch (e) {
        console.error("Initialization error:", e);
    }
});
            } // end init
            
            function resetSimulation() {
// ===== RESET TIMER =====
simTimerStart = null;
simTimerElapsedMs = 0;
const timerDiv = document.getElementById("sim-timer");
if (timerDiv) timerDiv.textContent = "00:00:00";

            resetRealStats();
              console.log("🔄 Reset simulation triggered");
            
              // 1️⃣ Reset kendaraan
              if (vehController && typeof vehController.clearAllVehicles === "function") {
                vehController.clearAllVehicles();
                console.log("🚗 Semua kendaraan dihapus dari simulasi");
              }
            
              // 2️⃣ Reset lampu lalu lintas ke all-red
              if (lampu && typeof lampu.resetAll === "function") {
                lampu.resetAll();
                lampu.draw();
                console.log("🚦 Lampu lalu lintas direset ke all-red");
              }
            
              // 3️⃣ Reset diagram siklus (cycleCanvas)
              if (siklus && typeof siklus.resetCycleDiagram === "function") {
                siklus.resetCycleDiagram();
                console.log("🔁 Diagram siklus di-reset ke fase awal");
              }
            
              // 4️⃣ Setelah 2 detik → aktifkan arah Utara (hijau)
              setTimeout(() => {
                if (lampu && typeof lampu.setCurrentDirection === "function") {
                  lampu.setCurrentDirection("utara");
                  lampu.draw();
                  console.log("🟢 Lampu utara menyala kembali (fase pertama)");
                }
              }, 2000);
            
              console.log("✅ Reset selesai: kendaraan, lampu, dan diagram diulang dari awal.");
            }
            
            setInterval(generateSpeedTables, 1000);
