// antrian.js (REVISI LOGIKA BARU: Flow & Queue Real-Time)
// Fitur Baru:
// 1. Antrian dihitung dari Bumper Depan kendaraan terdepan s/d Bumper Belakang kendaraan terakhir.
// 2. Mendukung toleransi 'Merayap' (Creep), tidak harus 0 absolute.
// 3. Mengabaikan kendaraan yang baru spawn (proteksi area radar).
const PX_PER_M = 10;
const DEFAULT_VEHICLE_LENGTH_M = 4.5;
const DEFAULT_MIN_GAP_M = 2.0;

const LASER_LENGTH_PX = 30;
const LASER_SAFE_STOP_PX = 15;
const SPAWN_GRACE_MS = 0; // Digantikan logic khusus di stats

// Parameter Fisika IDM
const IDM_PARAMS = {
  a: 0.00018,
  b: 0.00035,
  T_s: 1.2,
  s0_m: DEFAULT_MIN_GAP_M,
  delta: 4
};

const SAFETY_BUFFER_M = 0.3;
const SAFETY_BUFFER_PX = SAFETY_BUFFER_M * PX_PER_M;

const STOP_LOOKAHEAD_M = 10;
const STOP_LOOKAHEAD_PX = STOP_LOOKAHEAD_M * PX_PER_M;

const TL_COMFORT_DECEL = 0.0006;
const TL_RAMP_EXP = 1.6;
const TL_MIN_VSNAP = 0.0005;

// Tuning Lampu Kuning & Hard Stop
const YELLOW_COMMIT_DISTANCE_M = 4.0;
const YELLOW_COMMIT_DISTANCE_PX = YELLOW_COMMIT_DISTANCE_M * PX_PER_M;
const YELLOW_TIME_MARGIN_MS = 300;
const YELLOW_MIN_SPEED_FOR_TIME_CHECK = 0.00005;


const HARD_STOP_EXTRA_PX = 2;
const STOP_SPEED_FLOOR = 1e-5;
const MIN_ZERO_HELD_TL = 0.0002;

// ==========================================
// KONFIGURASI DETEKSI ANTRIAN (STATS)
// ==========================================
// Kecepatan di bawah ini dianggap "Berhenti/Merayap" (0.02 px/ms ~= 7 km/h)
const QUEUE_SPEED_TOLERANCE = 0.02; 

// Jarak maksimal moncong kendaraan pertama dari garis stop agar dianggap antri (20 meter)
const QUEUE_START_LIMIT_PX = 200; 

// Jarak gap maksimal antar kendaraan agar dianggap satu rangkaian antrian (5 meter)
const QUEUE_MAX_CHAIN_GAP_PX = 50; 

// Waktu pengabaian awal spawn agar tidak terhitung sebagai antrian (2000ms = 2 detik)
// Ini berfungsi sebagai "Radar" pengaman di area spawn.
const SPAWN_IGNORE_QUEUE_MS = 2000; 

function nowMs() { return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now(); }

function kmhToPxPerMs(kmh) {
  return (((kmh * 1000) / 3600) /* m/s */ * PX_PER_M) / 1000;
}
function vehicleLengthPx(v) {
  if (!v) return DEFAULT_VEHICLE_LENGTH_M * PX_PER_M;
  if (typeof v.lengthPx === 'number') return v.lengthPx;
  if (typeof v.length_m === 'number') return v.length_m * PX_PER_M;
  if (typeof v.length === 'number') return v.length * PX_PER_M;
  if (v.type === 'motor') return 2.0 * PX_PER_M;
  if (v.type === 'truk') return 12.0 * PX_PER_M;
  return DEFAULT_VEHICLE_LENGTH_M * PX_PER_M;
}
function fallbackSetDesiredSpeedIfMissing(v) {
  if (!v) return;
  if (v.maxSpeed) return;
  const randBetween = (min, max) => min + Math.random() * (max - min);
  if (v.type === 'motor') v.maxSpeed = kmhToPxPerMs(randBetween(25, 35));
  else if (v.type === 'truk') v.maxSpeed = kmhToPxPerMs(randBetween(15, 20));
  else v.maxSpeed = kmhToPxPerMs(randBetween(20, 30));
  if (!Number.isFinite(v.speed)) v.speed = 0;
}
function projectPointOntoAxis(p, ax, ay) { return p.x * ax + p.y * ay; }
function normalizeVec(v) { const L = Math.hypot(v.x, v.y); if (L <= 1e-9) return { x: 1, y: 0 }; return { x: v.x / L, y: v.y / L }; }

// prefer leader axis (robust for queues)
function choosePathTangentAxis(follower, leader) {
  if (leader?.debugBox?.centerlineSamples?.length >= 2) {
    const cl = leader.debugBox.centerlineSamples;
    const a = cl[0], b = cl[cl.length - 1];
    return normalizeVec({ x: b.x - a.x, y: b.y - a.y });
  }
  if (follower?.debugBox?.centerlineSamples?.length >= 2) {
    const cl = follower.debugBox.centerlineSamples;
    const a = cl[0], b = cl[cl.length - 1];
    return normalizeVec({ x: b.x - a.x, y: b.y - a.y });
  }
  if (leader?.debugBox && typeof leader.debugBox.angle === 'number') {
    const ang = leader.debugBox.angle;
    return { x: Math.cos(ang), y: Math.sin(ang) };
  }
  if (follower?.debugBox && typeof follower.debugBox.angle === 'number') {
    const ang = follower.debugBox.angle;
    return { x: Math.cos(ang), y: Math.sin(ang) };
  }
  if (follower?.debugBox && leader?.debugBox) {
    const dx = leader.debugBox.center.x - follower.debugBox.center.x;
    const dy = leader.debugBox.center.y - follower.debugBox.center.y;
    return normalizeVec({ x: dx, y: dy });
  }
  return { x: 1, y: 0 };
}

