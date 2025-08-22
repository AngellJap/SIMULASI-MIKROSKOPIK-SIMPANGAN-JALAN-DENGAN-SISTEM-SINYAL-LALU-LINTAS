export function drawBarat(ctx, config) {
  const totalMasuk = config.barat.in;
  const totalKeluar = config.barat.out;
  const skala = config.skala_px * 3;

  const centerX = ctx.canvas.width / 2;
  const centerY = ctx.canvas.height / 2;

  const startX = 0;
  const endX = centerX - 150;

  const lebarKeluar = totalKeluar * skala;
  const lebarMasuk = totalMasuk * skala;

  const startY = centerY - lebarMasuk;
  const tinggiTotal = lebarKeluar + lebarMasuk;

  // Area putih luar jalan
  ctx.fillStyle = 'white';
  ctx.fillRect(startX, 0, endX, ctx.canvas.height);

  // Jalan
  ctx.fillStyle = 'DimGray';
  ctx.fillRect(startX, startY, endX, tinggiTotal);

  // Garis AS tengah
  ctx.strokeStyle = 'white';
  ctx.setLineDash([]);
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(startX, centerY);
  ctx.lineTo(endX, centerY);
  ctx.stroke();

  // Marka putus-putus jalur masuk (ke tengah)
  ctx.setLineDash([10, 10]);
  ctx.lineWidth = 2;
  for (let i = 1; i < totalMasuk; i++) {
    const y = startY + i * skala;
    ctx.beginPath();
    ctx.moveTo(startX, y);
    ctx.lineTo(endX, y);
    ctx.stroke();
  }

  // Marka putus-putus jalur keluar
  for (let i = 1; i < totalKeluar; i++) {
    const y = centerY + i * skala;
    ctx.beginPath();
    ctx.moveTo(startX, y);
    ctx.lineTo(endX, y);
    ctx.stroke();
  }

  ctx.setLineDash([]);
}
