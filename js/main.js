/**
 * main.js (revisi: memindahkan logika gerak kendaraan ke vehmov.js)
 * - Menambahkan objek laneCoordinates untuk menyimpan posisi (x, y) dari setiap lajur.
 * - Mengubah drawEntryLaneNumbers dan drawExitLaneNumbers agar menyimpan koordinat selain menggambarnya.
 * - Spawn & movement kendaraan didelegasikan ke vehmov.js (createVehMovController).
 * - MEMPERBAIKI URUTAN PENAMAAN LAJUR KELUAR UTARA DAN TIMUR
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
import { updateAntrian } from './antrian.js';

document.addEventListener('DOMContentLoaded', init);

// Objek untuk menyimpan koordinat lajur masuk dan keluar
const laneCoordinates = {
    entry: {},
    exit: {}
};

function init() {
    const canvas = document.getElementById('simCanvas');
    const vehicleCanvas = document.getElementById('vehicleCanvas');
    if (!canvas || !vehicleCanvas) {
        console.error("main.js: simCanvas atau vehicleCanvas tidak ditemukan di DOM.");
        return;
    }
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

    const lampu = new LampuLaluLintas("simCanvas");

    const configTraffic = {
        utara: { flow: 500, truckPct: 20 },
        timur: { flow: 500, truckPct: 20 },
        selatan: { flow: 500, truckPct: 20 },
        barat: { flow: 500, truckPct: 20 },
    };

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
    ['inNorth', 'outNorth', 'inEast', 'outEast', 'inSouth', 'outSouth', 'inWest', 'outWest'].forEach(id => {
        const el = $(id);
        if (el) el.addEventListener('change', updateConfig);
    });

    const radiusSlider = $('customRange');
    const radiusValueDisplay = $('rangeVal');

    // ---------- CACHE / LOCKING MECHANISM ----------
    // Menyimpan snapshot koordinat awal (entry/exit) dan konfigurasi lajur saat itu
    let initialCaptured = false;
    let initialLaneCoordinates = null;
    let initialConfigSnapshot = null;
    // ketika true -> gunakan cached coordinates (jangan hitung ulang)
    let laneCoordinatesLocked = false;
    // nilai default (persis) untuk mengembalikan cache
    const defaultRadius = sliderInitial;

    // helper
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
        // pastikan config radius mengikuti slider awal
        config.radiusValue = parseFloat(radiusSlider.value);
        if (radiusValueDisplay) radiusValueDisplay.textContent = radiusSlider.value;

        radiusSlider.addEventListener("input", function() {
            const newVal = parseFloat(this.value);
            config.radiusValue = newVal;
            if (radiusValueDisplay) radiusValueDisplay.textContent = this.value;

            // jika user kembali ke nilai default (dengan toleransi), dan konfigurasi lajur sama seperti awal -> kunci
            const epsilon = 0.0001;
            const isAtDefault = Math.abs(newVal - defaultRadius) < epsilon;

            if (isAtDefault && initialCaptured && configsEqual(config, initialConfigSnapshot)) {
                laneCoordinatesLocked = true;
                // restore exact cached coords
                if (initialLaneCoordinates) {
                    laneCoordinates.entry = deepClone(initialLaneCoordinates.entry || {});
                    laneCoordinates.exit = deepClone(initialLaneCoordinates.exit || {});
                }
            } else {
                laneCoordinatesLocked = false;
            }

            try { lampu.updatePosition(config); } catch (e) { }
            // menggambar layout — fungsi drawEntry/drawExit memperhatikan `laneCoordinatesLocked`
            drawLayout();

            // inform controller (jika sudah ada)
            if (typeof vehController?.setLaneCoordinates === 'function') {
                vehController.setLaneCoordinates(laneCoordinates);
            }
        });
    }

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
    });
    if (truckSlider) truckSlider.addEventListener("input", () => {
        const arah = directionSelect ? directionSelect.value : 'utara';
        configTraffic[arah].truckPct = parseInt(truckSlider.value);
        if (truckValue) truckValue.textContent = `${truckSlider.value}%`;
    });

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

        laneArrows.utara = Array((config.utara.in || 0)).fill("straight");
        laneArrows.timur = Array((config.timur.in || 0)).fill("straight");
        laneArrows.selatan = Array((config.selatan.in || 0)).fill("straight");
        laneArrows.barat = Array((config.barat.in || 0)).fill("straight");

        updateExitLaneNumbers();
        try { lampu.updatePosition(config); } catch (e) { }
        updateTrafficUI();

        // Jika user mengganti konfigurasi lajur, buang cache awal — agar tidak restore koordinat usang
        if (initialCaptured && !configsEqual(config, initialConfigSnapshot)) {
            initialCaptured = false;
            initialLaneCoordinates = null;
            initialConfigSnapshot = null;
            laneCoordinatesLocked = false;
        }

        drawLayout();

        // inform vehController about updated lane coordinates (if controller supports it)
        if (typeof vehController?.setLaneCoordinates === 'function') {
            vehController.setLaneCoordinates(laneCoordinates);
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
                        drawLayout();
                        if (typeof vehController?.setLaneCoordinates === 'function') vehController.setLaneCoordinates(laneCoordinates);
                    }
                });
            });
        } catch (e) {
            console.error("click handler failed:", e);
        }
    });

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

    /* ---------------------------
        Draw entry lane numbers (BLUE) using getLaneButtonPositions
    --------------------------- */
    function drawEntryLaneNumbers(ctx, config) {
        ctx.fillStyle = "blue";
        ctx.font = "14px Arial";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";

        const OFFSET = -40;

        // ensure entry object exists
        laneCoordinates.entry = laneCoordinates.entry || {};

        // Jika terkunci dan ada cached snapshot, gunakan koordinat cached persis (restore draw)
        if (laneCoordinatesLocked && initialLaneCoordinates && initialLaneCoordinates.entry) {
            // clear then reapply cached
            Object.keys(laneCoordinates.entry).forEach(k => delete laneCoordinates.entry[k]);
            Object.keys(initialLaneCoordinates.entry).forEach(k => {
                const p = initialLaneCoordinates.entry[k];
                ctx.fillText(k.split('_')[1], p.x, p.y);
                laneCoordinates.entry[k] = { x: p.x, y: p.y };
            });
            return;
        }

        // --- CLEAR stale entry keys for each direction BEFORE drawing new ones ---
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

                // SIMPAN KOORDINAT (baru)
                laneCoordinates.entry[`${arah}_${i + 1}`] = { x: finalX, y: finalY };
            });
        });
    }

    /* ---------------------------
        drawExitLaneNumbers LEFT AS IS (RED) but with cache support
    --------------------------- */
    function drawExitLaneNumbers(ctx, config) {
        ctx.fillStyle = "red";
        ctx.font = "14px Arial";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";

        // Jika terkunci dan ada cached snapshot, gunakan koordinat cached persis (restore draw)
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

        // ensure exit object exists
        laneCoordinates.exit = laneCoordinates.exit || {};

        // --- CLEAR stale exit keys for each direction BEFORE drawing new ones ---
        ["utara", "timur", "selatan", "barat"].forEach(arah => {
            Object.keys(laneCoordinates.exit).forEach(k => {
                if (k.startsWith(arah + "_")) delete laneCoordinates.exit[k];
            });
        });

        // UTARA
        {
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

                // SIMPAN KOORDINAT
                laneCoordinates.exit[`utara_${i + 1}`] = { x: finalX, y: finalY };
            }
        }

        // SELATAN
        {
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

                // SIMPAN KOORDINAT
                laneCoordinates.exit[`selatan_${i + 1}`] = { x: finalX, y: finalY };
            }
        }

        // TIMUR
        {
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

                // SIMPAN KOORDINAT
                laneCoordinates.exit[`timur_${i + 1}`] = { x: finalX, y: finalY };
            }
        }

        // BARAT
        {
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

                // SIMPAN KOORDINAT
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

            // Setelah pertama kali layout digambar dan laneCoordinates terisi, capture snapshot awal (sekali saja)
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
                    // Jika slider saat ini sama dengan defaultRadius, lock immediately
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
    updateExitLaneNumbers(); // pastikan exitLaneNumbers terisi sebelum controller dibuat

    const vehController = createVehMovController({
        config,
        laneCoordinates,
        exitLaneNumbers,
        trafficConfig: configTraffic,
        laneArrows, // <-- PENTING: kirim laneArrows agar vehmov bisa baca panah selatan
        canvasSize: { width: canvas.width, height: canvas.height },
        baseSpeed: 0.10
    });

        document.getElementById("resetBtn").addEventListener("click", () => {
    if (vehController && typeof vehController.clearAllVehicles === "function") {
        vehController.clearAllVehicles();
    }
    });

    // Immediately inform controller of computed laneCoordinates (drawLayout will populate laneCoordinates)
    drawLayout();
    if (typeof vehController.setLaneCoordinates === 'function') {
        vehController.setLaneCoordinates(laneCoordinates);
    }

    // schedule initial spawns using controller
    ['utara','timur','selatan','barat'].forEach(arah => {
        vehController.scheduleNextSpawn(arah, performance.now());
    });

    // ---------- animate / loop ----------
    let lastTimestamp = performance.now();
    function animate(timestamp) {
        const deltaTime = timestamp - lastTimestamp;
        lastTimestamp = timestamp;

        try { lampu.tick(deltaTime); } catch (e) { }

        // 1) redraw layout (this updates laneCoordinates) -- draw functions respect laneCoordinatesLocked
        drawLayout();

        // keep controller informed (in case lanes changed interactively)
        if (typeof vehController.setLaneCoordinates === 'function') {
            vehController.setLaneCoordinates(laneCoordinates);
        }

        // clear vehicle canvas
        vctx.clearRect(0, 0, vehicleCanvas.width, vehicleCanvas.height);

        // optional: draw lane centers
        try { drawLaneCenters(vctx, config); } catch (e) { }

        // spawn check via controller (nextSpawnTimes)
        for (const arah of ['utara','timur','selatan','barat']) {
            if (timestamp >= (vehController.nextSpawnTimes[arah] || 0)) {
                vehController.spawnRandomVehicle(arah);
                vehController.scheduleNextSpawn(arah, timestamp);
            }
        }

        // 2) run car-following / antrian logic first (so it can set v.speed / commands)
        try {
            const vehiclesBefore = vehController.getVehicles();
            updateAntrian(vehiclesBefore, laneCoordinates, lampu, deltaTime, config.stopLine);
        } catch (e) {
            console.warn("updateAntrian failed:", e);
        }

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

            // gunakan sudut dari vehmov.js
            if (typeof vehicle.angle === "number") {
                vctx.rotate(vehicle.angle);
            } else {
                if (vehicle.direction === 'timur') vctx.rotate(-Math.PI / 2);
                else if (vehicle.direction === 'barat') vctx.rotate(Math.PI / 2);
                else if (vehicle.direction === 'utara') vctx.rotate(Math.PI);
            }

            drawVehicle(vctx, { x: 0, y: 0, type: vehicle.type });
               // --- Gambar ID kendaraan di atasnya ---
                if (vehicle.id) {
                    vctx.fillStyle = "yellow";       // warna teks
                    vctx.font = "bold 12px Arial";   // jenis font
                    vctx.textAlign = "center";       // rata tengah
                    vctx.textBaseline = "bottom";    // posisi di atas
                    
                    // sesuaikan tinggi label berdasarkan tipe kendaraan
                    let offset = 6;
                    if (vehicle.type === "truk") offset = 10;
                    else if (vehicle.type === "mobil") offset = 8;

                    vctx.fillText(vehicle.id, 0, -vehicle.lengthPx / 2 - 6);
                    // ↑ teks muncul di atas kendaraan (6px di atas sisi atas)
                }
                 vctx.restore();
        });

        // 5) DRAW DEBUG visuals from controller: paths, points, boxes
        if (typeof vehController.drawDebugPaths === 'function') {
            try { vehController.drawDebugPaths(vctx); } catch (e) { console.warn("drawDebugPaths failed:", e); }
        }
        if (typeof vehController.drawDebugPoints === 'function') {
            try { vehController.drawDebugPoints(vctx); } catch (e) { console.warn("drawDebugPoints failed:", e); }
        }
        // PENTING: gambar kotak debug di atas kendaraan
        if (typeof vehController.drawDebugBoxes === 'function') {
            try { vehController.drawDebugBoxes(vctx); } catch (e) { console.warn("drawDebugBoxes failed:", e); }
        }

        requestAnimationFrame(animate);
    }

    // finalize init after images loaded
    Promise.all(loadImagePromises).then(() => {
        try {
            updateConfig(); // will call drawLayout() and set laneCoordinates via setLaneCoordinates if available
            try { lampu.updatePosition(config); } catch (e) { }
            requestAnimationFrame(animate);
        } catch (e) {
            console.error("Initialization error:", e);
        }
    });
} // end init

// Di dalam function animate(timestamp) { ... }
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

    // Gambar kendaraan
    drawVehicle(vctx, { x: 0, y: 0, type: vehicle.type });

    // 🔹 Gambar ID kendaraan di atasnya
    if (vehicle.id) {
        vctx.fillStyle = "yellow";
        vctx.font = "bold 12px Arial";
        vctx.textAlign = "center";
        vctx.fillText(vehicle.id, 0, -20);
    }

    vctx.restore();
});