function buildCenterlineSamples(v, n = 9) {
  if (!v || !v.debugBox) return null;
  if (Array.isArray(v.debugBox.centerlineSamples) && v.debugBox.centerlineSamples.length >= 2) {
    return v.debugBox.centerlineSamples;
  }
  let front = v.debugBox.front;
  let rear = v.debugBox.rear;
  if ((!front || !rear) && v.debugBox.corners && v.debugBox.corners.length === 4) {
    front = { x: (v.debugBox.corners[0].x + v.debugBox.corners[1].x) * 0.5, y: (v.debugBox.corners[0].y + v.debugBox.corners[1].y) * 0.5 };
    rear  = { x: (v.debugBox.corners[2].x + v.debugBox.corners[3].x) * 0.5, y: (v.debugBox.corners[2].y + v.debugBox.corners[3].y) * 0.5 };
  }
  if (!front || !rear) {
    if (typeof v.frontX === 'number' && typeof v.frontY === 'number' && typeof v.rearX === 'number' && typeof v.rearY === 'number') {
      front = { x: v.frontX, y: v.frontY };
      rear = { x: v.rearX, y: v.rearY };
    } else {
      return null;
    }
  }
  const arr = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    arr.push({ x: rear.x + (front.x - rear.x) * t, y: rear.y + (front.y - rear.y) * t });
  }
  v.debugBox.centerlineSamples = arr;
  return arr;
}
function buildPerimeterSamples(v, samplesPerEdge = 8) {
  if (!v || !v.debugBox || !Array.isArray(v.debugBox.corners) || v.debugBox.corners.length < 4) return null;
  if (Array.isArray(v.debugBox.perimeterSamples) && v.debugBox.perimeterSamples.length >= 4 * samplesPerEdge) {
    return v.debugBox.perimeterSamples;
  }
  const corners = v.debugBox.corners;
  const pts = [];
  function interp(a, b, t) { return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }; }
  for (let e = 0; e < 4; e++) {
    const a = corners[e];
    const b = corners[(e + 1) % 4];
    for (let s = 0; s < samplesPerEdge; s++) {
      const t = s / samplesPerEdge;
      pts.push(interp(a, b, t));
    }
  }
  pts.push(corners[0]);
  v.debugBox.perimeterSamples = pts;
  return pts;
}
function ensureSamplesForVehicle(v, opts = {}) {
  if (!v) return;
  if (v.debugBox) {
    const nCenter = opts.centerSamples || 9;
    const perEdge = opts.perEdge || 8;
    buildCenterlineSamples(v, nCenter);
    buildPerimeterSamples(v, perEdge);
  } else {
    if (typeof v.frontX === 'number' && typeof v.frontY === 'number' && typeof v.rearX === 'number' && typeof v.rearY === 'number') {
      v.debugBox = v.debugBox || { center: { x: (v.frontX + v.rearX) * 0.5, y: (v.frontY + v.rearY) * 0.5 }, corners: [], angle: Math.atan2(v.frontY - v.rearY, v.frontX - v.rearX) };
      buildCenterlineSamples(v, opts.centerSamples || 9);
    }
  }
}
function obbOverlapSAT(dbA, dbB) {
  if (!dbA || !dbB || !Array.isArray(dbA.corners) || !Array.isArray(dbB.corners)) return false;
  const axes = [];
  function pushAxes(corners) {
    if (corners.length < 2) return;
    for (let i = 0; i < 2; i++) {
      const p0 = corners[i], p1 = corners[(i + 1) % corners.length];
      const edge = { x: p1.x - p0.x, y: p1.y - p0.y };
      const L = Math.hypot(edge.x, edge.y);
      if (L <= 1e-9) continue;
      axes.push({ x: edge.x / L, y: edge.y / L });
    }
  }
  pushAxes(dbA.corners); pushAxes(dbB.corners);

  for (const axis of axes) {
    let minA = Infinity, maxA = -Infinity;
    for (const p of dbA.corners) {
      const pr = projectPointOntoAxis(p, axis.x, axis.y);
      if (pr < minA) minA = pr;
      if (pr > maxA) maxA = pr;
    }
    let minB = Infinity, maxB = -Infinity;
    for (const p of dbB.corners) {
      const pr = projectPointOntoAxis(p, axis.x, axis.y);
      if (pr < minB) minB = pr;
      if (pr > maxB) maxB = pr;
    }
    if (maxA < minB - 1e-6 || maxB < minA - 1e-6) return false;
  }
  return true;
}
function shiftedDebugBox(db, dx, dy) {
  if (!db || !Array.isArray(db.corners)) return null;
  const corners = db.corners.map(p => ({ x: p.x + dx, y: p.y + dy }));
  return { corners, center: { x: db.center.x + dx, y: db.center.y + dy }, angle: db.angle, halfExtents: db.halfExtents };
}


function computeMaxNonOverlapScale(follower, leader, dt) {
  if (!follower || !leader || !follower.debugBox || !leader.debugBox) return 1.0;

  const axis = choosePathTangentAxis(follower, leader);
  const fMove = { x: axis.x * (follower.speed || 0) * dt, y: axis.y * (follower.speed || 0) * dt };
  const lMove = { x: axis.x * (leader.speed || 0) * dt, y: axis.y * (leader.speed || 0) * dt };

  const fFull = shiftedDebugBox(follower.debugBox, fMove.x, fMove.y);
  const lFull = shiftedDebugBox(leader.debugBox, lMove.x, lMove.y);
  if (!obbOverlapSAT(fFull, lFull)) return 1.0;

  if (obbOverlapSAT(follower.debugBox, leader.debugBox)) return 0.0;

  let lo = 0.0, hi = 1.0, best = 0.0;
  for (let iter = 0; iter < 24; iter++) {
    const mid = (lo + hi) / 2;
    const fMid = shiftedDebugBox(follower.debugBox, fMove.x * mid, fMove.y * mid);
    const lMid = shiftedDebugBox(leader.debugBox, lMove.x * mid, lMove.y * mid);
    if (!obbOverlapSAT(fMid, lMid)) {
      best = mid;
      lo = mid;
    } else {
      hi = mid;
    }
    if (hi - lo < 1e-5) break;
  }
  return Math.max(0, Math.min(1, best));
}


