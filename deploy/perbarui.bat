@echo off
REM Perbarui Kasir Buket di PC toko dengan klik dua kali:
REM   1) build aplikasi  2) cadangkan basis data + mulai ulang server  3) commit  4) push ke GitHub
REM Hasil tiap langkah: deploy\perbarui.log. Bila build gagal, server tidak diubah.
REM Syarat: Node.js 22 LTS atau lebih baru. Untuk commit/push: Git untuk Windows dan sudah pernah login GitHub.
title Perbarui Kasir Buket
cd /d "%~dp0\.."
node deploy\perbarui.mjs
echo.
echo Selesai. Catatan lengkap: deploy\perbarui.log
echo Jendela ini menutup sendiri dalam 30 detik.
timeout /t 30
