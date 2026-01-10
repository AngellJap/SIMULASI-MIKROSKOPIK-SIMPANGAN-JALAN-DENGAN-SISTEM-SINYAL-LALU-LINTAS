export function drawTimur(ctx, config) {
  const totalMasuk = config.timur.in;
  const totalKeluar = config.timur.out;
  const skala = config.skala_px * 3;

  const centerX = ctx.canvas.width / 2;
  const centerY = ctx.canvas.height / 2;

  const startXJalan = centerX; // Badan jalan tetap dari tengah
  const endX = ctx.canvas.width;

  const lebarKeluar = totalKeluar * skala;
  const tinggiTotal = (totalMasuk + totalKeluar) * skala;
  const startY = centerY - lebarKeluar;

  // === Ambil nilai radius minimum dari slider (HTML) ===
  const slider = document.getElementById("customRange");
  const radiusMeter = parseFloat(slider.value);
  const batasRadius = radiusMeter * config.skala_px;

  // Gambar Badan Jalan Abu-abu
  ctx.fillStyle = "DimGray";
  ctx.fillRect(startXJalan, startY, endX - startXJalan, tinggiTotal);

  // Hitung batas dinamis untuk marka putus-putus (ditambah radius)
  const startX_Masuk  = centerX + (config.selatan.out * skala) + batasRadius;
  const startX_Keluar = centerX + (config.utara.in * skala) + batasRadius;

  // Garis AS tengah
  const startX_AsTengah = Math.max(startX_Masuk, startX_Keluar);
  ctx.strokeStyle = "white";
  ctx.setLineDash([]);
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(startX_Masuk, centerY);
  ctx.lineTo(endX, centerY);
  ctx.stroke();

// Marka pemisah jalur masuk (Timur)
ctx.lineWidth = 2;
for (let i = 1; i < totalMasuk; i++) {
  const y = centerY + i * skala;

  const panjangPenuh = 10 * config.skala_px; // 10 meter dalam px

  // --- segmen penuh (dekat stop line → ke arah tengah) ---
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(startX_Masuk, y);                     // stop line
  ctx.lineTo(startX_Masuk + panjangPenuh, y);      // 10 m ke kanan
  ctx.stroke();

  // --- segmen putus-putus (sisa jalan ke kanan) ---
  ctx.setLineDash([10, 10]);
  ctx.beginPath();
  ctx.moveTo(startX_Masuk + panjangPenuh, y);      // dari akhir garis penuh
  ctx.lineTo(endX, y);                             // sampai ujung kanan
  ctx.stroke();
}

  // Marka putus-putus jalur keluar (jalur keluar di atas centerY → utara)
  ctx.setLineDash([10, 10]); 
  for (let i = 1; i < totalKeluar; i++) {
    const y = startY + i * skala;
    ctx.beginPath();
    ctx.moveTo(startX_Keluar, y);
    ctx.lineTo(endX, y);
    ctx.stroke();
  }

  // === Garis henti kendaraan (stop line) di ujung jalur masuk (Timur) ===
  ctx.setLineDash([]);
  ctx.lineWidth = 4;
  ctx.strokeStyle = "white";
  ctx.beginPath();

  // Jalur masuk di bawah (selatan)
  const masukAtasY = centerY;                     // batas atas jalur masuk
  const masukBawahY = centerY + totalMasuk * skala; // batas bawah jalur masuk

  ctx.moveTo(startX_Masuk, masukAtasY - 2);    // kiri sedikit dari jalur masuk
  ctx.lineTo(startX_Masuk, masukBawahY - 2);   // sampai ke tepi kanan jalan
  ctx.stroke();

  ctx.setLineDash([]);
}
