// vehmov.js (fix: rotasi gradual CCW/CW, tanpa flip di titik exit)

export function createVehMovController(options = {}) {
  const config = options.config || {};
  const laneCoordinates = options.laneCoordinates || { entry: {}, exit: {} };
  const exitLaneNumbers = options.exitLaneNumbers || {};
  let trafficConfig = options.trafficConfig || {};
  const laneArrows = options.laneArrows || {};
  const canvasSize = options.canvasSize || { width: 800, height: 800 };

  // internal state
  const vehicles = [];
  const nextSpawnTimes = { utara: 0, timur: 0, selatan: 0, barat: 0 };
  let nextId = 1;

  function nowMs() {
    return (performance && performance.now) ? performance.now() : Date.now();
  }

  // skala px dari config
  function skalaPx() { return (config.skala_px || 10) * 3; }

  // generate exponential interval (ms) dari flow (veh/jam)
  function getExponentialInterval(flowPerHour) {
    if (!flowPerHour || flowPerHour <= 0) return Infinity;
    const meanSeconds = 3600 / flowPerHour;
    const u = Math.random();
    return -Math.log(1 - u) * meanSeconds * 1000;
  }

  // posisi spawn awal (di luar canvas)
  function spawnPositionFor(arah, laneIndexZeroBased) {
    const s = skalaPx();
    const offset = (laneIndexZeroBased + 0.5) * s;
    let x = 0, y = 0, vx = 0, vy = 0;
    switch (arah) {
      case 'utara':
        x = canvasSize.width / 2 + offset;
        y = -20;
        vx = 0; vy = 1; break;
      case 'timur':
        x = canvasSize.width + 20;
        y = canvasSize.height / 2 + offset;
        vx = -1; vy = 0; break;
      case 'selatan':
        x = canvasSize.width / 2 - offset;
        y = canvasSize.height + 20;
        vx = 0; vy = -1; break;
      case 'barat':
        x = -20;
        y = canvasSize.height / 2 - offset;
        vx = 1; vy = 0; break;
      default:
        x = canvasSize.width / 2; y = -20; vx = 0; vy = 1;
    }
    return { x, y, vx, vy };
  }

  // fungsi Bezier kuadratik
  function bezierPoint(t, p0, p1, p2) {
    return {
      x: (1 - t) * (1 - t) * p0.x + 2 * (1 - t) * t * p1.x + t * t * p2.x,
      y: (1 - t) * (1 - t) * p0.y + 2 * (1 - t) * t * p1.y + t * t * p2.y
    };
  }

  // estimasi panjang kurva bezier
  function bezierLength(p0, p1, p2, segments = 20) {
    let length = 0;
    let prev = p0;
    for (let i = 1; i <= segments; i++) {
      const t = i / segments;
      const pt = bezierPoint(t, p0, p1, p2);
      const dx = pt.x - prev.x;
      const dy = pt.y - prev.y;
      length += Math.sqrt(dx * dx + dy * dy);
      prev = pt;
    }
    return length;
  }

  // mapping orientasi default
  function defaultAngleForDirection(dir) {
    if (dir === "utara") return Math.PI;
    if (dir === "timur") return -Math.PI / 2;
    if (dir === "barat") return Math.PI / 2;
    return 0; // selatan default (menghadap atas canvas)
  }

  // bikin kendaraan baru
  function createVehicle(arah, laneIndexZeroBased, type = 'mobil', exitLane = null) {
    const spawn = spawnPositionFor(arah, laneIndexZeroBased);
    const id = nextId++;
    const baseSpeed = options.baseSpeed || 0.10; // px per ms

    const v = {
      id,
      x: spawn.x,
      y: spawn.y,
      vx: spawn.vx,
      vy: spawn.vy,
      direction: arah,
      laneIndex: laneIndexZeroBased + 1,
      type,
      exitLane: exitLane || null,
      speed: baseSpeed,
      createdAt: nowMs(),
      turning: false,
      approachingTurn: false,
      route: "straight",
      turnProgress: 0,
      turnEntry: null,
      turnExit: null,
      controlPoint: null,
      angle: defaultAngleForDirection(arah),
      turnLength: 0,
      turnTraveled: 0
    };

    // khusus arah selatan: tentukan route (straight/left/right)
    if (arah === "selatan") {
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

        if (v.route === "left") {
          v.approachingTurn = true;
          v.turnEntry = entry;
          v.turnExit = laneCoordinates.exit["barat_1"];
          v.controlPoint = {
            x: config.cx - config.radiusValue * config.skala_px,
            y: config.cy + config.radiusValue * config.skala_px
          };
        } else if (v.route === "right") {
          v.approachingTurn = true;
          v.turnEntry = entry;
          v.turnExit = laneCoordinates.exit["timur_1"];
          v.controlPoint = {
            x: config.cx + config.radiusValue * config.skala_px,
            y: config.cy + config.radiusValue * config.skala_px
          };
        } else if (v.route === "straight") {
          v.turnExit = laneCoordinates.exit["utara_1"];
        }
      }
    }

    vehicles.push(v);
    return v;
  }

  // spawn random vehicle
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

  // schedule spawn berikutnya
  function scheduleNextSpawn(arah, currentTimeMs) {
    const flow = (trafficConfig[arah]?.flow ?? 500);
    const interval = getExponentialInterval(flow);
    nextSpawnTimes[arah] = currentTimeMs + interval;
  }

  // update posisi kendaraan
  function update(deltaMs) {
    if (!deltaMs || deltaMs <= 0) return;
    for (let i = vehicles.length - 1; i >= 0; i--) {
      const v = vehicles[i];

      if (v.approachingTurn && v.turnEntry) {
        const dx = v.turnEntry.x - v.x;
        const dy = v.turnEntry.y - v.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 5) {
          v.approachingTurn = false;
          v.turning = true;
          v.turnProgress = 0;
          v.turnLength = bezierLength(v.turnEntry, v.controlPoint, v.turnExit);
          v.turnTraveled = 0;
        } else {
          v.x += (v.vx || 0) * v.speed * deltaMs;
          v.y += (v.vy || 0) * v.speed * deltaMs;
        }
      } else if (v.turning && (v.route === "left" || v.route === "right")) {
        const step = v.speed * deltaMs;
        v.turnTraveled += step;
        let progress = v.turnTraveled / v.turnLength;
        if (progress > 1) progress = 1;
        v.turnProgress = progress;

        const p = bezierPoint(progress, v.turnEntry, v.controlPoint, v.turnExit);
        v.x = p.x;
        v.y = p.y;

        // ✅ rotasi gradual tanpa flip
        const startAngle = defaultAngleForDirection("selatan");
        if (v.route === "left") {
          v.angle = startAngle - (Math.PI / 2) * progress; // CCW
        } else if (v.route === "right") {
          v.angle = startAngle + (Math.PI / 2) * progress; // CW
        }

        if (progress >= 1) {
          v.turning = false;
          if (v.route === "left") {
            v.vx = -1; v.vy = 0; v.direction = "barat";
            // ❌ jangan reset v.angle, biarkan hasil gradual
          }
          if (v.route === "right") {
            v.vx = 1; v.vy = 0; v.direction = "timur";
            // ❌ jangan reset v.angle, biarkan hasil gradual
          }
        }
      } else {
        // normal lurus
        v.x += (v.vx || 0) * v.speed * deltaMs;
        v.y += (v.vy || 0) * v.speed * deltaMs;
      }

      // hapus kalau keluar canvas
      const margin = 60;
      if (v.x < -margin || v.x > canvasSize.width + margin ||
          v.y < -margin || v.y > canvasSize.height + margin) {
        vehicles.splice(i, 1);
      }
    }
  }

  // ambil copy kendaraan
  function getVehicles() { return vehicles.slice(); }

  function clear() { vehicles.length = 0; nextId = 1; }
  function setTrafficConfig(obj) { trafficConfig = obj || trafficConfig; }
  function setCanvasSize(sz) {
    if (sz?.width && sz?.height) {
      canvasSize.width = sz.width;
      canvasSize.height = sz.height;
    }
  }

  return {
    spawnRandomVehicle,
    scheduleNextSpawn,
    update,
    getVehicles,
    clear,
    nextSpawnTimes,
    setTrafficConfig,
    setCanvasSize
  };
}
