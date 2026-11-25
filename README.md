# LocalVid Studio

> Pengolah video open-source 100% client-side berbasis browser untuk Windows, Android, dan iOS. Gratis selamanya, tanpa unggah ke server, dan bebas watermark pada hasil video.

[![Open Source](https://img.shields.io/badge/Open%20Source-Yes-2563eb?style=flat-square)](https://github.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-10b981?style=flat-square)](./LICENSE)
[![100% Client-Side](https://img.shields.io/badge/100%25%20Client--Side-FFmpeg.wasm%20%2B%20WebGPU-f97316?style=flat-square)](#konsep-utama)
[![Free Forever](https://img.shields.io/badge/Cost-Free%20Forever%20(Rp0)-0ea5e9?style=flat-square)](#deploy-gratis-di-github-pages)
[![Platform](https://img.shields.io/badge/Platform-Windows%20%7C%20Android%20%7C%20iOS-6366f1?style=flat-square)](#arsitektur-adaptif-lintas-platform)

---

### English Overview

**LocalVid Studio** is a free, open-source, 100% client-side browser video editor powered by **FFmpeg.wasm**, **WebGPU**, and **WebGL2**. Every conversion, compression, 1080p enhancement, color grading, stabilization, and GPU upscaling step runs strictly inside the user's browser with zero backend server costs, complete file privacy (videos never leave your device), and zero watermarks on exported videos. It adapts automatically between multi-threaded performance on Desktop and low-RAM single-threaded execution on iOS and Android.

---

## Konsep Utama

- **100% Berjalan di Browser:** Seluruh pemrosesan video dijalankan secara lokal menggunakan `FFmpeg.wasm` dan akselerasi `WebGPU` / `WebGL2` tanpa backend.
- **Biaya Server Rp0:** Cukup di-hosting sebagai situs statis (misalnya lewat GitHub Pages) tanpa perlu menyewa server pemrosesan video.
- **Privasi Penuh:** Video Anda tidak pernah diunggah ke server mana pun dan tetap tersimpan di perangkat Anda sendiri.
- **Bebas Watermark:** Hasil video yang diunduh 100% bersih tanpa watermark tambahan.
- **Manajemen Memori Aman:** File sementara di virtual filesystem FFmpeg dan Blob URL lama selalu dibersihkan otomatis setiap kali selesai proses, pindah tab, atau mengganti file.

---

## 5 Fitur Utama

### 1. Ubah Ekstensi (Convert & Fast Remux)
- Mendukung input `.mov`, `.mp4`, `.mkv`, `.webm`, dan `.avi` dengan pilihan output `.MP4`, `.MOV`, `.WebM`, dan `.MKV`.
- **Mode Kilat / Fast Remux (`-c copy`):** Mengubah wadah video (termasuk rekaman `.MOV` dari iPhone) ke `.MP4` dalam hitungan detik tanpa menurunkan kualitas asli.
- **Fallback Re-encode Otomatis:** Jika codec asli tidak cocok dengan format wadah target, aplikasi otomatis beralih ke re-encode yang kompatibel (`H.264/AAC` atau `VP8/Vorbis`).

### 2. Kompres Video (Template 1-Klik & Mode Pro)
- **Template Media Sosial 1-Klik (Anti-Burik):** Pengaturan instan siap pakai untuk **TikTok & Reels HD**, **WhatsApp Status & Chat HD**, **YouTube 1080p Optimal**, **Instagram Feed / Story**, **Discord Free (< 10 MB)**, dan **Email / Lampiran Ringan (< 25 MB)**. Seluruh template hanya melakukan *downscale* (tidak pernah *upscale*).
- **Smart Bitrate Cap (Anti-Bengkak) & Smart Audio Copy:** Menghitung bitrate file asli secara otomatis dan menerapkan batas `-maxrate` / `-bufsize` serta salin audio otomatis untuk file padat (seperti kiriman WhatsApp) agar ukuran hasil tidak membengkak.
- **Mode Custom / Manual:**
  - **Pilihan Format Output:** `.MP4`, `.MKV`, `.WebM`, `.MOV` dengan *Smart Auto-Pairing* codec.
  - **Mode Kualitas:** Preset CRF (*Visually Lossless CRF 18*, *Seimbang CRF 23*, *Ukuran Terkecil CRF 28*) atau **Custom Target Size (MB)** lengkap dengan **Estimasi Ukuran Real-Time**.
  - **Pengaturan Lanjutan (Advanced Settings):** Video Codec (`Auto`, `H.264`, `H.265`, `VP9`, `Copy`), Resize (preset resolusi atau custom px), Aspect Ratio, Frame Rate (FPS), Rotate, Flip, Audio (Codec, Volume, Fade In/Out, Hapus Audio), Trim (`HH:MM:SS.MS`), Crop (px), Hapus Metadata Pribadi (`-map_metadata -1`), dan Optimasi Streaming Web (`-movflags +faststart`).

### 3. Jernihkan & HD + Filter Warna
- **Penjernihan & Upscale 1080p:** Kurangi Noise (`hqdn3d`), Pertajam Detail (`unsharp`), Perbaiki Warna & Kontras (`eq`), dan Upscale ke 1080p HD dengan pilihan algoritma skala (`Bicubic`, `Bilinear`, `Lanczos`) serta dimensi genap yang dihitung presisi sesuai orientasi portrait/landscape.
- **Filter & Color Grading (dengan Live Preview):**
  - *iPhone 18 Pro Max Look*
  - *Cinematic Teal & Orange*
  - *Golden Hour / Warm Aesthetic*
  - *Vintage Film / Kodak*
  - *Vivid HDR / Jernih Cerah*
  - *Noir B&W*

### 4. Stabilizer Video (Anti-Goyang)
- Tab mandiri berbasis filter bawaan FFmpeg `deshake` yang 100% kompatibel dengan FFmpeg.wasm di Windows, Android, dan iOS.
- Dilengkapi 3 tingkat kekuatan: **Ringan** (`16px`, `search=less`), **Sedang** (`32px`, `search=less`), dan **Kuat / Aksi** (`48px`, `search=exhaustive` + auto-crop 8% untuk menghilangkan tepi pantulan secara bersih).

### 5. AI / GPU HD Upscaler (Beta)
- Khusus untuk browser Desktop modern yang mendukung **WebGPU** (seperti Chrome dan Edge di Windows/macOS).
- Menyediakan **WebGPU Fast Enhance Shader** bawaan (tanpa unduh model eksternal), dukungan model **ONNX Super-Resolution** via `onnxruntime-web/webgpu`, serta fallback otomatis **WebGL2** agar tidak pernah menghasilkan frame hitam.
- **Keamanan Lintas Platform:** Di perangkat mobile (iOS/Android) atau browser tanpa WebGPU, modul ONNX tidak dimuat sama sekali (0 byte) demi kestabilan RAM dan baterai.

---

## Pengalaman Pengguna & Arsitektur Adaptif

- **Perbandingan Hasil Before & After Interaktif:** Pemutar video dengan **Mode Geser (Split Slider)** dan **Mode Berdampingan (Side-by-Side)**, kontrol Putar/Jeda tersinkronisasi, audio tunggal agar tidak bergema, dan atribut `playsInline` untuk iOS Safari.
- **Clean Result View & Auto-Reset Tab:** Setelah render selesai, tampilan langsung fokus pada hasil ekspor beserta ringkasan statistik kontekstual sesuai fitur yang dijalankan. Saat berpindah ke tab fitur lain, hasil sebelumnya dan Blob URL lama dibersihkan otomatis sementara video input tetap tersimpan.
- **Simpan ke Galeri HP:** Mendukung tombol **Unduh Video** serta **Simpan / Bagikan ke Galeri** lewat Web Share API di perangkat mobile yang mendukung.

### Arsitektur Adaptif Lintas Platform

| Platform | Engine FFmpeg.wasm | Mode Thread | Tujuan |
| :--- | :--- | :--- | :--- |
| **Desktop** (`crossOriginIsolated === true`) | `@ffmpeg/core-mt@0.12.6` | Multi-Thread (`2` atau `4` thread) | Performa render cepat dengan batas thread anti-deadlock |
| **Android / iOS** atau non-isolated | `@ffmpeg/core@0.12.6` | Single-Thread Hemat RAM (`1` thread) | Penggunaan memori stabil dan mencegah tab crash di Safari iOS |

---

## Tech Stack

- **Frontend Framework:** React 19 + TypeScript 7
- **Build Tool:** Vite 8 (`base: './'` untuk kompatibilitas subpath GitHub Pages)
- **Styling & Ikon:** Tailwind CSS v4 + Lucide React
- **Video Engine:** `@ffmpeg/ffmpeg` v0.12+ & `@ffmpeg/util` (core WASM dimuat via CDN jsDelivr dengan fallback unpkg)
- **GPU / AI Engine:** `onnxruntime-web` (lazy-loaded khusus Desktop WebGPU) + WebGPU / WebGL2 custom shaders
- **COOP / COEP Support:** `coi-serviceworker` (`public/coi-serviceworker.min.js`) untuk mengaktifkan `SharedArrayBuffer` di GitHub Pages

---

## Menjalankan Secara Lokal

### Prasyarat
- Node.js versi **20** atau **22** (disarankan Node.js 22 LTS)
- npm versi 10+

### Langkah Instalasi

```bash
# 1. Clone repositori
git clone https://github.com/USERNAME/localvid-studio.git
cd localvid-studio

# 2. Instal dependensi
npm install

# 3. Jalankan server pengembangan lokal (sudah aktif dengan header COOP/COEP)
npm run dev
```

Buka browser dan kunjungi `http://localhost:5173/`.

### Build Produksi & Pratinjau

```bash
# Build bundle produksi ke folder dist/
npm run build

# Uji hasil build secara lokal
npm run preview
```

---

## Deploy Gratis di GitHub Pages

Proyek ini sudah dilengkapi workflow GitHub Actions resmi di [.github/workflows/deploy.yml](./.github/workflows/deploy.yml) yang otomatis melakukan build dan deploy setiap kali ada push ke branch `main`.

1. Push repositori ini ke akun GitHub Anda pada branch `main`.
2. Buka tab **Settings** -> **Pages** di repositori GitHub Anda.
3. Pada bagian **Build and deployment** -> **Source**, pilih **GitHub Actions**.
4. Setiap push ke `main` (atau klik *Run workflow* manual di tab **Actions**) akan otomatis mempublikasikan LocalVid Studio ke `https://USERNAME.github.io/NAMA-REPO/`.

> **Catatan:** Pada kunjungan pertama di GitHub Pages, `coi-serviceworker.min.js` akan mendaftarkan service worker dan menyegarkan halaman sekali secara otomatis agar mode Multi-Thread (`SharedArrayBuffer`) aktif di Desktop.

---

## Catatan & Batasan Teknis

- **Batas Aman RAM Browser:** Karena seluruh video diproses di memori lokal browser, aplikasi menampilkan peringatan ramah bila ukuran file melebihi **150 MB di HP** atau **500 MB di Desktop** (tetap bisa dilanjutkan, namun disarankan memakai *Mode Kilat / Fast Remux*).
- **Durasi AI / GPU HD Upscaler:** Dibatasi maksimal **15 detik** per proses agar GPU desktop tidak macet (*hang*) saat memproses frame demi frame.
- **Koneksi Pertama Kali:** Engine WASM FFmpeg (`@ffmpeg/core` / `@ffmpeg/core-mt`) diunduh sekali dari CDN saat proses pertama dijalankan, lalu di-cache oleh browser.
- **Format Codec Spesifik:** Beberapa kombinasi codec ekstrem (misalnya audio tertentu pada wadah `.WebM`) dilindungi oleh validasi otomatis di UI agar perintah FFmpeg tidak gagal.

---

## Kontribusi

Kontribusi dalam bentuk laporan bug, saran fitur, dokumentasi, maupun Pull Request sangat terbuka dan dihargai. Silakan baca panduan singkat di [CONTRIBUTING.md](./CONTRIBUTING.md) sebelum mengirim Pull Request.

- Laporkan kendala atau ide fitur lewat menu **GitHub Issues**.
- Kirim perbaikan atau fitur baru lewat **Pull Request**.

---

## Author & Lisensi

- **Author:** Created by **Atainanur**
- **Lisensi:** Dirilis di bawah lisensi [MIT License](./LICENSE). Anda bebas menggunakan, memodifikasi, dan mendistribusikan proyek ini sesuai ketentuan lisensi MIT.
