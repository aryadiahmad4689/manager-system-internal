# VM Login Dashboard

Dashboard untuk monitoring dan manajemen Virtual Machine (VM) melalui SSH.

## Prasyarat

- Node.js >= 18
- npm

## Instalasi

### 1. Clone & Install Dependencies

```bash
git clone <repo-url>
cd vm-login-dashboard
npm install
```

### 2. Konfigurasi Environment

Salin file `.env.example` menjadi `.env.local` dan sesuaikan nilainya:

```bash
cp .env.example .env.local
```

Isi variabel berikut di `.env.local`:

| Variabel | Deskripsi |
|----------|-----------|
| `NEXTAUTH_URL` | URL aplikasi (default: `http://localhost:3000`) |
| `NEXTAUTH_SECRET` | Secret key untuk NextAuth.js (generate random string) |
| `ENCRYPTION_KEY` | Key enkripsi AES-256 untuk credential VM (64 karakter hex) |
| `DATABASE_PATH` | Path file database SQLite (default: `./data/dashboard.db`) |

**Generate ENCRYPTION_KEY:**

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 3. Setup Database & Seed

Jalankan seed untuk membuat database, tabel, user admin default, dan test VM:

```bash
npm run db:seed
```

Seed akan membuat:
- **User admin** — username: `admin`, password: `admin123`
- **Test VM** — sesuai konfigurasi di `src/lib/db/seed.ts`

> Seed aman dijalankan berulang kali. Jika data sudah ada, akan di-skip.

### 4. Jalankan Aplikasi

```bash
# Terminal 1 — Next.js frontend
npm run dev

# Terminal 2 — Socket server (untuk terminal & log streaming)
npm run dev:server
```

Buka `http://localhost:3000` dan login dengan credential admin.

---

## Menghapus VM dari Seed

Jika ingin menghapus VM yang dibuat oleh seed dari database, bisa dilakukan dengan beberapa cara:

### Opsi 1: Hapus via SQLite CLI

```bash
# Buka database
sqlite3 data/dashboard.db

# Lihat VM yang ada
SELECT id, label, host, username FROM vms;

# Hapus VM berdasarkan host (vm_status akan terhapus otomatis karena ON DELETE CASCADE)
DELETE FROM vms WHERE host = '<VM_HOST>' AND username = '<VM_USERNAME>';

# Verifikasi
SELECT * FROM vms;
.quit
```

### Opsi 2: Hapus via Script Node.js

Buat file `scripts/remove-vm.ts`:

```typescript
import Database from 'better-sqlite3';
import path from 'path';

const dbPath = process.env.DATABASE_PATH || path.resolve(process.cwd(), 'data', 'dashboard.db');
const db = new Database(dbPath);
db.pragma('foreign_keys = ON');

// Hapus test VM dari seed
const result = db.prepare(
  "DELETE FROM vms WHERE host = ? AND username = ?"
).run('<VM_HOST>', '<VM_USERNAME>');

console.log(`Deleted ${result.changes} VM(s).`);
db.close();
```

Jalankan:

```bash
npx tsx scripts/remove-vm.ts
```

### Opsi 3: Reset Database (Hapus Semua Data)

Jika ingin reset total dan seed ulang:

```bash
# Hapus file database
rm -f data/dashboard.db data/dashboard.db-shm data/dashboard.db-wal

# Seed ulang
npm run db:seed
```

---

## Struktur Database

| Tabel | Deskripsi |
|-------|-----------|
| `users` | User dashboard (admin) |
| `vms` | Daftar VM yang terdaftar |
| `vm_status` | Status terakhir tiap VM (online/offline/unreachable) |
| `sessions` | Tracking session user |
| `ai_settings` | Konfigurasi AI provider |

---

## Scripts

| Command | Deskripsi |
|---------|-----------|
| `npm run dev` | Jalankan Next.js dev server |
| `npm run dev:server` | Jalankan socket server |
| `npm run build` | Build production |
| `npm run db:seed` | Seed database |
| `npm run test` | Jalankan unit test |
| `npm run lint` | Jalankan ESLint |
