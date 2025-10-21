// antrian.js (revisi: perbaikan bug kendaraan yang sudah melewati entry jadi rem saat kuning)
// Penjelasan ringkas: tambahkan detection "passedEntry" (signed distance), dan commit-on-yellow
// sehingga kendaraan yang sudah melewati mulut persimpangan/titik entry tidak akan direm kembali.

const PX_PER_M = 10;
const DEFAULT_VEHICLE_LENGTH_M = 4.5;
const DEFAULT_MIN_GAP_M = 2.0;

const LASER_LENGTH_PX = 30;
const LASER_SAFE_STOP_PX = 15;
const SPAWN_GRACE_MS = 3500;

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

// yellow commit tuning
const YELLOW_COMMIT_DISTANCE_M = 4.0;
const YELLOW_COMMIT_DISTANCE_PX = YELLOW_COMMIT_DISTANCE_M * PX_PER_M;
const YELLOW_TIME_MARGIN_MS = 300;
const YELLOW_MIN_SPEED_FOR_TIME_CHECK = 0.00005;

// helper time
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
  if (!v || !v.debugBox) return;
  const nCenter = opts.centerSamples || 9;
  const perEdge = opts.perEdge || 8;
  buildCenterlineSamples(v, nCenter);
  buildPerimeterSamples(v, perEdge);
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
  const fMove = { x: (follower.vx || 0) * follower.speed * dt, y: (follower.vy || 0) * follower.speed * dt };
  const lMove = { x: (leader.vx || 0) * leader.speed * dt, y: (leader.vy || 0) * leader.speed * dt };

  const fFull = shiftedDebugBox(follower.debugBox, fMove.x, fMove.y);
  const lFull = shiftedDebugBox(leader.debugBox, lMove.x, lMove.y);
  if (!obbOverlapSAT(fFull, lFull)) return 1.0;

  if (obbOverlapSAT(follower.debugBox, leader.debugBox)) return 0.0;

  let lo = 0.0, hi = 1.0, best = 0.0;
  for (let iter = 0; iter < 22; iter++) {
    const mid = (lo + hi) / 2;
    const fMid = shiftedDebugBox(follower.debugBox, fMove.x * mid, fMove.y * mid);
    const lMid = shiftedDebugBox(leader.debugBox, lMove.x * mid, lMove.y * mid);
    if (!obbOverlapSAT(fMid, lMid)) {
      best = mid;
      lo = mid;
    } else {
      hi = mid;
    }
    if (hi - lo < 1e-4) break;
  }
  return Math.max(0, Math.min(1, best));
}
function computeLongitudinalGapUsingSamples(follower, leader) {
  if (!follower) return 1e9;
  let axisAngle = null;
  if (follower.debugBox && typeof follower.debugBox.angle === 'number') axisAngle = follower.debugBox.angle;
  else if (typeof follower.frontX === 'number' && typeof follower.rearX === 'number') {
    const dx = follower.frontX - follower.rearX, dy = follower.frontY - follower.rearY;
    axisAngle = Math.atan2(dy, dx);
  } else axisAngle = 0;
  const ax = Math.cos(axisAngle), ay = Math.sin(axisAngle);

  const fCL = (follower.debugBox && Array.isArray(follower.debugBox.centerlineSamples)) ? follower.debugBox.centerlineSamples : (buildCenterlineSamples(follower, 9) || null);
  const lCL = (leader && leader.debugBox && Array.isArray(leader.debugBox.centerlineSamples)) ? leader.debugBox.centerlineSamples : (leader ? buildCenterlineSamples(leader, 9) : null);

  if (fCL && lCL) {
    let frontProj = -Infinity;
    for (const p of fCL) {
      const pr = projectPointOntoAxis(p, ax, ay);
      if (pr > frontProj) frontProj = pr;
    }
    let rearProj = Infinity;
    for (const p of lCL) {
      const pr = projectPointOntoAxis(p, ax, ay);
      if (pr < rearProj) rearProj = pr;
    }
    return rearProj - frontProj;
  }

  const fPer = (follower.debugBox && Array.isArray(follower.debugBox.perimeterSamples)) ? follower.debugBox.perimeterSamples : (buildPerimeterSamples(follower, 8) || null);
  const lPer = (leader && leader.debugBox && Array.isArray(leader.debugBox.perimeterSamples)) ? leader.debugBox.perimeterSamples : (leader ? buildPerimeterSamples(leader, 8) : null);

  if (fPer && lPer) {
    const centerProj = projectPointOntoAxis(follower.debugBox.center, ax, ay);
    let frontProj = -Infinity;
    for (const p of fPer) {
      const pr = projectPointOntoAxis(p, ax, ay);
      if (pr >= centerProj && pr > frontProj) frontProj = pr;
    }
    if (!isFinite(frontProj) || frontProj === -Infinity) {
      for (const p of fPer) {
        const pr = projectPointOntoAxis(p, ax, ay);
        if (pr > frontProj) frontProj = pr;
      }
    }

    const leaderCenterProj = projectPointOntoAxis(leader.debugBox.center, ax, ay);
    let rearProj = Infinity;
    for (const p of lPer) {
      const pr = projectPointOntoAxis(p, ax, ay);
      if (pr <= leaderCenterProj && pr < rearProj) rearProj = pr;
    }
    if (!isFinite(rearProj) || rearProj === Infinity) {
      for (const p of lPer) {
        const pr = projectPointOntoAxis(p, ax, ay);
        if (pr < rearProj) rearProj = pr;
      }
    }

    return rearProj - frontProj;
  }

  if (follower && leader) {
    const fFront = (typeof follower.frontX === 'number' && typeof follower.frontY === 'number') ? { x: follower.frontX, y: follower.frontY } : null;
    const lRear = (typeof leader.rearX === 'number' && typeof leader.rearY === 'number') ? { x: leader.rearX, y: leader.rearY } : null;
    if (fFront && lRear) {
      const pf = projectPointOntoAxis(fFront, ax, ay);
      const pl = projectPointOntoAxis(lRear, ax, ay);
      return pl - pf;
    }
  }

  if (follower && leader) {
    const raw = Math.hypot(leader.debugBox ? (leader.debugBox.center.x - follower.debugBox.center.x) : (leader.x - follower.x),
                           leader.debugBox ? (leader.debugBox.center.y - follower.debugBox.center.y) : (leader.y - follower.y));
    return Math.max(-1e6, raw - vehicleLengthPx(leader));
  }
  return 1e9;
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
  // fallback: center
  if (v.debugBox && v.debugBox.center) return { x: v.debugBox.center.x, y: v.debugBox.center.y };
  if (typeof v.x === 'number' && typeof v.y === 'number') return { x: v.x, y: v.y };
  return null;
}

