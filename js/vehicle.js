// vehicle.js
// Modul untuk menggambar kendaraan dengan gambar PNG tajam
// Gambar di-scale down 10x dari ukuran asli agar tidak blur

// Muat gambar kendaraan
const vehicleImages = {
    mobil: new Image(),
    motor: new Image(),
    truk: new Image(),
};

// Set source gambar
vehicleImages.mobil.src = "js/vehicles/mobil.png";
vehicleImages.motor.src = "js/vehicles/motor.png";
vehicleImages.truk.src = "js/vehicles/truk.png";

/**
 * Gambar kendaraan pada posisi tertentu
 * vctx: context canvas kendaraan
 * vehicle: {x, y, type}
 */
export function drawVehicle(vctx, vehicle) {
    const img = vehicleImages[vehicle.type];
    if (!img || !img.complete) {
        // fallback kalau gambar belum siap
        vctx.fillStyle =
            vehicle.type === "motor" ? "blue" :
            vehicle.type === "truk" ? "brown" : "gray";
        vctx.fillRect(vehicle.x - 5, vehicle.y - 5, 10, 10);
        return;
    }

    // scale down 10x
    const scaleFactor = 0.1;
    const width = img.width * scaleFactor;
    const height = img.height * scaleFactor;

    vctx.drawImage(img, -width / 2, -height / 2, width, height);
}

/**
 * Fungsi dummy untuk menggambar titik lajur.
 * Dibuat kosong supaya tidak ada titik merah muncul,
 * tapi main.js tetap bisa memanggil tanpa error.
 */
export function drawLaneCenters() {
    // sengaja kosong
}
