// js/LampuLaluLintas.js
/**
 * LampuLaluLintas.js
 * Mengelola siklus dan status lampu lalu lintas, serta menggambar visualnya.
 */
export class LampuLaluLintas {
    constructor(canvasId) {
        this.canvas = document.getElementById(canvasId);
        this.ctx = this.canvas.getContext("2d");

        // Muat gambar lampu
        this.gambar = { merah: new Image(), kuning: new Image(), hijau: new Image() };
        this.gambar.merah.src = "js/Lampu_Lalu_Lintas/merah.png";
        this.gambar.kuning.src = "js/Lampu_Lalu_Lintas/kuning.png";
        this.gambar.hijau.src = "js/Lampu_Lalu_Lintas/hijau.png";

        // Rotasi lampu tiap lengan (radian)
        this.rotasiLampu = { utara: 270 * Math.PI / 180, timur: 0, selatan: 90 * Math.PI / 180, barat: Math.PI };

        // Default urutan single-direction (dipakai juga untuk membuat grup)
        this.urutan = ["utara", "timur", "selatan", "barat"];
        this.indexAktif = 0;

        // Status warna lampu
        this.status = { utara: "merah", timur: "merah", selatan: "merah", barat: "merah" };
        this.posLampu = { utara: {}, timur: {}, selatan: {}, barat: {} };

        // Fase & durasi
        this.fase = "allRed";
        this.waktuFase = 0;
        this.phaseMode = "searah"; // default: searah
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

    /** Ambil durasi dari input UI (versi baru: total siklus) */
    getDurasi() {
        const safeParse = (id, fallback) => {
            const el = document.getElementById(id);
            if (!el) return fallback;
            const v = parseFloat(el.value);
            return Number.isFinite(v) ? v * 1000 : fallback;
        };

        const durAllRed = safeParse("durAllRed", 2000);
        const durYellow = safeParse("durYellow", 3000);
        const durCycleTotal = safeParse("durCycleTotal", 120000);

        // Hitung durasi hijau berdasarkan mode saat ini (phaseMode)
        let base = (this.phaseMode === "searah") ? (durCycleTotal / 4) : (durCycleTotal / 2);
        let durHijau = base - durAllRed - durYellow;

        if (durHijau <= 0) {
            const minTotal = (this.phaseMode === "searah") ? 4 * (durAllRed + durYellow) : 2 * (durAllRed + durYellow);
            console.warn(`⚠️ Total siklus terlalu kecil (${(durCycleTotal/1000).toFixed(1)}s) untuk mode ${this.phaseMode}. Disarankan minimal ${(minTotal/1000).toFixed(1)} detik.`);
            // clamp minimal 1 detik (1000 ms)
            durHijau = 1000;
        }

        return { hijau: durHijau, kuning: durYellow, allRed: durAllRed, total: durCycleTotal };
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
        for (let arah of ["utara","timur","selatan","barat"]) {
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

    /** -------------------------
     *  Jalankan siklus lampu (dipanggil tiap frame)
     *  - Mendukung urutan yang berisi entri group (mis "utara,selatan")
     *  - fase: allRed -> hijau -> kuning -> allRed
     *  ------------------------- */
    tick(deltaTime) {
        // selalu baca durasi terbaru dari UI (otomatis)
        this.durasi = this.getDurasi();

        this.waktuFase += deltaTime;
        const arahAktif = this.urutan[this.indexAktif]; // bisa "utara" atau "utara,selatan"

        switch (this.fase) {
            case "allRed":
                // semua merah
                for (let a of ["utara","timur","selatan","barat"]) this.status[a] = "merah";
                if (this.waktuFase >= this.durasi.allRed) {
                    // pindah ke hijau untuk urutan indexAktif
                    this.fase = "hijau";
                    this.waktuFase = 0;
                    // set hijau pada satu atau beberapa arah
                    const dirs = (typeof arahAktif === 'string') ? arahAktif.split(',') : [arahAktif];
                    dirs.forEach(d => { if (d) this.status[d.trim()] = "hijau"; });
                }
                break;

            case "hijau":
                {
                    const dirs = (typeof arahAktif === 'string') ? arahAktif.split(',') : [arahAktif];
                    dirs.forEach(d => { if (d) this.status[d.trim()] = "hijau"; });
                    if (this.waktuFase >= this.durasi.hijau) {
                        this.fase = "kuning";
                        this.waktuFase = 0;
                        dirs.forEach(d => { if (d) this.status[d.trim()] = "kuning"; });
                    }
                }
                break;

            case "kuning":
                {
                    const dirs = (typeof arahAktif === 'string') ? arahAktif.split(',') : [arahAktif];
                    dirs.forEach(d => { if (d) this.status[d.trim()] = "kuning"; });
                    if (this.waktuFase >= this.durasi.kuning) {
                        // kembali allRed dan maju index
                        this.fase = "allRed";
                        this.waktuFase = 0;
                        for (let a of ["utara","timur","selatan","barat"]) this.status[a] = "merah";
                        this.indexAktif = (this.indexAktif + 1) % this.urutan.length;
                    }
                }
                break;
        }
    }

    /** Ubah mode fase (searah / berhadapan / berseberangan)
     *  Jika applyImmediately=true → langsung memotong fase berjalan (set allRed + waktu 0)
     *  Urutan internal di-set ke representasi yang sesuai:
     *    - searah: ["utara","timur","selatan","barat"]
     *    - berhadapan: ["utara,selatan","timur,barat"]
     *    - berseberangan: ["utara,timur","barat,selatan"]
     */
    setPhaseMode(mode = "searah", applyImmediately = true) {
        if (!["searah","berhadapan","berseberangan"].includes(mode)) {
            console.warn("[Lampu] setPhaseMode: unknown mode", mode);
            return;
        }
        this.phaseMode = mode;

        if (mode === "searah") {
            this.urutan = ["utara","timur","selatan","barat"];
        } else if (mode === "berhadapan") {
            this.urutan = ["utara,selatan","timur,barat"];
        } else {
            this.urutan = ["utara,timur","barat,selatan"];
        }

        // reset index & cut current phase
        this.indexAktif = 0;
        this.fase = "allRed";
        this.waktuFase = 0;
        // set all red immediately
        for (let a of ["utara","timur","selatan","barat"]) this.status[a] = "merah";

        console.log(`[Lampu] phaseMode set to ${mode} — urutan: ${JSON.stringify(this.urutan)} — immediateCut=${applyImmediately}`);
    }

    /** 🔄 Reset seluruh siklus lampu ke kondisi awal (All-Red, mulai dari Utara) */
    resetAll() {
        for (let arah of ["utara","timur","selatan","barat"]) this.status[arah] = "merah";
        this.indexAktif = 0;
        this.fase = "allRed";
        this.waktuFase = 0;
        console.log("🔁 Lampu lalu lintas direset ke all-red (Utara akan menyala pertama).");
    }

    /** 🚦 Paksa arah tertentu langsung jadi hijau (misal untuk set setelah reset) */
    setCurrentDirection(arah) {
        // support if arah is one of urutan entries or single direction
        const flat = this.urutan.join(",").split(",").map(s => s.trim());
        if (!flat.includes(arah)) return;
        for (let a of ["utara","timur","selatan","barat"]) this.status[a] = "merah";
        // find indexAktif that contains arah
        for (let i = 0; i < this.urutan.length; i++) {
            const entry = this.urutan[i];
            if ((entry.split(',')).includes(arah)) {
                this.indexAktif = i;
                break;
            }
        }
        this.fase = "hijau";
        this.waktuFase = 0;
        this.status[arah] = "hijau";
        console.log(`✅ Lampu diarahkan langsung ke ${arah.toUpperCase()} (Hijau).`);
    }

    /** 🧭 Sinkronisasi ke cycleCanvas (trigger visual reset event) */
    resetCycleVisual() {
        const evt = new CustomEvent("resetCycleCanvas", { detail: { arah: this.urutan[this.indexAktif] } });
        window.dispatchEvent(evt);
    }
} // end class
