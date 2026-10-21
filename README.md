# เพื่อนตัวจิ๋ว • Little Rescue

เกมป้องกันฐานด้านข้างแบบ LINE Rangers เล่นในเบราว์เซอร์ ติดตั้งเป็นแอปได้ทั้งมือถือและคอม เล่นออฟไลน์ได้

- เล่น: https://little-rescue.pages.dev
- ไฟล์เกมทั้งหมดอยู่ใน `game/` (HTML/JS ล้วน ไม่ต้อง build)

## อัปเดตเกม

1. แก้ไฟล์ใน `game/` แล้วเปิด pull request
2. GitHub ตรวจให้เอง (`node tools/check.mjs`) และทำลิงก์ทดลอง `https://pr-<เลข>.little-rescue.pages.dev` ให้ลองบนมือถือก่อน
   (ลิงก์ทดลองมีเซฟของตัวเอง ไม่ยุ่งกับเซฟผู้เล่นจริง)
3. กด Merge เข้า `main` = ขึ้นเกมจริงที่ลิงก์เดิม ผู้เล่นได้รุ่นใหม่ตอนเปิดเกมครั้งถัดไป (ไม่ตัดกลางด่าน)

ถ้ายังไม่ได้ตั้งรหัส Cloudflare: เปิดแท็บ Actions › รอบล่าสุด › ดาวน์โหลด `Little-Rescue-Cloudflare-Upload` แล้วอัปโหลดเองแบบเดิม

## ตั้งค่าครั้งแรก (ส่งขึ้น Cloudflare ให้อัตโนมัติ)

1. Cloudflare › My Profile › API Tokens › Create Token › เทมเพลต **Edit Cloudflare Workers**
   (หรือ Custom token สิทธิ์ Account › **Cloudflare Pages: Edit**) › คัดลอกโทเค็น
2. Cloudflare › Workers & Pages › ดู **Account ID** ทางขวา
3. GitHub repo นี้ › Settings › Secrets and variables › Actions › New repository secret
   - `CLOUDFLARE_API_TOKEN` = โทเค็นจากข้อ 1
   - `CLOUDFLARE_ACCOUNT_ID` = Account ID จากข้อ 2
4. ถ้าชื่อโปรเจกต์ใน Cloudflare ไม่ใช่ `little-rescue`: แท็บ Variables เพิ่ม `CLOUDFLARE_PROJECT` = ชื่อโปรเจกต์
5. Cloudflare › โปรเจกต์ › Settings › ดูว่า Production branch คือ `main`

## กฎที่ห้ามพัง

- เซฟผู้เล่น: `little-rescue-sideview-save-v2` (ห้ามเพิ่มฟิลด์ เวอร์ชันเก่าจะตัดทิ้ง) และ `little-rescue-meta-v1` (ด่าน/เลเวล)
- ห้ามย้ายเกมไปลิงก์อื่น (เช่น GitHub Pages) เพราะเบราว์เซอร์เก็บเซฟแยกตามลิงก์
- ทุกรุ่นใหม่: เปลี่ยน `BUILD_ID` ใน `sw.js`, `PAGE_BUILD_ID` ใน `pwa.js`, `TARGET` ในทุก `recover-v*/`,
  เพิ่ม `recover-vXYZ/` ของรุ่นนั้น และเพิ่มไฟล์ใหม่ลงรายการ PRECACHE (`tools/check.mjs` เตือนให้ทุกข้อ)