function computeLongitudinalGapUsingSamples(follower, leader) {
  if (!follower) return 1e9;
  if (!leader) return 1e9;

  const PREDICTION_TIME_MS = 120;
  const ANGLE_CLEARANCE_THRESHOLD = (30 * Math.PI / 180);
  const PATH_PROGRESS_CLEAR_THRESHOLD = 0.85;
  const LARGE_GAP = 1e6;

  const fAngle = (typeof follower.tangentAngle === 'number') ? follower.tangentAngle : (follower.debugBox && typeof follower.debugBox.angle === 'number' ? follower.debugBox.angle : null);
  const lAngle = (typeof leader.tangentAngle === 'number') ? leader.tangentAngle : (leader.debugBox && typeof leader.debugBox.angle === 'number' ? leader.debugBox.angle : null);

  const axis = choosePathTangentAxis(follower, leader);
  const ax = axis.x, ay = axis.y;
  const axisLen = Math.hypot(ax, ay) || 1;
  const nx = ax / axisLen, ny = ay / axisLen;

  const leaderProgress = (typeof leader.pathProgress === 'number') ? leader.pathProgress : null;
  if (leaderProgress !== null && leaderProgress >= PATH_PROGRESS_CLEAR_THRESHOLD) {
    return LARGE_GAP;
  }

  let angleDiff = 0;
  if (fAngle !== null && lAngle !== null) {
    angleDiff = Math.abs(Math.atan2(Math.sin(lAngle - fAngle), Math.cos(lAngle - fAngle)));
  }

  const projectAll = (pts) => {
    if (!Array.isArray(pts) || pts.length === 0) return null;
    let mn = Infinity, mx = -Infinity;
    for (const p of pts) {
      const pr = p.x * nx + p.y * ny;
      if (pr < mn) mn = pr;
      if (pr > mx) mx = pr;
    }
    return { min: mn, max: mx };
  };

  const fCL = (follower.debugBox && Array.isArray(follower.debugBox.centerlineSamples)) ? follower.debugBox.centerlineSamples : (buildCenterlineSamples(follower, 11) || null);
  const lCL = (leader.debugBox && Array.isArray(leader.debugBox.centerlineSamples)) ? leader.debugBox.centerlineSamples : (buildCenterlineSamples(leader, 11) || null);

  let followerFrontProj = null;
  let leaderRearProj = null;

  if (fCL && lCL) {
    const pf = projectAll(fCL);
    const pl = projectAll(lCL);
    if (pf && pl) {
      followerFrontProj = pf.max;
      leaderRearProj = pl.min;
    }
  }

  if ((followerFrontProj === null || leaderRearProj === null) && follower.debugBox && leader.debugBox) {
    const fPer = (Array.isArray(follower.debugBox.perimeterSamples)) ? follower.debugBox.perimeterSamples : buildPerimeterSamples(follower, 10);
    const lPer = (Array.isArray(leader.debugBox.perimeterSamples)) ? leader.debugBox.perimeterSamples : buildPerimeterSamples(leader, 10);

    if (fPer && lPer) {
      const pf = projectAll(fPer);
      const pl = projectAll(lPer);
      if (pf && pl) {
        followerFrontProj = followerFrontProj === null ? pf.max : Math.max(followerFrontProj, pf.max);
        leaderRearProj = leaderRearProj === null ? pl.min : Math.min(leaderRearProj, pl.min);
      }
    }
  }

  if ((followerFrontProj === null || leaderRearProj === null)) {
    const fFront = (typeof follower.frontX === 'number' && typeof follower.frontY === 'number') ? { x: follower.frontX, y: follower.frontY } : null;
    const lRear  = (typeof leader.rearX === 'number' && typeof leader.rearY === 'number') ? { x: leader.rearX, y: leader.rearY } : null;
    if (fFront) followerFrontProj = projectPointOntoAxis(fFront, nx, ny);
    if (lRear) leaderRearProj = projectPointOntoAxis(lRear, nx, ny);
  }

  if (followerFrontProj === null || leaderRearProj === null) {
    if (follower.debugBox && leader.debugBox && follower.debugBox.center && leader.debugBox.center) {
      const raw = Math.hypot(leader.debugBox.center.x - follower.debugBox.center.x, leader.debugBox.center.y - follower.debugBox.center.y);
      return Math.max(-1e6, raw - vehicleLengthPx(leader));
    }
    return 1e9;
  }

  const leaderSpeed = (typeof leader.speed === 'number') ? leader.speed : 0;
  const leaderRearPredicted = leaderRearProj + leaderSpeed * PREDICTION_TIME_MS;

  let rawGap = leaderRearPredicted - followerFrontProj;

  if (angleDiff > ANGLE_CLEARANCE_THRESHOLD) {
    const factor = Math.min(1.0, angleDiff / Math.PI);
    const relaxPx = Math.max(20, 60 * factor);
    rawGap += relaxPx;
  }

  if (leaderProgress !== null && leaderProgress > (PATH_PROGRESS_CLEAR_THRESHOLD - 0.15)) {
    rawGap += 40;
  }

  return rawGap;
}

function raySegmentIntersect(s, rd, a, sd) {
  const cross = (u, v) => u.x * v.y - u.y * v.x;
  const denom = cross(rd, sd);
  if (Math.abs(denom) < 1e-9) return null;
  const aMinusS = { x: a.x - s.x, y: a.y - s.y };
  const t = cross(aMinusS, sd) / denom;
  const u = cross(aMinusS, rd) / denom;
  if (t >= -1e-9 && t <= 1 + 1e-9 && u >= -1e-9 && u <= 1 + 1e-9) {
    return { t, u, x: s.x + rd.x * t, y: s.y + rd.y * t };
  }
  return null;
}
function getVehicleFrontPoint(v) {
  if (!v) return null;
  if (v.debugBox && v.debugBox.front) return { x: v.debugBox.front.x, y: v.debugBox.front.y };
  if (typeof v.frontX === 'number' && typeof v.frontY === 'number') return { x: v.frontX, y: v.frontY };
  if (v.debugBox && v.debugBox.center && typeof v.debugBox.angle === 'number') {
    const len = (v.debugBox.halfExtents?.halfL ?? (vehicleLengthPx(v) * 0.5));
    const heading = v.debugBox.angle;
    const fx = v.debugBox.center.x + Math.cos(heading) * len;
    const fy = v.debugBox.center.y + Math.sin(heading) * len;
    return { x: fx, y: fy };
  }
  if (typeof v.x === 'number' && typeof v.y === 'number') return { x: v.x, y: v.y };
  return null;
}
function getVehicleRearPoint(v) {
  if (!v) return null;
  if (v.debugBox && v.debugBox.rear) return { x: v.debugBox.rear.x, y: v.debugBox.rear.y };
  if (typeof v.rearX === 'number' && typeof v.rearY === 'number') return { x: v.rearX, y: v.rearY };
  if (v.debugBox && v.debugBox.center && typeof v.debugBox.angle === 'number') {
    const len = (v.debugBox.halfExtents?.halfL ?? (vehicleLengthPx(v) * 0.5));
    const heading = v.debugBox.angle;
    const rx = v.debugBox.center.x - Math.cos(heading) * len;
    const ry = v.debugBox.center.y - Math.sin(heading) * len;
    return { x: rx, y: ry };
  }
  if (v.debugBox && v.debugBox.center) return { x: v.debugBox.center.x, y: v.debugBox.center.y };
  if (typeof v.x === 'number' && typeof v.y === 'number') return { x: v.x, y: v.y };
  return null;
}

function signedDistFrontToEntryAlongHeading(v, entry) {
  const front = getVehicleFrontPoint(v);
  if (!front) return null;
  let heading = null;
  if (v.debugBox && typeof v.debugBox.angle === 'number') {
    heading = { x: Math.cos(v.debugBox.angle), y: Math.sin(v.debugBox.angle) };
  } else if (Array.isArray(v.debugBox?.centerlineSamples) && v.debugBox.centerlineSamples.length >= 2) {
    const cl = v.debugBox.centerlineSamples;
    heading = normalizeVec({ x: cl[cl.length - 1].x - cl[0].x, y: cl[cl.length - 1].y - cl[0].y });
  } else if (typeof v.frontX === 'number' && typeof v.rearX === 'number') {
    heading = normalizeVec({ x: v.frontX - v.rearX, y: v.frontY - v.rearY });
  } else {
    const dx = entry.x - front.x, dy = entry.y - front.y;
    return Math.hypot(dx, dy);
  }
  const dx = entry.x - front.x, dy = entry.y - front.y;
  return dx * heading.x + dy * heading.y;
}



