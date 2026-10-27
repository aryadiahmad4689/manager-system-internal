# 🖥️ VM Login Dashboard

Dashboard modern dan komprehensif untuk monitoring, manajemen Virtual Machine (VM), akses Web SSH Terminal interaktif, serta Multi-Database Query Console.

---

## 📌 Fitur Utama

- ⚡ **VM Monitoring & Status Tracking** — Pantau ketersediaan VM (online, offline, unreachable) secara real-time.
- 💻 **Web-Based SSH Terminal** — Akses konsol SSH langsung dari browser bertenaga **xterm.js** dan **SSH2**.
- 📡 **Real-Time Log Streaming** — Streaming log server dan aktivitas terminal berbasis **Socket.IO**.
- 🗄️ **Multi-Database Query Console** — Query editor interaktif dengan **CodeMirror** yang mendukung **SQLite**, **PostgreSQL**, dan **MySQL**.
- 🔐 **Keamanan Tinggi & Enkripsi Data** — Kredensial VM dienkripsi menggunakan algoritma **AES-256**, serta sesi diamankan dengan **NextAuth.js (JWT)**.
- 🤖 **AI Provider Integration** — Konfigurasi provider AI terintegrasi untuk bantuan analisis sistem.

---

## 🛠️ Tech Stack

- **Framework**: [Next.js 14](https://nextjs.org/) (App Router, React 18, TypeScript)
- **Styling**: Tailwind CSS
- **Authentication**: NextAuth.js (JWT & Credentials Provider)
- **Database**: Better-SQLite3
- **SSH & Terminal**: ssh2, @xterm/xterm, @xterm/addon-fit
- **Real-Time Communication**: Socket.IO
- **Database Drivers**: pg (PostgreSQL), mysql2 (MySQL), better-sqlite3 (SQLite)
- **Testing**: Vitest, React Testing Library, Fast-Check

---

## 📋 Prasyarat

- **Node.js** >= 18.x
- **npm** atau package manager kompatibel

---

## 🚀 Panduan Instalasi & Menjalankan

### 1. Clone & Install Dependencies

```bash
git clone <repo-url>
cd project-vm
npm install
```

### 2. Konfigurasi Environment

Salin file `.env.example` menjadi `.env.local` dan sesuaikan nilainya:

```bash
cp .env.example .env.local
```

Pengaturan variabel pada `.env.local`:

| Variabel | Deskripsi | Default / Rekomendasi |
|----------|-----------|-----------------------|
| `NEXTAUTH_URL` | URL aplikasi | `http://localhost:3000` (atau port server yang digunakan) |
| `NEXTAUTH_SECRET` | Secret key untuk enkripsi sesi NextAuth.js | Random string aman |
| `ENCRYPTION_KEY` | Key enkripsi AES-256 untuk kredensial VM | String hex 64 karakter (32 bytes) |
| `DATABASE_PATH` | Lokasi file database SQLite | `./data/dashboard.db` |
| `PORT` | Port server (opsional) | `3300` |

> 💡 **Generate ENCRYPTION_KEY & NEXTAUTH_SECRET:**
> ```bash
> # ENCRYPTION_KEY (32 bytes hex)
> node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
> 
> # NEXTAUTH_SECRET
> node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
> ```

### 3. Setup Database & Seed

Jalankan skrip seed untuk membuat skema database, tabel, akun admin awal, dan data pengujian:

```bash
npm run db:seed
```

**Kredensial Default Seed:**
- **Username**: `admin`
- **Password**: `admin123`

*(Catatan: Script seed aman dijalankan berulang kali. Data yang sudah ada tidak akan diduplikasi).*

### 4. Menjalankan Aplikasi

Aplikasi dapat dijalankan melalui dua opsi:

#### Opsi A: Menggunakan Custom Server (Next.js + Socket.IO Terintegrasi)
```bash
npm run dev:server
```
Server akan berjalan di `http://localhost:3300` (atau sesuai konfigurasi `PORT`), meng-handle Next.js dan endpoint `/api/socketio` untuk koneksi terminal SSH & log streaming.

#### Opsi B: Multi-Terminal (Dev Mode Terpisah)
```bash
# Terminal 1 — Next.js dev server
npm run dev

# Terminal 2 — Socket server
npm run dev:server
```

Buka browser di `http://localhost:3000` (atau port yang aktif) dan login dengan akun admin.

---

## ⚙️ Manajemen Data VM

### Menghapus VM dari Seed

Jika Anda ingin membersihkan atau menghapus data test VM yang dibuat oleh seed:

#### Opsi 1: Menggunakan SQLite CLI
```bash
# Buka database SQLite
sqlite3 data/dashboard.db

# Cek daftar VM
SELECT id, label, host, username FROM vms;

# Hapus VM berdasarkan host (relasi vm_status akan terhapus otomatis via CASCADE)
DELETE FROM vms WHERE host = '<VM_HOST>' AND username = '<VM_USERNAME>';

# Verifikasi & keluar
SELECT * FROM vms;
.quit
```

#### Opsi 2: Menggunakan Script Node.js
Buat file `scripts/remove-vm.ts`:
```typescript
import Database from 'better-sqlite3';
import path from 'path';

const dbPath = process.env.DATABASE_PATH || path.resolve(process.cwd(), 'data', 'dashboard.db');
const db = new Database(dbPath);
db.pragma('foreign_keys = ON');

const result = db.prepare(
  "DELETE FROM vms WHERE host = ? AND username = ?"
).run('<VM_HOST>', '<VM_USERNAME>');

console.log(`Deleted ${result.changes} VM(s).`);
db.close();
```
Jalankan script:
```bash
npx tsx scripts/remove-vm.ts
```

#### Opsi 3: Reset Total Database
```bash
# Hapus file database SQLite
rm -f data/dashboard.db data/dashboard.db-shm data/dashboard.db-wal

# Inisialisasi ulang
npm run db:seed
```

---

## 🗄️ Skema Database

| Tabel | Deskripsi |
|-------|-----------|
| `users` | Data akun pengguna / administrator dashboard |
| `vms` | Daftar Virtual Machine (kredensial host, port, username, password terenkripsi) |
| `vm_status` | Status ketersediaan berkala tiap VM (*online*, *offline*, *unreachable*) |
| `sessions` | Tracking sesi login pengguna |
| `ai_settings` | Konfigurasi preferensi provider model AI |

---

## 📜 Skrip NPM

| Script | Deskripsi |
|--------|-----------|
| `npm run dev` | Menjalankan Next.js development server |
| `npm run dev:server` | Menjalankan custom server Next.js + Socket.IO |
| `npm run build` | Menjalankan build production Next.js |
| `npm run start` | Menjalankan aplikasi hasil build production |
| `npm run db:seed` | Inisialisasi dan seeding database SQLite |
| `npm run test` | Menjalankan unit test dengan Vitest |
| `npm run test:watch` | Menjalankan unit test dalam mode watch |
| `npm run test:coverage` | Menjalankan unit test dengan laporan cakupan (coverage) |
| `npm run lint` | Menjalankan audit kode dengan ESLint |

---

## 👨‍💻 Penulis / Author

- **Ariadi Ahmad (SilverBullet)**

---

## 📄 Lisensi & Ketentuan Penggunaan

Proyek ini dirilis di bawah lisensi **Custom Non-Commercial & No-Derivatives (CC BY-NC-ND 4.0 / Setara)**:

- ✅ **Bebas Digunakan**: Terbuka untuk umum digunakan sebagai referensi, pembelajaran, atau penggunaan personal/internal tanpa biaya.


