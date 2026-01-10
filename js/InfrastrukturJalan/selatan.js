export function drawSelatan(ctx, config) {
  const totalMasuk = config.selatan.in;
  const totalKeluar = config.selatan.out;
  const skala = config.skala_px * 3;

  const centerX = ctx.canvas.width / 2;
  const centerY = ctx.canvas.height / 2;

  const startYJalan = centerY; // Badan jalan tetap dari tengah
  const endY = ctx.canvas.height;

  const lebarMasuk = totalMasuk * skala;
  const lebarTotal = (totalMasuk + totalKeluar) * skala;
  const startX = centerX - lebarMasuk;

  // === Ambil nilai radius minimum dari slider (HTML) ===
  const slider = document.getElementById("customRange");
  const radiusMeter = parseFloat(slider.value);
  const batasRadius = radiusMeter * config.skala_px;

  // Gambar Badan Jalan Abu-abu
  ctx.fillStyle = "DimGray";
  ctx.fillRect(startX, startYJalan, lebarTotal, endY - startYJalan);

  // Hitung batas dinamis untuk marka putus-putus (ditambah radius)
  const startY_Masuk  = centerY + (config.barat.out * skala) + batasRadius;
  const startY_Keluar = centerY + (config.timur.in * skala) + batasRadius;

  // Garis AS tengah
  const startY_AsTengah = Math.max(startY_Masuk, startY_Keluar);
  ctx.strokeStyle = "white";
  ctx.setLineDash([]);
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(centerX, startY_Masuk);
  ctx.lineTo(centerX, endY);
  ctx.stroke();

// Marka pemisah jalur masuk (Selatan)
ctx.lineWidth = 2;
for (let i = 1; i < totalMasuk; i++) {
  const x = startX + i * skala;

  const panjangPenuh = 10 * config.skala_px; // 10 meter dalam px

  // --- segmen penuh (dekat stop line → ke arah tengah) ---
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(x, startY_Masuk);                  // stop line
  ctx.lineTo(x, startY_Masuk + panjangPenuh);   // 10 m ke bawah
  ctx.stroke();

  // --- segmen putus-putus (sisa jalan ke bawah) ---
  ctx.setLineDash([10, 10]);
  ctx.beginPath();
  ctx.moveTo(x, startY_Masuk + panjangPenuh);   // dari akhir garis penuh
  ctx.lineTo(x, endY);                          // sampai ujung bawah
  ctx.stroke();
}

  // Marka putus-putus jalur keluar (kanan dari centerX)
  ctx.setLineDash([10, 10]); 
  for (let i = 1; i < totalKeluar; i++) {
    const x = centerX + i * skala;
    ctx.beginPath();
    ctx.moveTo(x, startY_Keluar);
    ctx.lineTo(x, endY);
    ctx.stroke();
  }

  // === Garis henti kendaraan (stop line) di ujung jalur masuk (Selatan) ===
  ctx.setLineDash([]);
  ctx.lineWidth = 4;
  ctx.strokeStyle = "white";
  ctx.beginPath();

  // Jalur masuk di kiri (barat) dari centerX
  const masukKiriX = centerX - totalMasuk * skala;
  const masukKananX = centerX;

  ctx.moveTo(masukKiriX + 2, startY_Masuk);   // dari sisi kiri jalur masuk
  ctx.lineTo(masukKananX + 2, startY_Masuk);  // ke sisi kanan jalur masuk
  ctx.stroke();

  ctx.setLineDash([]);
}
