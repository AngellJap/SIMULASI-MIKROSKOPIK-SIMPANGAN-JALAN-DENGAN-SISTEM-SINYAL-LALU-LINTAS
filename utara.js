export function drawUtara(ctx, config) {
  const totalMasuk = config.utara.in;
  const totalKeluar = config.utara.out;
  const skala = config.skala_px * 3;

  const centerX = ctx.canvas.width / 2;
  const centerY = ctx.canvas.height / 2;

  const startY = 0;
  const endYJalan = centerY; // Badan jalan tetap sampai tengah

  const lebarKeluar = totalKeluar * skala;
  const lebarTotal = (totalMasuk + totalKeluar) * skala;
  const startX = centerX - lebarKeluar;

  // === Ambil nilai radius minimum dari slider (HTML) ===
  const slider = document.getElementById("customRange");
  const radiusMeter = parseFloat(slider.value);      // nilai meter (3.28–11.59)
  const batasRadius = radiusMeter * config.skala_px; // konversi ke pixel

  // Gambar Badan Jalan Abu-abu
  ctx.fillStyle = "DimGray";
  ctx.fillRect(startX, startY, lebarTotal, endYJalan);

  // Hitung batas dinamis untuk marka putus-putus (dikurangi radius)
  const endY_Masuk  = centerY - (config.timur.out * skala) - batasRadius;
  const endY_Keluar = centerY - (config.barat.in * skala) - batasRadius;

  // Garis AS tengah dengan panjang dinamis
  const endY_AsTengah = Math.min(endY_Masuk, endY_Keluar);
  ctx.strokeStyle = "white";
  ctx.setLineDash([]);
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(centerX, startY);
  ctx.lineTo(centerX, endY_Masuk);
  ctx.stroke();

  // Marka putus-putus jalur masuk
  ctx.setLineDash([10, 10]);
  ctx.lineWidth = 2;
  for (let i = 1; i < totalMasuk; i++) {
    const x = centerX + i * skala;
    ctx.beginPath();
    ctx.moveTo(x, startY);
    ctx.lineTo(x, endY_Masuk);
    ctx.stroke();
  }

  // Marka putus-putus jalur keluar
  for (let i = 1; i < totalKeluar; i++) {
    const x = startX + i * skala;
    ctx.beginPath();
    ctx.moveTo(x, startY);
    ctx.lineTo(x, endY_Keluar);
    ctx.stroke();
  }

  // === Garis henti kendaraan (stop line) di ujung jalur masuk ===
  ctx.setLineDash([]);
  ctx.lineWidth = 4;
  ctx.strokeStyle = "white";
  ctx.beginPath();
  ctx.moveTo(centerX - 2, endY_Masuk);         // dari sisi kanan jalur masuk
  ctx.lineTo(centerX + totalMasuk * skala - 2, endY_Masuk); // ke sisi kiri jalur masuk
  ctx.stroke();

  ctx.setLineDash([]);
}
