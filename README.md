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
4. ส่งขึ้นใหม่ให้ค่าใหม่มีผล: GitHub › Actions › **Check and deploy** › Run workflow › `main` (โปรเจกต์แบบ Direct Upload ไม่มีปุ่ม Retry ใน Cloudflare) หรือ merge PR ถัดไป
5. เปิด `https://little-rescue.pages.dev/api/health` ต้องเห็น `{"ok":true,"cloud":true}`

ตารางในฐานข้อมูลสร้างให้เองตอนใช้ครั้งแรก ไม่ต้องรัน SQL · โค้ดฝั่งเซิร์ฟเวอร์อยู่ที่ `functions/api/[[path]].js`
(ไฟล์ zip สำหรับอัปโหลดเองไม่มีส่วนนี้ ต้องส่งขึ้นผ่าน GitHub Actions)

แนะนำเพิ่ม (ไม่บังคับ): Security › WAF › Rate limiting rules › จำกัด `/api/` เช่น 60 ครั้งต่อนาทีต่อ IP กันคนยิงสร้างบัญชีรัว ๆ

## ร้านค้าเพชร (เงินจริง · ตั้งแต่รุ่น 1.14.0 · เริ่มที่โหมดทดสอบ)

แท็บ 🏪 ร้านค้าจะเปิดเมื่อมีครบ: ฐานข้อมูล `SAVES_DB` (หัวข้อด้านบน) + กุญแจ Stripe สองตัว ถ้ายังไม่ครบ แท็บยังเป็น "เร็วๆ นี้"
ผู้ให้บริการ: **Stripe ประเทศไทย** (บัตร + พร้อมเพย์ QR, หน้าชำระเงินของ Stripe เอง เกมไม่แตะข้อมูลบัตร)

1. สมัคร https://dashboard.stripe.com/register เลือกประเทศ **Thailand** (สมัครแบบบุคคลธรรมดาได้ ใช้บัตรประชาชนและบัญชีธนาคารไทย)
   ช่วงทดสอบไม่ต้องยืนยันตัวตนให้เสร็จ ใช้ **Test mode** (สวิตช์มุมขวาบน) ได้เลย
2. Settings › Payment methods (ในโหมดทดสอบ) › เปิด **Cards** และ **PromptPay**
3. Developers › API keys › คัดลอก **Secret key** ที่ขึ้นต้น `sk_test_` (อย่าส่งให้ใครหรือวางในแชต)
4. Developers › Webhooks › Add endpoint
   - URL: `https://little-rescue.pages.dev/api/shop/webhook` (ลิงก์ทดลองของ PR ใช้ `https://pr-N.little-rescue.pages.dev/api/shop/webhook` แยกอีกอัน)
   - Events: `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`,
     `checkout.session.expired`, `charge.refunded`, `charge.dispute.created`
   - กด Reveal **Signing secret** คัดลอกค่าที่ขึ้นต้น `whsec_`
5. Cloudflare › Workers & Pages › `little-rescue` › Settings › **Variables and Secrets** › Add (ชนิด **Secret**) ทั้ง Production และ Preview
   - `STRIPE_SECRET_KEY` = `sk_test_...` · `STRIPE_WEBHOOK_SECRET` = `whsec_...`
   - (ไม่บังคับ) `SHOP_MONTHLY_LIMIT_THB` = วงเงินต่อผู้เล่นต่อเดือน (ค่าเริ่ม 3000) · `SHOP_METHODS` = `card,promptpay`
6. Deployments › Retry deployment รอบล่าสุด แล้วเปิด `/api/shop/config` ต้องเห็น `"open":true,"mode":"test"`
7. ทดลองซื้อ: สร้างบัญชี ☁️ › แท็บร้านค้า › เลือกแพ็ก › บัตร `4242 4242 4242 4242` วันหมดอายุอนาคต CVC อะไรก็ได้ › กลับมาเกม เพชรเข้าเอง
   ทดลองคืนเงิน: Stripe › Payments › เลือกรายการ › Refund (คืนบางส่วนได้) เพชรถูกหักตามสัดส่วน ดูในประวัติการซื้อ

