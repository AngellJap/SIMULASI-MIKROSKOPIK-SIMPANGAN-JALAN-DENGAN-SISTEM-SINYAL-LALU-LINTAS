/**
 * Kelas untuk mengelola lampu lalu lintas, memastikan posisinya dinamis
 * berdasarkan konfigurasi jumlah lajur dan radius putaran.
 */
export class LampuLaluLintas {
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    this.ctx = this.canvas.getContext("2d");

    // muat gambar lampu
    this.gambar = {
      merah: new Image(),
      kuning: new Image(),
      hijau: new Image()
    };
    this.gambar.merah.src = "js/Lampu_Lalu_Lintas/merah.png";
    this.gambar.kuning.src = "js/Lampu_Lalu_Lintas/kuning.png";
    this.gambar.hijau.src = "js/Lampu_Lalu_Lintas/hijau.png";

    // rotasi lampu di tiap lengan (dalam radian)
    this.rotasiLampu = {
      utara: 270 * Math.PI / 180,
      timur: 0 * Math.PI / 180,
      selatan: 90 * Math.PI / 180,
      barat: 180 * Math.PI / 180
    };

    // urutan siklus searah jarum jam
    this.urutan = ["utara", "timur", "selatan", "barat"];
    this.indexAktif = 0; // mulai dari Utara

    // status lampu default = semua merah
    this.status = {
      utara: "merah",
      timur: "merah",
      selatan: "merah",
      barat: "merah"
    };

    // Bind this ke metode updatePosition agar bisa dipanggil dari main.js
    this.updatePosition = this.updatePosition.bind(this);

    // Variabel untuk menyimpan posisi lampu
    this.posLampu = {};
  }

  /**
   * Mengambil konfigurasi dari main.js untuk menghitung posisi lampu lalu lintas.
   * Posisi dihitung dari "titik merah" (sudut dalam persimpangan) yang disesuaikan.
   * @param {object} config - Objek konfigurasi persimpangan dari main.js.
   */
  updatePosition(config) {
    const skala = config.skala_px * 3;
    const centerX = this.canvas.width / 2;
    const centerY = this.canvas.height / 2;

    // Ambil nilai radius dari slider
    const radiusSlider = document.getElementById("customRange");
    const radiusValue = parseFloat(radiusSlider.value);
    
    // Konversi nilai slider dari meter ke piksel
    const pixelsPerMeter = skala / 3; // Menggunakan 3 agar sinkron dengan drawTurningRadius
    const squareSideLength = radiusValue * pixelsPerMeter;

    // Menghitung posisi berdasarkan jumlah lajur masuk dan keluar
    const Uin_px = config.utara.in * skala;
    const Uout_px = config.utara.out * skala;
    const Sin_px = config.selatan.in * skala;
    const Sout_px = config.selatan.out * skala;
    const Tin_px = config.timur.in * skala;
    const Tout_px = config.timur.out * skala;
    const Bin_px = config.barat.in * skala;
    const Bout_px = config.barat.out * skala;

    // Perhitungan posisi lampu yang telah dimodifikasi
    // Posisi lampu utara dan selatan (vertikal)
    this.posLampu.utara = { 
        x: centerX + Uin_px + 30, // Posisi X tetap, hanya bergantung pada lajur
        y: centerY - Tout_px - squareSideLength - 0 // Posisi Y berubah dengan slider
    };
    
    this.posLampu.selatan = { 
        x: centerX - Sin_px - 30, // Posisi X tetap, hanya bergantung pada lajur
        y: centerY + Bout_px + squareSideLength + 0 // Posisi Y berubah dengan slider
    };
    
    // Posisi lampu timur dan barat (horizontal)
    this.posLampu.timur = { 
        x: centerX + Sout_px + squareSideLength + 0, // Posisi X berubah dengan slider
        y: centerY + Tin_px + 30 // Posisi Y tetap, hanya bergantung pada lajur
    };
    
    this.posLampu.barat = { 
        x: centerX - Uout_px - squareSideLength - 0, // Posisi X berubah dengan slider
        y: centerY - Bin_px - 30 // Posisi Y tetap, hanya bergantung pada lajur
    };
  }

  // ambil durasi dari input HTML
getDurasi() {
  return {
    hijau: parseInt(document.getElementById("durGreen").value) * 1000,
    kuning: parseInt(document.getElementById("durYellow").value) * 1000,
    allRed: parseInt(document.getElementById("durAllRed").value) * 1000
  };
}

  // gambar lampu di semua lengan
  draw() {
    const ctx = this.ctx;
    
    // Gambar jalan digambar di file main.js, jadi kita tidak perlu menghapusnya di sini.

    for (let arah in this.posLampu) {
      const warna = this.status[arah];
      const pos = this.posLampu[arah];
      const rotasi = this.rotasiLampu[arah];

      ctx.save();
      // geser titik rotasi ke tengah lampu
      ctx.translate(pos.x, pos.y);
      ctx.rotate(rotasi);
      // gambar lampu diputar
      ctx.drawImage(this.gambar[warna], -30, -30, 60, 60);
      ctx.restore();
    }

    requestAnimationFrame(() => this.draw());
  }

// update siklus
update() {
  const durasi = this.getDurasi();
  const arahAktif = this.urutan[this.indexAktif];

  // reset semua merah di awal (instant, tidak pakai allRed)
  for (let arah of this.urutan) {
    this.status[arah] = "merah";
  }

  // fase hijau
  this.status[arahAktif] = "hijau";
  setTimeout(() => {
    // fase kuning
    this.status[arahAktif] = "kuning";
    setTimeout(() => {
      // fase all-red setelah kuning
      for (let arah of this.urutan) {
        this.status[arah] = "merah";
      }
      setTimeout(() => {
        // ganti ke arah berikutnya
        this.indexAktif = (this.indexAktif + 1) % this.urutan.length;
        this.update();
      }, durasi.allRed);

    }, durasi.kuning);

  }, durasi.hijau);
}

  start() {
    this.gambar.hijau.onload = () => {
      this.draw();
      this.update();
    };
  }
}