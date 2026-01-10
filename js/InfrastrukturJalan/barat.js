export function drawBarat(ctx, config) {
  const totalMasuk = config.barat.in;
  const totalKeluar = config.barat.out;
  const skala = config.skala_px * 3;

  const centerX = ctx.canvas.width / 2;
  const centerY = ctx.canvas.height / 2;

  const startX = 0;
  const endXJalan = centerX;

  const lebarMasuk = totalMasuk * skala;
  const tinggiTotal = (totalMasuk + totalKeluar) * skala;
  const startY = centerY - lebarMasuk;

  // radius minimum (slider)
  const slider = document.getElementById("customRange");
  const radiusMeter = parseFloat(slider.value);
  const batasRadius = radiusMeter * config.skala_px;

  // badan jalan
  ctx.fillStyle = "DimGray";
  ctx.fillRect(startX, startY, endXJalan, tinggiTotal);

  // batas marka
  const endX_Masuk  = centerX - (config.utara.out * skala) - batasRadius;
  const endX_Keluar = centerX - (config.selatan.in * skala) - batasRadius;
  const endX_AsTengah = Math.min(endX_Masuk, endX_Keluar);

  // garis as tengah
  ctx.strokeStyle = "white";
  ctx.setLineDash([]);
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(startX, centerY);
  ctx.lineTo(endX_Masuk, centerY);
  ctx.stroke();

 // marka pemisah jalur masuk
ctx.lineWidth = 2;
for (let i = 1; i < totalMasuk; i++) {
  const y = startY + i * skala;

  const panjangPenuh = 10 * config.skala_px; // 10 meter dalam pixel

  // --- segmen penuh (dekat stop line) ---
  ctx.setLineDash([]); // garis penuh
  ctx.beginPath();
  ctx.moveTo(endX_Masuk - panjangPenuh, y); // mulai 10m sebelum stop line
  ctx.lineTo(endX_Masuk, y);               // sampai stop line
  ctx.stroke();

  // --- segmen putus-putus (dari ujung jalan sampai batas penuh) ---
  ctx.setLineDash([10, 10]); // putus-putus
  ctx.beginPath();
  ctx.moveTo(startX, y);                       // dari ujung jalan
  ctx.lineTo(endX_Masuk - panjangPenuh, y);    // berhenti sebelum garis penuh
  ctx.stroke();
}

// marka putus-putus keluar
ctx.setLineDash([10, 10]);
for (let i = 1; i < totalKeluar; i++) {
  const y = centerY + i * skala;
  ctx.beginPath();
  ctx.moveTo(startX, y);
  ctx.lineTo(endX_Keluar, y);
  ctx.stroke();
}

  // garis henti
  ctx.setLineDash([]);
  ctx.lineWidth = 4;
  ctx.strokeStyle = "white";
  ctx.beginPath();
  ctx.moveTo(endX_Masuk, startY + 2);
  ctx.lineTo(endX_Masuk, centerY + 2);
  ctx.stroke();

  // === SIMPAN POSISI STOP LINE UNTUK LAMPU ===
  if (!config.stopLine) config.stopLine = {};
  config.stopLine.barat = { x: endX_Masuk, y: centerY };
}

