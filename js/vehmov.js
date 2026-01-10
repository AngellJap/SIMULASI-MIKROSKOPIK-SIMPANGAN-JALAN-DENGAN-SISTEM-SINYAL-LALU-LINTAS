// vehmov.js (dua-titik axle model: rear & front mengikuti path — truk seperti gerbong)
// REVISI: 
// 1. Integrasi Saklar Debug (Toggle Visual).
// 2. Optimasi Culling (Tidak gambar debug object di luar layar).
// 3. Perbaikan sinkronisasi poros depan/belakang agar titik putih tidak "nge-jerk".

import { SpeedLogger } from "./SpeedLogger.js";

export function createVehMovController(options = {}) {
  const config = options.config || {};
  const laneCoordinates = options.laneCoordinates || { entry: {}, exit: {} };
  const exitLaneNumbers = options.exitLaneNumbers || {};
  let trafficConfig = options.trafficConfig || {};
  const laneArrows = options.laneArrows || {};
  // per-lane traffic config (opsional, dikirim dari main.js)
  // Struktur: { utara: [{flow, motorPct, mobilPct, trukPct}, ...], timur: [...], selatan: [...], barat: [...] }
  let laneTrafficConfig = options.laneTrafficConfig || { utara: [], timur: [], selatan: [], barat: [] };
  const canvasSize = options.canvasSize || { width: 800, height: 800 };
  const cx = canvasSize.width / 2;
  const cy = canvasSize.height / 2;
  const centerRadius = 150; // area tengah simpang
  const ANGLE_ADJUST = Math.PI;

  const truckWheelbaseMeters = options.truckWheelbaseMeters ?? 5.8;
  const truckLengthMeters = options.truckLengthMeters ?? 12.0;
  const truckFrontOverhangMeters = options.truckFrontOverhangMeters ?? 1.0;
  const truckRearOverhangMeters = options.truckRearOverhangMeters ?? 0;
  const truckAxleSpacing = options.truckAxleSpacing || { frontToFirstRear: 9.8, firstRearToSecondRear: 1.3 };

  // debug box scale: default 1 => gunakan ukuran penuh kendaraan (1:1)
  const DEBUG_BOX_SCALE = (typeof options.debugBoxScale === 'number') ? options.debugBoxScale : 1.0;

  // apakah auto-rotate kotak bila sprite tidak bedakan depan/belakang (default true)
  const AUTO_ROTATE_SYMMETRIC_BOX = (typeof options.autoRotateSymmetricBox === 'boolean') ? options.autoRotateSymmetricBox : true;

  // spawn margin (berapa jauh dari tepi canvas kendaraan mulai)
  const SPAWN_MARGIN = (typeof options.spawnMargin === 'number') ? options.spawnMargin : 1500;

  // minimum spawn interval (ms). default 3000 ms (3s). Can be overridden via options.minSpawnIntervalSec or options.minSpawnIntervalMs
  let _minSpawnIntervalMs = (typeof options.minSpawnIntervalMs === 'number') ? Math.max(0, Math.round(options.minSpawnIntervalMs)) : ((typeof options.minSpawnIntervalSec === 'number') ? Math.max(0, Math.round(options.minSpawnIntervalSec * 1000)) : 3500);

  function setMinSpawnIntervalSec(sec) { _minSpawnIntervalMs = Math.max(0, Math.round(Number(sec) * 1000)); }
  function getMinSpawnIntervalSec() { return _minSpawnIntervalMs / 1000; }

  // ---------- Laser config (dapat di-override via options) ----------
  const LASER_LENGTH_PX = (typeof options.laserLengthPx === 'number') ? options.laserLengthPx : 30;
  const LASER_SAFE_STOP_PX = (typeof options.laserSafeStopPx === 'number') ? options.laserSafeStopPx : 15;
  const LASER_DRAW_ENABLED = (typeof options.laserDraw === 'boolean') ? options.laserDraw : true;

  // ---------- unit conversion helpers (10 px = 1 m) ----------
  const PX_PER_M = (typeof options.pxPerMeter === 'number') ? options.pxPerMeter : 10;

  // default sample spacing (px) — bisa disesuaikan
  const DEFAULT_SAMPLE_SPACING_PX = Math.max(4, Math.round(PX_PER_M * 0.5)); // ~0.5 m

  // helper konversi: m/s -> px/ms ; m/s^2 -> px/ms^2
  function mps_to_px_per_ms(v_mps) { return (v_mps * PX_PER_M) / 1000; }
  function mps2_to_px_per_ms2(a_mps2) { return (a_mps2 * PX_PER_M) / 1_000_000; }

  // default physical tuning (dalam m/s^2 kemudian dikonversi)
  const DEFAULT_ACCEL_MPS2 = (typeof options.accelMps2 === 'number') ? options.accelMps2 : 1.5; // ~comfortable accel
  const DEFAULT_BRAKE_MPS2 = (typeof options.brakeMps2 === 'number') ? options.brakeMps2 : 4.0; // emergency-ish decel
  const DEFAULT_ACCEL = mps2_to_px_per_ms2(DEFAULT_ACCEL_MPS2);
  const DEFAULT_BRAKE_DECEL = mps2_to_px_per_ms2(DEFAULT_BRAKE_MPS2);

  // reaction time (ms)
  const DEFAULT_REACTION_MS = (typeof options.reactionTimeMs === 'number') ? options.reactionTimeMs : 1200;

  // detection range (in px) default ~ 50 m -> 50 * PX_PER_M
  const DETECTION_RANGE = (typeof options.detectionRange === 'number') ? options.detectionRange : (50 * PX_PER_M);

  // desired gap (px)
  const DESIRED_GAP = (typeof options.desiredGap === 'number') ? options.desiredGap : (1.5 * PX_PER_M); // 1.5 m

  const vehicles = [];
  const nextSpawnTimes = { utara: 0, timur: 0, selatan: 0, barat: 0 };
  let nextId = 1;

  function nowMs() { return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now(); }
  function skalaPx() { return (config.skala_px || 10) * 3; }

  function normalize(v) {
    const L = Math.hypot(v.x || 0, v.y || 0);
    if (L <= 1e-9) return { x: 1, y: 0 };
    return { x: v.x / L, y: v.y / L };
  }

  function dot(a, b) { return a.x * b.x + a.y * b.y; }
  function sub(a, b) { return { x: a.x - b.x, y: a.y - b.y }; }
  function add(a, b) { return { x: a.x + b.x, y: a.y + b.y }; }
  function mul(a, s) { return { x: a.x * s, y: a.y * s }; }

  // ---------- REVISI PENTING: Shifted Exponential Distribution ----------
  function getExponentialInterval(flowPerHour) {
    if (!flowPerHour || flowPerHour <= 0) return Infinity;

    const meanSeconds = 3600 / flowPerHour;
    const meanMs = meanSeconds * 1000;

    if (meanMs <= _minSpawnIntervalMs) {
      return _minSpawnIntervalMs;
    }

    const adjustedMeanMs = meanMs - _minSpawnIntervalMs;
    const u = Math.random();
    const randomPartMs = -Math.log(1 - u) * adjustedMeanMs;

    return _minSpawnIntervalMs + randomPartMs;
  }

  function spawnPositionFor(arah, laneIndexZeroBased) {
    const s = skalaPx();
    const offset = (laneIndexZeroBased + 0.5) * s;
    let x = 0, y = 0, vx = 0, vy = 0;
    switch (arah) {
      case 'utara':
        x = canvasSize.width / 2 + offset;
        y = -SPAWN_MARGIN;
        vx = 0; vy = 1;
        break;
      case 'timur':
        x = canvasSize.width + SPAWN_MARGIN;
        y = canvasSize.height / 2 + offset;
        vx = -1; vy = 0;
        break;
      case 'selatan':
        x = canvasSize.width / 2 - offset;
        y = canvasSize.height + SPAWN_MARGIN;
        vx = 0; vy = -1;
        break;
      case 'barat':
        x = -SPAWN_MARGIN;
        y = canvasSize.height / 2 - offset;
        vx = 1; vy = 0;
        break;
      default:
        x = canvasSize.width / 2; y = -SPAWN_MARGIN; vx = 0; vy = 1;
    }
    return { x, y, vx, vy };
  }

  // ---------- SPAWN RADAR: per-lajur (pause berdasarkan jarak antrian) ----------
  const spawnRadarConfig = Object.assign({
    radiusPx: 450,        // <--- REVISI: Diperbesar dari 300 ke 450 agar lebih aman mendeteksi antrian
    spawnIgnoreMs: 1000,  // <--- REVISI: Diperlama sedikit agar kendaraan baru sempat menjauh
    queueThreshold: 1,    // jika kendaraan (non-new) di dalam radius >= nilai ini -> pause lajur
    maxPauseMs: 30000,    // fallback: jika pause terlalu lama, otomatis unpause (ms).
  }, (options.spawnRadar || {}));

  const spawnRadars = { utara: [], timur: [], selatan: [], barat: [] };
  const spawnPauseState = { utara: [], timur: [], selatan: [], barat: [] };

  function buildSpawnRadars() {
    for (const dir of ['utara','timur','selatan','barat']) {
      spawnRadars[dir] = [];
      spawnPauseState[dir] = [];
      const laneCount = (config[dir] && config[dir].in) ? config[dir].in : 0;
      for (let li = 0; li < laneCount; li++) {
        const sp = spawnPositionFor(dir, li);
        spawnRadars[dir].push({ x: sp.x, y: sp.y, radius: spawnRadarConfig.radiusPx });
        spawnPauseState[dir].push({ paused: false, pauseStarted: 0 });
      }
    }
  }
  try { buildSpawnRadars(); } catch (e) {}

  function updateSpawnRadarsCenters() {
    for (const dir of ['utara','timur','selatan','barat']) {
      const lanes = spawnRadars[dir] || [];
      for (let li = 0; li < lanes.length; li++) {
        const sp = spawnPositionFor(dir, li);
        lanes[li].x = sp.x; lanes[li].y = sp.y;
      }
    }
  }

  function countVehiclesInRadar(dir, laneIndexZeroBased) {
    const radar = (spawnRadars[dir] && spawnRadars[dir][laneIndexZeroBased]) || null;
    if (!radar) return 0;
    const r2 = radar.radius * radar.radius;
    const now = nowMs();
    let cnt = 0;
    for (const v of vehicles) {
      if (v.direction !== dir) continue;
      if ((v.laneIndex - 1) !== laneIndexZeroBased) continue;
      // ignore kendaraan baru lahir
      if (typeof v.createdAt === 'number' && (now - v.createdAt) <= spawnRadarConfig.spawnIgnoreMs) continue;
      
      const dx = v.x - radar.x, dy = v.y - radar.y;
      if ((dx*dx + dy*dy) <= r2) cnt++;
    }
    return cnt;
  }

  // UTAMA: update tiap frame — jika cnt >= queueThreshold -> paused true.
  function updateSpawnRadars(now = null) {
    const tnow = now === null ? nowMs() : now;
    for (const dir of ['utara','timur','selatan','barat']) {
      const lanes = spawnRadars[dir] || [];
      for (let li = 0; li < lanes.length; li++) {
        let state = spawnPauseState[dir][li] || { paused: false, pauseStarted: 0 };
        const cnt = countVehiclesInRadar(dir, li);
        
        // trigger pause jika belum paused dan cnt >= threshold
        if (!state.paused && cnt >= spawnRadarConfig.queueThreshold) {
          state.paused = true;
          state.pauseStarted = tnow;
        }
        // jika sudah paused, cek kondisi resume: cnt < threshold -> unpause
        if (state.paused) {
          if (cnt < spawnRadarConfig.queueThreshold) {
            state.paused = false;
            state.pauseStarted = 0;
          } else if (spawnRadarConfig.maxPauseMs && (tnow - (state.pauseStarted || 0)) > spawnRadarConfig.maxPauseMs) {
            // fallback safety
            state.paused = false;
            state.pauseStarted = 0;
          }
        }
        spawnPauseState[dir][li] = state;
      }
    }
  }

  function isLanePaused(dir, laneIndexZeroBased) {
    const s = (spawnPauseState[dir] && spawnPauseState[dir][laneIndexZeroBased]);
    return !!(s && s.paused);
  }

  function setSpawnRadarOptions(opts = {}) {
    Object.assign(spawnRadarConfig, opts);
    if (typeof opts.radiusPx === 'number') {
      for (const dir of ['utara','timur','selatan','barat']) {
        const lanes = spawnRadars[dir] || [];
        for (const r of lanes) r.radius = spawnRadarConfig.radiusPx;
      }
    }
  }

  // ---------- geometry helpers ----------
  function linePointAt(t, p0, p1) { return { x: p0.x + (p1.x - p0.x) * t, y: p0.y + (p1.y - p0.y) * t }; }
  function lineTangent(p0, p1) { return { x: p1.x - p0.x, y: p1.y - p0.y }; }
  function lineLength(p0, p1) { return Math.hypot(p1.x - p0.x, p1.y - p0.y); }

  // helper: sample points along an edge p0->p1 with approx spacing spacingPx
  function sampleEdgePoints(p0, p1, spacingPx = DEFAULT_SAMPLE_SPACING_PX, maxSamples = 200) {
    const dx = p1.x - p0.x, dy = p1.y - p0.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) return [{ x: p0.x, y: p0.y }];
    const n = Math.min(maxSamples, Math.max(1, Math.floor(len / Math.max(1, spacingPx))));
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      pts.push({ x: p0.x + dx * t, y: p0.y + dy * t });
    }
    return pts;
  }

  // Quadratic
  function bezierPoint(t, p0, p1, p2) {
    const u = 1 - t;
    return {
      x: u * u * p0.x + 2 * u * t * p1.x + t * t * p2.x,
      y: u * u * p0.y + 2 * u * t * p1.y + t * t * p2.y
    };
  }
  function bezierTangent(t, p0, p1, p2) {
    return {
      x: 2 * (1 - t) * (p1.x - p0.x) + 2 * t * (p2.x - p1.x),
      y: 2 * (1 - t) * (p1.y - p0.y) + 2 * t * (p2.y - p1.y)
    };
  }
  function bezierLength(p0, p1, p2, segments = 40) {
    let length = 0; let prev = p0;
    for (let i = 1; i <= segments; i++) {
      const t = i / segments;
      const pt = bezierPoint(t, p0, p1, p2);
      length += Math.hypot(pt.x - prev.x, pt.y - prev.y);
      prev = pt;
    }
    return length;
  }

  // Cubic
  function cubicPoint(t, p0, p1, p2, p3) {
    const u = 1 - t;
    const u3 = u * u * u;
    const t3 = t * t * t;
    return {
      x: u3 * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t3 * p3.x,
      y: u3 * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t3 * p3.y
    };
  }
  function cubicTangent(t, p0, p1, p2, p3) {
    const u = 1 - t;
    return {
      x: 3 * u * u * (p1.x - p0.x) + 6 * u * t * (p2.x - p1.x) + 3 * t * t * (p3.x - p2.x),
      y: 3 * u * u * (p1.y - p0.y) + 6 * u * t * (p2.y - p1.y) + 3 * t * t * (p3.y - p2.y)
    };
  }
  function cubicLength(p0, p1, p2, p3, segments = 80) {
    let length = 0; let prev = p0;
    for (let i = 1; i <= segments; i++) {
      const t = i / segments;
      const pt = cubicPoint(t, p0, p1, p2, p3);
      length += Math.hypot(pt.x - prev.x, pt.y - prev.y);
      prev = pt;
    }
    return length;
  }

  // ---------- path-of-segments helpers ----------
  function segmentLength(seg) {
    if (seg.type === 'line') return lineLength(seg.p0, seg.p1);
    if (seg.type === 'quadratic') return bezierLength(seg.p0, seg.p1, seg.p2);
    if (seg.type === 'cubic') return cubicLength(seg.p0, seg.p1, seg.p2, seg.p3);
    return 0;
  }
  function segmentPointAndTangentAt(seg, t) {
    if (seg.type === 'line') {
      const pt = linePointAt(t, seg.p0, seg.p1);
      const tan = lineTangent(seg.p0, seg.p1);
      return { p: pt, tan };
    }
    if (seg.type === 'quadratic') {
      const pt = bezierPoint(t, seg.p0, seg.p1, seg.p2);
      const tan = bezierTangent(t, seg.p0, seg.p1, seg.p2);
      return { p: pt, tan };
    }
    if (seg.type === 'cubic') {
      const pt = cubicPoint(t, seg.p0, seg.p1, seg.p2, seg.p3);
      const tan = cubicTangent(t, seg.p0, seg.p1, seg.p2, seg.p3);
      return { p: pt, tan };
    }
    return { p: { x: 0, y: 0 }, tan: { x: 0, y: 0 } };
  }

     function buildPathFromSegments(segments) {
    // compute segment lengths (approx) AND build per-segment arc-length lookup tables
    const segLens = [];
    const segTables = [];
    let total = 0;
    for (let si = 0; si < segments.length; si++) {
      const seg = segments[si];
      // choose number of samples proportional to segment length (fallback to 40)
      const approxLen = segmentLength(seg) || 0;
      const samples = Math.max(12, Math.min(200, Math.round(approxLen / Math.max(1, DEFAULT_SAMPLE_SPACING_PX))));
      // build arc-length table for this segment
      const ts = [];
      const arc = [];
      let prev = segmentPointAndTangentAt(seg, 0).p;
      let cum = 0;
      ts.push(0); arc.push(0);
      for (let k = 1; k <= samples; k++) {
        const t = k / samples;
        const pt = segmentPointAndTangentAt(seg, t).p;
        const d = Math.hypot(pt.x - prev.x, pt.y - prev.y);
        cum += d;
        ts.push(t);
        arc.push(cum);
        prev = pt;
      }
      const segLen = cum;
      segLens.push(segLen);
      segTables.push({ ts, arc, segLen });
      total += segLen;
    }
    const cum = [];
    let s = 0;
    for (let i = 0; i < segLens.length; i++) { cum.push(s); s += segLens[i]; }
    return { segments, segLens, totalLength: total, cumStart: cum, segTables };
  }

    function pathPointAndTangentAtDistance(path, dist) {
    if (!path || path.totalLength <= 0) return { p: { x: 0, y: 0 }, tan: { x: 1, y: 0 } };
    const d = Math.max(0, Math.min(dist, path.totalLength));
    // find segment index the same as previous logic
    let segIdx = path.segments.length - 1;
    for (let i = 0; i < path.segments.length; i++) {
      if (d <= (path.cumStart[i] || 0) + (path.segLens[i] || 0) || i === path.segments.length - 1) { segIdx = i; break; }
    }
    const seg = path.segments[segIdx];
    const segStart = path.cumStart[segIdx] || 0;
    const segLen = path.segLens[segIdx] || 1;
    const localD = Math.max(0, Math.min(d - segStart, segLen));

    // If we have a precomputed table, invert arc-length -> t using binary search + linear interp
    if (path.segTables && path.segTables[segIdx]) {
      const table = path.segTables[segIdx];
      const arc = table.arc;
      const ts = table.ts;
      if (localD <= 0) return segmentPointAndTangentAt(seg, 0);
      if (localD >= table.segLen) return segmentPointAndTangentAt(seg, 1);
      // binary search first index with arc[idx] >= localD
      let lo = 0, hi = arc.length - 1;
      while (lo < hi) {
        const mid = Math.floor((lo + hi) / 2);
        if (arc[mid] < localD) lo = mid + 1; else hi = mid;
      }
      const j = lo;
      const a1 = (j > 0) ? arc[j - 1] : 0;
      const a2 = arc[j];
      const t1 = (j > 0) ? ts[j - 1] : 0;
      const t2 = ts[j];
      const frac = (a2 - a1) > 1e-9 ? ((localD - a1) / (a2 - a1)) : 0;
      const t = Math.max(0, Math.min(1, t1 + (t2 - t1) * frac));
      return segmentPointAndTangentAt(seg, t);
    }

    // fallback: proportional param (older behavior)
    const t = segLen > 0 ? ((localD) / segLen) : 0;
    return segmentPointAndTangentAt(seg, Math.max(0, Math.min(1, t)));
  }

  function findClosestDistanceOnPathToPoint(path, p, samplesPerSeg = 40) {
    if (!path || path.totalLength <= 0) return { dist: 0, pt: pathPointAndTangentAtDistance(path, 0).p, pathD: 0 };
    let best = { dist2: Infinity, pathD: 0, pt: null };
    for (let si = 0; si < path.segments.length; si++) {
      const seg = path.segments[si];
      const segLen = path.segLens[si];
      const segStartD = path.cumStart[si];
      const samples = Math.max(6, Math.round(samplesPerSeg * (segLen / Math.max(1e-6, path.totalLength))));
      for (let i = 0; i <= samples; i++) {
        const t = i / samples;
        const { p: pp } = segmentPointAndTangentAt(seg, t);
        const d2 = (pp.x - p.x) ** 2 + (pp.y - p.y) ** 2;
        if (d2 < best.dist2) {
          best.dist2 = d2;
          const dAlong = segStartD + t * segLen;
          best.pathD = dAlong;
          best.pt = pp;
        }
      }
    }
    const refineRange = Math.max(0.002 * path.totalLength, 0.1);
    const left = Math.max(0, best.pathD - refineRange);
    const right = Math.min(path.totalLength, best.pathD + refineRange);
    const refineSteps = 30;
    for (let i = 0; i <= refineSteps; i++) {
      const dtest = left + (right - left) * (i / refineSteps);
      const { p: pt } = pathPointAndTangentAtDistance(path, dtest);
      const d2 = (pt.x - p.x) ** 2 + (pt.y - p.y) ** 2;
      if (d2 < best.dist2) { best.dist2 = d2; best.pathD = dtest; best.pt = pt; }
    }
    return { dist: Math.sqrt(best.dist2), pathD: best.pathD, pt: best.pt };
  }

  // ---------- direction helpers ----------
  function defaultAngleForDirection(dir) {
    if (dir === "utara") return Math.PI;
    if (dir === "timur") return -Math.PI / 2;
    if (dir === "barat") return Math.PI / 2;
    return 0;
  }

  const dirOrder = ['utara', 'timur', 'selatan', 'barat'];
  function exitDirectionFor(entryDir, turn) {
    const i = dirOrder.indexOf(entryDir);
    if (i < 0) return null;
    if (turn === 'left') return dirOrder[(i + 1) % 4];
    if (turn === 'right') return dirOrder[(i + 3) % 4];
    if (turn === 'straight') return dirOrder[(i + 2) % 4];
    return null;
  }
  function dirFromKey(key) { if (!key || typeof key !== 'string') return null; return key.split('_')[0]; }

   function findExitPoint(exitDir, preferredExitLaneIndex, fromLaneIndex) {
    const exitMap = laneCoordinates.exit || {};
    const keys = Object.keys(exitMap).filter(k => k.startsWith(exitDir + "_"));
    if (keys.length === 0) return null;
    const candidates = keys.map(k => {
      const parts = k.split('_');
      const idx = parts.length > 1 ? parseInt(parts[1], 10) : null;
      return { key: k, idx: idx, point: exitMap[k] };
    }).filter(c => c.point && typeof c.point.x === 'number' && typeof c.point.y === 'number');
    if (candidates.length === 0) return null;
    if (typeof preferredExitLaneIndex === 'string' && laneCoordinates.exit[preferredExitLaneIndex]) {
      return laneCoordinates.exit[preferredExitLaneIndex];
    }
    if (preferredExitLaneIndex != null) {
      const pref = Number(preferredExitLaneIndex);
      const exact = candidates.find(c => c.idx === pref);
      if (exact) return exact.point;
    }
    if (fromLaneIndex != null) {
      const same = candidates.find(c => c.idx === Number(fromLaneIndex));
      if (same) return same.point;
      let best = candidates[0]; let bestDist = Math.abs((best.idx || 0) - Number(fromLaneIndex));
      for (const c of candidates) {
        const d = Math.abs((c.idx || 0) - Number(fromLaneIndex));
        if (d < bestDist) { best = c; bestDist = d; }
      }
      return best.point;
    }
    return candidates[0].point;
  }

  // ---------- control point generators ----------
  function computeCubicForStraight(entry, exit) {
    if (!entry || !exit) return null;
    const dx = exit.x - entry.x;
    const dy = exit.y - entry.y;
    const absDx = Math.abs(dx);
    const absDy = Math.abs(dy);
    const dist = Math.hypot(dx, dy);
    if (dist < 1e-3) return null;
    if (absDx >= absDy) {
      const midX = (entry.x + exit.x) / 2;
      const p1 = { x: midX, y: entry.y };
      const p2 = { x: midX, y: exit.y };
      return [p1, p2];
    } else {
      const midY = (entry.y + exit.y) / 2;
      const p1 = { x: entry.x, y: midY };
      const p2 = { x: exit.x,  y: midY };
      return [p1, p2];
    }
  }

  function computeQuadraticControlPoint(entry, exit, entryDir, exitDir) {
    if (!entry || !exit) return null;
    if (entryDir === exitDir) return null;
    let px = null, py = null;
    if (entryDir === 'utara' || entryDir === 'selatan') px = entry.x; else py = entry.y;
    if (exitDir === 'utara' || exitDir === 'selatan') px = exit.x; else py = exit.y;
    if (px == null) px = entry.x ?? exit.x ?? 0;
    if (py == null) py = entry.y ?? exit.y ?? 0;
    return { x: px, y: py };
  }

  function wheelbaseForType(type) {
    if (type === 'truk') return truckWheelbaseMeters * PX_PER_M;
    if (type === 'motor') return 1.3 * PX_PER_M;
    return 2.65 * PX_PER_M;
  }

  // Build off-canvas end point given exitDir and exit tangent (tangent colinear)
  function offCanvasPointForDirAlongTangent(exitPoint, exitTan) {
    const unit = normalize(exitTan);
    const canvasDiag = Math.hypot(canvasSize.width, canvasSize.height);
    const offDist = canvasDiag * 1.5 + 200;
    return { x: exitPoint.x + unit.x * offDist, y: exitPoint.y + unit.y * offDist };
  }

  // ---------- assign exit & build continuous path ----------
  function assignExitAndControlForVehicle(v) {
    if (v.turning || v.blend) return;
    v.path = null;

    const entryKey = `${v.direction}_${v.laneIndex}`;
    const entry = laneCoordinates.entry[entryKey];
    if (!entry) return;

    const route = v.route || 'straight';
    let exitDir = null;

    if (route === 'straight') 
        exitDir = exitDirectionFor(v.direction, 'straight');
    else 
        exitDir = exitDirectionFor(v.direction, route);
    
    if (!exitDir) return;

    let exitPoint = laneCoordinates.exit[`${exitDir}_${v.laneIndex}`] || null;
    if (!exitPoint) 
        exitPoint = findExitPoint(exitDir, v.exitLane, v.laneIndex);

    if (!exitPoint) {
        const allExitKeys = Object.keys(laneCoordinates.exit || {});
        for (const k of allExitKeys) {
            const d = dirFromKey(k);
            if (d && d !== v.direction) { 
                exitPoint = laneCoordinates.exit[k]; 
                exitDir = d; 
                break; 
            }
        }
    }

    if (!exitPoint) return;

    // ⭐⭐⭐ PATCH WAJIB — letakkan di sini ⭐⭐⭐
    // Simpan arah keluar yang benar (Utara/Timur/Selatan/Barat)
    v.exitDir = exitDir;
    // ⭐⭐⭐ END PATCH ⭐⭐⭐

    // --- lanjutan kode asli Anda ---
    let maneuverSeg = null;
    if (route === 'straight') {
        const cps = computeCubicForStraight(entry, exitPoint);
        if (cps && cps.length === 2) {
            maneuverSeg = { type: 'cubic', p0: entry, p1: cps[0], p2: cps[1], p3: exitPoint };
        } else {
            maneuverSeg = { type: 'line', p0: entry, p1: exitPoint };
        }
    } else {
        const cp = computeQuadraticControlPoint(entry, exitPoint, v.direction, exitDir);
        if (cp) 
            maneuverSeg = { type: 'quadratic', p0: entry, p1: cp, p2: exitPoint };
        else 
            maneuverSeg = { type: 'line', p0: entry, p1: exitPoint };
    }

    let exitTan = null;
    if (maneuverSeg.type === 'cubic') {
        exitTan = cubicTangent(1, maneuverSeg.p0, maneuverSeg.p1, maneuverSeg.p2, maneuverSeg.p3);
    } else if (maneuverSeg.type === 'quadratic') {
        exitTan = bezierTangent(1, maneuverSeg.p0, maneuverSeg.p1, maneuverSeg.p2);
    } else {
        exitTan = lineTangent(maneuverSeg.p0, maneuverSeg.p1);
    }
    if (!exitTan) exitTan = { x: 0, y: -1 };

    const off = offCanvasPointForDirAlongTangent(exitPoint, exitTan);

    if (typeof v.rearX !== 'number' || typeof v.rearY !== 'number') {
        const centerOffset = v.wheelbase * 0.5;
        const heading = (v.angle ?? 0) + Math.PI/2 - ANGLE_ADJUST;
        v.rearX = v.x - centerOffset * Math.cos(heading);
        v.rearY = v.y - centerOffset * Math.sin(heading);
    }

    const segs = [];
    segs.push({ type: 'line', p0: { x: v.rearX, y: v.rearY }, p1: { x: entry.x, y: entry.y } });
    segs.push(maneuverSeg);
    segs.push({ type: 'line', p0: { x: exitPoint.x, y: exitPoint.y }, p1: off });

    const built = buildPathFromSegments(segs);
    v.path = built;

    v.turnEntry = entry;
    v.turnExit = exitPoint;
    v.controlType = maneuverSeg.type === 'cubic' ? 'cubic' : (maneuverSeg.type === 'quadratic' ? 'quadratic' : 'line');
    v.controlPoint = maneuverSeg.type === 'quadratic' ? maneuverSeg.p1 : null;
    v.controlPoints = maneuverSeg.type === 'cubic' ? [maneuverSeg.p1, maneuverSeg.p2] : null;
    v.approachingTurn = true;
    v.turnLength = built.totalLength || 0;
    v.turnTraveled = 0;
}

  // ---------- helper: sync front/rear (poros) dari center + heading ----------
  // heading = angle in radians (vector heading) i.e. atan2(sin, cos)
  function updateAxlesFromCenter(v, heading = null) {
    if (!v) return;
    // derive heading if not provided
    if (heading === null) {
      if (typeof v.vx === 'number' && typeof v.vy === 'number' && (Math.abs(v.vx) > 1e-9 || Math.abs(v.vy) > 1e-9)) {
        heading = Math.atan2(v.vy, v.vx);
      } else if (typeof v.angle === 'number') {
        heading = v.angle + Math.PI/2 - ANGLE_ADJUST; // reverse stored angle transform
      } else {
        heading = 0;
      }
    }

    const half = (typeof v.wheelbase === 'number' && v.wheelbase > 0) ? (v.wheelbase * 0.5) : 0;
    const cosH = Math.cos(heading), sinH = Math.sin(heading);

    // center -> front = +half * heading ; rear = -half * heading
    v.frontX = v.x + half * cosH;
    v.frontY = v.y + half * sinH;
    v.rearX  = v.x - half * cosH;
    v.rearY  = v.y - half * sinH;

    // keep v.angle/v.vx/v.vy consistent
    const dx = v.frontX - v.rearX, dy = v.frontY - v.rearY;
    if (Math.hypot(dx, dy) > 1e-9) {
      const head = Math.atan2(dy, dx);
      v.angle = head - Math.PI/2 + ANGLE_ADJUST;
      v.vx = Math.cos(head);
      v.vy = Math.sin(head);
    }
  }

  // ---------- create vehicle ----------
  function createVehicle(arah, laneIndexZeroBased, type = 'mobil', exitLane = null) {
    const spawn = spawnPositionFor(arah, laneIndexZeroBased);
    const id = nextId++;
    const baseSpeed = (typeof options.baseSpeed === 'number') ? options.baseSpeed : mps_to_px_per_ms(10); // default ~10 m/s

    const initialHeading = Math.atan2(spawn.vy, spawn.vx);
    const v = {
      id,
      x: spawn.x, y: spawn.y, vx: spawn.vx, vy: spawn.vy,
      direction: arah,
      laneIndex: laneIndexZeroBased + 1,
      type, exitLane: exitLane || null,
      speed: baseSpeed,
      // ---- PATCH: save free-flow speed (km/jam) ----
freeFlowKmh: (() => {
    const pxPerSecond = baseSpeed * 1000;
    const mPerSecond = pxPerSecond / PX_PER_M;
    return mPerSecond * 3.6;
})(),
// ----------------------------------------------
      createdAt: nowMs(),
      turning: false, approachingTurn: false, route: "straight",
      turnProgress: 0, turnEntry: null, turnExit: null, controlPoint: null,
      controlPoints: null, controlType: null,
      angle: Math.atan2(spawn.vy, spawn.vx) - Math.PI/2 + ANGLE_ADJUST,
      turnLength: 0, turnTraveled: 0,
      wheelbase: wheelbaseForType(type),
      spriteOffsetFrontPx: 0,
      spriteOffsetRearPx: 0,
      axles: null,
      blend: null,
      rearX: null, rearY: null,
      frontX: null, frontY: null,
      path: null,
      // physics properties:
      lengthPx: 0,
      widthPx: 0,
      mass: 1, // derived later
      // laser state (updated each frame)
      _laser: null
    };

    if (v.type === 'truk') {
      const frontOverhangPx = truckFrontOverhangMeters * PX_PER_M;
      const frontToFirstRearPx = truckAxleSpacing.frontToFirstRear * PX_PER_M;
      const firstRearToSecondRearPx = (truckAxleSpacing.firstToSecondRear ? truckAxleSpacing.firstToSecondRear * PX_PER_M : (truckAxleSpacing.firstRearToSecondRear ? truckAxleSpacing.firstRearToSecondRear * PX_PER_M : 0));
      const rearOverhangPx = truckRearOverhangMeters * PX_PER_M;

      v.axles = { frontOverhangPx, frontToFirstRearPx, firstRearToSecondRearPx, rearOverhangPx };
      v.spriteOffsetFrontPx = frontOverhangPx;
      v.spriteOffsetRearPx = frontToFirstRearPx + firstRearToSecondRearPx + rearOverhangPx;
      v.wheelbase = frontToFirstRearPx;
      // Use requested canvas sizes (1:1)
      v.lengthPx = 120; // truck length in px
      v.widthPx = 25;   // truck width in px
    } else {
      v.axles = { frontOverhangPx: 0, rearOverhangPx: 0 };
      v.spriteOffsetFrontPx = 0;
      v.spriteOffsetRearPx = 0;
      // Use requested canvas sizes for motor and mobil
      if (v.type === 'motor') {
        v.lengthPx = 17.5; v.widthPx = 7.0;
      } else {
        // default 'mobil' and others -> UPDATED per request
        v.lengthPx = 42.0; v.widthPx = 21.0;
      }
    }

    // derive mass ~ proportional to length (longer => heavier)
    v.mass = Math.max(1, v.lengthPx / 100);

    // compute initial axles based on center and heading
    updateAxlesFromCenter(v, initialHeading);

    const entryKey = `${arah}_${v.laneIndex}`;
    const entry = laneCoordinates.entry[entryKey];

    if (entry) {
      const arrowType = (laneArrows[arah] && laneArrows[arah][laneIndexZeroBased]) || "straight";
      let allowed = [];
      if (arrowType.includes("straight")) allowed.push("straight");
      if (arrowType.includes("left")) allowed.push("left");
      if (arrowType.includes("right")) allowed.push("right");
      if (allowed.length === 0) allowed.push("straight");

      v.route = allowed[Math.floor(Math.random() * allowed.length)];
      assignExitAndControlForVehicle(v);
    } else {
      console.warn(`No entry point for key ${entryKey}; vehicle spawned without turn info.`);
      const off = { x: v.x + v.vx * 200, y: v.y + v.vy * 200 };
      v.path = buildPathFromSegments([{ type: 'line', p0: { x: v.rearX, y: v.rearY }, p1: off }]);
      v.turnLength = v.path.totalLength;
      v.turnTraveled = 0;
      v.approachingTurn = false;
      v.turning = true;
      v.displayId = generateVehicleID(type, arah);
    }

    // initial debug box compute
    computeDebugBoxForVehicle(v);

    vehicles.push(v);
    return v;
  }

