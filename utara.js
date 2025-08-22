export function drawUtara(ctx, config) {
  const totalMasuk = config.utara.in;
  const totalKeluar = config.utara.out;
  const skala = config.skala_px * 3;

  const centerX = ctx.canvas.width / 2;
  const centerY = ctx.canvas.height / 2;

  const startY = 0;
  const endY = centerY - 150;

  // Lebar sisi keluar dan masuk
  const lebarKeluar = totalKeluar * skala;
  const lebarMasuk = totalMasuk * skala;

  // Titik awal = tengah - lebar keluar
  const startX = centerX - lebarKeluar;
  const lebarTotal = lebarKeluar + lebarMasuk;

  // Area putih luar jalan
  ctx.fillStyle = 'white';
  ctx.fillRect(0, startY, ctx.canvas.width, endY);

  // Jalan
  ctx.fillStyle = 'DimGray';
  ctx.fillRect(startX, startY, lebarTotal, endY);

  // Garis AS tengah
  ctx.strokeStyle = 'white';
  ctx.setLineDash([]);
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(centerX, startY);
  ctx.lineTo(centerX, endY);
  ctx.stroke();

  // Marka putus-putus jalur keluar
  ctx.setLineDash([10, 10]);
  ctx.lineWidth = 2;
  for (let i = 1; i < totalKeluar; i++) {
    const x = startX + i * skala;
    ctx.beginPath();
    ctx.moveTo(x, startY);
    ctx.lineTo(x, endY);
    ctx.stroke();
  }

  // Marka putus-putus jalur masuk
  for (let i = 1; i < totalMasuk; i++) {
    const x = centerX + i * skala;
    ctx.beginPath();
    ctx.moveTo(x, startY);
    ctx.lineTo(x, endY);
    ctx.stroke();
  }

  ctx.setLineDash([]);
}
