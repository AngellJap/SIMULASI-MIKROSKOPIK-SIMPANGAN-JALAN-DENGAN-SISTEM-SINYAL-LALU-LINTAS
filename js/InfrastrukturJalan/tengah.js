export function drawTengah(ctx, config) {
  const skala = config.skala_px * 3;

  // Jumlah lajur
  const Uin = config.utara.in || 0;
  const Uout = config.utara.out || 0;
  const Sin = config.selatan.in || 0;
  const Sout = config.selatan.out || 0;
  const Tin = config.timur.in || 0;
  const Tout = config.timur.out || 0;
  const Bin = config.barat.in || 0;
  const Bout = config.barat.out || 0;

  // Hitung dimensi kotak pusat → pakai maksimum lajur lawan arah
  const lebarHorizontal = Math.max(Tin + Tout, Bin + Bout) * skala;
  const lebarVertical   = Math.max(Uin + Uout, Sin + Sout) * skala;

  const centerX = ctx.canvas.width / 2;
  const centerY = ctx.canvas.height / 2;

  // Fungsi konversi jumlah lajur → pixel
  const px = i => i * skala;

  // ==================
  // Kuadran (berdasar jumlah lajur)
  // ==================
  // Q1: Utara OUT × Barat IN
  ctx.fillStyle = "dimGrey";
  ctx.fillRect(centerX - px(Uout), centerY - px(Bin), px(Uout), px(Bin));

  // Q2: Utara IN × Timur OUT
  ctx.fillStyle = "dimGrey";
  ctx.fillRect(centerX, centerY - px(Tout), px(Uin), px(Tout));

  // Q3: Selatan OUT × Timur IN
  ctx.fillStyle = "dimGrey";
  ctx.fillRect(centerX, centerY, px(Sout), px(Tin));

  // Q4: Selatan IN × Barat OUT
  ctx.fillStyle = "dimGrey";
  ctx.fillRect(centerX - px(Sin), centerY, px(Sin), px(Bout));
}
