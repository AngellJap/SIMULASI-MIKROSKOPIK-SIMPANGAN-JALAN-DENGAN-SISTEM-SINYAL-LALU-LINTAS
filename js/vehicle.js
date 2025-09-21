// ---------- Konfigurasi tipe kendaraan ----------
export const vehicleTypes = {
  motor: {
    name: 'motor',
    length_m: 1.75,
    width_m: 0.7,
    speed_kmh_range: [25, 35], // km/h
    sprite: 'js/vehicles/motor.png',
  },
  mobil: {
    name: 'mobil',
    length_m: 5.8,
    width_m: 2.1,
    speed_kmh_range: [20, 30],
    sprite: 'js/vehicles/mobil.png',
  },
  truk: {
    name: 'truk',
    length_m: 12.0,
    width_m: 2.5,
    speed_kmh_range: [15, 20],
    sprite: 'js/vehicles/truk.png',
  },
};

// Helper: ambil angka acak antara min dan max (inklusive untuk float)
function randBetween(min, max) {
  return Math.random() * (max - min) + min;
}

// Konversi km/h -> m/s
export function kmhToMs(kmh) {
  return (kmh * 1000) / 3600;
}

// ---------- Cache sprite image ----------
export const sprites = {};
for (const type in vehicleTypes) {
  const img = new Image();
  img.src = vehicleTypes[type].sprite;
  sprites[type] = img;
}

// ---------- Kelas Vehicle ----------
export class Vehicle {
  constructor({id, type, speed_m_s, origin, destination, laneIndex, direction, movement, spawnTime, position=null}) {
    this.id = id;
    this.type = type; // 'motor'|'mobil'|'truk'
    this.speed_m_s = speed_m_s; // m/s
    this.origin = origin;
    this.destination = destination;
    this.laneIndex = laneIndex;
    this.direction = direction;
    this.movement = movement;
    this.spawnTime = spawnTime;
    this.position = position;
    this.length_m = vehicleTypes[type].length_m;
    this.width_m = vehicleTypes[type].width_m;
    this.sprite = sprites[type];
    this.state = 'waiting';
  }

  setPosition(pos) {
    this.position = pos;
  }

  update(dt) {
    this._moved_m = (this._moved_m || 0) + this.speed_m_s * dt;
  }

  // fungsi render untuk canvas
  draw(ctx, scale_m_to_px) {
    if (!this.position || !this.sprite.complete) return;
    const width_px = this.width_m * scale_m_to_px;
    const length_px = this.length_m * scale_m_to_px;

    ctx.save();
    ctx.translate(this.position.x, this.position.y);
    // TODO: rotasi sesuai arah (harus ditentukan berdasarkan movement + origin)
    ctx.drawImage(this.sprite, -length_px/2, -width_px/2, length_px, width_px);
    ctx.restore();
  }
}

// ---------- Poisson arrivals ----------
export function generatePoissonArrivals(lambda_per_hour, duration_seconds) {
  const lambda_per_sec = lambda_per_hour / 3600.0;
  const arrivals = [];
  if (lambda_per_sec <= 0) return arrivals;
  let t = 0;
  while (true) {
    const u = Math.random();
    const inter = -Math.log(1 - u) / lambda_per_sec;
    t += inter;
    if (t > duration_seconds) break;
    arrivals.push(t);
  }
  return arrivals;
}

// ---------- Movement rules ----------
export function getAllowedMovements(arrowString) {
  const s = arrowString.toUpperCase();
  const allowed = [];
  if (s.includes('L')) allowed.push('left');
  if (s.includes('S')) allowed.push('straight');
  if (s.includes('R')) allowed.push('right');
  return allowed;
}

export function mapLaneToMovements(lanesConfig) {
  const map = {};
  for (const lane of lanesConfig) {
    map[lane.laneIndex] = getAllowedMovements(lane.arrows);
  }
  return map;
}

// ---------- Origin & Destination ----------
export function assignOriginDestination(direction, movement) {
  const dirs = ['utara','timur','selatan','barat'];
  const i = dirs.indexOf(direction);
  if (i === -1) throw new Error('direction harus salah satu dari: ' + dirs.join(','));
  let toIndex;
  if (movement === 'straight') {
    toIndex = (i + 2) % 4;
  } else if (movement === 'left') {
    toIndex = (i + 1) % 4;
  } else if (movement === 'right') {
    toIndex = (i + 3) % 4;
  } else {
    throw new Error('movement harus left/straight/right');
  }
  return { from: direction, to: dirs[toIndex] };
}

// ---------- Spawn vehicles ----------
export function spawnVehiclesFromPoisson({arrivals, laneAssignment, vehicleTypeDistribution={motor:0.6,mobil:0.3,truk:0.1}, idPrefix='V', speedRandomness=true}) {
  const types = Object.keys(vehicleTypeDistribution);
  const probs = types.map(t => vehicleTypeDistribution[t]);
  const s = probs.reduce((a,b) => a+b, 0);
  if (s <= 0) throw new Error('vehicleTypeDistribution harus punya total > 0');
  const norm = probs.map(p => p / s);

  function pickType() {
    const r = Math.random();
    let acc = 0;
    for (let i=0;i<types.length;i++){
      acc += norm[i];
      if (r <= acc) return types[i];
    }
    return types[types.length-1];
  }

  const vehicles = [];
  for (let i=0;i<arrivals.length;i++){
    const t = arrivals[i];
    let laneInfo;
    if (typeof laneAssignment === 'function') laneInfo = laneAssignment(i, t);
    else laneInfo = laneAssignment[i] || laneAssignment[laneAssignment.length-1];
    if (!laneInfo) throw new Error('laneAssignment tidak tersedia untuk spawn index ' + i);

    const type = pickType();
    const vtype = vehicleTypes[type];
    let speed_kmh = (vtype.speed_kmh_range[0] + vtype.speed_kmh_range[1]) / 2;
    if (speedRandomness) speed_kmh = randBetween(vtype.speed_kmh_range[0], vtype.speed_kmh_range[1]);
    const speed_m_s = kmhToMs(speed_kmh);

    const {laneIndex, direction, movement} = laneInfo;
    const od = assignOriginDestination(direction, movement);

    const vehicle = new Vehicle({
      id: idPrefix + String(i+1).padStart(4,'0'),
      type,
      speed_m_s,
      origin: od.from,
      destination: od.to,
      laneIndex,
      direction,
      movement,
      spawnTime: t,
      position: null,
    });
    vehicles.push(vehicle);
  }
  return vehicles;
}
