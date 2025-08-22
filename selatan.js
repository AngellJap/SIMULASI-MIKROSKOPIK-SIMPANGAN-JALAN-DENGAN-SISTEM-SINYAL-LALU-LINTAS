export function drawSelatan(ctx, config) {
  const totalMasuk = config.selatan.in;
  const totalKeluar = config.selatan.out;
  const skala = config.skala_px * 3;

  const centerX = ctx.canvas.width / 2;
  const centerY = ctx.canvas.height / 2;

  const startY = centerY + 100; // mulai dari bawah blok tengah
  const endY = ctx.canvas.height;

  const lebarKeluar = totalKeluar * skala;
  const lebarMasuk = totalMasuk * skala;

  const startX = centerX - lebarMasuk;
  const lebarTotal = lebarKeluar + lebarMasuk;

  // Area putih luar jalan
  ctx.fillStyle = 'white';
  ctx.fillRect(0, startY, ctx.canvas.width, endY - startY);

  // Jalan
  ctx.fillStyle = 'DimGray';
  ctx.fillRect(startX, startY, lebarTotal, endY - startY);

  // Garis AS tengah
  ctx.strokeStyle = 'white';
  ctx.setLineDash([]);
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(centerX, startY);
  ctx.lineTo(centerX, endY);
  ctx.stroke();

  // Marka jalur masuk
  ctx.setLineDash([10, 10]);
  ctx.lineWidth = 2;
  for (let i = 1; i < totalMasuk; i++) {
    const x = centerX - i * skala;
    ctx.beginPath();
    ctx.moveTo(x, startY);
    ctx.lineTo(x, endY);
    ctx.stroke();
  }

  // Marka jalur keluar
  for (let i = 1; i < totalKeluar; i++) {
    const x = centerX + i * skala;
    ctx.beginPath();
    ctx.moveTo(x, startY);
    ctx.lineTo(x, endY);
    ctx.stroke();
  }

  ctx.setLineDash([]);
}