function lookupLaneArrowValue(laneArrows, direction, laneIndex) {
  if (!laneArrows) return null;
  const tryKeys = [direction, String(direction), direction?.toLowerCase?.(), direction?.toUpperCase?.()].filter(Boolean);
  let arr = null;
  for (const k of tryKeys) {
    if (laneArrows[k] != null) { arr = laneArrows[k]; break; }
  }
  if (arr == null) {
    if (laneArrows.lanes && laneArrows.lanes[direction]) arr = laneArrows.lanes[direction];
    else if (laneArrows.arrowMap && laneArrows.arrowMap[direction]) arr = laneArrows.arrowMap[direction];
  }
  if (arr == null) return null;

  const idx = (typeof laneIndex === 'number' && Number.isFinite(laneIndex)) ? Math.floor(laneIndex) : null;

  if (Array.isArray(arr)) {
    const candidates = [];
    if (idx !== null) {
      candidates.push(idx);                       
      candidates.push(idx - 1);                   
      candidates.push(idx + 1);                   
      candidates.push(arr.length - 1 - idx);      
      candidates.push(arr.length - idx);          
      candidates.push(arr.length - 1 - (idx - 1));
    }
    candidates.push(0); candidates.push(arr.length - 1);
    for (const c of candidates) {
      if (typeof c === 'number' && c >= 0 && c < arr.length) {
        const val = arr[c];
        if (val != null) return val;
      }
    }
    const keyStrs = [String(idx), String(idx + 1), String(idx - 1)];
    for (const ks of keyStrs) { if (arr[ks] != null) return arr[ks]; }
    return null;
  }

  if (typeof arr === 'object') {
    const keys = [];
    if (idx !== null) { keys.push(String(idx), String(idx + 1), String(idx - 1)); }
    keys.push('0', '1');
    for (const k of keys) { if (arr[k] != null) return arr[k]; }
    if (typeof arr === 'string') return arr;
    for (const k in arr) { if (arr[k] != null) return arr[k]; }
    return null;
  }
  return arr;
}

