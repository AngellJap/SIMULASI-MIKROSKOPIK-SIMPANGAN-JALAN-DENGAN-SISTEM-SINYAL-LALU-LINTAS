export function drawTengah(ctx, config) {
  const skala = config.skala_px * 3;

  // Cari jumlah lajur terbesar di semua lengan
  const maxUtara = config.utara.in + config.utara.out;
  const maxSelatan = config.selatan.in + config.selatan.out;
  const maxTimur = config.timur.in + config.timur.out;
  const maxBarat = config.barat.in + config.barat.out;

  const lebarVertical = Math.max(maxUtara, maxSelatan) * skala;
  const lebarHorizontal = Math.max(maxTimur, maxBarat) * skala;

  const centerX = ctx.canvas.width / 2;
  const centerY = ctx.canvas.height / 2;

  // Area putih latar belakang
  ctx.fillStyle = 'white';
  ctx.fillRect(centerX - lebarHorizontal / 2, centerY - lebarVertical / 2, lebarHorizontal, lebarVertical);

  // Jalan tengah
  ctx.fillStyle = 'DimGray';
  ctx.fillRect(centerX - lebarHorizontal / 2, centerY - lebarVertical / 2, lebarHorizontal, lebarVertical);
}
