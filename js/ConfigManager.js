// File: js/ConfigManager.js

/**
 * 1. FUNGSI EXPORT: Mengambil semua data dari HTML dan menyimpannya jadi JSON
 */
export function downloadKonfigurasi() {
    const config = {
        meta: {
            tanggal: new Date().toLocaleString('id-ID'),
            simulasi: "Simpang 4 Lengan Mikroskopik"
        },
        geometri: {
            radius: document.getElementById('customRange').value,
            lajur: {
                utara: { masuk: document.getElementById('inNorth').value, keluar: document.getElementById('outNorth').value },
                timur: { masuk: document.getElementById('inEast').value, keluar: document.getElementById('outEast').value },
                selatan: { masuk: document.getElementById('inSouth').value, keluar: document.getElementById('outSouth').value },
                barat: { masuk: document.getElementById('inWest').value, keluar: document.getElementById('outWest').value }
            }
        },
        sinyal: {
            siklus: document.getElementById('durCycleTotal').value,
            kuning: document.getElementById('durYellow').value,
            merah_semua: document.getElementById('durAllRed').value,
            ltor: document.getElementById('ltsorGlobalSwitch').checked,
            // Deteksi tombol fase aktif
            fase: document.querySelector('.fase-btn.active') ? document.querySelector('.fase-btn.active').innerText : 'Searah'
        },
        lalu_lintas: ambilDataLaluLintasSemuaArah()
    };

    // Download File
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(config, null, 2));
    const downloadAnchorNode = document.createElement('a');
    downloadAnchorNode.setAttribute("href", dataStr);
    downloadAnchorNode.setAttribute("download", "skenario_simulasi_" + Date.now() + ".json");
    document.body.appendChild(downloadAnchorNode);
    downloadAnchorNode.click();
    downloadAnchorNode.remove();
}

/**
 * Helper: Ambil data detail per lajur (Motor/Mobil/Truk)
 */
function ambilDataLaluLintasSemuaArah() {
    const data = {};
    const arah = ['utara', 'timur', 'selatan', 'barat'];
    
    arah.forEach(dir => {
        data[dir] = [];
        // Kita loop asumsi maksimal 5 lajur, atau baca dari input geometri
        const jumlahLajur = parseInt(document.getElementById(dir === 'utara' ? 'inNorth' : dir === 'timur' ? 'inEast' : dir === 'selatan' ? 'inSouth' : 'inWest').value) || 1;

        for (let i = 1; i <= jumlahLajur; i++) {
            // Pattern ID: utara_lane1_flow, utara_lane1_motorPct, dst.
            const flow = document.getElementById(`${dir}_lane${i}_flow`);
            
            if (flow) { // Jika elemen ada
                data[dir].push({
                    lajur: i,
                    arus: flow.value,
                    motor: document.getElementById(`${dir}_lane${i}_motorPct`).value,
                    mobil: document.getElementById(`${dir}_lane${i}_carPct`).value,
                    truk: document.getElementById(`${dir}_lane${i}_truckPct`).value
                });
            }
        }
    });
    return data;
}

/**
 * 2. FUNGSI IMPORT: Membaca JSON dan mengisi ke HTML
 */
export function uploadKonfigurasi(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const data = JSON.parse(e.target.result);
            terapkanKonfigurasi(data);
            alert("Skenario berhasil dimuat! Silakan tekan 'Reset / Mulai' untuk menjalankan.");
        } catch (err) {
            console.error(err);
            alert("Gagal membaca file JSON. Pastikan format benar.");
        }
    };
    reader.readAsText(file);
}

function terapkanKonfigurasi(data) {
    // Helper untuk set nilai dan memicu event 'change' agar UI update otomatis
    const setVal = (id, val) => {
        const el = document.getElementById(id);
        if (el) {
            el.value = val;
            el.dispatchEvent(new Event('change')); // PENTING: Memicu fungsi generate input traffic
            el.dispatchEvent(new Event('input'));
        }
    };

    // 1. Set Geometri (Ini akan memicu pembuatan baris input traffic)
    setVal('customRange', data.geometri.radius);
    setVal('inNorth', data.geometri.lajur.utara.masuk);
    setVal('outNorth', data.geometri.lajur.utara.keluar);
    setVal('inEast', data.geometri.lajur.timur.masuk);
    setVal('outEast', data.geometri.lajur.timur.keluar);
    setVal('inSouth', data.geometri.lajur.selatan.masuk);
    setVal('outSouth', data.geometri.lajur.selatan.keluar);
    setVal('inWest', data.geometri.lajur.barat.masuk);
    setVal('outWest', data.geometri.lajur.barat.keluar);

    // 2. Set Sinyal
    setVal('durCycleTotal', data.sinyal.siklus);
    setVal('durYellow', data.sinyal.kuning);
    setVal('durAllRed', data.sinyal.merah_semua);
    if (document.getElementById('ltsorGlobalSwitch')) {
        document.getElementById('ltsorGlobalSwitch').checked = data.sinyal.ltor;
        document.getElementById('ltsorGlobalSwitch').dispatchEvent(new Event('change'));
    }

    // Klik tombol fase yang sesuai
    const faseText = data.sinyal.fase || 'Searah';
    const buttons = document.querySelectorAll('.fase-btn');
    buttons.forEach(btn => {
        if (btn.innerText.includes(faseText)) btn.click();
    });

    // 3. Set Lalu Lintas (Beri sedikit jeda agar DOM input traffic selesai dibuat oleh event geometri)
    setTimeout(() => {
        const arah = ['utara', 'timur', 'selatan', 'barat'];
        arah.forEach(dir => {
            if (data.lalu_lintas && data.lalu_lintas[dir]) {
                data.lalu_lintas[dir].forEach(item => {
                    setVal(`${dir}_lane${item.lajur}_flow`, item.arus);
                    setVal(`${dir}_lane${item.lajur}_motorPct`, item.motor);
                    setVal(`${dir}_lane${item.lajur}_carPct`, item.mobil);
                    setVal(`${dir}_lane${item.lajur}_truckPct`, item.truk);
                });
            }
        });
    }, 200); // Delay 200ms
}