// ----------------- MAIN updateAntrian -----------------
export function updateAntrian(vehicles, laneCoordinates, lampu, deltaTime, stopLineCfg, laneArrows) {
  if (!vehicles || vehicles.length === 0) return;
  if (deltaTime <= 0) return;

  const now = nowMs();
  const ltorActive = !!(stopLineCfg && (stopLineCfg.ltsorGlobal || stopLineCfg.ltsor || stopLineCfg.ltor));

  for (const v of vehicles) {
    if (!v) continue;
    fallbackSetDesiredSpeedIfMissing(v);
    v._idm = v._idm || {};
    v._idm.provisionalSpeed = undefined;
    v._idm.tlAllowedSpeed = undefined;
    v._idm.tlEnforced = false;
    v._idm.laserAllowedSpeed = undefined;
    v._idm.overlapAllowedSpeed = undefined;
    v._idm.overlapScale = 1.0;
    v._idm.overlapCandidateId = null;
    v._idm.laser = v._idm.laser || { hit: false, hits: [] };
    ensureSamplesForVehicle(v, { centerSamples: 11, perEdge: 10 });
  }

  // Lane Grouping
  const lanes = { utara: {}, timur: {}, selatan: {}, barat: {} };
  for (const v of vehicles) {
    if (!v || !v.direction || v.laneIndex == null) continue;
    if (!lanes[v.direction][v.laneIndex]) lanes[v.direction][v.laneIndex] = [];
    lanes[v.direction][v.laneIndex].push(v);
  }
  for (const arah of Object.keys(lanes)) {
    for (const lajur of Object.keys(lanes[arah])) {
      const list = lanes[arah][lajur];
      if (!list) continue;
      switch (arah) {
        case "utara": list.sort((a,b) => b.y - a.y); break;
        case "selatan": list.sort((a,b) => a.y - b.y); break;
        case "timur": list.sort((a,b) => a.x - b.x); break;
        case "barat": list.sort((a,b) => b.x - a.x); break;
      }
    }
  }

  const a = IDM_PARAMS.a;
  const b = IDM_PARAMS.b;
  const T_ms = IDM_PARAMS.T_s * 1000;
  const s0_px = IDM_PARAMS.s0_m * PX_PER_M;
  const delta = IDM_PARAMS.delta;

  // 1) IDM provisional
  for (const arah of Object.keys(lanes)) {
    for (const lajur of Object.keys(lanes[arah])) {
      const list = lanes[arah][lajur];
      if (!list || list.length === 0) continue;
      for (let i = 0; i < list.length; i++) {
        const veh = list[i];
        if (!veh) continue;
        const currentV = (typeof veh.speed === 'number') ? veh.speed : 0;
        const v0 = (typeof veh.desiredSpeed === 'number') ? veh.desiredSpeed : ((typeof veh.maxSpeed === 'number') ? veh.maxSpeed : Math.max(currentV, 1e-6));
        const leader = (i > 0) ? list[i - 1] : null;

        let gap = leader ? computeLongitudinalGapUsingSamples(veh, leader) : 1e9;
        if (!Number.isFinite(gap)) gap = 1e9;

        const vLeader = leader && typeof leader.speed === 'number' ? leader.speed : currentV;
        const deltaV = currentV - vLeader;

        const s_star = s0_px + currentV * T_ms + (currentV * deltaV) / (2 * Math.sqrt(Math.max(1e-12, a * b)));
        const safeGap = Math.max(1, gap);

        const freeTerm = 1 - Math.pow(Math.max(1e-8, currentV / Math.max(v0, 1e-8)), delta);
        const interactionTerm = Math.pow(Math.max(1e-8, s_star / safeGap), 2);
        let acc = a * (freeTerm - interactionTerm);
        const MAX_ACC = a * 4.0;
        const MAX_DEC = -b * 6.0;
        if (acc > MAX_ACC) acc = MAX_ACC;
        if (acc < MAX_DEC) acc = MAX_DEC;

        let newSpeed = currentV + acc * deltaTime;
        if (newSpeed < 0) newSpeed = 0;
        const SPEED_MARGIN = 0.0005;
        let cappedSpeed = Math.min(newSpeed, v0 + SPEED_MARGIN);

        const leaderMove = (leader && typeof leader.speed === 'number') ? (leader.speed * deltaTime) : 0;
        let maxMoveAllowed = Math.max(0, gap + leaderMove - SAFETY_BUFFER_PX);
        if (gap <= 0) maxMoveAllowed = 0;
        const maxAllowedSpeed = (deltaTime > 0) ? (maxMoveAllowed / deltaTime) : cappedSpeed;
        let finalAllowedSpeed = Math.max(0, Math.min(cappedSpeed, maxAllowedSpeed));
        if (gap <= SAFETY_BUFFER_PX * 0.5) finalAllowedSpeed = 0;

        veh._idm.provisionalSpeed = finalAllowedSpeed;
      }
    }
  }

  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  // ----------------- TRAFFIC LIGHT ENFORCEMENT -----------------
  try {
    if (lampu && laneCoordinates && laneCoordinates.entry) {

      function getYellowTimeLeftMs(lampuObj, direction) {
        if (!lampuObj) return null;
        if (lampuObj.timeLeft && typeof lampuObj.timeLeft[direction] === 'number') return lampuObj.timeLeft[direction];
        return null;
      }

      for (const v of vehicles) {
        if (!v || !v.direction || typeof v.laneIndex !== 'number') continue;
        v._idm = v._idm || {};
        v._idm.trafficLight = v._idm.trafficLight || {};

        if (typeof v._idm._heldTlAllowed === 'undefined') v._idm._heldTlAllowed = undefined;

        // Skip enforcement if just spawned (prevent immediate stop on edge)
        if (v.createdAt && (now - v.createdAt) < SPAWN_GRACE_MS) {
          v._idm.trafficLight.skipped = true;
          v._idm.tlAllowedSpeed = v._idm.provisionalSpeed;
          v._idm.tlEnforced = false;
          continue;
        }

        const entryKey = `${v.direction}_${v.laneIndex}`;
        const entry = laneCoordinates.entry ? laneCoordinates.entry[entryKey] : null;
        if (!entry) {
          v._idm.tlAllowedSpeed = v._idm.provisionalSpeed;
          v._idm.tlEnforced = false;
          continue;
        }

        const signedDist = signedDistFrontToEntryAlongHeading(v, entry);
        v._idm.trafficLight.signedFrontToEntry = signedDist;
        const passedEntry = (signedDist != null && signedDist <= 0);
        v._idm.trafficLight.passedEntry = !!passedEntry;

        if (v._idm.trafficLight.committedOnYellow) {
          const rear = getVehicleRearPoint(v);
          if (rear) {
            let heading = null;
             if (v.debugBox && typeof v.debugBox.angle === 'number') {
              heading = { x: Math.cos(v.debugBox.angle), y: Math.sin(v.debugBox.angle) };
            } else if (typeof v.frontX === 'number' && typeof v.rearX === 'number') {
              heading = normalizeVec({ x: v.frontX - v.rearX, y: v.frontY - v.rearY });
            }
            if (heading) {
              const dxr = entry.x - rear.x, dyr = entry.y - rear.y;
              const signedRear = dxr * heading.x + dyr * heading.y;
              if (signedRear <= 0) {
                v._idm.trafficLight.committedOnYellow = false;
                v._idm._heldTlAllowed = undefined;
              }
            }
          }
        }

        const light = (lampu && lampu.status) ? lampu.status[v.direction] : null;

        if (light === 'merah' && v._idm.trafficLight.committedOnYellow && !v._idm.trafficLight.passedEntry) {
          v._idm.trafficLight.committedOnYellow = false;
        }

        if (v._idm.trafficLight.passedEntry || v._idm.trafficLight.committedOnYellow) {
          v._idm.trafficLight.enforced = false;
          v._idm.tlAllowedSpeed = v._idm.provisionalSpeed;
          v._idm.tlEnforced = false;
          if (v._idm.trafficLight.passedEntry) v._idm._heldTlAllowed = undefined;
          continue;
        }

        const front = getVehicleFrontPoint(v);
        if (!front) {
          v._idm.tlAllowedSpeed = v._idm.provisionalSpeed;
          v._idm.tlEnforced = false;
          continue;
        }
        const dx = entry.x - front.x, dy = entry.y - front.y;
        const dist = Math.hypot(dx, dy);
        v._idm.trafficLight.frontDist = dist;

        
        
        
        
        
        
        
        
        
        // LTOR Bypass
        try {
          const laneArrowRaw = lookupLaneArrowValue(laneArrows, v.direction, v.laneIndex);
          const laneArrowNorm = (typeof laneArrowRaw === 'string') ? laneArrowRaw.toLowerCase() : null;
          const isExactLeft = laneArrowNorm === 'left' || laneArrowNorm === 'left-only';
          const isContainsLeft = (!isExactLeft && laneArrowNorm && laneArrowNorm.includes('left'));
          if (ltorActive && (isExactLeft || isContainsLeft) && (v.route === 'left' || v._forceLeft)) {
            v._idm.trafficLight.enforced = false;
            v._idm.tlAllowedSpeed = v._idm.provisionalSpeed;
            v._idm.tlEnforced = false;
            v._idm._heldTlAllowed = undefined;
            continue;
          }
        } catch (e) {}

        if (dist <= STOP_LOOKAHEAD_PX) {
          const stoppingDist = Math.max(0, dist - LASER_SAFE_STOP_PX - SAFETY_BUFFER_PX);
          const rampFactorRaw = Math.max(0, Math.min(1, stoppingDist / STOP_LOOKAHEAD_PX));
          const rampFactor = Math.pow(rampFactorRaw, TL_RAMP_EXP);
          const v0 = (v.desiredSpeed || v.maxSpeed || 0.0001);
          const desiredRampSpeed = v0 * rampFactor;

          const safeDecel = Math.max(1e-9, TL_COMFORT_DECEL);
          let allowedByDecel = Math.sqrt(2 * safeDecel * Math.max(0, stoppingDist));
          const allowedByMove = (deltaTime > 0) ? (stoppingDist / deltaTime) : 0;
          let allowedFromTL = Math.min(allowedByDecel, allowedByMove, desiredRampSpeed);
          if (stoppingDist <= SAFETY_BUFFER_PX * 0.5) allowedFromTL = 0;

          if (!light) {
            v._idm.tlAllowedSpeed = v._idm.provisionalSpeed;
            v._idm.tlEnforced = false;
            continue;
          }

          if (light === 'kuning') {
            const withinCommitDistance = dist <= YELLOW_COMMIT_DISTANCE_PX;
            const timeLeft = getYellowTimeLeftMs(lampu, v.direction);
            let canReachBeforeEnd = false;
            const currentSpeed = (typeof v.speed === 'number') ? v.speed : ((typeof v._idm.v === 'number') ? v._idm.v : 0);
            const speedForEst = Math.max(currentSpeed, YELLOW_MIN_SPEED_FOR_TIME_CHECK);

            if (timeLeft != null && timeLeft > 0) {
              const travelTimeMs = (speedForEst > 0) ? (dist / speedForEst) : Infinity;
              if (travelTimeMs <= Math.max(0, timeLeft - YELLOW_TIME_MARGIN_MS)) {
                canReachBeforeEnd = true;
              }
            }

            if (withinCommitDistance || canReachBeforeEnd) {
              v._idm.trafficLight.committedOnYellow = true;
              v._idm.trafficLight.enforced = false;
              v._idm.tlAllowedSpeed = v._idm.provisionalSpeed;
              v._idm.tlEnforced = false;
              v._idm._heldTlAllowed = undefined;
            } else {
              v._idm.trafficLight.enforced = true;
              v._idm.tlAllowedSpeed = allowedFromTL;
              v._idm.tlEnforced = true;
              if (typeof v._idm._heldTlAllowed !== 'number') v._idm._heldTlAllowed = allowedFromTL;
              else v._idm._heldTlAllowed = Math.min(v._idm._heldTlAllowed, allowedFromTL);
            }
          } else if (light === 'merah') {
            v._idm.trafficLight.enforced = true;
            v._idm.tlAllowedSpeed = allowedFromTL;
            v._idm.tlEnforced = true;
            v._idm.trafficLight.reason = 'red_stop';
            if (typeof v._idm._heldTlAllowed !== 'number') v._idm._heldTlAllowed = allowedFromTL;
            else v._idm._heldTlAllowed = Math.min(v._idm._heldTlAllowed, allowedFromTL);
            if (v._idm.trafficLight.committedOnYellow && !v._idm.trafficLight.passedEntry) {
              v._idm.trafficLight.committedOnYellow = false;
            }
          } else if (light === 'hijau') {
            v._idm.trafficLight.enforced = false;
            v._idm.tlAllowedSpeed = v._idm.provisionalSpeed;
            v._idm.tlEnforced = false;
            v._idm._heldTlAllowed = undefined;
          }
        } else {
          v._idm.trafficLight.enforced = false;
          v._idm.tlAllowedSpeed = v._idm.provisionalSpeed;
          v._idm.tlEnforced = false;
        }
        if (typeof v._idm._heldTlAllowed === 'number') {
          if (typeof v._idm.tlAllowedSpeed !== 'number') v._idm.tlAllowedSpeed = v._idm._heldTlAllowed;
          else v._idm.tlAllowedSpeed = Math.min(v._idm.tlAllowedSpeed, v._idm._heldTlAllowed);
        }
      }
    }
  } catch (e) {
    console.error('TL enforcement error', e);
  }

  // ----------------- LASER PROCESSING -----------------
  if (deltaTime > 0) {
    for (const v of vehicles) {
      if (!v) continue;
      v._idm = v._idm || {};
      v._idm.laser = { hit: false, hits: [] };

      // Spawn Grace for Laser
      if (v.createdAt && (now - v.createdAt) < SPAWN_GRACE_MS) {
        v._idm.laser.hit = false;
        v._idm.laserAllowedSpeed = v._idm.provisionalSpeed;
        continue;
      }

      if (!v._laser) {
        v._idm.laser.hit = false;
        v._idm.laserAllowedSpeed = v._idm.provisionalSpeed;
        continue;
      }

      const rays = [];
      if (v._laser.center && v._laser.center.start && v._laser.center.end) rays.push({ name: 'center', start: v._laser.center.start, end: v._laser.center.end });
      if (v._laser.left   && v._laser.left.start   && v._laser.left.end)   rays.push({ name: 'left',   start: v._laser.left.start,   end: v._laser.left.end });
      if (v._laser.right  && v._laser.right.start  && v._laser.right.end)  rays.push({ name: 'right',  start: v._laser.right.start,  end: v._laser.right.end });

      if (rays.length === 0) {
        v._idm.laser.hit = false;
        v._idm.laserAllowedSpeed = v._idm.provisionalSpeed;
        continue;
      }

      let bestHit = null;

      for (const other of vehicles) {
        if (!other || other === v) continue;
        if (!other.debugBox || !Array.isArray(other.debugBox.corners) || other.debugBox.corners.length < 4) continue;

        const corners = other.debugBox.corners;
        for (const ray of rays) {
          const s = { x: ray.start.x, y: ray.start.y };
          const rd = { x: ray.end.x - ray.start.x, y: ray.end.y - ray.start.y };
          const rayLen = Math.hypot(rd.x, rd.y) || LASER_LENGTH_PX;
          for (let ei = 0; ei < 4; ei++) {
            const a = corners[ei];
            const b = corners[(ei + 1) % 4];
            const sd = { x: b.x - a.x, y: b.y - a.y };
            const inter = raySegmentIntersect(s, rd, a, sd);
            if (!inter) continue;
            const t = inter.t;
            if (t < -1e-9 || t > 1 + 1e-9) continue;
            const dist = Math.max(0, t * rayLen);
            if (!bestHit || dist < bestHit.dist) {
              bestHit = { t, dist, x: inter.x, y: inter.y, edgeIndex: ei, other, rayName: ray.name };
            }
          }
        }
      }

      if (!bestHit) {
        v._idm.laser.hit = false;
        v._idm.laserAllowedSpeed = v._idm.provisionalSpeed;
        if (v._laser) { v._laser.hit = false; v._laser.hitId = null; v._laser.hitPoint = null; v._laser.edgeIndex = null; }
        v._idm._lastLaserCap = undefined;
        continue;
      }

      const distToHit = bestHit.dist;
      const stoppingDist = Math.max(0, distToHit - LASER_SAFE_STOP_PX);
      const safeDecel = Math.max(1e-9, TL_COMFORT_DECEL);
      const allowedByDecel = Math.sqrt(2 * safeDecel * Math.max(0, stoppingDist));
      const allowedByTTC = (deltaTime > 0) ? (stoppingDist / deltaTime) : allowedByDecel;
      let allowedFromLaser = Math.max(0, Math.min(allowedByDecel, allowedByTTC));

      const SMOOTH_ALPHA = 0.45;
      v._idm._lastLaserCap = (typeof v._idm._lastLaserCap === 'number') ? (SMOOTH_ALPHA * allowedFromLaser + (1 - SMOOTH_ALPHA) * v._idm._lastLaserCap) : allowedFromLaser;
      const appliedCap = Math.max(0, v._idm._lastLaserCap);

      v._idm.laser.hit = true;
      v._idm.laser.hits.push({
        ray: bestHit.rayName, otherId: bestHit.other.id, edgeIndex: bestHit.edgeIndex,
        point: { x: bestHit.x, y: bestHit.y }, dist: bestHit.dist, allowedSpeed: appliedCap
      });

      v._idm.laserAllowedSpeed = appliedCap;

      v._laser = v._laser || {};
      v._laser.hit = true;
      v._laser.hitId = bestHit.other.id;
      v._laser.hitPoint = { x: bestHit.x, y: bestHit.y };
      v._laser.edgeIndex = bestHit.edgeIndex;
      if (bestHit.rayName === 'center' && v._laser.center) { v._laser.center.hit = true; v._laser.center.hitPoint = { x: bestHit.x, y: bestHit.y }; }
      if (bestHit.rayName === 'left' && v._laser.left) { v._laser.left.hit = true; v._laser.left.hitPoint = { x: bestHit.x, y: bestHit.y }; }
      if (bestHit.rayName === 'right' && v._laser.right) { v._laser.right.hit = true; v._laser.right.hitPoint = { x: bestHit.x, y: bestHit.y }; }
    }
  }

  // 2) Overlap Prevention
  const all = vehicles.slice();
  for (let i = 0; i < all.length; i++) {
    const v = all[i];
    if (!v) continue;
    v._idm = v._idm || {};

    if (v.createdAt && (now - v.createdAt) < SPAWN_GRACE_MS) {
      v._idm.overlapScale = 1.0;
      v._idm.overlapCandidateId = null;
      v._idm.overlapAllowedSpeed = v._idm.provisionalSpeed;
      continue;
    }

    if (!v.debugBox) {
      v._idm.overlapScale = 1.0;
      v._idm.overlapCandidateId = null;
      v._idm.overlapAllowedSpeed = v._idm.provisionalSpeed;
      continue;
    }
    let bestScale = 1.0;
    let candidate = null;
    for (let j = 0; j < all.length; j++) {
      if (i === j) continue;
      const other = all[j];
      if (!other || !other.debugBox) continue;
      const dx = other.debugBox.center.x - v.debugBox.center.x;
      const dy = other.debugBox.center.y - v.debugBox.center.y;
      const dist2 = dx*dx + dy*dy;
      const vDiag = Math.hypot((v.debugBox.halfExtents?.halfL ?? vehicleLengthPx(v)/2), (v.debugBox.halfExtents?.halfW ?? (v.widthPx||10)/2));
      const oDiag = Math.hypot((other.debugBox.halfExtents?.halfL ?? vehicleLengthPx(other)/2), (other.debugBox.halfExtents?.halfW ?? (other.widthPx||10)/2));
      const threshold = (vDiag + oDiag + 80) * (vDiag + oDiag + 80);
      if (dist2 > threshold) continue;

      if (obbOverlapSAT(v.debugBox, other.debugBox)) {
        bestScale = 0;
        candidate = other.id;
        break;
      }

      const scale = computeMaxNonOverlapScale(v, other, deltaTime);
      if (!Number.isFinite(scale)) continue;
      if (scale < bestScale) {
        bestScale = scale;
        candidate = other.id;
        if (bestScale <= 0) break;
      }
    }

    v._idm.overlapScale = bestScale;
    v._idm.overlapCandidateId = candidate;
    if (bestScale < 1.0) {
      const intended = (typeof v._idm.cappedSpeed === 'number') ? v._idm.cappedSpeed : ((typeof v.maxSpeed === 'number') ? v.maxSpeed : (v._idm.provisionalSpeed || 0));
      const allowedFromIntended = Math.max(0, intended * bestScale);
      const allowedFromProvisional = Math.max(0, (v._idm.provisionalSpeed || 0) * bestScale);
      const newSpeed = Math.min(allowedFromIntended, allowedFromProvisional);
      v._idm.overlapAllowedSpeed = newSpeed;
    } else {
      v._idm.overlapAllowedSpeed = v._idm.provisionalSpeed;
    }
  }

  // ----------------- FINAL SPEED APPLY -----------------
  for (const v of vehicles) {
    if (!v) continue;
    v._idm = v._idm || {};

    const provisional = (typeof v._idm.provisionalSpeed === 'number') ? v._idm.provisionalSpeed : ((typeof v.speed === 'number') ? v.speed : 0);
    const tlAllowed = (typeof v._idm.tlAllowedSpeed === 'number') ? v._idm.tlAllowedSpeed : provisional;
    const laserAllowed = (typeof v._idm.laserAllowedSpeed === 'number') ? v._idm.laserAllowedSpeed : provisional;
    const overlapAllowed = (typeof v._idm.overlapAllowedSpeed === 'number') ? v._idm.overlapAllowedSpeed : provisional;

    let final = provisional;
    final = Math.min(final, tlAllowed, laserAllowed, overlapAllowed);
    final = Math.max(0, final);

    if (typeof v._idm._heldTlAllowed === 'number') {
      const held = v._idm._heldTlAllowed;
      if (held < MIN_ZERO_HELD_TL) final = 0;
      else final = Math.min(final, held);
    }

    const currentSpeed = (typeof v.speed === 'number') ? v.speed : 0;
    const MAX_FRAME_ACCEL_UP = (IDM_PARAMS.a * 4.0) * (deltaTime);
    const MAX_FRAME_DECEL_UP = (b * 6.0) * (deltaTime); 
    const maxDown = Math.max(0, currentSpeed - MAX_FRAME_DECEL_UP);
    const maxUp = currentSpeed + Math.max(0, MAX_FRAME_ACCEL_UP);

    final = Math.min(final, maxUp);
    final = Math.max(final, maxDown);

    if (v._idm.trafficLight && v._idm.trafficLight.enforced && v._idm.trafficLight.reason === 'red_stop' && typeof v._idm.trafficLight.frontDist === 'number') {
      const hardDist = LASER_SAFE_STOP_PX + SAFETY_BUFFER_PX + HARD_STOP_EXTRA_PX;
      if (v._idm.trafficLight.frontDist <= hardDist) {
        final = 0;
        v._idm.trafficLight.hardStopped = true;
      }
    }

    if (v._idm.laser && v._idm.laser.hit && typeof v._idm.laser.hits?.[0]?.dist === 'number') {
      if (v._idm.laser.hits[0].dist <= LASER_SAFE_STOP_PX + HARD_STOP_EXTRA_PX) final = 0;
    }

    if (final <= STOP_SPEED_FLOOR) final = 0;

    v.speed = final;
    v._idm.finalAppliedSpeed = final;
  }
}

