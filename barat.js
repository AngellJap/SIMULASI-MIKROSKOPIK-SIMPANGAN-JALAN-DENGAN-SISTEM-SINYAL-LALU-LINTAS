export function drawBarat(ctx, config) {
  const totalMasuk = config.barat.in;
  const totalKeluar = config.barat.out;
  const skala = config.skala_px * 3;

  const centerX = ctx.canvas.width / 2;
  const centerY = ctx.canvas.height / 2;

  const startX = 0;
  const endXJalan = centerX; // Badan jalan tetap sampai tengah

  const lebarMasuk = totalMasuk * skala;
  const tinggiTotal = (totalMasuk + totalKeluar) * skala;
  const startY = centerY - lebarMasuk;

  // === Ambil nilai radius minimum dari slider (HTML) ===
  const slider = document.getElementById("customRange");
  const radiusMeter = parseFloat(slider.value);      // nilai meter (3.28–11.59)
  const batasRadius = radiusMeter * config.skala_px; // konversi ke pixel

  // Gambar Badan Jalan Abu-abu
  ctx.fillStyle = 'DimGray';
  ctx.fillRect(startX, startY, endXJalan, tinggiTotal);

  // Hitung batas dinamis untuk marka putus-putus (dikurangi radius)
  const endX_Masuk  = centerX - (config.utara.out * skala) - batasRadius;
  const endX_Keluar = centerX - (config.selatan.in * skala) - batasRadius;

  // Math.min digunakan karena koordinat X lebih kecil berarti lebih ke kiri (lebih pendek).
  const endX_AsTengah = Math.min(endX_Masuk, endX_Keluar);

  // ======================

  // Garis AS tengah dengan panjang dinamis
  ctx.strokeStyle = 'white';
  ctx.setLineDash([]);
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(startX, centerY);
  ctx.lineTo(endX_Masuk, centerY); // Menggunakan batas baru
  ctx.stroke();

  // Marka putus-putus jalur masuk
  ctx.setLineDash([10, 10]);
  ctx.lineWidth = 2;
  for (let i = 1; i < totalMasuk; i++) {
    const y = startY + i * skala;
    ctx.beginPath();
    ctx.moveTo(startX, y);
    ctx.lineTo(endX_Masuk, y);
    ctx.stroke();
  }

  // Marka putus-putus jalur keluar
  for (let i = 1; i < totalKeluar; i++) {
    const y = centerY + i * skala;
    ctx.beginPath();
    ctx.moveTo(startX, y);
    ctx.lineTo(endX_Keluar, y);
    ctx.stroke();
  }

  // === Garis henti kendaraan (stop line) di akhir jalur masuk ===
  ctx.setLineDash([]);         // garis penuh
  ctx.lineWidth = 4;
  ctx.strokeStyle = "white";
  ctx.beginPath();
  ctx.moveTo(endX_Masuk, startY + 2);                 // dari batas atas jalur masuk
  ctx.lineTo(endX_Masuk, centerY + 2);                // sampai ke garis tengah
  ctx.stroke();

  ctx.setLineDash([]);
}
