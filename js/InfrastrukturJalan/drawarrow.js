// drawArrow.js
export function getLaneButtonPositions(ctx, config, arah) {
  const centerX = ctx.canvas.width / 2;
  const centerY = ctx.canvas.height / 2;
  const skala = config.skala_px * 3;
  const pixelsPerMeter = skala / 3;
  const batasRadius = config.radiusValue * pixelsPerMeter;
  const gapFromStopline = Math.max(12, Math.round(skala * 0.08));

  let positions = [];

  ctx.save();

  if (arah === "selatan") {
    const boxWidth = 25;
    const boxHeight = 75;
    const totalMasuk = config.selatan.in;
    const stopLinePos = centerY + (config.barat.out * skala) + batasRadius;

    for (let i = 0; i < totalMasuk; i++) {
      const x = centerX - (i + 0.5) * skala;
      const y = stopLinePos + 40;
      positions.push({ x, y, lane: i, boxWidth, boxHeight });
    }
  }

  else if (arah === "utara") {
    const boxWidth = 25;
    const boxHeight = 75;
    const totalMasuk = config.utara.in;
    const stopLinePos = centerY - (config.timur.out * skala) - batasRadius;

    for (let i = 0; i < totalMasuk; i++) {
      const x = centerX + (i + 0.5) * skala;
      const y = stopLinePos - 40;
      positions.push({ x, y, lane: i, boxWidth, boxHeight });
    }
  }

  else if (arah === "barat") {
    const boxWidth = 75;
    const boxHeight = 25;
    const totalMasuk = config.barat.in;
    const stopLinePos = centerX - (config.utara.out * skala) - batasRadius;

    for (let i = 0; i < totalMasuk; i++) {
      const x = stopLinePos - gapFromStopline - 30;
      const y = centerY - (i + 0.5) * skala;
      positions.push({ x, y, lane: i, boxWidth, boxHeight });
    }
  }

  else if (arah === "timur") {
    const boxWidth = 75;
    const boxHeight = 25;
    const totalMasuk = config.timur.in;
    const stopLinePos = centerX + (config.selatan.out * skala) + batasRadius;

    for (let i = 0; i < totalMasuk; i++) {
      const x = stopLinePos + gapFromStopline + 30;
      const y = centerY + (i + 0.5) * skala;
      positions.push({ x, y, lane: i, boxWidth, boxHeight });
    }
  }

  ctx.restore();
  return positions;
}