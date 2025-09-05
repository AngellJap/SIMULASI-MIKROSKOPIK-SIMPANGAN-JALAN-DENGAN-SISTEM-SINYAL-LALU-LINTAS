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

    // posisi lampu di tiap lengan
    this.posLampu = {
      utara:   { x: this.canvas.width / 2 + 60,  y: 280 },
      timur:   { x: this.canvas.width - 340,    y: this.canvas.height / 1.7 - 10 },
      selatan: { x: this.canvas.width / 2 - 120, y: this.canvas.height - 340 },
      barat:   { x: 280,                        y: this.canvas.height / 2 - 120 }
    };

    // rotasi lampu di tiap lengan (dalam radian)
    this.rotasiLampu = {
      utara:   270 * Math.PI /180,                     // normal
      timur:   0 * Math.PI / 180,    // putar 90 derajat
      selatan: 90 * Math.PI / 180,   // putar 180 derajat
      barat:  180 * Math.PI / 180     // putar -90 derajat
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
  }

  // ambil durasi dari input HTML
  getDurasi() {
    return {
      merah: parseInt(document.getElementById("durRed").value) * 1000,
      kuning: parseInt(document.getElementById("durYellow").value) * 1000,
      hijau: parseInt(document.getElementById("durGreen").value) * 1000
    };
  }

  // gambar lampu di semua lengan
  draw() {
    const ctx = this.ctx;

    for (let arah in this.posLampu) {
      const warna = this.status[arah];
      const pos = this.posLampu[arah];
      const rotasi = this.rotasiLampu[arah];

      ctx.save();
      // geser titik rotasi ke tengah lampu
      ctx.translate(pos.x + 30, pos.y + 30);
      ctx.rotate(rotasi);
      // gambar lampu diputar
      ctx.drawImage(this.gambar[warna], -30, -30, 60, 60);
      ctx.restore();
    }

    requestAnimationFrame(() => this.draw());
  }

  // update siklus bergilir searah jarum jam
  update() {
    const durasi = this.getDurasi();
    const arahAktif = this.urutan[this.indexAktif];

    // reset semua jadi merah
    for (let arah of this.urutan) {
      this.status[arah] = "merah";
    }

    // atur siklus: hijau -> kuning -> merah
    this.status[arahAktif] = "hijau";
    setTimeout(() => {
      this.status[arahAktif] = "kuning";
      setTimeout(() => {
        this.status[arahAktif] = "merah";
        this.indexAktif = (this.indexAktif + 1) % this.urutan.length; // lanjut ke arah berikutnya
        this.update(); // ulangi untuk arah berikutnya
      }, durasi.kuning);
    }, durasi.hijau);
  }

  // mulai simulasi
  start() {
    this.gambar.hijau.onload = () => {
      this.draw();
      this.update();
    };
  }
}