// =========================
// PENOMORAN KENDARAAN
// =========================
const vehicleCounters = {
  utara: { MC: 0, LV: 0, HV: 0 },
  timur: { MC: 0, LV: 0, HV: 0 },
  selatan: { MC: 0, LV: 0, HV: 0 },
  barat: { MC: 0, LV: 0, HV: 0 },
};

// Fungsi bantu untuk membentuk ID unik
function generateVehicleID(type, direction) {
  let prefix;
  if (type === 'motor') prefix = 'MC';
  else if (type === 'mobil') prefix = 'LV';
  else if (type === 'truk') prefix = 'HV';
  else prefix = 'UK'; // unknown fallback

  const dirLetter = direction === 'utara' ? 'U'
                    : direction === 'timur' ? 'T'
                    : direction === 'selatan' ? 'S'
                    : direction === 'barat' ? 'B'
                    : '?';

  vehicleCounters[direction][prefix] += 1;
  const num = vehicleCounters[direction][prefix];
  return `${prefix}${num}${dirLetter}`;
}

// =========================
// SPAWN RANDOM VEHICLE (REVISED WITH RADAR CHECK)
// =========================
function spawnRandomVehicle(forcedDirection = null) {
  const directions = ['utara', 'timur', 'selatan', 'barat'];
  const arah = forcedDirection || directions[Math.floor(Math.random() * directions.length)];
  const laneCount = (config[arah] && config[arah].in) ? config[arah].in : 0;
  if (!laneCount) return null;

  // Pilih lajur — prefer per-lane flows jika tersedia
  let laneIndex = Math.floor(Math.random() * laneCount);
  let chosenLaneCfg = null;
  try {
    const lanesCfg = (laneTrafficConfig && laneTrafficConfig[arah] && laneTrafficConfig[arah].length) ? laneTrafficConfig[arah] : null;
    if (lanesCfg && lanesCfg.length > 0) {
      const totalFlow = lanesCfg.reduce((s, ln) => s + (Number(ln.flow) || 0), 0);
      if (totalFlow > 0) {
        // Weighted random berdasarkan flow per-lajur
        let r = Math.random() * totalFlow;
        let acc = 0;
        for (let i = 0; i < lanesCfg.length; i++) {
          acc += (Number(lanesCfg[i].flow) || 0);
          if (r <= acc) { laneIndex = i; chosenLaneCfg = lanesCfg[i]; break; }
        }
        if (!chosenLaneCfg) { laneIndex = Math.min(laneIndex, lanesCfg.length - 1); chosenLaneCfg = lanesCfg[laneIndex]; }
      } else {
        // tidak ada flow per-lajur (all zero) -> fallback random
        chosenLaneCfg = lanesCfg[laneIndex] || null;
      }
    }
  } catch (e) {
    chosenLaneCfg = null;
  }

  // ***** RADAR CHECK: Jika lajur yang dipilih PAUSED, batalkan spawn *****
  if (isLanePaused(arah, laneIndex)) {
    return null;
  }

  // Pilih tipe kendaraan berdasarkan bobot per-lajur (jika ada), else fallback lama
  let type = 'mobil';
  if (chosenLaneCfg) {
    const mPct = Number(chosenLaneCfg.motorPct) || 0;
    const cPct = Number(chosenLaneCfg.mobilPct) || 0;
    const tPct = Number(chosenLaneCfg.trukPct) || 0;
    const rnd = Math.random() * 100;
    if (rnd < mPct) type = 'motor';
    else if (rnd < mPct + cPct) type = 'mobil';
    else type = 'truk';
  } else {
    // legacy fallback (sebelum integrasi per-lajur)
    const truckPct = (trafficConfig[arah]?.truckPct ?? 20);
    const rnd = Math.random() * 100;
    if (rnd < truckPct) type = 'truk';
    else if (rnd < truckPct + 30) type = 'motor';
    else type = 'mobil';
  }

  const outChoices = exitLaneNumbers[arah] || [];
  const exitLane = outChoices.length > 0 ? outChoices[Math.floor(Math.random() * outChoices.length)] : null;

  const vehicle = createVehicle(arah, laneIndex, type, exitLane);
  return vehicle;
}
  function scheduleNextSpawn(arah, currentTimeMs) {
  // Jika ada laneTrafficConfig → gunakan jumlah flow per-lajur (agregat) untuk menghitung interval
  let flow = 0;
  try {
    if (laneTrafficConfig && laneTrafficConfig[arah] && laneTrafficConfig[arah].length > 0) {
      flow = laneTrafficConfig[arah].reduce((s, ln) => s + (Number(ln.flow) || 0), 0);
    }
  } catch (e) {
    flow = 0;
  }
  // fallback ke trafficConfig arah
  if (!flow || flow <= 0) flow = (trafficConfig[arah]?.flow ?? 500);
  const interval = getExponentialInterval(flow);
  nextSpawnTimes[arah] = currentTimeMs + interval;
}
  // ---------- helper: compute & update debugBox data for a vehicle ----------
  // Now produces an oriented bounding box (corners), axes (unit normals), center, half-extents
  function computeDebugBoxForVehicle(v) {
    // Prefer heading derived from rear->front if available (fixes truck orientation)
    let headingAngle = null;
    if (typeof v.frontX === 'number' && typeof v.frontY === 'number' && typeof v.rearX === 'number' && typeof v.rearY === 'number') {
      const dx = v.frontX - v.rearX;
      const dy = v.frontY - v.rearY;
      if (Math.hypot(dx, dy) > 1e-6) headingAngle = Math.atan2(dy, dx);
    }
    // fallback: try to derive from v.vx/vy or v.angle
    if (headingAngle === null) {
      if (typeof v.vx === 'number' && typeof v.vy === 'number' && (Math.abs(v.vx) > 1e-6 || Math.abs(v.vy) > 1e-6)) {
        headingAngle = Math.atan2(v.vy, v.vx);
      } else if (typeof v.angle === 'number') {
        // note: v.angle was stored as (heading - PI/2 + ANGLE_ADJUST) historically
        // recover heading by reversing that transform:
        headingAngle = v.angle + Math.PI/2 - ANGLE_ADJUST;
      } else {
        headingAngle = 0;
      }
    }

    // boxAngle: align box major axis with headingAngle
    let boxAngle = headingAngle;

    // width & length: use stored properties directly (1:1 with canvas sprite sizes)
    const width = (typeof v.widthPx === 'number' && v.widthPx > 0) ? v.widthPx : (v.type === 'truk' ? 25 : (v.type === 'motor' ? 7 : 21));
    const length = (typeof v.lengthPx === 'number' && v.lengthPx > 0) ? v.lengthPx : (v.type === 'truk' ? 120 : (v.type === 'motor' ? 17.5 : 42));

    // Determine if sprite distinguishes front/back:
    const frontOffset = (typeof v.spriteOffsetFrontPx === 'number') ? v.spriteOffsetFrontPx : 0;
    const rearOffset = (typeof v.spriteOffsetRearPx === 'number') ? v.spriteOffsetRearPx : 0;
    // consider front/back distinct if offsets differ OR length is noticeably larger than width
    const frontBackDistinct = (Math.abs(frontOffset - rearOffset) > 1e-6) || (length > width + 1e-3);

    if (!frontBackDistinct && AUTO_ROTATE_SYMMETRIC_BOX) {
      // rotate 90 degrees (pi/2) so the narrow side aligns with forward direction only for truly symmetric sprites
      boxAngle += Math.PI / 2;
    }

    const halfL = length / 2;
    const halfW = width / 2;
    const cosA = Math.cos(boxAngle);
    const sinA = Math.sin(boxAngle);

    // corners order: front-right, front-left, rear-left, rear-right (clockwise)
    const fr = { x: v.x + halfL * cosA - halfW * sinA, y: v.y + halfL * sinA + halfW * cosA };
    const fl = { x: v.x + halfL * cosA + halfW * sinA, y: v.y + halfL * sinA - halfW * cosA };
    const rl = { x: v.x - halfL * cosA + halfW * sinA, y: v.y - halfL * sinA - halfW * cosA };
    const rr = { x: v.x - halfL * cosA - halfW * sinA, y: v.y - halfL * sinA + halfW * cosA };

    const corners = [fr, fl, rl, rr];

    // axes: two unit vectors (edge directions) to use in SAT.
    const edge0 = normalize({ x: fl.x - fr.x, y: fl.y - fr.y }); // across width
    const edge1 = normalize({ x: rr.x - fr.x, y: rr.y - fr.y }); // along length (front->rear)
    const axes = [ { x: edge0.x, y: edge0.y }, { x: edge1.x, y: edge1.y } ];

    // compute front/rear approximate points for consumers (average of front corners / rear corners)
    const dbFront = { x: (fr.x + fl.x) * 0.5, y: (fr.y + fl.y) * 0.5 };
    const dbRear  = { x: (rr.x + rl.x) * 0.5, y: (rr.y + rl.y) * 0.5 };

    // store half extents along those edge axes for quick checks (not strictly necessary)
    v.debugBox = {
      corners,
      center: { x: v.x, y: v.y },
      axes,
      halfExtents: { halfL, halfW },
      width, length,
      angle: boxAngle,
      scale: DEBUG_BOX_SCALE,
      _frontBackDistinct: frontBackDistinct,
      _usedHeadingFromAxles: (headingAngle !== null),
      // extras for convenience:
      front: dbFront,
      rear: dbRear
    };

    // ------------------ SAMPLING: perimeter & centerline ------------------
    try {
      // spacing in px (allow override via options.debugSampleSpacingPx)
      const spacing = (typeof options.debugSampleSpacingPx === 'number') ? options.debugSampleSpacingPx : DEFAULT_SAMPLE_SPACING_PX;
      const maxSamplesPerEdge = 80; // safety cap per edge
      const perimSamples = [];

      // sample each edge (fr->fl, fl->rl, rl->rr, rr->fr) and avoid duplicated corner repeats
      const cornerList = corners;
      for (let ei = 0; ei < 4; ei++) {
        const a = cornerList[ei];
        const b = cornerList[(ei + 1) % 4];
        const s = sampleEdgePoints(a, b, spacing, maxSamplesPerEdge);
        // for edges after first, drop the first point to avoid duplicating the previous corner
        if (ei > 0 && s.length) s.shift();
        perimSamples.push(...s);
      }

      // centerline samples (rear -> front)
      const centerLineSamples = sampleEdgePoints(dbRear, dbFront, spacing, 200);

      // attach samples to debugBox for consumers (antrian.js etc.)
      v.debugBox.perimeterSamples = perimSamples;
      v.debugBox.centerlineSamples = centerLineSamples;
    } catch (e) {
      // sampling should not break simulation; swallow errors
      v.debugBox.perimeterSamples = v.debugBox.perimeterSamples || [];
      v.debugBox.centerlineSamples = v.debugBox.centerlineSamples || [];
      console && console.warn && console.warn("sampling debugBox failed for veh#", v.id, e);
    }
    // ---------------------------------------------------------------------
  }

  // ---------- NEW: Laser update helper ----------
  // Creates three parallel forward rays: center (for backwards compatibility) + left corner + right corner.
  function updateLaserForVehicle(v) {
    if (!v) return;
    // ensure laser object exists
    v._laser = v._laser || {};
    // clear hit info; antrian.js may set .center.hit/.left.hit/.right.hit later
    v._laser.center = v._laser.center || {};
    v._laser.left = v._laser.left || {};
    v._laser.right = v._laser.right || {};
    v._laser.center.hit = false; v._laser.left.hit = false; v._laser.right.hit = false;
    v._laser.center.hitId = null; v._laser.left.hitId = null; v._laser.right.hitId = null;
try { SpeedLogger.logFrame(v, PX_PER_M); } catch (e) {}

    // Determine forward unit vector (prefer axle vector front - rear, then vx/vy, then angle)
    let ux = 1, uy = 0;
    if (typeof v.frontX === 'number' && typeof v.rearX === 'number') {
      const dx = v.frontX - v.rearX, dy = v.frontY - v.rearY;
      const L = Math.hypot(dx, dy) || 1;
      ux = dx / L; uy = dy / L;
    } else if (typeof v.vx === 'number' && typeof v.vy === 'number' && (Math.abs(v.vx) > 1e-9 || Math.abs(v.vy) > 1e-9)) {
      const L = Math.hypot(v.vx, v.vy) || 1;
      ux = v.vx / L; uy = v.vy / L;
    } else if (typeof v.angle === 'number') {
      const heading = v.angle + Math.PI/2 - ANGLE_ADJUST;
      ux = Math.cos(heading); uy = Math.sin(heading);
    }

    // Center start: prefer debugBox.front then frontX/frontY then center+half-length
    let centerStart = null;
    if (v.debugBox && v.debugBox.front) centerStart = { x: v.debugBox.front.x, y: v.debugBox.front.y };
    else if (typeof v.frontX === 'number' && typeof v.frontY === 'number') centerStart = { x: v.frontX, y: v.frontY };
    else {
      const heading = (typeof v.angle === 'number') ? (v.angle + Math.PI/2 - ANGLE_ADJUST) : Math.atan2(uy, ux);
      const half = (v.lengthPx || 40) * 0.5;
      centerStart = { x: v.x + Math.cos(heading) * half, y: v.y + Math.sin(heading) * half };
    }

    // Corner starts: prefer debugBox.corners[0]=fr and [1]=fl. If missing, derive from centerStart +/- lateral vector
    let fr = null, fl = null;
    if (v.debugBox && Array.isArray(v.debugBox.corners) && v.debugBox.corners.length >= 4) {
      fr = v.debugBox.corners[0];
      fl = v.debugBox.corners[1];
    } else {
      // derive lateral vector perpendicular to forward (ux,uy)
      const lx = -uy, ly = ux; // left is +lx,+ly
      const halfW = (v.widthPx || 20) * 0.5;
      // front-right = centerStart - halfW * leftVector
      fr = { x: centerStart.x - lx * halfW, y: centerStart.y - ly * halfW };
      fl = { x: centerStart.x + lx * halfW, y: centerStart.y + ly * halfW };
    }

    // Build ray objects: start + end (length LASER_LENGTH_PX forward)
    const len = LASER_LENGTH_PX;
    const centerEnd = { x: centerStart.x + ux * len, y: centerStart.y + uy * len };
    const leftEnd = { x: fl.x + ux * len, y: fl.y + uy * len };
    const rightEnd = { x: fr.x + ux * len, y: fr.y + uy * len };

    // Store in v._laser for consumers (antrian.js)
    v._laser.center.start = { x: centerStart.x, y: centerStart.y };
    v._laser.center.end = centerEnd;
    v._laser.center.ux = ux; v._laser.center.uy = uy; v._laser.center.length = len;

    v._laser.left.start = { x: fl.x, y: fl.y };
    v._laser.left.end = leftEnd;
    v._laser.left.ux = ux; v._laser.left.uy = uy; v._laser.left.length = len;

    v._laser.right.start = { x: fr.x, y: fr.y };
    v._laser.right.end = rightEnd;
    v._laser.right.ux = ux; v._laser.right.uy = uy; v._laser.right.length = len;

    // maintain top-level compatibility fields: v._laser.start/end point to center ray
    v._laser.start = v._laser.center.start;
    v._laser.end = v._laser.center.end;
    v._laser.ux = ux; v._laser.uy = uy;
    v._laser.length = len;

    // leave hit flags to antrian.js (which will check each ray individually if implemented)
  }

  // ---------- SAT helpers for OBB (rectangles) ----------
  function projectOntoAxis(points, axis) {
    let min = Infinity, max = -Infinity;
    for (const p of points) {
      const proj = p.x * axis.x + p.y * axis.y;
      if (proj < min) min = proj;
      if (proj > max) max = proj;
    }
    return { min, max };
  }
  function intervalOverlap(aMin, aMax, bMin, bMax) {
    return Math.max(0, Math.min(aMax, bMax) - Math.max(aMin, bMin));
  }

  function obbOverlapMTV(dbA, dbB) {
    const axesToTest = [];
    for (const a of dbA.axes) axesToTest.push({ x: -a.y, y: a.x });
    for (const a of dbB.axes) axesToTest.push({ x: -a.y, y: a.x });

    let minOverlap = Infinity;
    let smallestAxis = null;
    let direction = 1;

    for (const rawAxis of axesToTest) {
      const len = Math.hypot(rawAxis.x, rawAxis.y);
      if (len <= 1e-9) continue;
      const axis = { x: rawAxis.x / len, y: rawAxis.y / len };

      const projA = projectOntoAxis(dbA.corners, axis);
      const projB = projectOntoAxis(dbB.corners, axis);

      const ov = Math.max(0, Math.min(projA.max, projB.max) - Math.max(projA.min, projB.min));
      if (ov <= 0) {
        return null;
      }
      if (ov < minOverlap) {
        minOverlap = ov;
        smallestAxis = axis;
        const centerDelta = { x: dbB.center.x - dbA.center.x, y: dbB.center.y - dbA.center.y };
        const sign = (centerDelta.x * axis.x + centerDelta.y * axis.y) >= 0 ? 1 : -1;
        direction = sign;
      }
    }
    if (!smallestAxis) return null;
    return { overlap: minOverlap, axis: smallestAxis, direction };
  }

  // ---------- helper: find nearest vehicle ahead ----------
  function findVehicleAhead(v) {
    // forward unit vector for v: use rear->front if available; otherwise derive from vx/vy
    let forward = null;
    if (typeof v.frontX === 'number' && typeof v.frontY === 'number' && typeof v.rearX === 'number' && typeof v.rearY === 'number') {
      forward = normalize({ x: v.frontX - v.rearX, y: v.frontY - v.rearY });
    } else if (typeof v.vx === 'number' && typeof v.vy === 'number' && (Math.abs(v.vx) > 1e-6 || Math.abs(v.vy) > 1e-6)) {
      forward = normalize({ x: v.vx, y: v.vy });
    } else {
      // fallback from angle
      const heading = (typeof v.angle === 'number') ? (v.angle + Math.PI/2 - ANGLE_ADJUST) : 0;
      forward = { x: Math.cos(heading), y: Math.sin(heading) };
    }
    const perp = { x: -forward.y, y: forward.x };

    let best = null;
    for (const other of vehicles) {
      if (other === v) continue;
      // quick distance culling
      const dx = other.x - v.x, dy = other.y - v.y;
      const proj = dx * forward.x + dy * forward.y; // forward distance from centers
      if (proj <= 2) continue; // behind or extremely close negative
      if (proj > DETECTION_RANGE) continue; // out of detection range

      const lateral = Math.abs(dx * perp.x + dy * perp.y);
      // require lateral overlap roughly within lane width: use max widths * 1.2
      const laneThreshold = Math.max(v.widthPx, other.widthPx) * 1.2 + DESIRED_GAP;
      if (lateral > laneThreshold) continue;

      // choose nearest in front (smallest proj)
      if (!best || proj < best.proj) {
        best = { other, proj, lateral, dx, dy };
      }
    }
    return best; // null or object
  }

  // ---------- MAIN UPDATE ----------
  function update(deltaMs) {
    if (!deltaMs || deltaMs <= 0) return;
    const now = nowMs();

    // 1. Update Radar State (Check Antrian per Lajur)
    try { updateSpawnRadars(now); } catch (e) {}

    // ============================================================
    // FITUR BARU: "SPAWN COLLISION CLEANUP"
    // Hapus kendaraan yang baru lahir jika terdeteksi overlap parah
    // ============================================================
    for (let i = vehicles.length - 1; i >= 0; i--) {
      const v = vehicles[i];
      
      // Hanya cek kendaraan yang umurnya < 1 detik (baru lahir)
      if (v.createdAt && (now - v.createdAt) < 1000) {
        
        // Cek indikator tabrakan dari antrian.js
        // overlapScale kecil (< 0.2) atau ada candidateId tabrakan
        const isCrashing = v._idm && (v._idm.overlapScale < 0.2 || v._idm.overlapCandidateId !== null);
        
        // Cek apakah dia macet total (speed 0) padahal harusnya jalan
        const isStuck = (v.speed <= 0.0001);

        if (isCrashing && isStuck) {
          console.warn(`[AUTO-FIX] Menghapus kendaraan ${v.id} yang spawn tabrakan.`);
          
          // Hapus kendaraan dari array
          vehicles.splice(i, 1);
          
          // JADWALKAN ULANG (RETRY)
          // Mundurkan jadwal spawn arah ini 1 detik dari sekarang
          if (nextSpawnTimes && v.direction) {
             nextSpawnTimes[v.direction] = now + 1000; 
          }
          
          // Lanjut loop, jangan proses fisika untuk kendaraan yang sudah dihapus ini
          continue; 
        }
      }
    }
    // ============================================================

    // First: decide desired speed for each vehicle based on vehicle ahead (no collision push)
    for (const v of vehicles) {
      // per-vehicle tuning (use provided or fallback to defaults converted to px/ms^2)
      const accel = (typeof v._accel === 'number') ? v._accel : DEFAULT_ACCEL;
      const brakeDecel = (typeof v._brakeDecel === 'number') ? v._brakeDecel : DEFAULT_BRAKE_DECEL;
      const reactionMs = (typeof v._reactionMs === 'number') ? v._reactionMs : DEFAULT_REACTION_MS;
      // baseSpeed may be passed in px/ms; if user used m/s, they must convert externally
      const baseSpeed = (typeof options.baseSpeed === 'number') ? options.baseSpeed : mps_to_px_per_ms(10); // default 10 m/s
      const BOOST_FACTOR = 1; // percepatan ekstra di tengah simpang

      // detect vehicle ahead
      const ahead = findVehicleAhead(v);
      let desiredSpeed = baseSpeed; // px/ms

      if (ahead && ahead.other) {
        const other = ahead.other;
        // compute half lengths
        const halfLenV = (v.lengthPx || 0) / 2;
        const halfLenO = (other.lengthPx || 0) / 2;
        // distance between vehicle centers along forward axis minus half-lengths -> gap
        const totalCenterSep = Math.max(0, ahead.proj);
        const gap = Math.max(0, totalCenterSep - (halfLenV + halfLenO));

        // braking distance estimate using reaction time + kinetic braking distance: v*tr + v^2/(2*a)
        const vSpeed = v.speed || 0; // px/ms
        const brakingDistance = vSpeed * reactionMs + ((vSpeed * vSpeed) / (2 * Math.max(1e-9, brakeDecel)));

        const minAllowed = DESIRED_GAP + brakingDistance; // gap we want to maintain

        // If gap <= minAllowed => must stop (or keep zero desired)
        if (gap <= minAllowed) {
          desiredSpeed = 0;
        } else {
          // otherwise choose a speed that smoothly approaches baseSpeed as gap increases
          // Use simple linear interpolation: when gap == minAllowed -> 0 ; when gap >= minAllowed + ramp -> baseSpeed
          const ramp = Math.max(PX_PER_M * 5, minAllowed); // make ramp at least ~5 m or proportional
          const t = Math.min(1, (gap - minAllowed) / ramp);
          desiredSpeed = baseSpeed * t;
          // small floor
          if (desiredSpeed < mps_to_px_per_ms(0.2)) desiredSpeed = mps_to_px_per_ms(0.2); // avoid near-zero crawl unless necessary
        }
      } else {
        // no obstacle detected: drive at base speed
        desiredSpeed = (typeof v.desiredSpeed === 'number') ? v.desiredSpeed : baseSpeed;
      }

      // ==================================================================
      // FIX CREEPING/MENEROBOS LAMPU MERAH
      // Paksa vehmov menghormati limit kecepatan dari antrian.js (lampu merah/laser)
      if (v._idm && typeof v._idm.finalAppliedSpeed === 'number') {
          desiredSpeed = Math.min(desiredSpeed, v._idm.finalAppliedSpeed);
      }
      // ==================================================================

      // store desiredSpeed to use in motion update
      v._desiredSpeed = desiredSpeed;
      v._accelRate = accel;
      v._brakeRate = brakeDecel;
      v._reactionMs = (typeof options.reactionTimeMs === 'number') ? options.reactionTimeMs : DEFAULT_REACTION_MS;
    }

    // Now move each vehicle applying acceleration / braking and existing path logic
    for (let i = vehicles.length - 1; i >= 0; i--) {
      const v = vehicles[i];
      const EPS = 1e-9;

      // Smoothly change v.speed toward v._desiredSpeed
      const desired = (typeof v._desiredSpeed === 'number') ? v._desiredSpeed : ((typeof options.baseSpeed === 'number') ? options.baseSpeed : mps_to_px_per_ms(10));
      const accelRate = (typeof v._accelRate === 'number') ? v._accelRate : DEFAULT_ACCEL;
      const brakeRate = (typeof v._brakeRate === 'number') ? v._brakeRate : DEFAULT_BRAKE_DECEL;

      if (v.speed < desired) {
        // accelerate
        v.speed = Math.min(desired, v.speed + accelRate * deltaMs);
      } else if (v.speed > desired) {
        // brake (stronger)
        v.speed = Math.max(desired, v.speed - brakeRate * deltaMs);
      }

      // then apply movement same as before but using v.speed as travel rate
      let moveBudget = v.speed * deltaMs;

      // FIX DRIFT: Jika target 0 dan speed sudah 0, jangan ada budget gerak sama sekali
      if (desired <= EPS && v.speed <= EPS) {
          v.speed = 0;
          moveBudget = 0;
      }

      while (moveBudget > EPS) {
        // approachingTurn: find closest on path -> create blend or snap
        if (v.approachingTurn && v.path) {
          const centerOffset = v.wheelbase * 0.5;
          const estHeading = (v.angle ?? 0) + Math.PI/2 - ANGLE_ADJUST;
          const estRear = { x: v.x - centerOffset * Math.cos(estHeading), y: v.y - centerOffset * Math.sin(estHeading) };

          const closest = findClosestDistanceOnPathToPoint(v.path, estRear, 40);
          const targetD = closest.pathD;
          const pStart = closest.pt;
          const offsetDist = Math.hypot(pStart.x - estRear.x, pStart.y - estRear.y);

          const minBlend = 2;
          const maxBlend = Math.max(20, v.wheelbase * 0.5);
          const desiredBlend = Math.min(offsetDist, maxBlend);
          const blendLen = Math.max(minBlend, desiredBlend);

          if (offsetDist <= 1.0) {
            // snap rear to path and start following -- use tangent for heading
            v.rearX = pStart.x; v.rearY = pStart.y;
            v.turnTraveled = targetD;
            v.turnLength = v.path.totalLength || 1;
            v.turning = true;
            v.approachingTurn = false;
            // compute front based on arc-length (rear + wheelbase along path)
            const frontD = Math.min(v.turnTraveled + v.wheelbase, v.path.totalLength);
            const { p: frontPt } = pathPointAndTangentAtDistance(v.path, frontD);
            v.frontX = frontPt.x; v.frontY = frontPt.y;
            const { tan } = pathPointAndTangentAtDistance(v.path, v.turnTraveled);
            const unitTan = normalize(tan);
            const heading = Math.atan2(unitTan.y, unitTan.x);
            v.x = v.rearX + centerOffset * unitTan.x;
            v.y = v.rearY + centerOffset * unitTan.y;
            // sync axles/angle consistently from path-derived front/rear
            updateAxlesFromCenter(v, heading);
            continue;
          } else {
            // prepare center target using tangent (unit) and compute target front too
            const { tan } = pathPointAndTangentAtDistance(v.path, targetD);
            const unitTan = normalize(tan);
            const centerTarget = {
              x: pStart.x + centerOffset * unitTan.x,
              y: pStart.y + centerOffset * unitTan.y
            };
            const frontD = Math.min(targetD + v.wheelbase, v.path.totalLength);
            const { p: frontPt } = pathPointAndTangentAtDistance(v.path, frontD);

            v.blend = {
              targetRearD: targetD,
              targetRear: pStart,
              targetFront: frontPt,
              centerTarget,
              remaining: blendLen,
              total: blendLen,
              pendingTurnTraveled: targetD,
              pendingTurnLength: v.path.totalLength || 1
            };
            v.approachingTurn = false;
            continue;
          }
        }

        // blending active
        if (v.blend) {
          const centerTarget = v.blend.centerTarget;
          const bx = centerTarget.x - v.x;
          const by = centerTarget.y - v.y;
          const distToTarget = Math.hypot(bx, by);
          if (distToTarget < EPS) {
            v.x = centerTarget.x; v.y = centerTarget.y;
            v.rearX = v.blend.targetRear.x; v.rearY = v.blend.targetRear.y;
            v.frontX = v.blend.targetFront.x; v.frontY = v.blend.targetFront.y;
            v.turnTraveled = v.blend.pendingTurnTraveled || 0;
            v.turnLength = v.blend.pendingTurnLength || 1;
            v.turnProgress = v.turnLength > 0 ? (v.turnTraveled / v.turnLength) : 0;
            v.blend = null;
            v.turning = true;
            // set angle using vector between rear->front (path-derived)
            const dx = v.frontX - v.rearX, dy = v.frontY - v.rearY;
            const heading = Math.atan2(dy, dx);
            updateAxlesFromCenter(v, heading);
            continue;
          }

          const move = Math.min(moveBudget, distToTarget, v.blend.remaining);
          const ux = bx / distToTarget, uy = by / distToTarget;
          v.x += ux * move;
          v.y += uy * move;

          // update poros agar titik depan/belakang selalu mengikuti pusat selama blending
          const motionHeading = Math.atan2(uy, ux); // heading of motion
          updateAxlesFromCenter(v, motionHeading);

          moveBudget -= move;
          v.blend.remaining -= move;

          if (v.blend.remaining <= EPS || Math.hypot(centerTarget.x - v.x, centerTarget.y - v.y) <= 1.0) {
            v.rearX = v.blend.targetRear.x; v.rearY = v.blend.targetRear.y;
            v.frontX = v.blend.targetFront.x; v.frontY = v.blend.targetFront.y;
            v.x = centerTarget.x; v.y = centerTarget.y;
            v.turnTraveled = v.blend.pendingTurnTraveled || 0;
            v.turnLength = v.blend.pendingTurnLength || 1;
            v.turnProgress = v.turnLength > 0 ? (v.turnTraveled / v.turnLength) : 0;
            v.blend = null;
            v.turning = true;
            const dx = v.frontX - v.rearX, dy = v.frontY - v.rearY;
            const heading = Math.atan2(dy, dx);
            updateAxlesFromCenter(v, heading);
            continue;
          } else {
            break;
          }
        }

        // turning along path (two-axle follower)
        if (v.turning && v.path) {
          if (v.turnLength <= 0) v.turnLength = v.path.totalLength || 1;
          const remainingOnPath = Math.max(0, v.turnLength - v.turnTraveled);
          if (remainingOnPath <= 0.001) {
            // finished path: snap final heading and clear path to avoid flicker
            v.turnTraveled = v.turnLength;
            v.turnProgress = 1;
            v.turning = false;
            // final rear and front
            const rearD = v.turnTraveled;
            const frontD = Math.min(rearD + v.wheelbase, v.path.totalLength);
            const { p: rearPt } = pathPointAndTangentAtDistance(v.path, rearD);
            const { p: frontPt } = pathPointAndTangentAtDistance(v.path, frontD);
            v.rearX = rearPt.x; v.rearY = rearPt.y;
            v.frontX = frontPt.x; v.frontY = frontPt.y;
            const dx = v.frontX - v.rearX, dy = v.frontY - v.rearY;
            const finalHeading = Math.atan2(dy, dx);
            v.vx = Math.cos(finalHeading); v.vy = Math.sin(finalHeading);
            updateAxlesFromCenter(v, finalHeading);
            // recompute center consistent with rear & front (updateAxlesFromCenter set them already)
            const centerOffset = v.wheelbase * 0.5;
            v.x = v.rearX + centerOffset * Math.cos(finalHeading);
            v.y = v.rearY + centerOffset * Math.sin(finalHeading);
            v.path = null; v.approachingTurn = false; v.blend = null;
            continue;
          }

          const use = Math.min(moveBudget, remainingOnPath);
          v.turnTraveled += use;
          v.turnProgress = v.turnTraveled / Math.max(1e-6, v.turnLength);

          // get rear point and tangent at exact traveled distance
          const rearD = v.turnTraveled;
          const frontD = Math.min(rearD + v.wheelbase, v.path.totalLength);
          const { p: rear } = pathPointAndTangentAtDistance(v.path, rearD);
          const { p: front } = pathPointAndTangentAtDistance(v.path, frontD);

          v.rearX = rear.x; v.rearY = rear.y;
          v.frontX = front.x; v.frontY = front.y;

          // heading based on vector rear->front
          const dx = v.frontX - v.rearX, dy = v.frontY - v.rearY;
          const headingAngle = Math.atan2(dy, dx);
          const centerOffset = v.wheelbase * 0.5;
          // center location is rear + centerOffset * unit vector(rear->front)
          const unit = normalize({ x: dx, y: dy });
          const cx = v.rearX + centerOffset * unit.x;
          const cy = v.rearY + centerOffset * unit.y;

          v.x = cx; v.y = cy;
          updateAxlesFromCenter(v, headingAngle);

          moveBudget -= use;

          if (use >= remainingOnPath - 1e-6) {
            // reached path end -> snap final heading and clear path
            v.turning = false;
            const finalRearD = v.turnLength;
            const finalFrontD = Math.min(finalRearD + v.wheelbase, v.path.totalLength);
            const { p: finalRearPt } = pathPointAndTangentAtDistance(v.path, finalRearD);
            const { p: finalFrontPt } = pathPointAndTangentAtDistance(v.path, finalFrontD);
            v.rearX = finalRearPt.x; v.rearY = finalRearPt.y;
            v.frontX = finalFrontPt.x; v.frontY = finalFrontPt.y;
            const dx2 = v.frontX - v.rearX, dy2 = v.frontY - v.rearY;
            const finalHeading = Math.atan2(dy2, dx2);
            v.vx = Math.cos(finalHeading); v.vy = Math.sin(finalHeading);
            updateAxlesFromCenter(v, finalHeading);
            const centerOffset2 = v.wheelbase * 0.5;
            v.x = v.rearX + centerOffset2 * Math.cos(finalHeading);
            v.y = v.rearY + centerOffset2 * Math.sin(finalHeading);
            v.path = null; v.approachingTurn = false; v.blend = null;
            continue;
          } else {
            break;
          }
        }

        // 4) default straight movement (center moves along vx/vy)
        const move = moveBudget;
        v.x += (v.vx || 0) * move;
        v.y += (v.vy || 0) * move;
        moveBudget = 0;
        SpeedLogger.logFrame(v, PX_PER_M);

        // sync axles/poros berdasarkan heading dari vx/vy (atau v.angle)
        if ((v.vx || 0) !== 0 || (v.vy || 0) !== 0) {
          const head = Math.atan2(v.vy, v.vx);
          updateAxlesFromCenter(v, head);
        } else {
          if (typeof v.angle === 'number') updateAxlesFromCenter(v, v.angle + Math.PI/2 - ANGLE_ADJUST);
        }
        break;
      } // end while

      // compute & update debugBox for this vehicle so antrian.js (or others) can use it immediately
      try {
        // As a safety: if vehicle is NOT following path or blend, ensure axles are in sync
        if (!v.turning && !v.blend) {
          let h = null;
          if (typeof v.vx === 'number' && typeof v.vy === 'number' && (Math.abs(v.vx) > 1e-9 || Math.abs(v.vy) > 1e-9)) {
            h = Math.atan2(v.vy, v.vx);
          } else if (typeof v.angle === 'number') {
            h = v.angle + Math.PI/2 - ANGLE_ADJUST;
          }
          updateAxlesFromCenter(v, h);
        }

        computeDebugBoxForVehicle(v);

        // update laser geometry for this vehicle (center + corner lasers)
        updateLaserForVehicle(v);
      } catch (e) {
        console.warn("computeDebugBoxForVehicle failed for veh#", v.id, e);
      }

      // remove if out of canvas bounds (with margin)
      const margin = SPAWN_MARGIN + 60;
      if (v.x < -margin || v.x > canvasSize.width + margin || v.y < -margin || v.y > canvasSize.height + margin) {
        try { SpeedLogger.finalizeVehicle(v, PX_PER_M); } catch (e) {}
        vehicles.splice(i, 1);
      }
    } // end per-vehicle movement

    // NOTE: collision push / resolution intentionally removed.
    // We only detect vehicles ahead and slow down; collisions (overlap) will not be corrected by displacement.
  }

  // ---------- debug draw ----------
  function drawDebugPoints(ctx) {
    // 1. Cek Saklar (ID: debugShowPoints)
    const toggle = document.getElementById("debugShowPoints");
    if (toggle && !toggle.checked) return;

    vehicles.forEach(v => {
      // 2. Culling: Jangan gambar jika jauh di luar layar
      if (v.x < -100 || v.x > canvasSize.width + 100 || 
          v.y < -100 || v.y > canvasSize.height + 100) return;

      // Ensure debugBox exists so corner dots are correct
      if (!v.debugBox) {
        try { computeDebugBoxForVehicle(v); } catch (e) {}
      }

      if (v.controlType === 'quadratic' && v.controlPoint) {
        ctx.save(); ctx.fillStyle = "magenta"; ctx.beginPath();
        ctx.arc(v.controlPoint.x, v.controlPoint.y, 5, 0, 2 * Math.PI); ctx.fill(); ctx.restore();
      }
      if (v.controlType === 'cubic' && v.controlPoints && v.controlPoints.length === 2) {
        ctx.save(); ctx.fillStyle = "magenta"; ctx.beginPath();
        ctx.arc(v.controlPoints[0].x, v.controlPoints[0].y, 5, 0, 2 * Math.PI); ctx.fill();
        ctx.beginPath(); ctx.arc(v.controlPoints[1].x, v.controlPoints[1].y, 5, 0, 2 * Math.PI); ctx.fill();
        ctx.restore();
      }
      if (v.blend && v.blend.targetRear) {
        ctx.save(); ctx.fillStyle = "orange"; ctx.beginPath();
        ctx.arc(v.blend.targetRear.x, v.blend.targetRear.y, 4, 0, 2 * Math.PI); ctx.fill(); ctx.restore();
      }
      if (v.turnEntry) { ctx.save(); ctx.fillStyle = "lime"; ctx.beginPath(); ctx.arc(v.turnEntry.x, v.turnEntry.y, 3, 0, 2 * Math.PI); ctx.fill(); ctx.restore(); }
      if (v.turnExit)  { ctx.save(); ctx.fillStyle = "lime"; ctx.beginPath(); ctx.arc(v.turnExit.x, v.turnExit.y, 3, 0, 2 * Math.PI); ctx.fill(); ctx.restore(); }

      // white dots for axles (rear/front)
      if (typeof v.rearX === 'number' && typeof v.rearY === 'number') {
        ctx.save(); ctx.fillStyle = "white"; ctx.beginPath();
        ctx.arc(v.rearX, v.rearY, 3, 0, 2 * Math.PI); ctx.fill(); ctx.restore();
      }
      if (typeof v.frontX === 'number' && typeof v.frontY === 'number') {
        ctx.save(); ctx.fillStyle = "white"; ctx.beginPath();
        ctx.arc(v.frontX, v.frontY, 3, 0, 2 * Math.PI); ctx.fill(); ctx.restore();
      }

      // ===== NEW: draw blue dots on each debugBox corner to verify coordinates exist =====
      if (v.debugBox && Array.isArray(v.debugBox.corners)) {
        ctx.save();
        ctx.fillStyle = "deepskyblue"; // jelas terlihat di atas sprite
        const r = 3; // pixel radius for corner dots
        for (const c of v.debugBox.corners) {
          if (c && typeof c.x === 'number' && typeof c.y === 'number') {
            ctx.beginPath();
            ctx.arc(c.x, c.y, r, 0, 2 * Math.PI);
            ctx.fill();
          }
        }
        ctx.restore();
      }
    });
  }

  function drawDebugPaths(ctx) {
    // 1. Cek Saklar (ID: debugShowPaths)
    const toggle = document.getElementById("debugShowPaths");
    if (toggle && !toggle.checked) return;

    vehicles.forEach(v => {
      if (!v.path) return;

      // 2. Culling: Jangan gambar jika jauh di luar layar
      if (v.x < -100 || v.x > canvasSize.width + 100 || 
          v.y < -100 || v.y > canvasSize.height + 100) return;

      ctx.save();
      ctx.strokeStyle = "rgba(0,0,0,0.15)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let si = 0; si < v.path.segments.length; si++) {
        const seg = v.path.segments[si];
        if (seg.type === 'line') {
          ctx.moveTo(seg.p0.x, seg.p0.y); ctx.lineTo(seg.p1.x, seg.p1.y);
        } else if (seg.type === 'quadratic') {
          ctx.moveTo(seg.p0.x, seg.p0.y);
          ctx.quadraticCurveTo(seg.p1.x, seg.p1.y, seg.p2.x, seg.p2.y);
        } else if (seg.type === 'cubic') {
          ctx.moveTo(seg.p0.x, seg.p0.y);
          ctx.bezierCurveTo(seg.p1.x, seg.p1.y, seg.p2.x, seg.p2.y, seg.p3.x, seg.p3.y);
        }
      }
      ctx.stroke();
      ctx.restore();
    });
  }

  // ---------- kotak debug fisik kendaraan (visual draw) ----------
  function drawDebugBoxes(ctx) {
    // 1. Cek Saklar (ID: debugShowHitbox)
    const toggle = document.getElementById("debugShowHitbox");
    if (toggle && !toggle.checked) return;

    vehicles.forEach(v => {
      // 2. Culling: Jangan gambar jika jauh di luar layar
      if (v.x < -100 || v.x > canvasSize.width + 100 || 
          v.y < -100 || v.y > canvasSize.height + 100) return;

      if (!v.debugBox) computeDebugBoxForVehicle(v);
      const db = v.debugBox;
      if (!db || !db.corners) return;

      ctx.save();
      // warna outline berdasarkan tipe
      if (v.type === "motor") ctx.strokeStyle = "red";
      else if (v.type === "mobil") ctx.strokeStyle = "yellow";
      else if (v.type === "truk") ctx.strokeStyle = "green";
      else ctx.strokeStyle = "white";

      ctx.lineWidth = Math.max(0.8, 1.5);
      ctx.globalAlpha = 0.9;

      // polygon outline
      ctx.beginPath();
      ctx.moveTo(db.corners[0].x, db.corners[0].y);
      for (let i = 1; i < db.corners.length; i++) ctx.lineTo(db.corners[i].x, db.corners[i].y);
      ctx.closePath();
      ctx.stroke();

      // draw center
      ctx.fillStyle = "rgba(0,255,255,0.9)";
      ctx.beginPath();
      ctx.arc(db.center.x, db.center.y, Math.max(1, 3 * (db.scale || 1.0)), 0, 2 * Math.PI);
      ctx.fill();

      // optional: draw axes for debug
      ctx.strokeStyle = "rgba(255,255,255,0.15)";
      ctx.beginPath();
      const a0 = db.axes[0];
      ctx.moveTo(db.center.x - a0.x * 20, db.center.y - a0.y * 20);
      ctx.lineTo(db.center.x + a0.x * 20, db.center.y + a0.y * 20);
      const a1 = db.axes[1];
      ctx.moveTo(db.center.x - a1.x * 20, db.center.y - a1.y * 20);
      ctx.lineTo(db.center.x + a1.x * 20, db.center.y + a1.y * 20);
      ctx.stroke();

      // --- draw perimeter samples (small blue dots) ---
      if (db.perimeterSamples && db.perimeterSamples.length) {
        ctx.save();
        ctx.fillStyle = "deepskyblue";
        for (const p of db.perimeterSamples) {
          ctx.beginPath();
          ctx.arc(p.x, p.y, 1.5, 0, 2 * Math.PI);
          ctx.fill();
        }
        ctx.restore();
      }

      // --- draw centerline samples (small blue dots, slightly darker) ---
      if (db.centerlineSamples && db.centerlineSamples.length) {
        ctx.save();
        ctx.fillStyle = "dodgerblue";
        for (const p of db.centerlineSamples) {
          ctx.beginPath();
          ctx.arc(p.x, p.y, 1.5, 0, 2 * Math.PI);
          ctx.fill();
        }
        ctx.restore();
      }

      ctx.restore();

      // ===== NEW: draw laser lines (green) if enabled =====
      if (LASER_DRAW_ENABLED && v._laser) {
        ctx.save();
        ctx.lineWidth = 2;

        // center ray (compat)
        if (v._laser.center && v._laser.center.start && v._laser.center.end) {
          ctx.beginPath();
          ctx.moveTo(v._laser.center.start.x, v._laser.center.start.y);
          ctx.lineTo(v._laser.center.end.x, v._laser.center.end.y);
          ctx.strokeStyle = v._laser.center.hit ? "lime" : "rgba(0,255,0,0.6)";
          ctx.stroke();
          if (v._laser.center.hit && v._laser.center.hitPoint) {
            ctx.fillStyle = "lime";
            ctx.beginPath();
            ctx.arc(v._laser.center.hitPoint.x, v._laser.center.hitPoint.y, 3, 0, Math.PI*2);
            ctx.fill();
          }
        }

        // left corner ray
        if (v._laser.left && v._laser.left.start && v._laser.left.end) {
          ctx.beginPath();
          ctx.moveTo(v._laser.left.start.x, v._laser.left.start.y);
          ctx.lineTo(v._laser.left.end.x, v._laser.left.end.y);
          ctx.strokeStyle = v._laser.left.hit ? "lime" : "rgba(0,220,0,0.5)";
          ctx.stroke();
          if (v._laser.left.hit && v._laser.left.hitPoint) {
            ctx.fillStyle = "lime";
            ctx.beginPath();
            ctx.arc(v._laser.left.hitPoint.x, v._laser.left.hitPoint.y, 3, 0, Math.PI*2);
            ctx.fill();
          }
        }

        // right corner ray
        if (v._laser.right && v._laser.right.start && v._laser.right.end) {
          ctx.beginPath();
          ctx.moveTo(v._laser.right.start.x, v._laser.right.start.y);
          ctx.lineTo(v._laser.right.end.x, v._laser.right.end.y);
          ctx.strokeStyle = v._laser.right.hit ? "lime" : "rgba(0,200,0,0.45)";
          ctx.stroke();
          if (v._laser.right.hit && v._laser.right.hitPoint) {
            ctx.fillStyle = "lime";
            ctx.beginPath();
            ctx.arc(v._laser.right.hitPoint.x, v._laser.right.hitPoint.y, 3, 0, Math.PI*2);
            ctx.fill();
          }
        }

        ctx.restore();
      }
    });
    try { ctx.globalAlpha = 1.0; } catch (e) {}
  }

  // ---------- external API ----------
  function getVehicles() { return vehicles.slice(); }
  function clear() { vehicles.length = 0; nextId = 1; }
  function setTrafficConfig(obj) { trafficConfig = obj || trafficConfig; }
    // Terima konfigurasi per-lajur dari main.js
  // Terima konfigurasi per-lajur dari main.js
  function setLaneTrafficConfig(obj) {
    if (!obj) return;
    try {
      // shallow copy + sanitasi struktur
      laneTrafficConfig = { utara: [], timur: [], selatan: [], barat: [] };
      ['utara','timur','selatan','barat'].forEach(dir => {
        if (!Array.isArray(obj[dir])) return;
        laneTrafficConfig[dir] = obj[dir].map(l => {
          // pastikan property tersedia, dan normalisasikan kecil (sum -> 100) kalau perlu
          const flow = Math.max(0, Math.round(Number(l?.flow || 0)));
          let m = Number(l?.motorPct ?? l?.motor ?? 0) || 0;
          let c = Number(l?.mobilPct ?? l?.mobil ?? 0) || 0;
          let t = Number(l?.trukPct ?? l?.truk ?? 0) || 0;
          const sum = m + c + t;
          if (sum === 0) {
            // fallback default
            m = 33; c = 33; t = 34;
          } else {
            // normalize to percentages
            m = (m / sum) * 100;
            c = (c / sum) * 100;
            t = (t / sum) * 100;
            // pembulatan aman: pastikan integer dan jumlah = 100
            let im = Math.round(m), ic = Math.round(c), it = Math.round(t);
            const fix = 100 - (im + ic + it);
            it += fix;
            m = im; c = ic; t = it;
          }
          const motorPct = Math.max(0, Math.round(m));
          const mobilPct = Math.max(0, Math.round(c));
          const trukPct = Math.max(0, Math.round(t));
          // provide aliases for compatibility
          return { flow, motorPct, mobilPct, trukPct };
        });
      });
      console.debug("vehmov: laneTrafficConfig set", laneTrafficConfig);
    } catch (e) {
      console.warn("setLaneTrafficConfig failed:", e);
    }
  }

  function setCanvasSize(sz) { 
    if (sz?.width && sz?.height) { canvasSize.width = sz.width; canvasSize.height = sz.height; } 
    // update radar positions if canvas size changes
    try { updateSpawnRadarsCenters(); } catch(e) {}
  }

  function setLaneCoordinates(newLc) {
    if (!newLc) return;
    laneCoordinates.entry = newLc.entry || laneCoordinates.entry || {};
    laneCoordinates.exit = newLc.exit || laneCoordinates.exit || {};
    for (const v of vehicles) {
      try { assignExitAndControlForVehicle(v); } catch (e) { console.warn("setLaneCoordinates: reassign failed untuk veh#", v.id, e); }
    }
    // update radar because lane config might have changed
    try { buildSpawnRadars(); updateSpawnRadarsCenters(); } catch (e) {}
  }
  function clearAllVehicles() {
    vehicles.length = 0;
    nextId = 1;
    console.log("Semua kendaraan telah dihapus.");
  }

  return {
    spawnRandomVehicle, scheduleNextSpawn, update, getVehicles, clear, clearAllVehicles,
    nextSpawnTimes, setTrafficConfig, setCanvasSize,
    drawDebugPoints, drawDebugPaths, drawDebugBoxes, setLaneTrafficConfig,
    setLaneCoordinates,
    // min spawn interval control (seconds)
    setMinSpawnIntervalSec, getMinSpawnIntervalSec,
     setSpawnRadarOptions // EXPORTED: agar bisa tuning radar dari luar
  };
}