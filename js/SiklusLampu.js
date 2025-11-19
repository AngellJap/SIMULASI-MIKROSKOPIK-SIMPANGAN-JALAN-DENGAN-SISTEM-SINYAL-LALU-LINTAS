// js/SiklusLampu.js
// Replaced circular diagram with 12 horizontal bars (U->T, U->S, U->B, T->S, T->B, T->U, S->B, S->U, S->T, B->U, B->T, B->S)
// This module draws into a provided <canvas> element and synchronizes with LampuLaluLintas (lampuRef) when available.
// Public API (keperluan main.js):
//   update(deltaMs)
//   draw()
//   setParams(totalSec, allRedSec, yellowSec)  // seconds
//   setPhaseMode(mode)
//   syncWithLampu(instance)
//   resetCycleDiagram()
//   setLTOR(bool)
// Behavior summary:
// - Each bar represents one maneuver (origin -> destination)
// - When a primary direction is "hijau", all outgoing bars from that origin become green (subject to arrowsConfig)
// - When LTOR (left-turn-through) is ON, the adjacent right-hand chain bars are allowed green as described by user rules
// - Bars update color (red / green / yellow) according to lampuRef.fase and lampu timings

export default function createSiklusLampu(opts = {}) {
  const canvas = opts.canvas;
  const ctx = canvas?.getContext('2d');
  if (!ctx) throw new Error('SiklusLampu: canvas context required');

  // configuration
  let totalCycleMs = (opts.cycleTotalSec || 60) * 1000;
  let allRedMs = (opts.allRedSec || 2) * 1000;
  let yellowMs = (opts.yellowSec || 3) * 1000;
  let ltor = !!opts.ltor;
  let phaseMode = opts.phaseMode || 'searah'; // searah | berhadapan | berseberangan

  // arrowsConfig: boolean outgoing map for each origin
  let arrowsConfig = opts.arrowsConfig || {
    Utara: { Timur: true, Selatan: true, Barat: true },
    Timur:  { Selatan: true, Barat: true, Utara: true },
    Selatan:{ Barat: true, Utara: true, Timur: true },
    Barat:  { Utara: true, Timur: true, Selatan: true }
  };

  // bar definitions (ordered)
  const BAR_LIST = [
    { id: 'U_T', origin: 'Utara', to: 'Timur', label: 'Utara → Timur' },
    { id: 'U_S', origin: 'Utara', to: 'Selatan', label: 'Utara → Selatan' },
    { id: 'U_B', origin: 'Utara', to: 'Barat', label: 'Utara → Barat' },

    { id: 'T_S', origin: 'Timur', to: 'Selatan', label: 'Timur → Selatan' },
    { id: 'T_B', origin: 'Timur', to: 'Barat', label: 'Timur → Barat' },
    { id: 'T_U', origin: 'Timur', to: 'Utara', label: 'Timur → Utara' },

    { id: 'S_B', origin: 'Selatan', to: 'Barat', label: 'Selatan → Barat' },
    { id: 'S_U', origin: 'Selatan', to: 'Utara', label: 'Selatan → Utara' },
    { id: 'S_T', origin: 'Selatan', to: 'Timur', label: 'Selatan → Timur' },

    { id: 'B_U', origin: 'Barat', to: 'Utara', label: 'Barat → Utara' },
    { id: 'B_T', origin: 'Barat', to: 'Timur', label: 'Barat → Timur' },
    { id: 'B_S', origin: 'Barat', to: 'Selatan', label: 'Barat → Selatan' }
  ];

  // visual params
  const padding = 12;
  const barHeight = 22;
  const gap = 8;
  const labelWidth = 140;
  const barRadius = 6;

  // internal state
  let lampuRef = null;
  let elapsed = 0; // fallback

  // map helper: find bar ids for origin
  function barsFromOrigin(origin) {
    return BAR_LIST.filter(b => b.origin === origin).map(b => b.id);
  }

  // map lookup by id
  const barIndexById = {};
  BAR_LIST.forEach((b, i) => barIndexById[b.id] = i);

  // determine which bars should be green given an active primary direction and LTOR flag
  function barsForActiveDirection(dir, ltorOn, arrows) {
    // base: outbound from dir
    const out = new Set();
    const ac = arrows[dir] || {};
    if (ac.Timur || ac['Timur']) out.add('U_T'); // note: will be pushed correctly below by checking origin
    // generalized: iterate BAR_LIST and add when origin matches dir and arrow enabled
    BAR_LIST.forEach(b => {
      if (b.origin === dir) {
        // convert destination name
        const dest = b.to;
        if (ac[dest] || ac[dest[0]] || ac[dest]) out.add(b.id);
      }
    });

    // More robust: use arrowsConfig keys as full names
    BAR_LIST.forEach(b => {
      if (b.origin === dir) {
        const dest = b.to;
        if ((arrows[dir] && (arrows[dir][dest] === true)) || (arrows[dir] && arrows[dir][dest[0]] === true)) {
          out.add(b.id);
        } else {
          // if arrowsConfig not detailed, assume all outgoing enabled
          if (!arrows[dir]) out.add(b.id);
        }
      }
    });

    if (ltorOn) {
      // add the right-hand chain per user's rule:
      // if dir=Utara, add: Timur->Selatan (T_S), Selatan->Barat (S_B), Barat->Utara (B_U)
      const cw = ['Utara','Timur','Selatan','Barat'];
      const idx = cw.indexOf(dir);
      if (idx >= 0) {
        // right neighbor chain (start at right)
        const right = cw[(idx+1)%4];
        const rightRight = cw[(idx+2)%4];
        const mapping = {
          'Utara': ['T_S','S_B','B_U'],
          'Timur': ['S_B','B_U','U_T'],
          'Selatan': ['B_U','U_T','T_S'],
          'Barat': ['U_T','T_S','S_B']
        };
        const extra = mapping[dir] || [];
        extra.forEach(id => out.add(id));
      }
    }

    return Array.from(out);
  }

  function computeDurations() {
    // returns object in ms: { hijau, kuning, allRed, total }
    const hijau = Math.max(0, (totalCycleMs / (phaseMode === 'searah' ? 4 : 2)) - allRedMs - yellowMs);
    return { hijau, kuning: yellowMs, allRed: allRedMs, total: totalCycleMs };
  }

  // determine current active primary dir (Utara/Timur/Selatan/Barat) and phase info from lampuRef
  function getLampuState() {
    if (lampuRef && typeof lampuRef === 'object') {
      const dur = lampuRef.durasi ? lampuRef.durasi : computeDurations();
      const index = (typeof lampuRef.indexAktif === 'number') ? lampuRef.indexAktif : 0;
      // get ordering: prefer lampuRef.urutan if present
      const order = Array.isArray(lampuRef.urutan) && lampuRef.urutan.length > 0 ? lampuRef.urutan : ['utara','timur','selatan','barat'];
      const idx = Math.max(0, Math.min(order.length - 1, index));
      const rawDir = order[idx] || order[idx % order.length] || 'utara';
      // normalize to capitalized names used in BAR_LIST
      const dirMap = { utara: 'Utara', north: 'Utara', timur: 'Timur', east: 'Timur', selatan: 'Selatan', south: 'Selatan', barat: 'Barat', west: 'Barat' };
      const dir = (dirMap[rawDir.toLowerCase?.() ] || (rawDir[0]?.toUpperCase() + rawDir.slice(1))) || 'Utara';
      const fase = lampuRef.fase || 'allRed'; // 'hijau'|'kuning'|'allRed'
      const waktuFase = Number(lampuRef.waktuFase) || 0; // ms within current fase
      return { dur, dir, fase, waktuFase };
    }
    // fallback: internal elapsed-based calculation
    const dur = computeDurations();
    const groupCount = (phaseMode === 'searah') ? 4 : 2;
    const perGroup = dur.total / groupCount;
    const progress = (elapsed % dur.total);
    const groupIndex = Math.floor(progress / perGroup) % groupCount;
    const order = ['Utara','Timur','Selatan','Barat'];
    const dir = order[groupIndex];
    const within = progress - groupIndex * perGroup;
    let fase = 'allRed';
    if (within < dur.allRed) fase = 'allRed';
    else if (within < dur.allRed + dur.hijau) fase = 'hijau';
    else fase = 'kuning';
    const waktuFase = within; // ms
    return { dur, dir, fase, waktuFase };
  }

  // draw a rounded rect
  function roundRect(x, y, w, h, r) {
    const radius = Math.min(r, h/2, w/2);
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + w, y, x + w, y + h, radius);
    ctx.arcTo(x + w, y + h, x, y + h, radius);
    ctx.arcTo(x, y + h, x, y, radius);
    ctx.arcTo(x, y, x + w, y, radius);
    ctx.closePath();
  }

  function draw() {
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0,0,w,h);

    // sizing
    const totalBars = BAR_LIST.length;
    const contentHeight = totalBars * barHeight + (totalBars - 1) * gap + padding * 2;
    // If canvas height small, scale barHeight/gap; but we keep fixed for clarity

    // get state
    const state = getLampuState();
    const dur = state.dur;

    // background
    ctx.fillStyle = '#fafafa';
    ctx.fillRect(0,0,w,h);

    // draw each bar
    for (let i = 0; i < BAR_LIST.length; i++) {
      const b = BAR_LIST[i];
      const y = padding + i * (barHeight + gap);
      const xLabel = padding;
      const xBar = padding + labelWidth;
      const barW = Math.max(80, w - xBar - padding);

      // default red background track
      ctx.fillStyle = '#e0e0e0';
      roundRect(xBar, y, barW, barHeight, barRadius);
      ctx.fill();

      // label
      ctx.fillStyle = '#222';
      ctx.font = '13px Arial';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(b.label, xLabel, y + barHeight/2);

      // determine color for this bar
      // default red
      let color = '#c0392b';
      let fillPct = 0; // percent of bar fill (for green progress)

      const activeDir = state.dir; // e.g. 'Utara'
      const activeFase = state.fase; // 'hijau'|'kuning'|'allRed'

      // Determine which bars should be green for activeDir according to arrowsConfig and LTOR
      const shouldBeGreen = barsForActiveDirection(activeDir, ltor, arrowsConfig).indexOf(b.id) >= 0;

      if (shouldBeGreen) {
        if (activeFase === 'hijau') {
          color = '#2ecc71'; // green
          // compute progress within green segment
          const greenDur = dur.hijau || 1;
          const tInPhase = Math.max(0, Math.min(state.waktuFase, greenDur));
          fillPct = Math.max(0, Math.min(1, tInPhase / greenDur));
        } else if (activeFase === 'kuning') {
          color = '#f39c12'; // yellow
          fillPct = 1; // show full yellow block
        } else {
          color = '#c0392b'; // all-red
          fillPct = 0;
        }
      } else {
        // not part of green set -> if it's the origin of current active dir and in yellow/all-red transition, keep yellow/red accordingly
        // otherwise remain red
        color = '#c0392b';
        fillPct = 0;
      }

      // draw fill
      if (fillPct > 0) {
        ctx.save();
        roundRect(xBar, y, barW * fillPct, barHeight, barRadius);
        ctx.fillStyle = color;
        ctx.fill();
        ctx.restore();
      }

      // outline
      ctx.lineWidth = 1;
      ctx.strokeStyle = '#bbb';
      roundRect(xBar, y, barW, barHeight, barRadius);
      ctx.stroke();

      // mid text (state)
      ctx.fillStyle = '#111';
      ctx.font = '11px Arial';
      ctx.textAlign = 'center';
      ctx.fillText(shouldBeGreen ? (activeFase.toUpperCase()) : 'RED', xBar + barW/2, y + barHeight/2);
    }

    // footer: show current active dir & phase
    ctx.fillStyle = '#000';
    ctx.font = '12px Arial';
    ctx.textAlign = 'left';
    ctx.fillText(`Active: ${state.dir} | Phase: ${state.fase} | LTOR: ${ltor ? 'ON' : 'OFF'}`, padding, padding + BAR_LIST.length * (barHeight + gap) + 6);
  }

  function update(deltaMs) {
    // synchronize durations if lampuRef provides
    if (lampuRef && typeof lampuRef.updateDurations === 'function') {
      try { lampuRef.updateDurations(); } catch(e) {}
    }

    if (lampuRef && lampuRef.durasi) {
      // keep internal timers aligned but rely on lampuRef for phase state
      const dur = lampuRef.durasi;
      totalCycleMs = dur.total || totalCycleMs;
      allRedMs = dur.allRed || allRedMs;
      yellowMs = dur.kuning || yellowMs;
    } else {
      // fallback increment
      elapsed += deltaMs;
      if (totalCycleMs > 0) elapsed %= totalCycleMs;
    }
  }

  function setParams(totalSec, allRedSec, yellowSec) {
    totalCycleMs = (Number(totalSec) || 0) * 1000;
    allRedMs = (Number(allRedSec) || 0) * 1000;
    yellowMs = (Number(yellowSec) || 0) * 1000;
  }

  function setPhaseMode(mode) {
    if (['searah','berhadapan','berseberangan'].includes(mode)) phaseMode = mode;
  }

  function syncWithLampu(instance) {
    lampuRef = instance || null;
  }

  function resetCycleDiagram() {
    elapsed = 0;
  }

  function setLTOR(val) { ltor = !!val; }

  // initial draw
  draw();

  return {
    update, draw, setParams, setPhaseMode, syncWithLampu, resetCycleDiagram, setLTOR
  };
}
