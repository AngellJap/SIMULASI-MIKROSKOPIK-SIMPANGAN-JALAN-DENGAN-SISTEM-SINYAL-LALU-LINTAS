import { drawTengah } from './draw/tengah.js';
import { drawUtara } from './draw/utara.js';
import { drawSelatan } from './draw/selatan.js';
import { drawTimur } from './draw/timur.js';
import { drawBarat } from './draw/barat.js';

const canvas = document.getElementById('simCanvas');
const ctx = canvas.getContext('2d');

const config = {
  utara: { in: 2, out: 2 },
  timur: { in: 2, out: 2 },
  selatan: { in: 2, out: 2 },
  barat: { in: 2, out: 2 },
  skala_px: 10 // 1 lajur = 3 meter * 10 px = 30px
};

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

['inNorth','outNorth','inEast','outEast','inSouth','outSouth','inWest','outWest']
  .forEach(populateDropdown);

['inNorth','outNorth','inEast','outEast','inSouth','outSouth','inWest','outWest']
  .forEach(id => {
    document.getElementById(id).addEventListener('change', updateConfig);
  });

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

function drawLayout() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawTengah(ctx, config);
  drawUtara(ctx, config);
  drawSelatan(ctx, config);
  drawTimur(ctx, config);
  drawBarat(ctx, config);
}

// Gambar pertama kali
drawLayout();
