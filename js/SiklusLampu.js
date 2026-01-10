// js/SiklusLampu.js
// VERSI FINAL TUNTAS (ANTI-POTONG):
// 1. Canvas Height diperbesar ke 540px (agar footer tidak terpotong).
// 2. Layout Spasi tetap lebar dan rapi.
// 3. Warna Pastel + Teks Hitam Jelas.
// 4. Tanpa Celah Merah (Smooth Bar).

export default function createSiklusLampu(opts = {}) {
  const canvas = opts.canvas || document.getElementById('cycleCanvas');
  if (!canvas) throw new Error('SiklusLampu: canvas element not found (id "cycleCanvas")');
  const ctx = canvas.getContext('2d');

  // [PERBAIKAN UTAMA] PERBESAR TINGGI CANVAS
  // Dulu 480, sekarang 540 agar footer di bawah muat sepenuhnya.
  canvas.width = 580;  
  canvas.height = 540; 

  // --- Parameter Default ---
  let cycleTotalSec = Number(opts.totalSec ?? 60);
  let allRedSec = Number(opts.allRedSec ?? 2);
  let yellowSec = Number(opts.yellowSec ?? 3);
  let phaseMode = opts.phaseMode ?? 'searah';
  let ltor = Boolean(opts.ltor ?? false);
  let simSpeed = Number(opts.simSpeed ?? 1);
  
  let laneArrowsData = { 
      utara: [], timur: [], selatan: [], barat: [] 
  };

  let arrowsConfig = opts.arrowsConfig || {
    Utara:  { Timur: true,  Selatan: true, Barat: true },
    Timur:  { Selatan: true, Barat: true, Utara: true },
    Selatan:{ Barat: true,  Utara: true, Timur: true },
    Barat:  { Utara: true,  Timur: true, Selatan: true }
  };

  const MOVES = [
    { id: 'UT', label: 'UT' , origin: 'Utara', to: 'Timur'  },
    { id: 'US', label: 'US' , origin: 'Utara', to: 'Selatan' },
    { id: 'UB', label: 'UB' , origin: 'Utara', to: 'Barat'   },
    { id: 'TU', label: 'TU' , origin: 'Timur', to: 'Utara'   },
    { id: 'TS', label: 'TS' , origin: 'Timur', to: 'Selatan' },
    { id: 'TB', label: 'TB' , origin: 'Timur', to: 'Barat'   },
    { id: 'SU', label: 'SU' , origin: 'Selatan', to: 'Utara'  },
    { id: 'ST', label: 'ST' , origin: 'Selatan', to: 'Timur'  },
    { id: 'SB', label: 'SB' , origin: 'Selatan', to: 'Barat'   },
    { id: 'BU', label: 'BU' , origin: 'Barat', to: 'Utara'    },
    { id: 'BT', label: 'BT' , origin: 'Barat', to: 'Timur'    },
    { id: 'BS', label: 'BS' , origin: 'Barat', to: 'Selatan'  }
  ];

  const CANVAS_W = canvas.width;   
  const CANVAS_H = canvas.height;  
  
  // Layout Spacing
  const padding = 15;
  const topMargin = 50; 
  const labelWidth = 60;           
  const barHeight = 20;            
  const gap = 12; 
  const rightPadding = 40; 

  const innerX = padding + labelWidth;
  const innerW = CANVAS_W - innerX - padding - rightPadding; 
  const totalBars = MOVES.length;
  
  // --- WARNA ESTETIK ---
  const COLOR_GREEN = '#2ecc71';
  const COLOR_YELLOW = '#ffd200';
  const COLOR_RED = '#ff6666';     // Merah Cerah (Background)
  const COLOR_ALL_RED = '#cc0000'; // Merah Standar (All Red)
  const COLOR_BG = '#ffffff';

  let lampuRef = null;
  let internalTimeAccumulator = 0; 

  // --- LISTENERS ---
  setTimeout(() => {
    const switchEl = document.getElementById('ltsorGlobalSwitch');
    if (switchEl) {
      ltor = switchEl.checked; 
      switchEl.addEventListener('change', (e) => {
        ltor = e.target.checked; 
        if (lampuRef) lampuRef.ltor = ltor; 
        draw(); 
      });
    }
  }, 500);

  document.addEventListener('laneArrowsUpdated', (e) => {
    if (e.detail && e.detail.laneArrows) {
        laneArrowsData = e.detail.laneArrows;
        draw();
    }
  });

  setInterval(() => {
      if (typeof window !== 'undefined' && window.laneArrows) {
          const globalStr = JSON.stringify(window.laneArrows);
          const localStr = JSON.stringify(laneArrowsData);
          if (globalStr !== localStr) {
              laneArrowsData = JSON.parse(globalStr);
              draw();
          }
      }
  }, 1000);

  function groupsCount() { return phaseMode === 'searah' ? 4 : 2; }
  
  function computeGreenSec() {
    const g = groupsCount();
    return Math.max(0, (cycleTotalSec / g) - allRedSec - yellowSec);
  }

  function durations() {
    return {
      hijau: computeGreenSec(),
      kuning: Number(yellowSec),
      allRed: Number(allRedSec),
      total: Number(cycleTotalSec)
    };
  }

  function phaseOrder() {
    if (phaseMode === 'searah') return ['Utara','Timur','Selatan','Barat'];
    if (phaseMode === 'berhadapan') return ['Utara','Timur']; 
    if (phaseMode === 'berseberangan') return ['Utara','Selatan']; 
    return ['Utara','Timur','Selatan','Barat'];
  }

  function allowedMovesForDirection(dir, groupIndex=null) {
    if (phaseMode === 'berhadapan') {
      if (groupIndex === 0) return new Set(['UT','US','UB', 'SU','ST','SB']);
      return new Set(['TU','TS','TB', 'BU','BT','BS']);
    }
    if (phaseMode === 'berseberangan') {
      if (groupIndex === 0) return new Set(['UT','US','UB', 'TU','TS','TB']);
      return new Set(['SU','ST','SB', 'BU','BT','BS']);
    }
    const allowed = new Set();
    MOVES.forEach(m => {
      if (m.origin === dir) {
        if (!arrowsConfig[dir]) allowed.add(m.id);
        else if (arrowsConfig[dir][m.to]) allowed.add(m.id);
      }
    });
    return allowed;
  }

  function fmt(n, d=1) { return Number(n).toFixed(d); }

  function roundRectPath(x,y,w,h,r=6) {
    const radius = Math.min(r, h/2, w/2);
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + w - radius, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
    ctx.lineTo(x + w, y + h - radius);
    ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
    ctx.lineTo(x + radius, y + h);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
  }

  // =================================================================
  // FUNGSI DRAW
  // =================================================================
  function draw() {
    ctx.fillStyle = COLOR_BG;
    ctx.fillRect(0,0,CANVAS_W,CANVAS_H);

    if (typeof window !== 'undefined' && window.laneArrows) {
        laneArrowsData = window.laneArrows;
    }

    const dur = durations();
    const groups = groupsCount();
    const perGroupTotal = dur.total / groups;
    const pxPerSec = innerW / dur.total;

    // Header
    ctx.fillStyle = '#111';
    ctx.font = '13px Arial';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(`Siklus ${cycleTotalSec}s | all-red ${allRedSec}s | kuning ${yellowSec}s | hijau ${dur.hijau.toFixed(1)}s | LTOR: ${ltor ? "ON" : "OFF"}`, padding, 18);

    const lampuState = extractLampuState();

    // Loop Baris Diagram
    for (let i = 0; i < MOVES.length; i++) {
      const m = MOVES[i];
      const y = padding + topMargin + i * (barHeight + gap);

      // Label Samping
      ctx.fillStyle = '#000';
      ctx.font = '12px Arial';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(m.id, padding, y + barHeight/2);

      // 1. LOGIKA LTOR
      let isArrowFreeLeft = false;
      const isLeftMove = (m.id === 'UT' || m.id === 'TS' || m.id === 'SB' || m.id === 'BU');
      
      if (isLeftMove) {
          const originKey = m.origin.toLowerCase();
          const arrowsOnLane = laneArrowsData[originKey] || []; 
          let hasExactLeftArrow = false;

          if (Array.isArray(arrowsOnLane)) {
              hasExactLeftArrow = arrowsOnLane.some(val => val === 'left');
          } else if (typeof arrowsOnLane === 'object' && arrowsOnLane !== null) {
              hasExactLeftArrow = Object.values(arrowsOnLane).some(val => val === 'left');
          }

          if (ltor && hasExactLeftArrow) {
              isArrowFreeLeft = true;
          }
      }

      // 2. GAMBAR BACKGROUND
      ctx.save(); 
      roundRectPath(innerX, y, innerW, barHeight, 6);
      ctx.clip(); 

      if (isArrowFreeLeft) {
          // Background Hijau (Jalan Terus)
          ctx.fillStyle = COLOR_GREEN;
          ctx.fillRect(innerX, y, innerW, barHeight);
      } else {
          // Background Merah Cerah (Normal)
          ctx.fillStyle = COLOR_RED; 
          ctx.fillRect(innerX, y, innerW, barHeight);

          // 3. LOOP SEGMEN WAKTU
          let groupCursorSec = 0;
          const order = phaseOrder();

          for (let g = 0; g < groups; g++) {
            const pxARstart = innerX + groupCursorSec * pxPerSec;
            const pxARw = Math.max(1, dur.allRed * pxPerSec);
            const pxGstart = pxARstart + pxARw;
            const pxGw = Math.max(0, dur.hijau * pxPerSec);
            const pxYstart = pxGstart + pxGw;
            const pxYw = Math.max(0, dur.kuning * pxPerSec);

            const dir = order[g % order.length];
            const allowed = allowedMovesForDirection(dir, g);

            // Gambar All-Red (Merah Tua)
            ctx.fillStyle = COLOR_ALL_RED;
            ctx.fillRect(pxARstart, y, Math.ceil(pxARw), barHeight);

            if (allowed.has(m.id)) {
              // Hijau
              if (pxGw > 0) {
                ctx.fillStyle = COLOR_GREEN;
                ctx.fillRect(pxGstart, y, Math.ceil(pxGw), barHeight);
              }
              // Kuning
              if (pxYw > 0) {
                ctx.fillStyle = COLOR_YELLOW;
                ctx.fillRect(pxYstart, y, Math.ceil(pxYw), barHeight);
              }
            } else {
              // Faded Red
              if (m.origin === dir) {
                const fadedW = pxGw + pxYw;
                if (fadedW > 0) {
                  ctx.fillStyle = COLOR_RED; 
                  ctx.globalAlpha = 0.5;
                  ctx.fillRect(pxGstart, y, Math.ceil(fadedW), barHeight);
                  ctx.globalAlpha = 1.0;
                }
              }
            }
            
            // Garis Pembatas Fase
            const phaseEndX = innerX + (groupCursorSec + perGroupTotal) * pxPerSec;
            ctx.beginPath();
            ctx.moveTo(phaseEndX, y);
            ctx.lineTo(phaseEndX, y + barHeight);
            ctx.lineWidth = 1;
            ctx.strokeStyle = '#eee';
            ctx.stroke();

            groupCursorSec += perGroupTotal;
          }
      }
      
      ctx.restore(); 

      // Border Luar
      ctx.lineWidth = 1;
      ctx.strokeStyle = '#ccc';
      roundRectPath(innerX, y, innerW, barHeight, 6);
      ctx.stroke();

      // Teks Status
      ctx.font = '11px Arial';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#000000';

      let statusText = 'RED';
      const isActiveNormal = isMoveActiveNow(m.id, lampuState);
      
      if (isArrowFreeLeft) {
          statusText = 'JALAN TERUS';
      } else if (isActiveNormal) {
          statusText = `AKTIF (${lampuState?.fase ?? '-'})`;
      }
      ctx.fillText(statusText, innerX + innerW/2, y + barHeight/2);

      // Highlight Border
      if (isArrowFreeLeft || (lampuState && lampuState.fase === 'hijau')) {
        const allowedNow = allowedMovesForDirection(lampuState?.dir);
        if (isArrowFreeLeft || (allowedNow && allowedNow.has(m.id))) {
          ctx.strokeStyle = '#333';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(innerX, y);
          ctx.lineTo(innerX + innerW, y);
          ctx.stroke();
        }
      }
    } // End Loop MOVES

    // Ruler & Ticks (Digambar di posisi Y yang aman)
    // 15px jarak dari baris terakhir
    const rulerY = padding + topMargin + MOVES.length * (barHeight + gap) + 15; 
    
    ctx.strokeStyle = '#666';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(innerX, rulerY);
    ctx.lineTo(innerX + innerW, rulerY);
    ctx.stroke();
    
    ctx.font = '10px Arial';
    ctx.fillStyle = '#333';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    for (let t = 0; t <= 6; t++) {
      const sec = (t / 6) * dur.total;
      const x = innerX + sec * pxPerSec;
      ctx.beginPath();
      ctx.moveTo(x, rulerY);
      ctx.lineTo(x, rulerY + 6);
      ctx.stroke();
      ctx.fillText(`${Math.round(sec)}s`, x, rulerY + 18);
    }

    // Cursor Waktu Berjalan
    if (lampuState && lampuState.waktuFase != null) {
      const order = phaseOrder();
      const currentDir = lampuState.dir.charAt(0).toUpperCase() + lampuState.dir.slice(1).toLowerCase();
      
      let groupIndexForCursor = 0;
      if (phaseMode === 'searah') {
          const map = {Utara:0, Timur:1, Selatan:2, Barat:3};
          groupIndexForCursor = map[currentDir] ?? 0;
      } 
      else if (phaseMode === 'berhadapan') {
          if (currentDir === 'Utara' || currentDir === 'Selatan') groupIndexForCursor = 0;
          else groupIndexForCursor = 1;
      } 
      else if (phaseMode === 'berseberangan') {
          if (currentDir === 'Utara' || currentDir === 'Timur') groupIndexForCursor = 0;
          else groupIndexForCursor = 1;
      }

      const groupStartSec = groupIndexForCursor * (dur.total / groups);
      let phaseStartOffsetSec = 0;
      if (lampuState.fase === 'hijau') phaseStartOffsetSec = dur.allRed;
      else if (lampuState.fase === 'kuning') phaseStartOffsetSec = dur.allRed + dur.hijau;
      
      const phaseElapsedSec = lampuState.waktuFase;
      const absSec = groupStartSec + phaseStartOffsetSec + phaseElapsedSec;
      const markerX = innerX + (absSec % dur.total) * (innerW / dur.total);
      
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(markerX, padding + 30); 
      ctx.lineTo(markerX, rulerY);
      ctx.stroke();
      
      // Label Cursor Pintar
      ctx.font = '11px Arial';
      ctx.fillStyle = '#000';
      
      // Default: Center
      ctx.textAlign = 'center';
      let labelX = markerX;

      // Jika mepet kanan, align right
      if (markerX > CANVAS_W - 100) {
          ctx.textAlign = 'right';
          labelX = markerX - 5; 
      } 
      // Jika mepet kiri, align left
      else if (markerX < 100) {
          ctx.textAlign = 'left';
          labelX = markerX + 5;
      }

      let labelText = '';
      if (lampuState.fase !== 'allRed') {
          labelText = `${lampuState.labelDir} ${lampuState.fase} ${fmt(lampuState.waktuFase, 1)}s`;
      } else {
          labelText = `All Red ${fmt(lampuState.waktuFase, 1)}s`;
      }

      ctx.fillText(labelText, labelX, padding + 25);
    }
    
    // Footer Text (Dipindah lebih ke bawah lagi, aman dari tumpang tindih)
    // 40px di bawah ruler
    const footerY = rulerY + 40;
    
    ctx.textAlign = 'left';
    ctx.fillStyle = '#000';
    const totalGreen = dur.hijau * groups;
    const eff = ((totalGreen / cycleTotalSec) * 100).toFixed(1);
    ctx.fillText(`Cycle ${fmt(cycleTotalSec,0)}s | Total Green ${fmt(totalGreen,0)}s | Eff ${eff}%`, padding, footerY);
  }

  function isMoveActiveNow(moveId, lampuState) {
    if (!lampuState || !lampuState.dir || lampuState.fase !== 'hijau') return false;
    const currentDir = lampuState.dir.charAt(0).toUpperCase() + lampuState.dir.slice(1).toLowerCase();
    let groupIdx = 0;
    if (phaseMode === 'searah') {
        const map = {Utara:0, Timur:1, Selatan:2, Barat:3};
        groupIdx = map[currentDir] ?? 0;
    } else if (phaseMode === 'berhadapan') {
        if (currentDir === 'Utara' || currentDir === 'Selatan') groupIdx = 0;
        else groupIdx = 1;
    } else if (phaseMode === 'berseberangan') {
        if (currentDir === 'Utara' || currentDir === 'Timur') groupIdx = 0;
        else groupIdx = 1;
    }
    const allowed = allowedMovesForDirection(currentDir, groupIdx);
    return allowed.has(moveId);
  }

  function extractLampuState() {
    if (!lampuRef) return null;
    try {
      if (lampuRef.durasi && typeof lampuRef.durasi === 'object') {
          const d = lampuRef.durasi;
          if (d.total) cycleTotalSec = d.total > 1000 ? d.total/1000 : Number(d.total);
          if (d.allRed) allRedSec = d.allRed > 1000 ? d.allRed/1000 : Number(d.allRed);
          if (d.kuning) yellowSec = d.kuning > 1000 ? d.kuning/1000 : Number(d.kuning);
      }
      if (typeof lampuRef.ltor !== 'undefined') ltor = Boolean(lampuRef.ltor);
      if (lampuRef.phaseMode) phaseMode = lampuRef.phaseMode;

      const switchEl = document.getElementById('ltsorGlobalSwitch');
      if (switchEl) ltor = switchEl.checked;

      const orderRaw = lampuRef.urutan || ['utara','timur','selatan','barat'];
      const idx = lampuRef.indexAktif || 0;
      const rawCombined = String(orderRaw[idx % orderRaw.length] || 'utara');
      
      const rawSingle = rawCombined.split(',')[0].trim(); 
      const dirMap = { utara:'Utara', north:'Utara', timur:'Timur', east:'Timur', selatan:'Selatan', south:'Selatan', barat:'Barat', west:'Barat' };
      const dir = dirMap[String(rawSingle).toLowerCase()] ?? (rawSingle[0]?.toUpperCase?.() + rawSingle.slice(1));
      
      let labelDir = dir;
      if (rawCombined.includes(',')) {
          labelDir = rawCombined.split(',')
              .map(d => {
                  const clean = d.trim().toLowerCase();
                  return dirMap[clean] || (clean.charAt(0).toUpperCase() + clean.slice(1));
              })
              .join(' & ');
      }

      const fase = lampuRef.fase || lampuRef.phase || 'allRed';
      
      let waktuFase = lampuRef.waktuFase ?? lampuRef.elapsed ?? 0;
      if (typeof waktuFase === 'number') waktuFase /= 1000.0;
      else waktuFase = Number(waktuFase) || 0;

      return { dir, labelDir, fase: lampuRef.fase || 'allRed', waktuFase, dur: durations() };
    } catch (e) {
      return null;
    }
  }

  function update(deltaMs) { internalTimeAccumulator += (deltaMs * simSpeed); }
  function setParams(total, ar, y) { cycleTotalSec=Number(total); allRedSec=Number(ar); yellowSec=Number(y); }
  function setPhaseMode(m) { if(['searah','berhadapan','berseberangan'].includes(m)) phaseMode = m; }
  function setSimSpeed(v) { simSpeed = Number(v); }
  function syncWithLampu(i) { lampuRef = i; }
  function syncStopLineConfig(c) { stopLineCfg = c; }
  function resetCycleDiagram() { internalTimeAccumulator = 0; }
  function setArrowsConfig(c) { arrowsConfig = c; }
  function setLaneArrows(d) { if(d) { laneArrowsData = d; draw(); } }
  function setLTOR(v) { ltor = Boolean(v); draw(); }

  draw();

  return {
    update, draw, setParams, setPhaseMode, setSimSpeed, syncWithLampu,
    syncStopLineConfig, resetCycleDiagram, setArrowsConfig, setLaneArrows, setLTOR
  };
}