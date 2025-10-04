// vehmov.js (dua-titik axle model: rear & front mengikuti path — truk seperti gerbong)
export function createVehMovController(options = {}) {
  const config = options.config || {};
  const laneCoordinates = options.laneCoordinates || { entry: {}, exit: {} };
  const exitLaneNumbers = options.exitLaneNumbers || {};
  let trafficConfig = options.trafficConfig || {};
  const laneArrows = options.laneArrows || {};
  const canvasSize = options.canvasSize || { width: 800, height: 800 };

  const ANGLE_ADJUST = Math.PI;

  const truckWheelbaseMeters = options.truckWheelbaseMeters ?? 5.8;
  const truckLengthMeters = options.truckLengthMeters ?? 12.0;
  const truckFrontOverhangMeters = options.truckFrontOverhangMeters ?? 1.0;
  const truckRearOverhangMeters = options.truckRearOverhangMeters ?? 3.5;
  const truckAxleSpacing = options.truckAxleSpacing || { frontToFirstRear: 5.8, firstRearToSecondRear: 1.3 };

  const vehicles = [];
  const nextSpawnTimes = { utara: 0, timur: 0, selatan: 0, barat: 0 };
  let nextId = 1;

  function nowMs() { return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now(); }
  function skalaPx() { return (config.skala_px || 10) * 3; }
  const PX_PER_M = 10;

  function normalize(v) {
    const L = Math.hypot(v.x || 0, v.y || 0);
    if (L <= 1e-9) return { x: 1, y: 0 };
    return { x: v.x / L, y: v.y / L };
  }

  function getExponentialInterval(flowPerHour) {
    if (!flowPerHour || flowPerHour <= 0) return Infinity;
    const meanSeconds = 3600 / flowPerHour;
    const u = Math.random();
    return -Math.log(1 - u) * meanSeconds * 1000;
  }

  function spawnPositionFor(arah, laneIndexZeroBased) {
    const s = skalaPx();
    const offset = (laneIndexZeroBased + 0.5) * s;
    let x = 0, y = 0, vx = 0, vy = 0;
    switch (arah) {
      case 'utara': x = canvasSize.width / 2 + offset; y = -20; vx = 0; vy = 1; break;
      case 'timur': x = canvasSize.width + 20; y = canvasSize.height / 2 + offset; vx = -1; vy = 0; break;
      case 'selatan': x = canvasSize.width / 2 - offset; y = canvasSize.height + 20; vx = 0; vy = -1; break;
      case 'barat': x = -20; y = canvasSize.height / 2 - offset; vx = 1; vy = 0; break;
      default: x = canvasSize.width / 2; y = -20; vx = 0; vy = 1;
    }
    return { x, y, vx, vy };
  }

  // ---------- geometry helpers ----------
  function linePointAt(t, p0, p1) { return { x: p0.x + (p1.x - p0.x) * t, y: p0.y + (p1.y - p0.y) * t }; }
  function lineTangent(p0, p1) { return { x: p1.x - p0.x, y: p1.y - p0.y }; }
  function lineLength(p0, p1) { return Math.hypot(p1.x - p0.x, p1.y - p0.y); }

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
    const segLens = segments.map(segmentLength);
    const total = segLens.reduce((a, b) => a + b, 0);
    const cum = [];
    let s = 0;
    for (let i = 0; i < segLens.length; i++) { cum.push(s); s += segLens[i]; }
    return { segments, segLens, totalLength: total, cumStart: cum };
  }

  function pathPointAndTangentAtDistance(path, dist) {
    if (!path || path.totalLength <= 0) return { p: { x: 0, y: 0 }, tan: { x: 1, y: 0 } };
    const d = Math.max(0, Math.min(dist, path.totalLength));
    let segIdx = path.segments.length - 1;
    for (let i = 0; i < path.segments.length; i++) {
      if (d <= path.cumStart[i] + path.segLens[i] || i === path.segments.length - 1) { segIdx = i; break; }
    }
    const seg = path.segments[segIdx];
    const segStart = path.cumStart[segIdx];
    const segLen = path.segLens[segIdx] || 1;
    const t = segLen > 0 ? ((d - segStart) / segLen) : 0;
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

  // Build off-canvas end point given exitDir and exit tangent (colinear)
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
    if (route === 'straight') exitDir = exitDirectionFor(v.direction, 'straight');
    else exitDir = exitDirectionFor(v.direction, route);
    if (!exitDir) return;

    let exitPoint = laneCoordinates.exit[`${exitDir}_${v.laneIndex}`] || null;
    if (!exitPoint) exitPoint = findExitPoint(exitDir, v.exitLane, v.laneIndex);
    if (!exitPoint) {
      const allExitKeys = Object.keys(laneCoordinates.exit || {});
      for (const k of allExitKeys) {
        const d = dirFromKey(k);
        if (d && d !== v.direction) { exitPoint = laneCoordinates.exit[k]; exitDir = d; break; }
      }
    }
    if (!exitPoint) return;

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
      if (cp) maneuverSeg = { type: 'quadratic', p0: entry, p1: cp, p2: exitPoint };
      else maneuverSeg = { type: 'line', p0: entry, p1: exitPoint };
    }

    // compute exit tangent (t = 1) and off-canvas point colinear with that tangent
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

    // ensure rear exists
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

  // ---------- create vehicle ----------
  function createVehicle(arah, laneIndexZeroBased, type = 'mobil', exitLane = null) {
    const spawn = spawnPositionFor(arah, laneIndexZeroBased);
    const id = nextId++;
    const baseSpeed = options.baseSpeed || 0.10;

    const initialHeading = Math.atan2(spawn.vy, spawn.vx);
    const v = {
      id,
      x: spawn.x, y: spawn.y, vx: spawn.vx, vy: spawn.vy,
      direction: arah,
      laneIndex: laneIndexZeroBased + 1,
      type, exitLane: exitLane || null,
      speed: baseSpeed,
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
      path: null
    };

    if (v.type === 'truk') {
      const frontOverhangPx = truckFrontOverhangMeters * PX_PER_M;
      const frontToFirstRearPx = truckAxleSpacing.frontToFirstRear * PX_PER_M;
      const firstRearToSecondRearPx = truckAxleSpacing.firstRearToSecondRear * PX_PER_M;
      const rearOverhangPx = truckRearOverhangMeters * PX_PER_M;
      const totalLenPx = (truckLengthMeters * PX_PER_M);

      v.axles = { frontOverhangPx, frontToFirstRearPx, firstRearToSecondRearPx, rearOverhangPx };
      v.spriteOffsetFrontPx = frontOverhangPx;
      v.spriteOffsetRearPx = frontToFirstRearPx + firstRearToSecondRearPx + rearOverhangPx;
      v.wheelbase = frontToFirstRearPx;
      v.lengthPx = totalLenPx;
    } else {
      v.axles = { frontOverhangPx: 0, rearOverhangPx: 0 };
      v.spriteOffsetFrontPx = 0;
      v.spriteOffsetRearPx = 0;
      v.lengthPx = (type === 'motor') ? 2.0 * PX_PER_M : 4.5 * PX_PER_M;
    }

    const centerOffset = v.wheelbase * 0.5;
    const heading = initialHeading;
    v.rearX = v.x - centerOffset * Math.cos(heading);
    v.rearY = v.y - centerOffset * Math.sin(heading);
    // front position based on arc-length wheelbase ahead along straight spawn dir
    v.frontX = v.rearX + v.wheelbase * Math.cos(heading);
    v.frontY = v.rearY + v.wheelbase * Math.sin(heading);

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
    }

    vehicles.push(v);
    return v;
  }

  function spawnRandomVehicle(forcedDirection = null) {
    const directions = ['utara', 'timur', 'selatan', 'barat'];
    const arah = forcedDirection || directions[Math.floor(Math.random() * directions.length)];
    const laneCount = (config[arah] && config[arah].in) ? config[arah].in : 0;
    if (!laneCount) return null;
    const truckPct = (trafficConfig[arah]?.truckPct ?? 20);
    const rnd = Math.random() * 100;
    let type = 'mobil';
    if (rnd < truckPct) type = 'truk';
    else if (rnd < truckPct + 30) type = 'motor';
    const laneIndex = Math.floor(Math.random() * laneCount);
    const outChoices = exitLaneNumbers[arah] || [];
    const exitLane = outChoices.length > 0 ? outChoices[Math.floor(Math.random() * outChoices.length)] : null;
    return createVehicle(arah, laneIndex, type, exitLane);
  }

  function scheduleNextSpawn(arah, currentTimeMs) {
    const flow = (trafficConfig[arah]?.flow ?? 500);
    const interval = getExponentialInterval(flow);
    nextSpawnTimes[arah] = currentTimeMs + interval;
  }

  // ---------- MAIN UPDATE ----------
  function update(deltaMs) {
    if (!deltaMs || deltaMs <= 0) return;

    for (let i = vehicles.length - 1; i >= 0; i--) {
      const v = vehicles[i];
      let moveBudget = v.speed * deltaMs;
      const EPS = 1e-6;

      while (moveBudget > EPS) {
        // approachingTurn: find closest on path -> create blend or snap
        if (v.approachingTurn && v.path) {
          const rearCenterOffset = 0; // rear point is rear axle
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
            const { p: frontPt, tan: frontTan } = pathPointAndTangentAtDistance(v.path, frontD);
            v.frontX = frontPt.x; v.frontY = frontPt.y;
            const { tan } = pathPointAndTangentAtDistance(v.path, v.turnTraveled);
            const unitTan = normalize(tan);
            const heading = Math.atan2(unitTan.y, unitTan.x);
            v.x = v.rearX + centerOffset * unitTan.x;
            v.y = v.rearY + centerOffset * unitTan.y;
            v.angle = heading - Math.PI/2 + ANGLE_ADJUST;
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
            // set angle using vector between rear->front
            const dx = v.frontX - v.rearX, dy = v.frontY - v.rearY;
            const heading = Math.atan2(dy, dx);
            v.angle = heading - Math.PI/2 + ANGLE_ADJUST;
            continue;
          }

          const move = Math.min(moveBudget, distToTarget, v.blend.remaining);
          const ux = bx / distToTarget, uy = by / distToTarget;
          v.x += ux * move;
          v.y += uy * move;
          // during blend we orient center towards the direction of motion (cosmetic)
          v.angle = Math.atan2(uy, ux) - Math.PI/2 + ANGLE_ADJUST;
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
            v.angle = heading - Math.PI/2 + ANGLE_ADJUST;
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
            const { p: rearPt, tan: rearTan } = pathPointAndTangentAtDistance(v.path, rearD);
            const { p: frontPt, tan: frontTan } = pathPointAndTangentAtDistance(v.path, frontD);
            v.rearX = rearPt.x; v.rearY = rearPt.y;
            v.frontX = frontPt.x; v.frontY = frontPt.y;
            const dx = v.frontX - v.rearX, dy = v.frontY - v.rearY;
            const finalHeading = Math.atan2(dy, dx);
            v.vx = Math.cos(finalHeading); v.vy = Math.sin(finalHeading);
            v.angle = Math.atan2(v.vy, v.vx) - Math.PI/2 + ANGLE_ADJUST;
            // recompute center consistent with rear & front
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
          const { p: rear, tan: rearTan } = pathPointAndTangentAtDistance(v.path, rearD);
          const { p: front, tan: frontTan } = pathPointAndTangentAtDistance(v.path, frontD);

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
          v.angle = headingAngle - Math.PI/2 + ANGLE_ADJUST;

          moveBudget -= use;

          if (use >= remainingOnPath - 1e-6) {
            // reached path end -> snap final heading and clear path
            v.turning = false;
            const finalRearD = v.turnLength;
            const finalFrontD = Math.min(finalRearD + v.wheelbase, v.path.totalLength);
            const { p: finalRearPt, tan: finalRearTan } = pathPointAndTangentAtDistance(v.path, finalRearD);
            const { p: finalFrontPt } = pathPointAndTangentAtDistance(v.path, finalFrontD);
            v.rearX = finalRearPt.x; v.rearY = finalRearPt.y;
            v.frontX = finalFrontPt.x; v.frontY = finalFrontPt.y;
            const dx2 = v.frontX - v.rearX, dy2 = v.frontY - v.rearY;
            const finalHeading = Math.atan2(dy2, dx2);
            v.vx = Math.cos(finalHeading); v.vy = Math.sin(finalHeading);
            v.angle = Math.atan2(v.vy, v.vx) - Math.PI/2 + ANGLE_ADJUST;
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
        if ((v.vx || 0) !== 0 || (v.vy || 0) !== 0) v.angle = Math.atan2(v.vy, v.vx) - Math.PI/2 + ANGLE_ADJUST;
        break;
      } // end while

      // remove if out of canvas bounds
      const margin = 60;
      if (v.x < -margin || v.x > canvasSize.width + margin || v.y < -margin || v.y > canvasSize.height + margin) {
        vehicles.splice(i, 1);
      }
    } // end for
  }

  // ---------- external API ----------
  function getVehicles() { return vehicles.slice(); }
  function clear() { vehicles.length = 0; nextId = 1; }
  function setTrafficConfig(obj) { trafficConfig = obj || trafficConfig; }
  function setCanvasSize(sz) { if (sz?.width && sz?.height) { canvasSize.width = sz.width; canvasSize.height = sz.height; } }

  function setLaneCoordinates(newLc) {
    if (!newLc) return;
    laneCoordinates.entry = newLc.entry || laneCoordinates.entry || {};
    laneCoordinates.exit = newLc.exit || laneCoordinates.exit || {};
    for (const v of vehicles) {
      try { assignExitAndControlForVehicle(v); } catch (e) { console.warn("setLaneCoordinates: reassign failed for veh#", v.id, e); }
    }
  }

  // ---------- debug draw ----------
  function drawDebugPoints(ctx) {
    vehicles.forEach(v => {
      if (v.controlType === 'quadratic' && v.controlPoint) {
        ctx.save(); ctx.fillStyle = "purple"; ctx.beginPath();
        ctx.arc(v.controlPoint.x, v.controlPoint.y, 5, 0, 2 * Math.PI); ctx.fill(); ctx.restore();
      }
      if (v.controlType === 'cubic' && v.controlPoints && v.controlPoints.length === 2) {
        ctx.save(); ctx.fillStyle = "purple"; ctx.beginPath();
        ctx.arc(v.controlPoints[0].x, v.controlPoints[0].y, 5, 0, 2 * Math.PI); ctx.fill();
        ctx.beginPath(); ctx.arc(v.controlPoints[1].x, v.controlPoints[1].y, 5, 0, 2 * Math.PI); ctx.fill();
        ctx.restore();
      }
      if (v.blend && v.blend.targetRear) {
        ctx.save(); ctx.fillStyle = "orange"; ctx.beginPath();
        ctx.arc(v.blend.targetRear.x, v.blend.targetRear.y, 4, 0, 2 * Math.PI); ctx.fill(); ctx.restore();
      }
      if (v.turnEntry) { ctx.save(); ctx.fillStyle = "rgba(0,160,0,0.9)"; ctx.beginPath(); ctx.arc(v.turnEntry.x, v.turnEntry.y, 3, 0, 2 * Math.PI); ctx.fill(); ctx.restore(); }
      if (v.turnExit)  { ctx.save(); ctx.fillStyle = "rgba(0,160,0,0.9)"; ctx.beginPath(); ctx.arc(v.turnExit.x, v.turnExit.y, 3, 0, 2 * Math.PI); ctx.fill(); ctx.restore(); }
      if (typeof v.rearX === 'number' && typeof v.rearY === 'number') {
        ctx.save(); ctx.fillStyle = "blue"; ctx.beginPath();
        ctx.arc(v.rearX, v.rearY, 3, 0, 2 * Math.PI); ctx.fill(); ctx.restore();
      }
      if (typeof v.frontX === 'number' && typeof v.frontY === 'number') {
        ctx.save(); ctx.fillStyle = "magenta"; ctx.beginPath();
        ctx.arc(v.frontX, v.frontY, 3, 0, 2 * Math.PI); ctx.fill(); ctx.restore();
      }
    });
  }

  function drawDebugPaths(ctx) {
    vehicles.forEach(v => {
      if (!v.path) return;
      ctx.save();
      ctx.strokeStyle = "rgba(128,0,128,0.5)";
      ctx.lineWidth = 2;
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

      v.path.segments.forEach((seg) => {
        if (seg.type === 'line') {
          ctx.save(); ctx.fillStyle = "rgba(0,200,0,0.9)"; ctx.fillRect(seg.p0.x-2, seg.p0.y-2,4,4); ctx.fillRect(seg.p1.x-2, seg.p1.y-2,4,4); ctx.restore();
        } else if (seg.type === 'quadratic') {
          ctx.save(); ctx.fillStyle = "rgba(0,200,0,0.9)"; ctx.fillRect(seg.p0.x-2, seg.p0.y-2,4,4); ctx.fillRect(seg.p1.x-2, seg.p1.y-2,4,4); ctx.fillRect(seg.p2.x-2, seg.p2.y-2,4,4); ctx.restore();
        } else if (seg.type === 'cubic') {
          ctx.save(); ctx.fillStyle = "rgba(0,200,0,0.9)";
          ctx.fillRect(seg.p0.x-2, seg.p0.y-2,4,4); ctx.fillRect(seg.p1.x-2, seg.p1.y-2,4,4); ctx.fillRect(seg.p2.x-2, seg.p2.y-2,4,4); ctx.fillRect(seg.p3.x-2, seg.p3.y-2,4,4);
          ctx.restore();
        }
      });

      if (v.blend && v.blend.centerTarget) {
        ctx.save(); ctx.fillStyle = "orange"; ctx.beginPath(); ctx.arc(v.blend.centerTarget.x, v.blend.centerTarget.y, 3, 0, 2*Math.PI); ctx.fill(); ctx.restore();
      }
    });
  }

  return {
    spawnRandomVehicle, scheduleNextSpawn, update, getVehicles, clear,
    nextSpawnTimes, setTrafficConfig, setCanvasSize, drawDebugPoints, drawDebugPaths,
    setLaneCoordinates
  };
}