// helper: count stopped vehicles
export function countStoppedVehicles(vehicles, threshold = 0.001) {
  const counts = { utara: 0, timur: 0, selatan: 0, barat: 0 };
  if (!vehicles || vehicles.length === 0) return counts;
  for (const v of vehicles) {
    if (!v || !v.direction) continue;
    if (typeof v.speed === 'number' && v.speed < threshold) counts[v.direction]++;
  }
  return counts;
}

// ----------------- STATISTIK PELAPORAN (REVISI TOTAL) -----------------

/**
 * Menghitung statistik Real-Time: Flow (Arus) & Queue (Antrian Nyata)
 * 
 * LOGIKA ANTRIAN BARU:
 * 1. Urutkan kendaraan berdasarkan jarak moncong depan ke stop line.
 * 2. Filter kendaraan yang baru spawn (Umur < SPAWN_IGNORE_QUEUE_MS) --> Efek Radar.
 * 3. Cari "Kepala Antrian" (First Vehicle):
 *    - Jarak moncong <= QUEUE_START_LIMIT_PX dari garis.
 *    - Kecepatan <= QUEUE_SPEED_TOLERANCE (mendukung merayap).
 * 4. Rangkai kendaraan di belakangnya (Chain):
 *    - Jarak Gap (Moncong Belakang - Ekor Depan) <= QUEUE_MAX_CHAIN_GAP_PX.
 *    - Kecepatan <= QUEUE_SPEED_TOLERANCE.
 * 5. Hitung Panjang: (Jarak Ekor Kendaraan Terakhir dari Garis) - (Jarak Moncong Kendaraan Pertama dari Garis).
 *    Ini merepresentasikan panjang fisik rangkaian kendaraan.
 */
