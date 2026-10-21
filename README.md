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

## เซฟบนคลาวด์ (ตั้งครั้งเดียว ตั้งแต่รุ่น 1.11.0)

ปุ่ม ☁️ มุมขวาบนของหน้าเริ่มเกมจะขึ้นเมื่อ Cloudflare มีฐานข้อมูลให้แล้วเท่านั้น ถ้ายังไม่ตั้ง เกมเล่นได้ตามเดิมด้วยเซฟในเครื่อง

1. Cloudflare › Storage & Databases › **D1 SQL Database** › Create › ชื่อ `little-rescue-saves` (Location: Asia-Pacific)
2. (แนะนำ) สร้างอีกอันชื่อ `little-rescue-saves-preview` ไว้ให้ลิงก์ทดลอง จะได้ไม่ปนกับเซฟผู้เล่นจริง
3. Workers & Pages › โปรเจกต์ `little-rescue` › Settings › **Bindings** › Add › D1 database
   - Variable name: `SAVES_DB` · Database: `little-rescue-saves` · ทำในหัวข้อ **Production**
   - สลับไป **Preview** แล้วเพิ่ม `SAVES_DB` = `little-rescue-saves-preview`
   - (`DB` เป็นของระบบสถิติ ห้ามใช้ชื่อซ้ำ)
4. Deployments › กด Retry deployment รอบล่าสุด (หรือ merge PR ถัดไป) ให้ค่าใหม่มีผล
5. เปิด `https://little-rescue.pages.dev/api/health` ต้องเห็น `{"ok":true,"cloud":true}`

ตารางในฐานข้อมูลสร้างให้เองตอนใช้ครั้งแรก ไม่ต้องรัน SQL · โค้ดฝั่งเซิร์ฟเวอร์อยู่ที่ `functions/api/[[path]].js`
(ไฟล์ zip สำหรับอัปโหลดเองไม่มีส่วนนี้ ต้องส่งขึ้นผ่าน GitHub Actions)

แนะนำเพิ่ม (ไม่บังคับ): Security › WAF › Rate limiting rules › จำกัด `/api/` เช่น 60 ครั้งต่อนาทีต่อ IP กันคนยิงสร้างบัญชีรัว ๆ

## กฎที่ห้ามพัง

- เซฟผู้เล่น: `little-rescue-sideview-save-v2` (ห้ามเพิ่มฟิลด์ เวอร์ชันเก่าจะตัดทิ้ง) และ `little-rescue-meta-v1` (ด่าน/เลเวล)
- บัญชีคลาวด์อยู่ใน `little-rescue-cloud-v1` (ไม่ใช่เซฟ) · เซฟในเครื่องคือตัวจริงที่เกมเล่น คลาวด์เป็นสำเนา
- ห้ามย้ายเกมไปลิงก์อื่น (เช่น GitHub Pages) เพราะเบราว์เซอร์เก็บเซฟแยกตามลิงก์
- ทุกรุ่นใหม่: เปลี่ยน `BUILD_ID` ใน `sw.js`, `PAGE_BUILD_ID` ใน `pwa.js`, `TARGET` ในทุก `recover-v*/`,
  เพิ่ม `recover-vXYZ/` ของรุ่นนั้น และเพิ่มไฟล์ใหม่ลงรายการ PRECACHE (`tools/check.mjs` เตือนให้ทุกข้อ)