// --- helper: compute signed distance along vehicle heading from front to entry
function signedDistFrontToEntryAlongHeading(v, entry) {
  const front = getVehicleFrontPoint(v);
  if (!front) return null;
  // heading vector: from rear to front if available or from debugBox.angle
  let heading = null;
  if (v.debugBox && typeof v.debugBox.angle === 'number') {
    heading = { x: Math.cos(v.debugBox.angle), y: Math.sin(v.debugBox.angle) };
  } else if (Array.isArray(v.debugBox?.centerlineSamples) && v.debugBox.centerlineSamples.length >= 2) {
    const cl = v.debugBox.centerlineSamples;
    const a = cl[cl.length - 1];
    const b = cl[0];
    heading = normalizeVec({ x: a.x - b.x, y: a.y - b.y });
  } else if (typeof v.frontX === 'number' && typeof v.rearX === 'number') {
    heading = normalizeVec({ x: v.frontX - v.rearX, y: v.frontY - v.rearY });
  } else {
    // fallback to vector from front -> entry (absolute dist, not signed)
    const dx = entry.x - front.x, dy = entry.y - front.y;
    return Math.hypot(dx, dy);
  }
  const dx = entry.x - front.x, dy = entry.y - front.y;
  return dx * heading.x + dy * heading.y; // positive if entry is ahead along heading, negative if front passed entry
}