export function getRealTimeTrafficStats(vehicles, entryCoords, laneCoordinates) {
  const crossingEvents = []; 
  const queues = {};         
  const now = nowMs();

  const toKey = (dir, laneIdx) => {
    const d = dir.charAt(0).toUpperCase() + dir.slice(1).toLowerCase();
    return `${d}-${laneIdx}`;
  };

  // Grouping per lajur
  const vehByLane = {};
  
  // Helper: Hitung jarak dari titik P ke Garis StopLine (hanya 1 sumbu)
  function getDistToLine(x, y, sl, dir) {
    switch (dir) {
      case 'utara':   return sl.y - y; // y kendaraan makin kecil saat mendekat (utara di atas, tapi koordinat y=0 di atas?) 
                                       // Asumsi Canvas: y=0 top, y=height bottom. Utara spawn di top (y kecil) gerak ke +y ?
                                       // Cek vehmov: spawn utara y=-margin, vy=1. Berarti gerak ke bawah.
                                       // Stopline di tengah. Jarak = sl.y - v.y (positif jika belum lewat).
      case 'selatan': return y - sl.y; // Spawn bawah, gerak ke atas (vy=-1). Jarak = v.y - sl.y.
      case 'timur':   return x - sl.x; // Spawn kanan, gerak ke kiri (vx=-1). Jarak = v.x - sl.x.
      case 'barat':   return sl.x - x; // Spawn kiri, gerak ke kanan (vx=1). Jarak = sl.x - v.x.
    }
    return 0;
  }

  vehicles.forEach(v => {
    if (!v.direction || v.laneIndex === undefined) return;
    const coordKey = `${v.direction.toLowerCase()}_${v.laneIndex}`;
    const sl = entryCoords[coordKey];
    if (!sl) return;

    // --- DETEKSI ARUS (CROSSING) ---
    if (!v.hasCrossed) {
      let passed = false;
      const tol = 5; 
      switch (v.direction) {
        case 'utara':   if (v.y > sl.y + tol) passed = true; break;
        case 'selatan': if (v.y < sl.y - tol) passed = true; break;
        case 'timur':   if (v.x < sl.x - tol) passed = true; break;
        case 'barat':   if (v.x > sl.x + tol) passed = true; break;
      }

      if (passed) {
        v.hasCrossed = true;
        crossingEvents.push({
          id: v.id, type: v.type, direction: v.direction, lane: v.laneIndex
        });
      }
    }

    const key = toKey(v.direction, v.laneIndex);
    if (!vehByLane[key]) vehByLane[key] = { list: [], stopLine: sl, dir: v.direction };
    vehByLane[key].list.push(v);
  });

  // --- HITUNG ANTRIAN PER LAJUR ---
  for (const key in vehByLane) {
    const group = vehByLane[key];
    const rawList = group.list;
    const sl = group.stopLine;
    const dir = group.dir;

    // 1. Filter: Hanya kendaraan yang BELUM lewat garis DAN SUDAH "matang" (bukan baru spawn)
    const candidates = rawList.filter(v => {
      if (v.hasCrossed) return false;
      // "Radar" Logic: Abaikan kendaraan yang umurnya < SPAWN_IGNORE_QUEUE_MS
      if (v.createdAt && (now - v.createdAt) < SPAWN_IGNORE_QUEUE_MS) return false;
      return true;
    });

    // 2. Sort: Dari yang terdekat ke garis (jarak kecil) ke yang terjauh
    candidates.sort((a, b) => {
      const distA = getDistToLine(getVehicleFrontPoint(a).x, getVehicleFrontPoint(a).y, sl, dir);
      const distB = getDistToLine(getVehicleFrontPoint(b).x, getVehicleFrontPoint(b).y, sl, dir);
      return distA - distB;
    });

    // 3. Cari Kepala Antrian (First Stopped Vehicle)
    let firstIdx = -1;
    for (let i = 0; i < candidates.length; i++) {
      const v = candidates[i];
      const frontDist = getDistToLine(getVehicleFrontPoint(v).x, getVehicleFrontPoint(v).y, sl, dir);
      const speed = Math.abs(v.speed || 0);

      // Syarat Kepala: Jarak < Limit (misal 20m) DAN Kecepatan < Toleransi (Merayap)
      if (frontDist <= QUEUE_START_LIMIT_PX && speed <= QUEUE_SPEED_TOLERANCE) {
        firstIdx = i;
        break; 
      }
    }

    if (firstIdx === -1) {
      // Tidak ada antrian
      queues[key] = 0;
      continue;
    }

    // 4. Rangkai ke belakang (Chain)
    let lastIdx = firstIdx;
    for (let i = firstIdx + 1; i < candidates.length; i++) {
      const prev = candidates[i - 1];
      const curr = candidates[i];

      // Jarak fisik: Moncong Curr - (Moncong Prev + Panjang Prev) = Gap
      const prevFrontDist = getDistToLine(getVehicleFrontPoint(prev).x, getVehicleFrontPoint(prev).y, sl, dir);
      const currFrontDist = getDistToLine(getVehicleFrontPoint(curr).x, getVehicleFrontPoint(curr).y, sl, dir);
      
      const prevLen = vehicleLengthPx(prev);
      const gap = currFrontDist - (prevFrontDist + prevLen);
      const speed = Math.abs(curr.speed || 0);

      // Syarat Chain: Gap kecil DAN Speed merayap/berhenti
      if (gap <= QUEUE_MAX_CHAIN_GAP_PX && speed <= QUEUE_SPEED_TOLERANCE) {
        lastIdx = i;
      } else {
        break; // Rantai putus
      }
    }

    // 5. Hitung Panjang Fisik Antrian
    // Rumus: (Posisi Ekor Terakhir) - (Posisi Moncong Pertama)
    // Ekor Terakhir = Moncong Terakhir + Panjang Terakhir
    const vFirst = candidates[firstIdx];
    const vLast = candidates[lastIdx];

    const distFrontFirst = getDistToLine(getVehicleFrontPoint(vFirst).x, getVehicleFrontPoint(vFirst).y, sl, dir);
    const distFrontLast = getDistToLine(getVehicleFrontPoint(vLast).x, getVehicleFrontPoint(vLast).y, sl, dir);
    const lenLast = vehicleLengthPx(vLast);

    const distRearLast = distFrontLast + lenLast;
    const queuePx = distRearLast - distFrontFirst;

    queues[key] = Math.max(0, queuePx / PX_PER_M);
  }

  return { crossingEvents, queues };
}