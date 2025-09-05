// Import semua modul gambar jalan
import { drawTengah } from './InfrastrukturJalan/tengah.js';
import { drawUtara } from './InfrastrukturJalan/utara.js';
import { drawSelatan } from './InfrastrukturJalan/selatan.js';
import { drawTimur } from './InfrastrukturJalan/timur.js';
import { drawBarat } from './InfrastrukturJalan/barat.js';
import { drawTurningRadius } from './InfrastrukturJalan/drawTurningRadius.js';

// Import modul lampu lalu lintas
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

// Fungsi isi dropdown (jumlah lajur)
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
['inNorth','outNorth','inEast','outEast','inSouth','outSouth','inWest','outWest']
  .forEach(populateDropdown);

// Tambahkan event listener untuk update config
['inNorth','outNorth','inEast','outEast','inSouth','outSouth','inWest','outWest']
  .forEach(id => {
    document.getElementById(id).addEventListener('change', updateConfig);
  });

// Ambil slider radius dari HTML
const radiusSlider = document.getElementById("customRange");
radiusSlider.addEventListener("input", drawLayout);

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

  drawLayout();
}

// Gambar layout jalan
function drawLayout() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Gambar semua lengan jalan terlebih dahulu
  drawUtara(ctx, config);
  drawSelatan(ctx, config);
  drawTimur(ctx, config);
  drawBarat(ctx, config);

  // Gambar bagian tengah
  drawTengah(ctx, config);

  // Gambar turning radius (marka manuver)
  const radiusValue = parseFloat(radiusSlider.value);
  if (!isNaN(radiusValue)) {
    drawTurningRadius(ctx, config, radiusValue);
  }
}

// Jalankan gambar pertama kali
drawLayout();

// === Lampu Lalu Lintas ===
const lampu = new LampuLaluLintas("simCanvas");
lampu.start();
