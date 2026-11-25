# Panduan Kontribusi LocalVid Studio

Terima kasih atas minat Anda untuk berkontribusi di **LocalVid Studio**! Setiap kontribusi, mulai dari laporan bug, perbaikan dokumentasi, peningkatan UI/UX, hingga optimasi FFmpeg.wasm dan WebGPU, sangat membantu komunitas.

---

## Cara Melaporkan Bug

Sebelum membuka Issue baru, periksa dulu apakah kendala serupa sudah pernah dilaporkan. Saat membuat **GitHub Issue**, sertakan informasi berikut agar mudah direproduksi:

1. **Perangkat & Browser:** Contoh `Windows 11 / Chrome 131`, `iPhone 15 / iOS Safari 18`, atau `Android 14 / Chrome`.
2. **Mode Engine:** `Multi-Thread` atau `Single-Thread Hemat RAM` (terlihat di badge header aplikasi).
3. **Tab Fitur & Pengaturan:** Jelaskan tab fitur, template, atau opsi yang dipilih.
4. **Info Video (Opsional):** Format file, resolusi, durasi, dan ukuran MB (jangan unggah video pribadi ke Issue).
5. **Log Teknis FFmpeg:** Salin baris error dari panel lipat **Log Teknis FFmpeg** di bagian bawah halaman.

---

## Cara Mengajukan Fitur Baru

Buka **GitHub Issue** dengan label *enhancement* dan jelaskan:
- Masalah yang ingin diselesaikan dan manfaatnya bagi pengguna.
- Gambaran alur UI atau parameter FFmpeg/WebGPU yang diusulkan.
- Pertimbangan kompatibilitas di Windows, Android, dan iOS (ingat bahwa proyek ini 100% client-side tanpa server).

---

## Alur Pengembangan & Pull Request

1. **Fork** repositori ini ke akun GitHub Anda, lalu clone ke komputer lokal:
   ```bash
   git clone https://github.com/USERNAME-ANDA/localvid-studio.git
   cd localvid-studio
   npm install
   ```
2. Buat branch baru dari `main` dengan nama yang deskriptif:
   ```bash
   git checkout -b fix/perbaikan-stabilizer
   # atau
   git checkout -b feat/nama-fitur-baru
   ```
3. Jalankan mode pengembangan lokal untuk menguji perubahan Anda:
   ```bash
   npm run dev
   ```
4. Pastikan build TypeScript dan Vite lulus 100% tanpa error sebelum commit:
   ```bash
   npm run build
   ```
5. Commit perubahan dengan pesan yang jelas, push ke branch fork Anda, lalu buka **Pull Request** ke branch `main`.

---

## Prinsip & Standar Kode

- **100% Client-Side & Privasi Utama:** Jangan menambahkan integrasi unggah video ke server eksternal, tracking analytics, atau API key rahasia.
- **Tanpa Watermark pada Video Hasil:** Credit pembuat hanya ditampilkan di antarmuka web, tidak pernah dibakar (*burned-in*) ke dalam video output pengguna.
- **Aman untuk FFmpeg.wasm & Lintas Platform:**
  - Selalu batasi jumlah thread (`-threads`) agar tidak terjadi pthread deadlock di mode Multi-Thread WASM.
  - Gunakan dimensi genap (kelipatan 2) dan `-pix_fmt yuv420p` / `format=yuv420p` demi kompatibilitas iOS Safari, Android, dan Windows.
  - Pastikan library AI/WebGPU tetap *lazy-loaded* sehingga 0 byte dimuat di perangkat mobile atau browser tanpa WebGPU.
  - Pastikan file sementara virtual FS dan Blob URL selalu dibersihkan melalui `cleanupMemory()`.
- **Bersih dari File Media Tes:** Jangan pernah menyertakan file video tes (`.mp4`, `.mov`, `.mkv`, `.webm`, `.avi`) atau folder konfigurasi lokal di dalam commit.

---

Dengan berkontribusi pada repositori ini, Anda menyetujui bahwa kontribusi Anda akan dilisensikan di bawah [MIT License](./LICENSE).