// ----------------- MAIN updateAntrian -----------------
export function updateAntrian(vehicles, laneCoordinates, lampu, deltaTime, stopLineCfg) {
  if (!vehicles || vehicles.length === 0) return;
  if (deltaTime <= 0) return;

  const now = nowMs();

  // prepare vehicles
  for (const v of vehicles) {
    fallbackSetDesiredSpeedIfMissing(v);
    v._idm = v._idm || {};
    if (!v.debugBox) continue;
    ensureSamplesForVehicle(v, { centerSamples: 9, perEdge: 10 });
  }

  // lane grouping
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
        const EPS_MIN_SPEED = 1e-8;
        let finalAllowedSpeed = Math.max(0, Math.max(EPS_MIN_SPEED, Math.min(cappedSpeed, maxAllowedSpeed)));
        if (gap <= SAFETY_BUFFER_PX * 0.5) finalAllowedSpeed = 0;

        veh._idm = veh._idm || {};
        veh._idm.acc = acc;
        veh._idm.gap = gap;
        veh._idm.s_star = s_star;
        veh._idm.v = currentV;
        veh._idm.v0 = v0;
        veh._idm.deltaV = deltaV;
        veh._idm.leaderId = leader ? leader.id : null;
        veh._idm.leaderSpeed = leader ? leader.speed : null;
        veh._idm.leaderMove = leaderMove;
        veh._idm.maxMoveAllowed = maxMoveAllowed;
        veh._idm.maxAllowedSpeed = maxAllowedSpeed;
        veh._idm.cappedSpeed = cappedSpeed;
        veh._idm.finalAllowedSpeed = finalAllowedSpeed;

        veh.speed = finalAllowedSpeed;
      }
    }
  }

  // ----------------- TRAFFIC LIGHT ENFORCEMENT (fix: passedEntry + commit-on-yellow) -----------------
  try {
    if (lampu && laneCoordinates && laneCoordinates.entry) {

      function getYellowTimeLeftMs(lampuObj, direction) {
        if (!lampuObj) return null;
        if (lampuObj.timeLeft && typeof lampuObj.timeLeft[direction] === 'number') return lampuObj.timeLeft[direction];
        if (lampuObj.remaining && typeof lampuObj.remaining[direction] === 'number') return lampuObj.remaining[direction];
        if (lampuObj.timeRemaining && typeof lampuObj.timeRemaining[direction] === 'number') return lampuObj.timeRemaining[direction];
        if (lampuObj.timers && lampuObj.timers[direction] && typeof lampuObj.timers[direction].remaining === 'number') return lampuObj.timers[direction].remaining;
        return null;
      }

      for (const v of vehicles) {
        if (!v || !v.direction || typeof v.laneIndex !== 'number') continue;

        v._idm = v._idm || {};
        v._idm.trafficLight = v._idm.trafficLight || {};

        if (v.createdAt && (now - v.createdAt) < SPAWN_GRACE_MS) {
          v._idm.trafficLight.skipped = true;
          continue;
        }

        const entryKey = `${v.direction}_${v.laneIndex}`;
        const entry = laneCoordinates.entry ? laneCoordinates.entry[entryKey] : null;
        if (!entry) continue;

        const signedDist = signedDistFrontToEntryAlongHeading(v, entry);
        // store signedDist for debug
        v._idm.trafficLight.signedFrontToEntry = signedDist;

        // determine passedEntry by signed dist (<= 0 means front at/after entry)
        const passedEntry = (signedDist != null && signedDist <= 0);
        v._idm.trafficLight.passedEntry = !!passedEntry;

        // if previously committed on yellow, check if rear has cleared entry to release commit
        if (v._idm.trafficLight.committedOnYellow) {
          const rear = getVehicleRearPoint(v);
          if (rear) {
            // compute signed rear->entry along same heading (approx by projecting vector onto heading built from debugBox.angle/rear->front)
            // reuse signedDistFrontToEntry but for rear: build temp obj with front=rear & rear move slightly backwards not necessary; approximate by computing vector along v.debugBox.angle
            let heading = null;
            if (v.debugBox && typeof v.debugBox.angle === 'number') {
              heading = { x: Math.cos(v.debugBox.angle), y: Math.sin(v.debugBox.angle) };
            } else if (Array.isArray(v.debugBox?.centerlineSamples) && v.debugBox.centerlineSamples.length >= 2) {
              const cl = v.debugBox.centerlineSamples;
              heading = normalizeVec({ x: cl[cl.length - 1].x - cl[0].x, y: cl[cl.length - 1].y - cl[0].y });
            } else {
              heading = null;
            }
            if (heading) {
              const dxr = entry.x - rear.x, dyr = entry.y - rear.y;
              const signedRear = dxr * heading.x + dyr * heading.y;
              // once rear has passed (signedRear <= 0), release committedOnYellow
              if (signedRear <= 0) {
                v._idm.trafficLight.committedOnYellow = false;
                v._idm.trafficLight.committedReleasedAt = now;
              }
            }
          }
        }

        // if passedEntry or currently committed => do not enforce TL stop
        if (v._idm.trafficLight.passedEntry || v._idm.trafficLight.committedOnYellow) {
          v._idm.trafficLight.enforced = false;
          v._idm.trafficLight.reason = v._idm.trafficLight.passedEntry ? 'already_past_entry' : 'committed_on_yellow';
          continue;
        }

        // otherwise normal TL reaction if within lookahead
        const front = getVehicleFrontPoint(v);
        if (!front) continue;
        const dx = entry.x - front.x, dy = entry.y - front.y;
        const dist = Math.hypot(dx, dy);
        v._idm.trafficLight.frontDist = dist;

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

          const light = (lampu && lampu.status) ? lampu.status[v.direction] : null;
          if (!light) continue;

          if (light === 'kuning') {
            // Decide commit-or-stop
            const withinCommitDistance = dist <= YELLOW_COMMIT_DISTANCE_PX;

            const timeLeft = getYellowTimeLeftMs(lampu, v.direction); // ms or null
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
              // Commit: allow vehicle to continue. Mark committedOnYellow to prevent future TL enforcement
              v._idm.trafficLight.committedOnYellow = true;
              v._idm.trafficLight.enforced = false;
              v._idm.trafficLight.yellowCommit = true;
              v._idm.trafficLight.reason = withinCommitDistance ? 'yellow_commit_close' : 'yellow_commit_time';
              // leave v.speed as IDM provisional
            } else {
              // Stop as before
              v._idm.trafficLight.enforced = true;
              v._idm.trafficLight.allowed = allowedFromTL;
              v._idm.trafficLight.desiredRampSpeed = desiredRampSpeed;
              v._idm.trafficLight.allowedByDecel = allowedByDecel;
              v._idm.trafficLight.allowedByMove = allowedByMove;
              v._idm.trafficLight.stoppingDist = stoppingDist;
              v._idm.trafficLight.rampFactor = rampFactorRaw;

              const currentV = (typeof v._idm.v === 'number') ? v._idm.v : (typeof v.speed === 'number' ? v.speed : 0);
              const intended = (typeof v.speed === 'number') ? v.speed : 0;
              const targetAfterTL = Math.min(intended, allowedFromTL);
              const maxDecelPerFrame = safeDecel * deltaTime;
              let newSpeed;
              if (targetAfterTL < currentV - maxDecelPerFrame) newSpeed = Math.max(0, currentV - maxDecelPerFrame);
              else newSpeed = Math.max(0, targetAfterTL);
              v.speed = Math.min(v.speed || newSpeed, newSpeed);
              if (allowedFromTL === 0) v.speed = 0;
              v._idm.trafficLight.reason = 'stop_on_yellow';
            }
          } else if (light === 'merah') {
            v._idm.trafficLight.enforced = true;
            v._idm.trafficLight.allowed = allowedFromTL;
            v._idm.trafficLight.desiredRampSpeed = desiredRampSpeed;
            v._idm.trafficLight.allowedByDecel = allowedByDecel;
            v._idm.trafficLight.allowedByMove = allowedByMove;
            v._idm.trafficLight.stoppingDist = stoppingDist;
            v._idm.trafficLight.rampFactor = rampFactorRaw;

            const currentV = (typeof v._idm.v === 'number') ? v._idm.v : (typeof v.speed === 'number' ? v.speed : 0);
            const intended = (typeof v.speed === 'number') ? v.speed : 0;
            const targetAfterTL = Math.min(intended, allowedFromTL);
            const maxDecelPerFrame = safeDecel * deltaTime;
            let newSpeed;
            if (targetAfterTL < currentV - maxDecelPerFrame) newSpeed = Math.max(0, currentV - maxDecelPerFrame);
            else newSpeed = Math.max(0, targetAfterTL);
            v.speed = Math.min(v.speed || newSpeed, newSpeed);
            if (allowedFromTL === 0) v.speed = 0;
            v._idm.trafficLight.reason = 'red_stop';
          } else if (light === 'hijau') {
            v._idm.trafficLight.enforced = false;
            v._idm.trafficLight.reason = 'green';
          }
        } else {
          v._idm.trafficLight.enforced = false;
          v._idm.trafficLight.reason = 'out_of_lookahead';
        }
      }
    }
  } catch (e) {
    // resilient: do not break update loop
    console.error('TL enforcement error', e);
  }

  // ----------------- LASER PROCESSING (unchanged) -----------------
  if (deltaTime > 0) {
    for (const v of vehicles) {
      if (!v) continue;

      v._idm = v._idm || {};
      v._idm.laser = { hit: false, hits: [] };

      if (v.createdAt && (now - v.createdAt) < SPAWN_GRACE_MS) {
        if (v._laser) { v._laser.hit = false; v._laser.hitId = null; v._laser.hitPoint = null; v._laser.edgeIndex = null; }
        continue;
      }

      if (!v._laser) {
        if (v._laser) { v._laser.hit = false; v._laser.hitId = null; v._laser.hitPoint = null; }
        continue;
      }

      const rays = [];
      if (v._laser.center && v._laser.center.start && v._laser.center.end) rays.push({ name: 'center', start: v._laser.center.start, end: v._laser.center.end, meta: v._laser.center });
      if (v._laser.left   && v._laser.left.start   && v._laser.left.end)   rays.push({ name: 'left',   start: v._laser.left.start,   end: v._laser.left.end,   meta: v._laser.left });
      if (v._laser.right  && v._laser.right.start  && v._laser.right.end)  rays.push({ name: 'right',  start: v._laser.right.start,  end: v._laser.right.end,  meta: v._laser.right });

      if (rays.length === 0) {
        if (v._laser) { v._laser.hit = false; v._laser.hitId = null; v._laser.hitPoint = null; }
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
            if (ei === 2) continue; // ignore rear edge
            if (!bestHit || dist < bestHit.dist) {
              bestHit = { t, dist, x: inter.x, y: inter.y, edgeIndex: ei, other, rayName: ray.name };
            }
          }
        }
      }

      v._laser.hit = false; v._laser.hitId = null; v._laser.hitPoint = null;
      if (v._laser.center) { v._laser.center.hit = false; v._laser.center.hitPoint = null; }
      if (v._laser.left)   { v._laser.left.hit = false; v._laser.left.hitPoint = null; }
      if (v._laser.right)  { v._laser.right.hit = false; v._laser.right.hitPoint = null; }

      if (bestHit) {
        const distToHit = bestHit.dist;
        const stoppingDist = Math.max(0, distToHit - LASER_SAFE_STOP_PX);
        const allowedFromLaser = Math.max(0, stoppingDist / deltaTime);

        v._idm.laser.hit = true;
        v._idm.laser.hits.push({
          ray: bestHit.rayName, otherId: bestHit.other.id, edgeIndex: bestHit.edgeIndex,
          point: { x: bestHit.x, y: bestHit.y }, dist: bestHit.dist, allowedSpeed: allowedFromLaser
        });

        v._laser.hit = true;
        v._laser.hitId = bestHit.other.id;
        v._laser.hitPoint = { x: bestHit.x, y: bestHit.y };
        v._laser.edgeIndex = bestHit.edgeIndex;

        if (bestHit.rayName === 'center' && v._laser.center) {
          v._laser.center.hit = true; v._laser.center.hitPoint = { x: bestHit.x, y: bestHit.y };
        } else if (bestHit.rayName === 'left' && v._laser.left) {
          v._laser.left.hit = true; v._laser.left.hitPoint = { x: bestHit.x, y: bestHit.y };
        } else if (bestHit.rayName === 'right' && v._laser.right) {
          v._laser.right.hit = true; v._laser.right.hitPoint = { x: bestHit.x, y: bestHit.y };
        }

        if (typeof v.speed === 'number') {
          v.speed = Math.max(0, Math.min(v.speed, allowedFromLaser));
        } else {
          v.speed = allowedFromLaser;
        }

        continue;
      } else {
        v._idm.laser.hit = false;
        v._laser.hit = false; v._laser.hitId = null; v._laser.hitPoint = null; v._laser.edgeIndex = null;
      }
    }
  }

  // 2) overlap prevention (unchanged)
  const all = vehicles.slice();
  for (let i = 0; i < all.length; i++) {
    const v = all[i];
    if (!v) continue;
    v._idm = v._idm || {};

    if (v.createdAt && (now - v.createdAt) < SPAWN_GRACE_MS) {
      v._idm.overlapScale = 1.0;
      v._idm.overlapCandidateId = null;
      v._idm.overlapAllowedSpeed = v.speed;
      continue;
    }

    if (!v.debugBox) {
      v._idm.overlapScale = 1.0;
      v._idm.overlapCandidateId = null;
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

    if (bestScale < 1.0) {
      const intended = (typeof v._idm.cappedSpeed === 'number') ? v._idm.cappedSpeed : ((typeof v.maxSpeed === 'number') ? v.maxSpeed : v.speed);
      const allowedFromIntended = Math.max(0, intended * bestScale);
      const allowedFromProvisional = Math.max(0, (v.speed || 0) * bestScale);
      const newSpeed = Math.min(allowedFromIntended, allowedFromProvisional);
      v._idm.overlapCandidateId = candidate;
      v._idm.overlapScale = bestScale;
      v._idm.overlapAllowedSpeed = newSpeed;
      v.speed = Math.max(0, newSpeed);
    } else {
      v._idm.overlapCandidateId = null;
      v._idm.overlapScale = 1.0;
      v._idm.overlapAllowedSpeed = v.speed;
    }
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
