// js/SiklusLampu.js
// Modul siklus lampu lalu lintas — diagram lingkaran 4 fase
// Revisi: sinkronisasi ke LampuLaluLintas jika diberikan (lampuRef).
export default function createSiklusLampu(opts = {}) {
  const canvas = opts.canvas;
  const ctx = canvas?.getContext('2d');
  if (!ctx) throw new Error("SiklusLampu membutuhkan canvas context!");

  // Default parameter (ms)
  let cycleTotal = (opts.cycleTotalSec || 120) * 1000;
  let allRedDur = (opts.allRedSec || 2) * 1000;
  let yellowDur = (opts.yellowSec || 3) * 1000;
  const colors = { red: "#cc0000", yellow: "#ffd200", green: "#2ecc71" };
  let elapsed = 0;           // fallback internal timer (ms)
  let simSpeed = 1.0;

  const labels = ["U", "T", "S", "B"]; // searah jarum jam

  // Phase mode: "searah" | "berhadapan" | "berseberangan"
  let phaseMode = opts.phaseMode || "searah";

  // Lampu referensi (null jika tidak ada). Bisa diset via opts.lampuRef atau syncWithLampu()
  let lampuRef = opts.lampuRef || null;

  // Compute green (same formula as LampuLaluLintas.getDurasi)
  function computeGreen(mode = phaseMode, localCycleTotal = cycleTotal, localAllRed = allRedDur, localYellow = yellowDur) {
    const tot = localCycleTotal;
    let base = (mode === "searah") ? (tot / 4) : (tot / 2);
    let g = base - localAllRed - localYellow;
    if (g < 0) g = 0;
    return g;
  }

  // Public API: set params (in detik)
  function setParams(totalSec, allRedSec, yellowSec) {
    cycleTotal = (Number(totalSec) || 0) * 1000;
    allRedDur = (Number(allRedSec) || 0) * 1000;
    yellowDur = (Number(yellowSec) || 0) * 1000;
    // If there's a lampuRef and it exposes updateDurations, trigger it so lampu also refreshes.
    try {
      if (lampuRef && typeof lampuRef.updateDurations === "function") {
        lampuRef.updateDurations();
      }
    } catch (e) {
      // ignore
    }
  }

  function setPhaseMode(mode = "searah") {
    if (!["searah","berhadapan","berseberangan"].includes(mode)) {
      console.warn("[SiklusLampu] unknown phaseMode:", mode);
      return;
    }
    phaseMode = mode;
  }

  function setSimSpeed(v) {
    simSpeed = v || 1;
  }

  // Allow main.js to attach lampu instance after both are created
  function syncWithLampu(instance) {
    lampuRef = instance || null;
    // If lampuRef has durasi, mirror certain base values to keep display parameters consistent
    if (lampuRef && lampuRef.durasi) {
      // prefer lampu's total (but keep internal cycleTotal as fallback)
      try {
        if (typeof lampuRef.durasi.total === "number") cycleTotal = Number(lampuRef.durasi.total) || cycleTotal;
        if (typeof lampuRef.durasi.allRed === "number") allRedDur = Number(lampuRef.durasi.allRed) || allRedDur;
        if (typeof lampuRef.durasi.kuning === "number") yellowDur = Number(lampuRef.durasi.kuning) || yellowDur;
      } catch (e) { /* ignore */ }
    }
  }

  // Reset visual pointer to start
  let justReset = false;
  function resetCycleDiagram() {
    elapsed = 0;
    justReset = true;
    console.log("🔄 Cycle diagram direset ke awal (All-Red, Utara).");
  }

  // Update: if lampuRef exists, compute elapsed from lampuRef's index/fase/waktuFase,
  // otherwise fallback to internal timer (elapsed).
  function update(deltaMs) {
    if (lampuRef && typeof lampuRef === "object" && lampuRef.durasi && (lampuRef.indexAktif !== undefined) && (lampuRef.waktuFase !== undefined)) {
      // Ensure lampuRef.durasi is fresh if lampuRef exposes updateDurations
      try { if (typeof lampuRef.updateDurations === 'function') lampuRef.updateDurations(); } catch (e) {}

      const dur = lampuRef.durasi || { hijau: computeGreen(phaseMode, cycleTotal, allRedDur, yellowDur), kuning: yellowDur, allRed: allRedDur, total: cycleTotal };
      const groupCount = Array.isArray(lampuRef.urutan) ? lampuRef.urutan.length : (phaseMode === "searah" ? 4 : 2);
      const perGroupTotal = (typeof dur.total === "number" && dur.total > 0) ? (dur.total / groupCount) : (dur.allRed + dur.hijau + dur.kuning);

      // compute elapsed by summing full groups before current index
      const idx = Number(lampuRef.indexAktif) || 0;
      let e = 0;
      for (let i = 0; i < idx; i++) {
        e += perGroupTotal;
      }

      // within current group, offset depends on fase and waktuFase
      const fase = lampuRef.fase || "allRed";
      const wf = Number(lampuRef.waktuFase) || 0;

      if (fase === "allRed") {
        // Add elapsed within allRed (start of group)
        e += Math.min(wf, dur.allRed);
      } else if (fase === "hijau") {
        e += dur.allRed + Math.min(wf, dur.hijau);
      } else if (fase === "kuning") {
        e += dur.allRed + dur.hijau + Math.min(wf, dur.kuning);
      } else {
        // unknown phase: fallback to using percentage of perGroupTotal
        e += Math.min(wf, perGroupTotal);
      }

      // clamp & set internal values for drawing
      elapsed = e % (dur.total || cycleTotal);
      // also keep cycleTotal aligned (so draw uses same denom)
      cycleTotal = dur.total || cycleTotal;
      allRedDur = dur.allRed || allRedDur;
      yellowDur = dur.kuning || yellowDur;
      phaseMode = lampuRef.phaseMode || phaseMode;
    } else {
      // fallback: advance internal timer
      elapsed += deltaMs * simSpeed;
      if (cycleTotal > 0) elapsed %= cycleTotal;
    }
  }

  // DRAW: uses current elapsed & cycleTotal (either from lampuRef-derived or internal)
  function draw() {
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    const cx = w / 2, cy = h / 2;
    const r = Math.min(w, h) / 2 - 20;

    // durations (ms)
    const dur = (lampuRef && lampuRef.durasi) ? lampuRef.durasi : { hijau: computeGreen(phaseMode, cycleTotal, allRedDur, yellowDur), kuning: yellowDur, allRed: allRedDur, total: cycleTotal };
    const groupCount = (lampuRef && Array.isArray(lampuRef.urutan)) ? lampuRef.urutan.length : (phaseMode === "searah" ? 4 : 2);
    const perGroupTotal = (dur.total && groupCount > 0) ? (dur.total / groupCount) : (dur.allRed + dur.hijau + dur.kuning);

    // For drawing, each group is split into 3 segments: allRed, green, yellow
    const segments = [
      { color: colors.red, dur: dur.allRed },
      { color: colors.green, dur: dur.hijau },
      { color: colors.yellow, dur: dur.kuning }
    ];

    if (phaseMode === "searah") {
      // draw 4 quadrants (or N=groupCount)
      for (let q = 0; q < groupCount; q++) {
        let startAngle = (q * (2 * Math.PI / groupCount)) - Math.PI / 2;
        for (let seg of segments) {
          const frac = (perGroupTotal > 0) ? (seg.dur / perGroupTotal) : 0;
          const endAngle = startAngle + frac * (2 * Math.PI / groupCount);
          ctx.beginPath();
          ctx.moveTo(cx, cy);
          ctx.fillStyle = seg.color;
          ctx.arc(cx, cy, r, startAngle, endAngle, false);
          ctx.closePath();
          ctx.fill();
          startAngle = endAngle;
        }

        // Label (direction initial)
        ctx.save();
        ctx.translate(cx, cy);
        const labelAngle = (q * (2 * Math.PI / groupCount)) - Math.PI / 2 + (Math.PI / groupCount);
        const lx = Math.cos(labelAngle) * (r * 0.65);
        const ly = Math.sin(labelAngle) * (r * 0.65);
        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 18px Arial";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        const lab = labels[q] || labels[q % labels.length] || "?";
        ctx.fillText(lab, lx, ly);
        ctx.restore();
      }
    } else {
      // berhadapan or berseberangan: draw two halves, each half comprises segments in order
      for (let half = 0; half < groupCount; half++) {
        let startAngle = (half * Math.PI) - Math.PI / 2;
        for (let seg of segments) {
          const frac = (perGroupTotal > 0) ? (seg.dur / perGroupTotal) : 0;
          const endAngle = startAngle + frac * Math.PI;
          ctx.beginPath();
          ctx.moveTo(cx, cy);
          ctx.fillStyle = seg.color;
          ctx.arc(cx, cy, r, startAngle, endAngle, false);
          ctx.closePath();
          ctx.fill();
          startAngle = endAngle;
        }
      }

      // Put labels for four directions at quarter positions (like before)
      for (let q = 0; q < 4; q++) {
        ctx.save();
        ctx.translate(cx, cy);
        const labelAngle = (q * Math.PI / 2) - Math.PI / 2 + Math.PI / 4;
        const lx = Math.cos(labelAngle) * (r * 0.7);
        const ly = Math.sin(labelAngle) * (r * 0.7);
        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 18px Arial";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(labels[q], lx, ly);
        ctx.restore();
      }
    }

    // Outline
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, 2 * Math.PI);
    ctx.lineWidth = 2;
    ctx.strokeStyle = "#333";
    ctx.stroke();

    // Dot progress around circle: use elapsed / total
    const progTotal = (dur.total && dur.total > 0) ? dur.total : cycleTotal;
    const progress = (progTotal > 0) ? (elapsed / progTotal) : 0;
    const angle = (2 * Math.PI * progress) - Math.PI / 2;
    const dotX = cx + Math.cos(angle) * r;
    const dotY = cy + Math.sin(angle) * r;

    const grad = ctx.createRadialGradient(dotX, dotY, 0, dotX, dotY, 15);
    grad.addColorStop(0, "#fff");
    grad.addColorStop(1, "transparent");
    ctx.beginPath();
    ctx.fillStyle = grad;
    ctx.arc(dotX, dotY, 10, 0, 2 * Math.PI);
    ctx.fill();

    ctx.beginPath();
    ctx.fillStyle = "#000";
    ctx.arc(dotX, dotY, 4, 0, 2 * Math.PI);
    ctx.fill();

    // Teks waktu sisa: compute remaining in the overall cycle (progTotal - elapsed)
    const remSeconds = ((progTotal - elapsed) / 1000);
    const textString = `Sisa: ${remSeconds.toFixed(1)} dtk`;
    const padding = 6;
    ctx.font = "16px Arial";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const metrics = ctx.measureText(textString);
    const textWidth = metrics.width;
    const textHeight = 16;
    ctx.fillStyle = "rgba(255,255,255,0.95)";
    ctx.fillRect(cx - (textWidth / 2) - padding, cy - (textHeight / 2) - padding, textWidth + (padding * 2), textHeight + (padding * 2));
    ctx.fillStyle = "#000";
    ctx.fillText(textString, cx, cy);
  }

  // Return public API
  return {
    update,
    draw,
    setParams,
    setSimSpeed,
    setPhaseMode,
    syncWithLampu,    // gunakan ini dari main.js setelah lampu dibuat: siklus.syncWithLampu(lampu)
    resetCycleDiagram
  };
}
