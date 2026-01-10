/**
 * Fungsi utama untuk menggambar empat kotak abu-abu dan empat lingkaran putih.
 * @param {CanvasRenderingContext2D} ctx - Konteks gambar kanvas.
 * @param {object} config - Objek konfigurasi persimpangan.
 * @param {number} radiusValue - Nilai radius dari slider (dalam meter).
 */
export function drawTurningRadius(ctx, config, radiusValue) {
  // Hitung skala berdasarkan konfigurasi utama
  const skala = config.skala_px * 3;
  const centerX = ctx.canvas.width / 2;
  const centerY = ctx.canvas.height / 2;

  // Hitung lebar total lajur masuk/keluar dalam piksel
  const U_in_px = config.utara.in * skala;
  const U_out_px = config.utara.out * skala;

  const T_in_px = config.timur.in * skala;
  const T_out_px = config.timur.out * skala;

  const S_in_px = config.selatan.in * skala;
  const S_out_px = config.selatan.out * skala;

  const B_in_px = config.barat.in * skala;
  const B_out_px = config.barat.out * skala;

  // Konversi nilai slider dari meter ke piksel
  const pixelsPerMeter = skala / 3;
  const squareSideLength = radiusValue * pixelsPerMeter;

  // === Menggambar Kotak (Sekarang abu-abu DimGray) ===
  ctx.fillStyle = 'DimGray';
  
  // Kotak 1: Sudut kiri atas
  ctx.fillRect(centerX - U_out_px - squareSideLength, centerY - B_in_px - squareSideLength, squareSideLength, squareSideLength);
  
  // Kotak 2: Sudut kanan atas
  ctx.fillRect(centerX + U_in_px, centerY - T_out_px - squareSideLength, squareSideLength, squareSideLength);
  
  // Kotak 3: Sudut kanan bawah
  ctx.fillRect(centerX + S_out_px, centerY + T_in_px, squareSideLength, squareSideLength);
  
  // Kotak 4: Sudut kiri bawah
  ctx.fillRect(centerX - S_in_px - squareSideLength, centerY + B_out_px, squareSideLength, squareSideLength);
  
  // === Menghitung Koordinat Titik Kuning (sudut luar kotak) ===
  // Titik Merah dan Kuning tidak digambar, tetapi koordinatnya tetap diperlukan untuk lingkaran
  const yellowPoint1X = centerX - U_out_px - squareSideLength;
  const yellowPoint1Y = centerY - B_in_px - squareSideLength;
  
  const yellowPoint2X = centerX + U_in_px + squareSideLength;
  const yellowPoint2Y = centerY - T_out_px - squareSideLength;
  
  const yellowPoint3X = centerX + S_out_px + squareSideLength;
  const yellowPoint3Y = centerY + T_in_px + squareSideLength;
  
  const yellowPoint4X = centerX - S_in_px - squareSideLength;
  const yellowPoint4Y = centerY + B_out_px + squareSideLength;

  // --- Menggambar LINGKARAN PENUH (Sekarang putih) ---
  ctx.fillStyle = 'white';

  // 1. Lingkaran 1 (Pusat di Titik Kuning 1)
  ctx.beginPath();
  ctx.arc(yellowPoint1X, yellowPoint1Y, squareSideLength, 0, 2 * Math.PI);
  ctx.fill();

  // 2. Lingkaran 2 (Pusat di Titik Kuning 2)
  ctx.beginPath();
  ctx.arc(yellowPoint2X, yellowPoint2Y, squareSideLength, 0, 2 * Math.PI);
  ctx.fill();

  // 3. Lingkaran 3 (Pusat di Titik Kuning 3)
  ctx.beginPath();
  ctx.arc(yellowPoint3X, yellowPoint3Y, squareSideLength, 0, 2 * Math.PI);
  ctx.fill();
  
  // 4. Lingkaran 4 (Pusat di Titik Kuning 4)
  ctx.beginPath();
  ctx.arc(yellowPoint4X, yellowPoint4Y, squareSideLength, 0, 2 * Math.PI);
  ctx.fill();
}