ความปลอดภัย: ถ้าใส่กุญแจจริง (`sk_live_`) ร้านจะ**ปิดเอง** และ webhook จากโหมดจริงถูกเมิน จนกว่าจะเพิ่ม `SHOP_LIVE` = `1`
ก่อนเปิดขายจริง: ยืนยันตัวตนใน Stripe ให้ผ่าน, เขียนนโยบายคืนเงินและเงื่อนไขการใช้, ปรึกษานักบัญชีเรื่องภาษี (VAT/ภาษีเงินได้),
สร้าง webhook และ secret ชุดใหม่ของโหมดจริง แล้วค่อยตั้ง `SHOP_LIVE=1`

ทำงานอย่างไร: เกมเรียก `/api/shop/checkout` › เซิร์ฟเวอร์สร้างคำสั่งซื้อใน `shop_orders` และหน้า Stripe Checkout › ผู้เล่นจ่าย ›
Stripe เรียก webhook (ตรวจลายเซ็น HMAC + ยอดเงินตรงกับคำสั่งซื้อ) › เติมเพชรเข้ากระเป๋าเงินฝั่งเซิร์ฟเวอร์ (`functions/_lib/wallet.js`)
ทุกการเติม/หักมีรหัสกันซ้ำ (`pay:`, `refund:`, `dispute:`) Stripe ส่งซ้ำกี่ครั้งก็เติมครั้งเดียว · คืนเงินแล้วเพชรถูกใช้ไปแล้ว ส่วนที่ขาดจะหักจากการซื้อครั้งถัดไป
โค้ด: `functions/api/shop/[[path]].js` (เซิร์ฟเวอร์), `game/shop.js` (หน้าร้าน)
## กันโกง: กระเป๋าเงินบนเซิร์ฟเวอร์ (ตั้งแต่รุ่น 1.13.0)

ไม่ต้องตั้งค่าอะไรเพิ่ม ใช้ฐานข้อมูล `SAVES_DB` เดิม ตารางสร้างให้เองตอนใช้ครั้งแรก

- ผู้เล่นที่มีบัญชี ☁️: เซิร์ฟเวอร์เป็นคนถือเหรียญ เลเวล ดาว ชิ้นส่วน และด่านที่ผ่านตัวจริง ทุกการได้/ใช้เหรียญถูกส่งไปตรวจ
  (ชนะเร็วเกินจริงไม่ได้ ชนะได้ไม่เกินชั่วโมงละ 60 ครั้ง ราคา/รางวัลต้องตรงกับเกม) แล้วบันทึกลงสมุดบัญชี `ledger`
  แก้ตัวเลขในเบราว์เซอร์ก็จะถูกปรับกลับเป็นยอดบนเซิร์ฟเวอร์ · การสุ่มเพื่อนสุ่มบนเซิร์ฟเวอร์ (ต้องต่อเน็ต)
- ผู้เล่นไม่มีบัญชี: เล่นออฟไลน์เหมือนเดิมทุกอย่าง
- เล่นออฟไลน์ได้ตามปกติ การกระทำจะเข้าคิวแล้วส่งเมื่อออนไลน์
- รายละเอียด API และวิธีให้ระบบอื่น (ร้านค้า เพื่อน แอดมิน) เพิ่ม/หักเหรียญ: `docs/server-wallet.md`
- ตัวเลขฝั่งเซิร์ฟเวอร์อยู่ที่ `functions/_lib/economy.js` ต้องตรงกับ `game/engine.js` และ `game/daily-missions.js`
  (`tools/check.mjs` ตรวจให้ ถ้าไม่ตรง merge ไม่ได้)

## กฎที่ห้ามพัง

- เซฟผู้เล่น: `little-rescue-sideview-save-v2` (ห้ามเพิ่มฟิลด์ เวอร์ชันเก่าจะตัดทิ้ง) และ `little-rescue-meta-v1` (ด่าน/เลเวล)
- บัญชีคลาวด์อยู่ใน `little-rescue-cloud-v1` (ไม่ใช่เซฟ) · เซฟในเครื่องคือตัวจริงที่เกมเล่น คลาวด์เป็นสำเนา
- ห้ามย้ายเกมไปลิงก์อื่น (เช่น GitHub Pages) เพราะเบราว์เซอร์เก็บเซฟแยกตามลิงก์
- ทุกรุ่นใหม่: เปลี่ยน `BUILD_ID` ใน `sw.js`, `PAGE_BUILD_ID` ใน `pwa.js`, `TARGET` ในทุก `recover-v*/`,
  เพิ่ม `recover-vXYZ/` ของรุ่นนั้น และเพิ่มไฟล์ใหม่ลงรายการ PRECACHE (`tools/check.mjs` เตือนให้ทุกข้อ)
