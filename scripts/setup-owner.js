// scripts/setup-owner.js
// Tạo user_roles document cho Owner đầu tiên
// Usage: node scripts/setup-owner.js
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env
const envPath = join(__dirname, "..", ".env");
const envContent = readFileSync(envPath, "utf-8");
for (const line of envContent.split("\n")) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const idx = trimmed.indexOf("=");
  if (idx === -1) continue;
  const key = trimmed.slice(0, idx).trim();
  const value = trimmed.slice(idx + 1).trim();
  if (key && value && !process.env[key]) process.env[key] = value;
}

// ─── CONFIG ────────────────────────────────────────────────────────────────
const OWNER_EMAIL = "leduccuong2804@gmail.com";
const OWNER_UID = "SKNfSTjlfVfzXAjn0TOxonj8cne2";
const TEAM_ID = "team_default";
// ───────────────────────────────────────────────────────────────────────────

const { projectId, clientEmail, privateKey } = {
  projectId:
    process.env.FIREBASE_PROJECT_ID || process.env.VITE_FIREBASE_PROJECT_ID,
  clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
  privateKey: process.env.FIREBASE_PRIVATE_KEY,
};

if (!clientEmail || !privateKey) {
  console.error(
    "❌ Thiếu FIREBASE_CLIENT_EMAIL hoặc FIREBASE_PRIVATE_KEY trong .env",
  );
  console.error(
    "   → Vào Firebase Console → Project Settings → Service accounts → Generate new private key",
  );
  process.exit(1);
}

const { initializeApp, cert, getApps } = await import("firebase-admin/app");
const { getFirestore } = await import("firebase-admin/firestore");
const { getAuth } = await import("firebase-admin/auth");

if (!getApps().length) {
  initializeApp({
    credential: cert({
      projectId,
      clientEmail,
      privateKey: privateKey.replace(/\\n/g, "\n"),
    }),
  });
}

const db = getFirestore();
const auth = getAuth();

// 1. Xác nhận user tồn tại trong Firebase Auth
try {
  const userRecord = await auth.getUser(OWNER_UID);
  console.log(`✅ Firebase Auth user: ${userRecord.email}`);
} catch {
  console.error(
    `❌ Không tìm thấy user UID="${OWNER_UID}" trong Firebase Auth`,
  );
  process.exit(1);
}

// 2. Tạo user_roles document
const roleRef = db.collection("user_roles").doc(OWNER_UID);
await roleRef.set(
  {
    email: OWNER_EMAIL,
    role: "owner",
    teamId: TEAM_ID,
  },
  { merge: true },
);
console.log(`✅ user_roles/${OWNER_UID} → role=owner, teamId=${TEAM_ID}`);

// 3. Tạo settings/config ban đầu cho team
const configRef = db
  .collection("user")
  .doc(TEAM_ID)
  .collection("settings")
  .doc("config");
const configSnap = await configRef.get();
if (!configSnap.exists) {
  await configRef.set({
    googleSheetId: null,
    autoSyncToSheet: false,
    fulfillmentAccounts: [],
    kpiTeams: [],
  });
  console.log(`✅ /user/${TEAM_ID}/settings/config tạo mới`);
} else {
  console.log(`ℹ️  /user/${TEAM_ID}/settings/config đã tồn tại, bỏ qua`);
}

console.log("\n🎉 Setup hoàn tất! Đăng nhập tại localhost:3000 với:");
console.log(`   Email   : ${OWNER_EMAIL}`);
console.log(`   Role    : owner`);
console.log(`   Team ID : ${TEAM_ID}`);
