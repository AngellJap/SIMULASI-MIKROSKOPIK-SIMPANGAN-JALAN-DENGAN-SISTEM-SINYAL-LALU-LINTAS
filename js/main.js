/**
 * File utama untuk mengatur konfigurasi persimpangan dan logika tampilan.
 */
import { drawUtara } from './InfrastrukturJalan/utara.js';
import { drawTimur } from './InfrastrukturJalan/timur.js';
import { drawSelatan } from './InfrastrukturJalan/selatan.js';
import { drawBarat } from './InfrastrukturJalan/barat.js';
import { drawTurningRadius } from './InfrastrukturJalan/drawTurningRadius.js';
import { drawTengah } from './InfrastrukturJalan/tengah.js';

import { LampuLaluLintas } from './LampuLaluLintas.js';

// Dapatkan canvas
const canvas = document.getElementById('simCanvas');
const ctx = canvas.getContext('2d');

// Konfigurasi awal jumlah lajur
const config = {
  utara: { in: 2, out: 2 },
  timur: { in: 2, out: 2 },
  selatan: { in: 2, out: 2 },
  barat: { in: 2, out: 2 },
  skala_px: 10 // 1 lajur = 3 meter * 10 px = 30px
};

// Inisialisasi lampu lalu lintas
const lampu = new LampuLaluLintas("simCanvas");

// === Panah lajur ===
const arrowTypes = [
  "left",
  "straight",
  "right",
  "left_straight",
  "straight_right",
  "left_right",
  "left_straight_right"
];

// Status panah tiap lajur
let laneArrows = {
  utara: [],
  timur: [],
  selatan: [],
  barat: []
};

// Inisialisasi isi dropdown jumlah lajur
function populateDropdown(id) {
  const select = document.getElementById(id);
  for (let i = 1; i <= 5; i++) {
    const opt = document.createElement('option');
    opt.value = i;
    opt.textContent = i;
    select.appendChild(opt);
  }
  select.value = 2; // default
}

// Inisialisasi semua dropdown
['inNorth', 'outNorth', 'inEast', 'outEast', 'inSouth', 'outSouth', 'inWest', 'outWest']
  .forEach(populateDropdown);

// Tambahkan event listener untuk update config
['inNorth', 'outNorth', 'inEast', 'outEast', 'inSouth', 'outSouth', 'inWest', 'outWest']
  .forEach(id => {
    document.getElementById(id).addEventListener('change', updateConfig);
  });

// Ambil slider radius dari HTML
const radiusSlider = document.getElementById("customRange");
radiusSlider.addEventListener("input", updateConfig); 

// Update config jika dropdown berubah
function updateConfig() {
  config.utara.in = parseInt(document.getElementById('inNorth').value);
  config.utara.out = parseInt(document.getElementById('outNorth').value);
  config.timur.in = parseInt(document.getElementById('inEast').value);
  config.timur.out = parseInt(document.getElementById('outEast').value);
  config.selatan.in = parseInt(document.getElementById('inSouth').value);
  config.selatan.out = parseInt(document.getElementById('outSouth').value);
  config.barat.in = parseInt(document.getElementById('inWest').value);
  config.barat.out = parseInt(document.getElementById('outWest').value);

  // Reset lane arrows sesuai jumlah lajur masuk
  laneArrows.utara = Array(config.utara.in).fill("straight");
  laneArrows.timur = Array(config.timur.in).fill("straight");
  laneArrows.selatan = Array(config.selatan.in).fill("straight");
  laneArrows.barat = Array(config.barat.in).fill("straight");

  // Perbarui posisi lampu lalu lintas
  lampu.updatePosition(config, parseFloat(radiusSlider.value));

  drawLayout();
}

// Gambar layout jalan
function drawLayout() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  drawUtara(ctx, config, laneArrows);
  drawSelatan(ctx, config, laneArrows);
  drawTimur(ctx, config, laneArrows);
  drawBarat(ctx, config, laneArrows);

  drawTengah(ctx, config);

  const radiusValue = parseFloat(radiusSlider.value);
  if (!isNaN(radiusValue)) {
    drawTurningRadius(ctx, config, radiusValue);
  }
}

// Deteksi klik untuk ganti arah panah
canvas.addEventListener("click", (e) => {
  const rect = canvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;

  const skala = config.skala_px * 3;
  const centerX = canvas.width / 2;
  const centerY = canvas.height / 2;

  // cek area barat (contoh: untuk semua arah harus dibuat mirip)
  const startYBarat = centerY - config.barat.in * skala;
  const endXBarat = centerX;

  for (let i = 0; i < config.barat.in; i++) {
    const laneCenterY = startYBarat + (i + 0.5) * skala;
    const arrowX = endXBarat - 40;
    if (Math.abs(x - arrowX) < 30 && Math.abs(y - laneCenterY) < 20) {
      const current = laneArrows.barat[i];
      let nextIndex = (arrowTypes.indexOf(current) + 1) % arrowTypes.length;
      laneArrows.barat[i] = arrowTypes[nextIndex];
      drawLayout();
      return;
    }
  }
});

// Jalankan gambar pertama kali
updateConfig();

// === Lampu Lalu Lintas ===
lampu.start();
