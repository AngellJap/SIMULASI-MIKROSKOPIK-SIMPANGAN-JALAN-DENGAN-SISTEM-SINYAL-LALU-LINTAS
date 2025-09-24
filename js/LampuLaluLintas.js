/**
 * LampuLaluLintas.js
 * Mengelola siklus dan status lampu lalu lintas, serta menggambar visualnya.
 */
export class LampuLaluLintas {
    constructor(canvasId) {
        this.canvas = document.getElementById(canvasId);
        this.ctx = this.canvas.getContext("2d");

        // Muat gambar lampu
        this.gambar = {
            merah: new Image(),
            kuning: new Image(),
            hijau: new Image()
        };
        this.gambar.merah.src = "js/Lampu_Lalu_Lintas/merah.png";
        this.gambar.kuning.src = "js/Lampu_Lalu_Lintas/kuning.png";
        this.gambar.hijau.src = "js/Lampu_Lalu_Lintas/hijau.png";

        // Rotasi lampu tiap lengan (radian)
        this.rotasiLampu = {
            utara: 270 * Math.PI / 180,
            timur: 0,
            selatan: 90 * Math.PI / 180,
            barat: Math.PI
        };

        this.urutan = ["utara", "timur", "selatan", "barat"];
        this.indexAktif = 0;

        // Status warna lampu
        this.status = { utara: "merah", timur: "merah", selatan: "merah", barat: "merah" };
        this.posLampu = { utara: {}, timur: {}, selatan: {}, barat: {} };

        // Fase & durasi
        this.fase = "allRed";
        this.waktuFase = 0;
        this.durasi = this.getDurasi();
    }

    /** Hitung posisi lampu berdasarkan arah dan lajur */
    _calculatePos(arah, inVal, outVal, laneWidth, radius_px, margin, centerX, centerY) {
        let x = 0, y = 0;
        switch (arah) {
            case "utara":
                x = centerX + (inVal - 1) * laneWidth + 60;
                y = centerY - radius_px - margin - laneWidth / 2 - outVal * laneWidth;
                break;
            case "selatan":
                x = centerX - (inVal - 1) * laneWidth - 60;
                y = centerY + radius_px + margin + laneWidth / 2 + outVal * laneWidth;
                break;
            case "timur":
                y = centerY + (inVal - 1) * laneWidth + 60;
                x = centerX + radius_px + margin + laneWidth / 2 + outVal * laneWidth;
                break;
            case "barat":
                y = centerY - (inVal - 1) * laneWidth - 60;
                x = centerX - radius_px - margin - laneWidth / 2 - outVal * laneWidth;
                break;
        }
        return { x, y };
    }

    /** Update posisi lampu */
    updatePosition(config) {
        if (!config) return;
        const skala = (config.skala_px || 10) * 3;
        const centerX = this.canvas.width / 2;
        const centerY = this.canvas.height / 2;
        const radiusValue = (typeof config.radiusValue === "number") ? config.radiusValue : (parseFloat(config.radiusValue) || 5);
        const pixelsPerMeter = skala / 3;
        const radius_px = radiusValue * pixelsPerMeter;
        const laneWidth = Math.max(30, Math.round(skala / 1.5));
        const margin = Math.round(laneWidth * 0.5) - 30;

        this.posLampu.utara = this._calculatePos("utara", config.utara?.in || 2, config.timur?.out || 0, laneWidth, radius_px, margin, centerX, centerY);
        this.posLampu.selatan = this._calculatePos("selatan", config.selatan?.in || 2, config.barat?.out || 0, laneWidth, radius_px, margin, centerX, centerY);
        this.posLampu.timur = this._calculatePos("timur", config.timur?.in || 2, config.selatan?.out || 0, laneWidth, radius_px, margin, centerX, centerY);
        this.posLampu.barat = this._calculatePos("barat", config.barat?.in || 2, config.utara?.out || 0, laneWidth, radius_px, margin, centerX, centerY);
    }

    /** Ambil durasi dari input UI */
    getDurasi() {
        const safeParse = (id, fallback) => {
            const el = document.getElementById(id);
            if (!el) return fallback;
            const v = parseInt(el.value);
            return Number.isFinite(v) ? v * 1000 : fallback;
        };
        return {
            hijau: safeParse("durGreen", 5000),
            kuning: safeParse("durYellow", 1000),
            allRed: safeParse("durAllRed", 500)
        };
    }

    /** Update durasi manual (opsional) */
    updateDurations() {
        this.durasi = this.getDurasi();
    }

    /** Gambar lampu */
    draw() {
        const ctx = this.ctx;
        const lampSize = 60;
        const half = lampSize / 2;
        for (let arah of this.urutan) {
            const warna = this.status[arah] || "merah";
            const pos = this.posLampu[arah] || { x: 0, y: 0 };
            const rotasi = this.rotasiLampu[arah] || 0;

            ctx.save();
            ctx.translate(pos.x, pos.y);
            ctx.rotate(rotasi);

            const img = this.gambar[warna];
            if (img && img.complete && img.naturalWidth !== 0) {
                ctx.drawImage(img, -half, -half, lampSize, lampSize);
            } else {
                ctx.fillStyle = warna === "merah" ? "#b22" : warna === "kuning" ? "#eea" : "#2b2";
                ctx.fillRect(-half, -half, lampSize, lampSize);
                ctx.strokeStyle = "#333";
                ctx.strokeRect(-half, -half, lampSize, lampSize);
            }

            ctx.restore();
        }
    }

    /** Jalankan siklus lampu */
    tick(deltaTime) {
        // 🚩 sekarang selalu ambil durasi terbaru dari UI
        this.durasi = this.getDurasi();

        this.waktuFase += deltaTime;
        const arahAktif = this.urutan[this.indexAktif];

        switch (this.fase) {
            case "allRed":
                for (let arah of this.urutan) this.status[arah] = "merah";
                if (this.waktuFase >= this.durasi.allRed) {
                    this.fase = "hijau";
                    this.waktuFase = 0;
                    this.status[arahAktif] = "hijau";
                }
                break;

            case "hijau":
                this.status[arahAktif] = "hijau";
                if (this.waktuFase >= this.durasi.hijau) {
                    this.fase = "kuning";
                    this.waktuFase = 0;
                    this.status[arahAktif] = "kuning";
                }
                break;

            case "kuning":
                this.status[arahAktif] = "kuning";
                if (this.waktuFase >= this.durasi.kuning) {
                    this.fase = "allRed";
                    this.waktuFase = 0;
                    for (let arah of this.urutan) this.status[arah] = "merah";
                    this.indexAktif = (this.indexAktif + 1) % this.urutan.length;
                }
                break;
        }
    }
}
