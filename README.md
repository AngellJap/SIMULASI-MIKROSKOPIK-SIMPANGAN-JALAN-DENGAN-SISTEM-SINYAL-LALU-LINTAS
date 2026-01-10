# SIMULASI-MIKROSKOPIK-SIMPANGAN-JALAN-DENGAN-SISTEM-SINYAL-LALU-LINTAS
Simulasi mikroskopik simpangan jalan raya empat lengan dengan sistem sinyal lalu lintas berbasis HTML, JavaScript, dan CSS.

Proyek ini merupakan bagian dari penelitian skripsi yang bertujuan untuk membuat
visualisasi simulasi lalu lintas pada simpang bersinyal empat lengan menggunakan
HTML, CSS, dan JavaScript. Simulasi ini berfokus pada:
- Pergerakan kendaraan (motor, mobil, bus) secara mikroskopik berdasarkan radius putar (turning radius) terhadap waktu tunda.
- Pengaruh siklus sinyal lalu lintas (merah, kuning, hijau) dan marka jalan terhadap kinerja simpang.
- Kebijakan belok kiri langsung (LTOR) vs belok kiri ikuti lampu (NLTOR).
- Variasi jumlah lajur masuk/keluar dan pengaruhnya terhadap kapasitas, tundaan, dan panjang antrian.

## 🎯 Tujuan
- Membuat perangkat lunak sederhana untuk memvisualisasikan arus lalu lintas di persimpangan.
- Menguji berbagai skenario (jumlah lajur, turning radius, siklus sinyal, marka jalan, LTOR/NLTOR).
- Memberikan alat bantu analisis untuk penelitian lalu lintas perkotaan.

## ⚙️ Teknologi
- HTML
- CSS
- JavaScript

## 🚀 Cara Berkontribusi
1. Fork repository ini.
2. Clone ke komputer lokal Anda.
3. Tambahkan fitur baru atau perbaikan bug.
4. Buat Pull Request untuk digabungkan ke repositori utama.

---

Proyek ini bersifat open-collaboration untuk pengembangan simulasi sederhana yang
dapat membantu analisis kinerja simpang bersinyal dalam konteks penelitian akademik.

---

Baik, ini **tambahan bagian README** yang rapi, teknis, dan aman untuk dibaca dosen maupun pengguna awam. Tinggal ditempel di bawah README yang sudah ada.

---

## ▶️ Cara Menjalankan Simulasi

Simulasi ini merupakan aplikasi berbasis web murni (client-side) dan **tidak memerlukan backend server**. Untuk menjalankannya, ikuti langkah-langkah berikut secara berurutan:

### 1. Unduh dan Siapkan Berkas

* Unduh seluruh isi repositori ini secara manual/ dengan download dalam bentuk ***ZIP***.
* Pastikan **struktur folder dan nama file tidak diubah**, karena setiap modul JavaScript saling terhubung berdasarkan path folder yang ada.

Struktur folder utama harus tetap seperti berikut:

```
SIMULASI-MIKROSKOPIK-SIMPANGAN-JALAN-DENGAN-SISTEM-SINYAL-LALU-LINTAS/
│── index.html
│── style.css
│── js/
  │── vehicles/
  │── Lampu_Lalu_Lintas/
  │── InfrastrukturJalan/
  │── arrowIcons/
│── logo/
```

### 2. Buka Menggunakan Visual Studio Code

* Buka folder proyek menggunakan **Visual Studio Code** atau editor sejenis.
* Disarankan menggunakan ekstensi **Live Server** di Visual Studio Code agar simulasi berjalan optimal.

### 3. Jalankan dengan Live Server

* Klik kanan pada berkas `index.html`
* Pilih **“Open with Live Server”**
* Simulasi akan terbuka otomatis melalui browser (misalnya `http://127.0.0.1:5500`).

### 4. Menggunakan Simulasi

* Masukkan parameter simulasi seperti:

  * Jumlah lajur
  * Durasi lampu lalu lintas
  * Kebijakan LTOR / NLTOR
  * Radius putar kendaraan
* Model akan secara ***otomatis*** jalan saat run.
* Hasil simulasi akan ditampilkan secara visual dan numerik, serta dapat diekspor dalam bentuk csv.

### 5. Catatan Penting

* Pastikan seluruh file JavaScript berada di dalam folder `js/` sesuai struktur asli.
* Jangan membuka `index.html` langsung tanpa Live Server, karena beberapa fungsi (rendering dan ekspor data) dapat berjalan tidak optimal.
