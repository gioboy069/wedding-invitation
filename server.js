import express from "express";
import compression from "compression";
import multer from "multer";
import cookieParser from "cookie-parser";
import { randomBytes, timingSafeEqual, scryptSync, createHash } from "crypto";
import { spawn } from "child_process";
import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync, mkdtempSync, rmSync, copyFileSync, renameSync } from "fs";
import { Readable } from "stream";
import { tmpdir } from "os";
import { join, dirname, extname, basename, resolve } from "path";
import { fileURLToPath } from "url";
import QRCode from "qrcode";
import { createDriveAlbum } from "./lib/drive-album.js";

async function prepareUpload(file) {
  const mod = await import("./lib/prepare-media.js");
  return mod.prepareUpload(file);
}

let exceljsModule;
async function createWorkbook() {
  if (!exceljsModule) exceljsModule = await import("exceljs");
  const ExcelJS = exceljsModule.default || exceljsModule;
  return new ExcelJS.Workbook();
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;
const DATA_DIR = join(ROOT, "data");
const UPLOAD_DIR = join(ROOT, "uploads");
const PORT = Number(process.env.PORT || 4317);
const HOST = process.env.HOST || "0.0.0.0";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "gomeZ120822@";
const RSVP_EMAIL = process.env.RSVP_EMAIL || "gomez.wed2027@gmail.com";
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || RSVP_EMAIL;

if (!existsSync(UPLOAD_DIR)) mkdirSync(UPLOAD_DIR, { recursive: true });
if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

const sessions = new Map();
const SESSIONS_FILE = "sessions.json";
const BACKUP_FILES = ["content.json", "gallery.json", "guests.json", "rsvps.json", "guest-album.json"];

function loadSessions() {
  try {
    const saved = readJson(SESSIONS_FILE, {});
    const now = Date.now();
    const maxAge = 1000 * 60 * 60 * 12;
    Object.entries(saved).forEach(([token, ts]) => {
      if (now - Number(ts) < maxAge) sessions.set(token, Number(ts));
    });
  } catch (err) {
    console.error("Failed to load sessions:", err);
  }
}

function persistSessions() {
  try {
    const out = {};
    sessions.forEach((ts, token) => {
      out[token] = ts;
    });
    writeJson(SESSIONS_FILE, out);
  } catch (err) {
    console.error("Failed to persist sessions:", err);
  }
}

function defaultAdminConfig() {
  return {
    email: ADMIN_EMAIL,
    passwordHash: "",
    salt: "",
    resetTokenHash: "",
    resetExpires: 0,
    lastResetSentAt: 0,
  };
}

function loadAdminConfig() {
  const saved = readJson("admin.json", defaultAdminConfig());
  return { ...defaultAdminConfig(), ...saved, email: saved.email || ADMIN_EMAIL };
}

function saveAdminConfig(cfg) {
  writeJson("admin.json", cfg);
}

function hashPassword(password, salt = randomBytes(16).toString("hex")) {
  const hash = scryptSync(String(password), salt, 64).toString("hex");
  return { hash, salt };
}

function hashToken(token) {
  return createHash("sha256").update(String(token)).digest("hex");
}

function verifyPassword(password) {
  const cfg = loadAdminConfig();
  if (cfg.passwordHash && cfg.salt) {
    const check = scryptSync(String(password), cfg.salt, 64);
    const stored = Buffer.from(cfg.passwordHash, "hex");
    if (!stored.length || check.length !== stored.length) return false;
    return timingSafeEqual(check, stored);
  }
  return safeEqual(password || "", ADMIN_PASSWORD);
}

function ensureAdminPassword() {
  const cfg = loadAdminConfig();
  if (!cfg.passwordHash || !cfg.salt) {
    const hashed = hashPassword(ADMIN_PASSWORD);
    cfg.passwordHash = hashed.hash;
    cfg.salt = hashed.salt;
    saveAdminConfig(cfg);
  }
}

function publicBaseUrl(req) {
  const host = String(req.get("x-forwarded-host") || req.get("host") || `127.0.0.1:${PORT}`)
    .split(",")[0]
    .trim();
  const forwarded = String(req.get("x-forwarded-proto") || "").split(",")[0].trim();
  const proto = forwarded || (req.secure ? "https" : "http");
  return `${proto}://${host}`;
}

async function sendAdminResetEmail(resetUrl) {
  const emailRes = await fetch(`https://formsubmit.co/ajax/${encodeURIComponent(ADMIN_EMAIL)}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      _subject: "Reset your wedding admin password",
      _template: "box",
      _captcha: "false",
      name: "Wedding admin",
      message:
        "Hello Gio and Augiela,\n\n" +
        "Someone asked to reset the password for your wedding invitation admin.\n\n" +
        "Open this link to choose a new password. It expires in one hour:\n" +
        resetUrl +
        "\n\nIf you did not ask for this, you can ignore this email.",
    }),
  });
  if (!emailRes.ok) {
    const body = await emailRes.text();
    console.error("Admin reset email failed:", emailRes.status, emailErrorDetail(body));
    return false;
  }
  return true;
}

function emailErrorDetail(body) {
  const text = String(body || "").replace(/\s+/g, " ").trim();
  if (/just a moment|cf-chl|challenge-platform|cloudflare/i.test(text)) {
    return "FormSubmit asked for a browser check, so the server could not send that email.";
  }
  return text.slice(0, 180) || "Email could not be sent";
}

loadSessions();
ensureAdminPassword();

function readJson(name, fallback) {
  const path = join(DATA_DIR, name);
  if (!existsSync(path)) {
    writeFileSync(path, JSON.stringify(fallback, null, 2));
    return structuredClone(fallback);
  }
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(name, data) {
  const path = join(DATA_DIR, name);
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2));
  renameSync(tmp, path);
  if (BACKUP_FILES.includes(name)) scheduleRecordBackup();
}

const LIVE_STAMP = "live-stamp.json";
let backupQueued = false;
let backupRunning = null;

function readLiveStamp() {
  try {
    const saved = JSON.parse(readFileSync(join(DATA_DIR, LIVE_STAMP), "utf8"));
    return String(saved.savedAt || "");
  } catch {
    return "";
  }
}

function writeLiveStamp(savedAt) {
  writeFileSync(join(DATA_DIR, LIVE_STAMP), JSON.stringify({ savedAt: savedAt || new Date().toISOString() }, null, 2));
}

function scheduleRecordBackup() {
  if (!driveAlbum || !driveAlbum.connected()) return backupRunning || Promise.resolve();
  backupQueued = true;
  if (backupRunning) return backupRunning;
  backupRunning = flushRecordBackup().finally(() => {
    backupRunning = null;
    if (backupQueued) scheduleRecordBackup();
  });
  return backupRunning;
}

async function flushRecordBackup() {
  backupQueued = false;
  if (!driveAlbum.connected()) return;
  try {
    const bundle = readBackupBundle();
    await driveAlbum.saveJsonRecord("rsvps.json", bundle.rsvps);
    await driveAlbum.saveJsonRecord("wedding-backup.json", bundle);
    writeLiveStamp(bundle.savedAt);
  } catch (err) {
    console.error("Could not back up the wedding records", err.detail || err.message);
  }
}

function rememberRecords() {
  const pending = scheduleRecordBackup();
  return Promise.race([
    pending || Promise.resolve(),
    new Promise((resolve) => setTimeout(resolve, 3000)),
  ]);
}

function readBackupBundle() {
  return {
    kind: "augiela-gio-wedding-backup",
    version: 1,
    savedAt: new Date().toISOString(),
    content: readJson("content.json", {}),
    gallery: readJson("gallery.json", []),
    guests: readJson("guests.json", []),
    rsvps: readJson("rsvps.json", []),
    guestAlbum: readJson("guest-album.json", { posts: [] }),
  };
}

function assertBackupBundle(bundle) {
  if (!bundle || bundle.kind !== "augiela-gio-wedding-backup" || Number(bundle.version) !== 1) {
    const error = new Error("That file is not a wedding backup.");
    error.status = 400;
    throw error;
  }
  if (!bundle.content || typeof bundle.content !== "object" || Array.isArray(bundle.content)) {
    const error = new Error("The backup is missing the invitation details.");
    error.status = 400;
    throw error;
  }
  if (!Array.isArray(bundle.gallery) || !Array.isArray(bundle.guests) || !Array.isArray(bundle.rsvps)) {
    const error = new Error("The backup is missing the gallery, guest list, or RSVPs.");
    error.status = 400;
    throw error;
  }
  const posts = bundle.guestAlbum && Array.isArray(bundle.guestAlbum.posts) ? bundle.guestAlbum.posts : null;
  if (!posts) {
    const error = new Error("The backup is missing the guest album list.");
    error.status = 400;
    throw error;
  }
  return {
    content: bundle.content,
    gallery: bundle.gallery,
    guests: bundle.guests,
    rsvps: bundle.rsvps,
    guestAlbum: { posts },
    savedAt: String(bundle.savedAt || ""),
  };
}

function applyBackupBundle(bundle) {
  const next = assertBackupBundle(bundle);
  writeFileSync(join(DATA_DIR, "content.json"), JSON.stringify(next.content, null, 2));
  writeFileSync(join(DATA_DIR, "gallery.json"), JSON.stringify(next.gallery, null, 2));
  writeFileSync(join(DATA_DIR, "guests.json"), JSON.stringify(next.guests, null, 2));
  writeFileSync(join(DATA_DIR, "rsvps.json"), JSON.stringify(next.rsvps, null, 2));
  writeFileSync(join(DATA_DIR, "guest-album.json"), JSON.stringify(next.guestAlbum, null, 2));
  writeLiveStamp(new Date().toISOString());
  scheduleRecordBackup();
  return {
    ok: true,
    savedAt: next.savedAt,
    guests: next.guests.length,
    rsvps: next.rsvps.length,
    gallery: next.gallery.length,
    moments: next.guestAlbum.posts.length,
  };
}

function createToken() {
  return randomBytes(32).toString("hex");
}

function safeEqual(a, b) {
  const bufA = Buffer.from(String(a).trim());
  const bufB = Buffer.from(String(b).trim());
  if (!bufA.length || bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

function getSessionToken(req) {
  const cookie = String(req.cookies?.admin_session || "").trim();
  if (cookie) return cookie;
  const header = String(req.get("authorization") || "");
  if (/^bearer\s+/i.test(header)) return header.replace(/^bearer\s+/i, "").trim();
  return String(req.get("x-admin-token") || "").trim();
}

function requireAdmin(req, res, next) {
  const token = getSessionToken(req);
  if (!token || !sessions.has(token)) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  sessions.set(token, Date.now());
  persistSessions();
  next();
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = extname(file.originalname).toLowerCase() || ".jpg";
    const safe = [".jpg", ".jpeg", ".png", ".webp", ".gif"].includes(ext) ? ext : ".jpg";
    cb(null, `photo-${Date.now()}-${randomBytes(4).toString("hex")}${safe}`);
  },
});

const IMAGE_MIME = /^image\/(jpeg|png|webp|gif)$/;
const VIDEO_MIME = /^video\/(mp4|webm|quicktime)$/;

const upload = multer({
  storage,
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (IMAGE_MIME.test(file.mimetype)) cb(null, true);
    else cb(new Error("Only image uploads are allowed"));
  },
});

const galleryUpload = multer({
  storage,
  limits: { fileSize: 40 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (IMAGE_MIME.test(file.mimetype) || VIDEO_MIME.test(file.mimetype)) cb(null, true);
    else cb(new Error("Only photo (JPEG/PNG/WebP/GIF) or short video (MP4/WebM/MOV) uploads are allowed"));
  },
});

function isVideoSrc(src, mime) {
  if (mime && VIDEO_MIME.test(mime)) return true;
  const value = String(src || "").toLowerCase();
  return /\.(mp4|webm|mov)(\?|#|$)/i.test(value) || value.includes("/video/");
}

function galleryItemType(item, mime) {
  const explicit = String(item?.type || "").toLowerCase();
  if (explicit === "video" || explicit === "photo" || explicit === "image") {
    return explicit === "image" ? "photo" : explicit;
  }
  return isVideoSrc(item?.src || item?.url, mime) ? "video" : "photo";
}

function isAllowedGallerySrc(src) {
  const value = String(src || "").trim();
  if (!value) return false;
  if (/^https?:\/\//i.test(value)) return true;
  if (value.startsWith("/api/media/drive/")) return true;
  if (value.startsWith("/uploads/")) return true;
  if (value.startsWith("img/") || value.startsWith("/img/")) return true;
  return false;
}

const backupUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const name = String(file.originalname || "").toLowerCase();
    const type = String(file.mimetype || "").toLowerCase();
    if (name.endsWith(".json") || type.includes("json") || type === "text/plain" || type === "application/octet-stream") cb(null, true);
    else cb(new Error("Please upload the backup .json file."));
  },
});

const spreadsheetUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 6 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const name = String(file.originalname || "").toLowerCase();
    const type = String(file.mimetype || "").toLowerCase();
    if (
      name.endsWith(".xlsx") ||
      name.endsWith(".xlsm") ||
      type.includes("spreadsheet") ||
      type.includes("excel")
    ) {
      cb(null, true);
    } else {
      cb(new Error("Please upload an Excel file (.xlsx)"));
    }
  },
});

const app = express();
app.set("trust proxy", 1);
app.use(compression({
  threshold: 2048,
  filter(req, res) {
    const type = String(res.getHeader("Content-Type") || "");
    if (/image|video|audio|zip|octet-stream|spreadsheet|font|wasm/i.test(type)) return false;
    return compression.filter(req, res);
  },
}));
app.use(express.json({ limit: "2mb" }));
app.use(cookieParser());

function requestIsHttps(req) {
  const forwarded = String(req.get("x-forwarded-proto") || "").split(",")[0].trim();
  return req.secure || forwarded === "https";
}

app.use((req, res, next) => {
  const https = requestIsHttps(req);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()"
  );
  const policy = [
    "default-src 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "frame-src 'none'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    "img-src 'self' data: blob: https:",
    "media-src 'self' blob: https:",
    "connect-src 'self' https://fonts.googleapis.com https://fonts.gstatic.com https://formsubmit.co",
    "worker-src 'self' blob:",
  ];
  if (https) policy.push("upgrade-insecure-requests");
  res.setHeader("Content-Security-Policy", policy.join("; "));
  if (https) {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  next();
});

function sessionCookieOptions(req) {
  const forwarded = String(req.get("x-forwarded-proto") || "").split(",")[0].trim();
  const isHttps = req.secure || forwarded === "https";
  return {
    httpOnly: true,
    path: "/",
    maxAge: 1000 * 60 * 60 * 12,
    secure: isHttps,
    sameSite: isHttps ? "none" : "lax",
    partitioned: isHttps,
  };
}

// Block private paths from static serving
app.use(["/data", "/lib", "/server.js", "/package.json", "/package-lock.json", "/.git", "/.env"], (_req, res) => {
  res.status(404).end();
});


function sharePageUrl(req) {
  const base = publicBaseUrl(req);
  let host = "";
  try { host = new URL(base).hostname; } catch { host = ""; }
  if (!host || host === "localhost" || host === "127.0.0.1" || host.endsWith(".local")) {
    return "https://wedding-invitation-gomez-2027.onrender.com/share";
  }
  return `${base.replace(/\/$/, "")}/share`;
}

app.get("/share/qr.svg", async (req, res) => {
  try {
    const svg = await QRCode.toString(sharePageUrl(req), {
      type: "svg",
      margin: 1,
      errorCorrectionLevel: "M",
      color: { dark: "#0D2B45", light: "#F7F5F1" },
    });
    res.setHeader("Content-Type", "image/svg+xml; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Share-Url", sharePageUrl(req));
    res.send(svg);
  } catch (err) {
    console.error(err);
    res.status(500).type("text").send("Could not draw the code");
  }
});

// Force download of project ZIP (avoids preview proxy hang on static zip)
app.get(["/download", "/download.zip"], (_req, res) => {
  const zipPath = join(ROOT, "augiela-gio-wedding-invitation.zip");
  if (!existsSync(zipPath)) return res.status(404).send("ZIP not found");
  res.download(zipPath, "augiela-gio-wedding-invitation.zip");
});

app.use("/uploads", express.static(UPLOAD_DIR, {
  maxAge: "7d",
  etag: true,
}));

// Admin dashboard — explicit routes so /admin and /admin/ always work on Render
const adminIndex = join(ROOT, "admin", "index.html");
app.get(["/admin", "/admin/"], (_req, res) => {
  if (!existsSync(adminIndex)) {
    return res.status(404).type("text").send(
      "Admin page not found. Make sure the admin/index.html folder was uploaded to your GitHub repo, then redeploy on Render."
    );
  }
  res.setHeader("Cache-Control", "no-cache");
  res.sendFile(adminIndex);
});
app.use("/admin", express.static(join(ROOT, "admin"), {
  maxAge: "1h",
  etag: true,
}));

app.use(express.static(ROOT, {
  index: "index.html",
  extensions: ["html"],
  etag: true,
  setHeaders(res, filePath) {
    if (/\.(?:webp|jpg|jpeg|png|svg|woff2)$/i.test(filePath)) {
      res.setHeader("Cache-Control", "public, max-age=604800, immutable");
    } else if (/\.(?:css|js)$/i.test(filePath)) {
      res.setHeader("Cache-Control", "public, max-age=86400");
    } else if (/\.html$/i.test(filePath)) {
      res.setHeader("Cache-Control", "public, max-age=60");
    }
  },
}));

// ── Public API ──

app.get("/api/content", (_req, res) => {
  res.json(rewriteDriveUrlsInContent(readJson("content.json", {})));
});

app.get("/api/gallery", (_req, res) => {
  const gallery = readJson("gallery.json", []);
  res.json(
    gallery.map((item) => {
      const src = normalizeImageUrl(item.src || item.url || "");
      return {
        ...item,
        src,
        type: galleryItemType({ ...item, src }),
      };
    })
  );
});

app.post("/api/rsvp", async (req, res) => {
  const { name, firstName, surname, attendance, message, companions, guestId } = req.body || {};
  const person = parsePersonName(name, firstName, surname);
  if (!person.surname || !person.firstName) {
    return res.status(400).json({ error: "Surname and first name are required" });
  }
  if (!["attending", "declined"].includes(attendance)) {
    return res.status(400).json({ error: "Attendance must be attending or declined" });
  }

  const guests = readJson("guests.json", []).map(hydratePerson);
  let matchedGuest = null;
  if (guestId) {
    const byId = guests.find((g) => g.id === guestId) || null;
    if (byId && namesMatch(byId, person)) matchedGuest = byId;
  }
  if (!matchedGuest) {
    matchedGuest = guests.find((g) => namesMatch(g, person)) || null;
  }
  if (!matchedGuest) {
    return res.status(403).json({
      notOnGuestList: true,
      error: "This name is not on the guest list. Please use the surname and first name on your invitation, or contact Gio and Augiela.",
    });
  }

  const allocation = matchedGuest
    ? Math.min(10, Math.max(1, Number(matchedGuest.allocation) || 1))
    : 1;
  const maxCompanions = Math.max(0, allocation - 1);
  const companionList = (Array.isArray(companions) ? companions : [])
    .map(parseCompanion)
    .filter((c) => c.firstName && c.surname)
    .slice(0, maxCompanions);

  let rsvps = [];
  try {
    rsvps = readJson("rsvps.json", []);
  } catch (err) {
    console.error("Failed to read RSVPs:", err);
  }

  if (findExistingRsvp(rsvps, person, matchedGuest?.id)) {
    return res.status(409).json(alreadySubmittedPayload());
  }

  const placement = guestPlacement(matchedGuest);
  const entry = {
    id: `rsvp-${Date.now()}-${randomBytes(3).toString("hex")}`,
    name: person.name,
    firstName: person.firstName,
    surname: person.surname,
    attendance,
    message: String(message || "").trim(),
    companions: companionList,
    partySize: 1 + companionList.length,
    allocation,
    category: placement.category,
    tableNumber: placement.tableNumber,
    guestId: matchedGuest ? matchedGuest.id : null,
    guestMatched: !!matchedGuest,
    submittedAt: new Date().toISOString(),
  };

  try {
    rsvps.push(entry);
    writeJson("rsvps.json", rsvps);
  } catch (err) {
    console.error("Failed to save RSVP locally:", err);
    return res.status(500).json({ error: "The RSVP could not be saved. Please try again." });
  }

  await rememberRecords();
  res.status(201).json({ ok: true, id: entry.id });
  notifyRsvp(entry, companionList);
});

function notifyRsvp(entry, companionList) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  fetch(`https://formsubmit.co/ajax/${encodeURIComponent(RSVP_EMAIL)}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    signal: controller.signal,
    body: JSON.stringify({
      name: entry.name,
      firstName: entry.firstName,
      surname: entry.surname,
      attendance: entry.attendance === "attending" ? "Joyfully Accepts" : "Regretfully Declines",
      partySize: entry.partySize,
      companions: companionList.length ? companionList.map((c) => c.name).join(", ") : "(none)",
      message: entry.message || "(no message)",
      guestMatched: entry.guestMatched ? "Yes" : "No",
      category: entry.category || "(none)",
      table: formatTableLabel(entry.tableNumber) || "(not assigned)",
      submittedAt: entry.submittedAt,
      _subject: `Wedding RSVP: ${entry.name} — ${entry.attendance}`,
      _template: "table",
      _captcha: "false",
    }),
  }).then(async (emailRes) => {
    if (!emailRes.ok) {
      const body = await emailRes.text();
      console.error("RSVP email failed:", emailRes.status, emailErrorDetail(body));
    }
  }).catch((err) => {
    console.error("RSVP email error:", err.message || err);
  }).finally(() => clearTimeout(timer));
}

function normalizeGuestName(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function trimNamePart(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function formatPersonName(firstName, surname) {
  const first = trimNamePart(firstName);
  const last = trimNamePart(surname);
  if (last && first) return `${last}, ${first}`;
  return last || first;
}

function parsePersonName(value, fallbackFirst, fallbackSurname) {
  let firstName = trimNamePart(fallbackFirst);
  let surname = trimNamePart(fallbackSurname);
  const raw = trimNamePart(value);
  if (!firstName && !surname && raw) {
    if (raw.includes(",")) {
      const comma = raw.indexOf(",");
      surname = trimNamePart(raw.slice(0, comma));
      firstName = trimNamePart(raw.slice(comma + 1));
    } else {
      const parts = raw.split(" ").filter(Boolean);
      if (parts.length === 1) firstName = parts[0];
      else {
        surname = parts[parts.length - 1];
        firstName = parts.slice(0, -1).join(" ");
      }
    }
  }
  return {
    firstName,
    surname,
    name: formatPersonName(firstName, surname) || raw,
  };
}

function hydratePerson(record) {
  const rec = record && typeof record === "object" ? record : {};
  return { ...rec, ...parsePersonName(rec.name, rec.firstName, rec.surname) };
}

function nameKey(personOrString) {
  const parsed = typeof personOrString === "string"
    ? parsePersonName(personOrString)
    : parsePersonName(personOrString?.name, personOrString?.firstName, personOrString?.surname);
  const tokens = normalizeGuestName(`${parsed.firstName} ${parsed.surname}`)
    .split(" ")
    .filter(Boolean);
  return [...new Set(tokens)].sort().join(" ");
}

function namesMatch(a, b) {
  const ka = nameKey(a);
  const kb = nameKey(b);
  return Boolean(ka && kb && ka === kb);
}

function guestSearchScore(query, guest) {
  const q = normalizeGuestName(query);
  if (q.length < 2) return 0;
  const person = hydratePerson(guest);
  const surname = normalizeGuestName(person.surname);
  const first = normalizeGuestName(person.firstName);
  const full = [surname, first].filter(Boolean).join(" ");
  if (!surname && !first) return 0;

  const parts = q.split(" ").filter(Boolean);
  let score = 0;

  function startsWithPart(value, part) {
    return value === part || value.startsWith(part);
  }

  if (surname === q || first === q || full === q) score = Math.max(score, 100);
  if (startsWithPart(surname, q)) score = Math.max(score, 92);
  if (startsWithPart(first, q)) score = Math.max(score, 84);
  if (full.startsWith(q)) score = Math.max(score, 88);

  if (parts.length > 1) {
    const matched = parts.every((part) => startsWithPart(surname, part) || startsWithPart(first, part));
    if (matched) score = Math.max(score, 96);
  }

  const tokens = full.split(" ").filter(Boolean);
  if (tokens.some((token) => startsWithPart(token, q) || parts.some((part) => startsWithPart(token, part)))) {
    score = Math.max(score, 70);
  }

  if (q.length >= 3 && (surname.includes(q) || first.includes(q) || full.includes(q))) {
    score = Math.max(score, 45);
  }

  return score;
}

function parseCompanion(value) {
  if (value && typeof value === "object") {
    return parsePersonName(value.name, value.firstName, value.surname);
  }
  return parsePersonName(String(value || ""));
}

function trimGuestField(value, max) {
  let text = String(value || "").replace(/\s+/g, " ").trim();
  if (max) text = text.slice(0, max);
  return text;
}

function formatTableLabel(value) {
  const raw = trimGuestField(value, 40);
  if (!raw) return "";
  if (/^table\b/i.test(raw)) return raw;
  return `Table ${raw}`;
}

function guestPlacement(guest) {
  const rec = guest && typeof guest === "object" ? guest : {};
  return {
    category: trimGuestField(rec.category, 80),
    tableNumber: trimGuestField(rec.tableNumber, 40),
  };
}

function publicGuestPayload(guest) {
  const person = hydratePerson(guest);
  const placement = guestPlacement(person);
  const allocation = Math.min(10, Math.max(1, Number(person.allocation) || 1));
  return {
    id: person.id,
    name: person.name,
    firstName: person.firstName,
    surname: person.surname,
    allocation,
    maxCompanions: Math.max(0, allocation - 1),
    category: placement.category,
    tableNumber: placement.tableNumber,
    tableLabel: formatTableLabel(placement.tableNumber),
  };
}

function publicGuestFacingPayload(guest) {
  const payload = publicGuestPayload(guest);
  delete payload.tableNumber;
  delete payload.tableLabel;
  return payload;
}

function sortGuestsBySurname(guests) {
  return guests.sort((a, b) => {
    const pa = hydratePerson(a);
    const pb = hydratePerson(b);
    return pa.surname.localeCompare(pb.surname, undefined, { sensitivity: "base" })
      || pa.firstName.localeCompare(pb.firstName, undefined, { sensitivity: "base" });
  });
}

function findExistingRsvp(rsvps, person, guestId) {
  return (rsvps || []).find((r) => {
    if (guestId && r.guestId && r.guestId === guestId) return true;
    return namesMatch(hydratePerson(r), person);
  }) || null;
}

function alreadySubmittedPayload() {
  return {
    ok: false,
    alreadySubmitted: true,
    error: "We've already received your RSVP. If you need to change names or update your response, please contact Gio and Augiela directly.",
  };
}

// Public guest name search for RSVP typeahead (does not dump the full list)
app.get("/api/guests/search", (req, res) => {
  const query = trimNamePart(req.query.q || req.query.name || "");
  if (normalizeGuestName(query).length < 2) {
    return res.json({ matches: [] });
  }
  const guests = readJson("guests.json", []).map(hydratePerson);
  const matches = guests
    .map((guest) => ({ guest, score: guestSearchScore(query, guest) }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score
      || a.guest.surname.localeCompare(b.guest.surname, undefined, { sensitivity: "base" })
      || a.guest.firstName.localeCompare(b.guest.firstName, undefined, { sensitivity: "base" }))
    .slice(0, 8)
    .map(({ guest }) => publicGuestFacingPayload(guest));
  res.json({ matches });
});

// Public guest lookup for RSVP form (does not expose full list)
app.get("/api/guests/lookup", (req, res) => {
  const person = parsePersonName(
    req.query.name,
    req.query.firstName,
    req.query.surname
  );
  if (!person.surname || !person.firstName) {
    return res.json({ matched: false, alreadySubmitted: false });
  }
  const guests = readJson("guests.json", []).map(hydratePerson);
  const rsvps = readJson("rsvps.json", []);
  const guest = guests.find((g) => namesMatch(g, person)) || null;
  const existing = findExistingRsvp(rsvps, person, guest?.id);
  if (existing) {
    const payload = guest ? publicGuestFacingPayload(guest) : null;
    if (payload && !payload.category && existing.category) {
      payload.category = trimGuestField(existing.category, 80);
    }
    return res.json({
      matched: !!guest,
      alreadySubmitted: true,
      attendance: existing.attendance || "",
      guest: payload || {
        name: existing.name,
        firstName: existing.firstName,
        surname: existing.surname,
        category: trimGuestField(existing.category, 80),
      },
    });
  }
  if (!guest) return res.json({ matched: false, alreadySubmitted: false });
  res.json({
    matched: true,
    alreadySubmitted: false,
    guest: publicGuestFacingPayload(guest),
  });
});

// ── Admin guest list ──

app.get("/api/admin/guests", requireAdmin, (_req, res) => {
  res.json(readJson("guests.json", []).map(hydratePerson));
});

function excelCellText(value) {
  if (value == null || value === "") return "";
  if (typeof value === "object") {
    if (value.hyperlink && value.text) return String(value.text).trim();
    if (value.text) return String(value.text).trim();
    if (Array.isArray(value.richText)) return value.richText.map((part) => part.text || "").join("").trim();
    if (value.result != null) return String(value.result).trim();
  }
  return String(value).replace(/\s+/g, " ").trim();
}

function excelHeaderKey(value) {
  return excelCellText(value).toLowerCase().replace(/[^a-z0-9]+/g, "");
}

app.get("/api/admin/guests.xlsx", requireAdmin, async (_req, res) => {
  const guests = sortGuestsBySurname(readJson("guests.json", []).map(hydratePerson));
  const rsvps = readJson("rsvps.json", []);
  const workbook = await createWorkbook();
  workbook.creator = "Augiela & Gio wedding";
  const sheet = workbook.addWorksheet("Guest list");
  sheet.columns = [
    { header: "Guest ID", key: "id", width: 32 },
    { header: "Surname", key: "surname", width: 18 },
    { header: "First name", key: "firstName", width: 18 },
    { header: "Category", key: "category", width: 22 },
    { header: "Table", key: "tableNumber", width: 12 },
    { header: "Allocation", key: "allocation", width: 12 },
    { header: "RSVP", key: "rsvp", width: 22 },
  ];
  sheet.getRow(1).font = { bold: true };
  guests.forEach((guest) => {
    const existing = findExistingRsvp(rsvps, guest, guest.id);
    let rsvp = "Waiting";
    if (existing) rsvp = existing.attendance === "attending" ? "Replied · attending" : "Replied · declined";
    sheet.addRow({
      id: guest.id || "",
      surname: guest.surname || "",
      firstName: guest.firstName || "",
      category: guest.category || "",
      tableNumber: guest.tableNumber || "",
      allocation: Math.min(10, Math.max(1, Number(guest.allocation) || 1)),
      rsvp,
    });
  });
  const help = workbook.addWorksheet("How to update");
  help.getColumn(1).width = 92;
  [
    "Download this file, edit the Guest list sheet, then upload it in Admin → Guest List.",
    "Leave Guest ID unchanged for people already on the list. That keeps their RSVP linked.",
    "To add someone new, leave Guest ID blank and fill Surname and First name.",
    "Category examples: The Groom, The Bride, Groom’s mother, Family, Friend.",
    "Table is the table number they will see on the RSVP form.",
    "Allocation is how many seats that invitation includes (1–10).",
    "The RSVP column is for your reference only — uploading will not change replies.",
    "Guests left out of the file stay on the website unless you tick Remove guests who are not in this file.",
  ].forEach((line, i) => {
    help.getCell(i + 1, 1).value = line;
  });

  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", 'attachment; filename="wedding-guest-list.xlsx"');
  await workbook.xlsx.write(res);
  res.end();
});

app.post("/api/admin/guests/import", requireAdmin, (req, res) => {
  spreadsheetUpload.single("file")(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message || "Please upload an Excel file." });
    if (!req.file?.buffer) return res.status(400).json({ error: "Please choose an Excel file to upload." });
    try {
      const workbook = await createWorkbook();
      await workbook.xlsx.load(req.file.buffer);
      const sheet = workbook.getWorksheet("Guest list") || workbook.worksheets[0];
      if (!sheet) return res.status(400).json({ error: "That Excel file has no worksheet to import." });

      const headerRow = sheet.getRow(1);
      const colIndex = {};
      headerRow.eachCell((cell, col) => {
        const key = excelHeaderKey(cell.value);
        if (key === "guestid" || key === "id") colIndex.id = col;
        if (key === "surname" || key === "lastname" || key === "last") colIndex.surname = col;
        if (key === "firstname" || key === "first" || key === "givenname") colIndex.firstName = col;
        if (key === "category" || key === "role") colIndex.category = col;
        if (key === "table" || key === "tablenumber" || key === "tableno") colIndex.tableNumber = col;
        if (key === "allocation" || key === "partysize" || key === "seats") colIndex.allocation = col;
      });
      if (!colIndex.surname || !colIndex.firstName) {
        return res.status(400).json({ error: "The spreadsheet needs Surname and First name columns." });
      }

      const guests = readJson("guests.json", []).map(hydratePerson);
      const seenNames = new Set();
      const seenIds = new Set();
      const keptIds = new Set();
      let added = 0;
      let updated = 0;
      const skipped = [];
      const removeMissing = String(req.body?.removeMissing || "") === "yes";

      sheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return;
        const person = parsePersonName(
          "",
          excelCellText(row.getCell(colIndex.firstName).value),
          excelCellText(row.getCell(colIndex.surname).value)
        );
        if (!person.surname && !person.firstName) return;
        if (!person.surname || !person.firstName) {
          skipped.push("Row " + rowNumber + " needs both surname and first name.");
          return;
        }
        const nameKeyValue = nameKey(person);
        if (seenNames.has(nameKeyValue)) {
          skipped.push(person.name + " appears more than once in the file.");
          return;
        }
        seenNames.add(nameKeyValue);

        const incomingId = colIndex.id ? excelCellText(row.getCell(colIndex.id).value) : "";
        if (incomingId) {
          if (seenIds.has(incomingId)) {
            skipped.push("Guest ID " + incomingId + " appears more than once in the file.");
            return;
          }
          seenIds.add(incomingId);
        }

        let allocation = colIndex.allocation
          ? Number(excelCellText(row.getCell(colIndex.allocation).value))
          : NaN;
        const placement = guestPlacement({
          category: colIndex.category ? excelCellText(row.getCell(colIndex.category).value) : "",
          tableNumber: colIndex.tableNumber ? excelCellText(row.getCell(colIndex.tableNumber).value) : "",
        });

        let idx = incomingId ? guests.findIndex((g) => g.id === incomingId) : -1;
        if (idx === -1) idx = guests.findIndex((g) => namesMatch(g, person));

        if (idx !== -1) {
          if (!Number.isFinite(allocation)) allocation = guests[idx].allocation || 1;
          allocation = Math.min(10, Math.max(1, Math.round(allocation)));
          const duplicate = guests.some((g, i) => i !== idx && namesMatch(g, person));
          if (duplicate) {
            skipped.push(person.name + " would duplicate another guest.");
            return;
          }
          guests[idx] = {
            ...guests[idx],
            name: person.name,
            firstName: person.firstName,
            surname: person.surname,
            allocation,
            category: placement.category,
            tableNumber: placement.tableNumber,
          };
          keptIds.add(guests[idx].id);
          updated += 1;
          return;
        }

        if (!Number.isFinite(allocation)) allocation = 1;
        allocation = Math.min(10, Math.max(1, Math.round(allocation)));
        const item = {
          id: `guest-${Date.now()}-${randomBytes(3).toString("hex")}-${rowNumber}`,
          name: person.name,
          firstName: person.firstName,
          surname: person.surname,
          allocation,
          category: placement.category,
          tableNumber: placement.tableNumber,
        };
        guests.push(item);
        keptIds.add(item.id);
        added += 1;
      });

      let removed = 0;
      let nextGuests = guests;
      if (removeMissing) {
        if (!keptIds.size) {
          return res.status(400).json({ error: "That file has no guests, so nobody was removed." });
        }
        nextGuests = guests.filter((guest) => {
          if (keptIds.has(guest.id)) return true;
          removed += 1;
          return false;
        });
      }

      sortGuestsBySurname(nextGuests);
      writeJson("guests.json", nextGuests);
      const removedNote = removed ? ` Removed ${removed} guest${removed === 1 ? "" : "s"} who were not in the file.` : "";
      res.json({
        ok: true,
        added,
        updated,
        removed,
        skipped,
        total: nextGuests.length,
        message: `Imported ${updated} update${updated === 1 ? "" : "s"} and ${added} new guest${added === 1 ? "" : "s"}.${removedNote}`,
      });
    } catch (error) {
      console.error("Guest Excel import failed:", error);
      res.status(400).json({ error: "Could not read that Excel file. Please upload the downloaded .xlsx file." });
    }
  });
});

app.post("/api/admin/guests", requireAdmin, (req, res) => {
  const person = parsePersonName(req.body?.name, req.body?.firstName, req.body?.surname);
  let allocation = Number(req.body?.allocation);
  if (!person.surname || !person.firstName) {
    return res.status(400).json({ error: "Surname and first name are required" });
  }
  if (!Number.isFinite(allocation)) allocation = 1;
  allocation = Math.min(10, Math.max(1, Math.round(allocation)));

  const guests = readJson("guests.json", []).map(hydratePerson);
  const exists = guests.some((g) => namesMatch(g, person));
  if (exists) return res.status(400).json({ error: "That guest is already on the list" });

  const placement = guestPlacement(req.body);
  const item = {
    id: `guest-${Date.now()}-${randomBytes(3).toString("hex")}`,
    name: person.name,
    firstName: person.firstName,
    surname: person.surname,
    allocation,
    category: placement.category,
    tableNumber: placement.tableNumber,
  };
  guests.push(item);
  sortGuestsBySurname(guests);
  writeJson("guests.json", guests);
  res.status(201).json(item);
});

app.put("/api/admin/guests/:id", requireAdmin, (req, res) => {
  const guests = readJson("guests.json", []).map(hydratePerson);
  const idx = guests.findIndex((g) => g.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "Guest not found" });

  const person = parsePersonName(
    req.body?.name,
    req.body?.firstName ?? guests[idx].firstName,
    req.body?.surname ?? guests[idx].surname
  );
  let allocation = Number(req.body?.allocation ?? guests[idx].allocation);
  if (!person.surname || !person.firstName) {
    return res.status(400).json({ error: "Surname and first name are required" });
  }
  if (!Number.isFinite(allocation)) allocation = guests[idx].allocation || 1;
  allocation = Math.min(10, Math.max(1, Math.round(allocation)));

  const duplicate = guests.some((g, i) => i !== idx && namesMatch(g, person));
  if (duplicate) return res.status(400).json({ error: "That guest is already on the list" });

  const placement = guestPlacement({
    category: req.body?.category ?? guests[idx].category,
    tableNumber: req.body?.tableNumber ?? guests[idx].tableNumber,
  });

  guests[idx] = {
    ...guests[idx],
    name: person.name,
    firstName: person.firstName,
    surname: person.surname,
    allocation,
    category: placement.category,
    tableNumber: placement.tableNumber,
  };
  sortGuestsBySurname(guests);
  writeJson("guests.json", guests);
  res.json(guests.find((g) => g.id === req.params.id));
});

app.delete("/api/admin/guests/:id", requireAdmin, (req, res) => {
  const guests = readJson("guests.json", []);
  const next = guests.filter((g) => g.id !== req.params.id);
  if (next.length === guests.length) return res.status(404).json({ error: "Guest not found" });
  writeJson("guests.json", next);
  res.json({ ok: true });
});

// ── Admin auth ──

const loginAttempts = new Map();

app.post("/api/admin/login", (req, res) => {
  const { password } = req.body || {};
  const key = String(req.ip || "unknown");
  const now = Date.now();
  const attempt = loginAttempts.get(key) || { fails: 0, reset: now + 15 * 60 * 1000 };
  if (now > attempt.reset) {
    attempt.fails = 0;
    attempt.reset = now + 15 * 60 * 1000;
  }
  if (attempt.fails >= 8) {
    loginAttempts.set(key, attempt);
    return res.status(429).json({ error: "Too many sign-in attempts. Wait a few minutes and try again." });
  }
  if (!verifyPassword(password || "")) {
    attempt.fails += 1;
    loginAttempts.set(key, attempt);
    return res.status(401).json({ error: "Invalid password." });
  }
  attempt.fails = 0;
  loginAttempts.set(key, attempt);
  const token = createToken();
  sessions.set(token, Date.now());
  persistSessions();
  res.cookie("admin_session", token, sessionCookieOptions(req));
  res.json({ ok: true, token });
});

app.get("/api/admin/login-options", (_req, res) => {
  res.json({ email: loadAdminConfig().email });
});

app.post("/api/admin/forgot-password", async (req, res) => {
  const cfg = loadAdminConfig();
  const now = Date.now();
  if (cfg.lastResetSentAt && now - Number(cfg.lastResetSentAt) < 60 * 1000) {
    return res.json({
      ok: true,
      emailed: true,
      email: cfg.email,
      message: "If an account exists, a reset link is on its way. Please wait a moment before requesting another.",
    });
  }

  const rawToken = createToken();
  cfg.resetTokenHash = hashToken(rawToken);
  cfg.resetExpires = now + 60 * 60 * 1000;
  cfg.lastResetSentAt = now;
  saveAdminConfig(cfg);

  const resetUrl = `${publicBaseUrl(req)}/admin/?token=${encodeURIComponent(rawToken)}`;
  let emailed = false;
  try {
    emailed = await sendAdminResetEmail(resetUrl);
  } catch (err) {
    console.error("Admin reset email error:", err);
  }
  res.json({
    ok: true,
    emailed,
    email: cfg.email,
    message: emailed
      ? `A reset link was sent to ${cfg.email}. Check your inbox and spam folder.`
      : `We couldn't send email just now. Please try again in a moment, or check that ${cfg.email} can receive mail from the site.`,
  });
});

app.post("/api/admin/reset-password", (req, res) => {
  const token = String(req.body?.token || "").trim();
  const password = String(req.body?.password || "");
  const confirm = String(req.body?.confirm || password);
  if (!token) return res.status(400).json({ error: "This reset link is missing. Please request a new one." });
  if (password.length < 8) {
    return res.status(400).json({ error: "Please choose a password of at least 8 characters." });
  }
  if (password !== confirm) {
    return res.status(400).json({ error: "Those passwords do not match." });
  }

  const cfg = loadAdminConfig();
  const now = Date.now();
  if (!cfg.resetTokenHash || !cfg.resetExpires || now > Number(cfg.resetExpires)) {
    return res.status(400).json({ error: "This reset link has expired. Please request a new one." });
  }
  const incoming = Buffer.from(hashToken(token), "hex");
  const stored = Buffer.from(String(cfg.resetTokenHash), "hex");
  if (!incoming.length || incoming.length !== stored.length || !timingSafeEqual(incoming, stored)) {
    return res.status(400).json({ error: "This reset link is invalid. Please request a new one." });
  }

  const hashed = hashPassword(password);
  cfg.passwordHash = hashed.hash;
  cfg.salt = hashed.salt;
  cfg.resetTokenHash = "";
  cfg.resetExpires = 0;
  saveAdminConfig(cfg);

  sessions.clear();
  persistSessions();
  res.json({ ok: true });
});

app.post("/api/admin/logout", (req, res) => {
  const token = getSessionToken(req);
  if (token) sessions.delete(token);
  persistSessions();
  res.clearCookie("admin_session", { ...sessionCookieOptions(req), maxAge: 0 });
  res.json({ ok: true });
});

app.get("/api/admin/me", (req, res) => {
  const token = getSessionToken(req);
  if (!token || !sessions.has(token)) {
    return res.status(401).json({ authenticated: false });
  }
  res.json({ authenticated: true });
});

// ── Admin content ──

app.put("/api/admin/content", requireAdmin, (req, res) => {
  const content = req.body;
  if (!content || typeof content !== "object") {
    return res.status(400).json({ error: "Invalid content" });
  }

  if (content.weddingDate) {
    const wedding = new Date(content.weddingDate);
    if (isNaN(wedding.getTime())) {
      return res.status(400).json({ error: "Invalid wedding date" });
    }
    content.weddingDate = wedding.toISOString();
    content.weddingDateDisplay = wedding.toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  }

  // Normalize Google Drive share links on story timeline photos
  if (Array.isArray(content.timeline)) {
    content.timeline = content.timeline.map((item) => {
      if (!item || typeof item !== "object") return item;
      return {
        ...item,
        photo: normalizeImageUrl(item.photo || ""),
      };
    });
  }

  // Normalize Google Drive share links on attire photos
  if (content.attirePhotos && typeof content.attirePhotos === "object") {
    const next = {};
    for (const [key, entry] of Object.entries(content.attirePhotos)) {
      if (!entry || typeof entry !== "object") {
        next[key] = entry;
        continue;
      }
      next[key] = {
        ...entry,
        photo: normalizeImageUrl(entry.photo || ""),
      };
    }
    content.attirePhotos = next;
  }

  function normalizeSponsors(list) {
    if (!Array.isArray(list)) return [];
    return list.map((person) => {
      if (!person || typeof person !== "object") return person;
      return {
        ...person,
        photo: normalizeImageUrl(person.photo || ""),
      };
    });
  }
  content.ninongs = normalizeSponsors(content.ninongs);
  content.ninangs = normalizeSponsors(content.ninangs);

  if (typeof content.envelopeImage === "string") {
    content.envelopeImage = normalizeImageUrl(content.envelopeImage);
  }

  if (content.ceremonyPhotoFrame) content.ceremonyPhotoFrame = normalizePhotoFrame(content.ceremonyPhotoFrame);
  if (content.venuePhotoFrame) content.venuePhotoFrame = normalizePhotoFrame(content.venuePhotoFrame);

  writeJson("content.json", content);
  res.json({ ok: true, content });
});

function normalizePhotoFrame(frame) {
  const src = frame && typeof frame === "object" ? frame : {};
  const clamp = (value, min, max, fallback) => {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
  };
  return {
    x: Math.round(clamp(src.x, 0, 100, 50)),
    y: Math.round(clamp(src.y, 0, 100, 50)),
    zoom: Math.round(clamp(src.zoom, 1, 2.4, 1) * 100) / 100,
  };
}

function clampAlbumNumber(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

app.put("/api/admin/album-look", requireAdmin, (req, res) => {
  const content = readJson("content.json", {});
  content.albumPreviewSize = Math.round(clampAlbumNumber(req.body?.albumPreviewSize, 96, 240, 168));
  content.albumSlideSpeed = Math.round(clampAlbumNumber(req.body?.albumSlideSpeed, 0, 2, 0.55) * 100) / 100;
  writeJson("content.json", content);
  res.json({
    ok: true,
    albumPreviewSize: content.albumPreviewSize,
    albumSlideSpeed: content.albumSlideSpeed,
  });
});

// Generic image upload (envelope texture, etc.) — does not add to gallery
app.post("/api/admin/upload", requireAdmin, upload.single("file"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });
  res.json({ src: `/uploads/${req.file.filename}` });
});

// ── Admin gallery ──

function extractDriveFileId(raw) {
  const input = String(raw || "").trim();
  if (!input) return "";

  // Already a local Drive proxy path
  let match = input.match(/^\/api\/media\/drive\/([a-zA-Z0-9_-]+)/i);
  if (match) return match[1];

  // https://drive.google.com/file/d/FILE_ID/...
  match = input.match(/drive\.google\.com\/file\/d\/([^/?#]+)/i);
  if (match) return match[1];

  // https://lh3.googleusercontent.com/d/FILE_ID
  match = input.match(/googleusercontent\.com\/d\/([a-zA-Z0-9_-]+)/i);
  if (match) return match[1];

  // Any drive.google.com URL with ?id= or &id=
  if (/drive\.google\.com/i.test(input)) {
    match = input.match(/[?&]id=([^&/#]+)/i);
    if (match) return decodeURIComponent(match[1]);
  }

  return "";
}

function normalizeImageUrl(raw) {
  const input = String(raw || "").trim();
  if (!input) return "";

  const driveId = extractDriveFileId(input);
  if (driveId) {
    // Serve through our proxy so <img> tags actually render Drive photos
    return `/api/media/drive/${driveId}`;
  }

  return input;
}

function rewriteDriveUrlsInContent(content) {
  if (!content || typeof content !== "object") return content;
  const next = { ...content };

  if (Array.isArray(next.timeline)) {
    next.timeline = next.timeline.map((item) => {
      if (!item || typeof item !== "object") return item;
      return { ...item, photo: normalizeImageUrl(item.photo || "") };
    });
  }

  if (next.attirePhotos && typeof next.attirePhotos === "object") {
    const photos = {};
    for (const [key, entry] of Object.entries(next.attirePhotos)) {
      if (!entry || typeof entry !== "object") {
        photos[key] = entry;
        continue;
      }
      photos[key] = {
        ...entry,
        photo: normalizeImageUrl(entry.photo || ""),
      };
    }
    next.attirePhotos = photos;
  }

  const mapSponsors = (list) => {
    if (!Array.isArray(list)) return list;
    return list.map((person) => {
      if (!person || typeof person !== "object") return person;
      return { ...person, photo: normalizeImageUrl(person.photo || "") };
    });
  };
  next.ninongs = mapSponsors(next.ninongs);
  next.ninangs = mapSponsors(next.ninangs);

  return next;
}

const driveAlbum = createDriveAlbum({ dataDir: DATA_DIR, publicBaseUrl });

function driveIdFromSrc(src) {
  const match = String(src || "").match(/\/api\/media\/drive\/([a-zA-Z0-9_-]+)/i);
  return match ? match[1] : "";
}

function sendDriveBuffer(res, buffer, contentType, preferVideo) {
  const type = String(contentType || "").toLowerCase();
  const head = buffer.slice(0, 32).toString("utf8").trim().toLowerCase();
  if (type.includes("text/html") || head.startsWith("<!doctype") || head.startsWith("<html")) return false;
  let outType = preferVideo ? "video/mp4" : "image/jpeg";
  if (type.startsWith("image/") || type.startsWith("video/")) outType = type.split(";")[0];
  res.setHeader("Content-Type", outType);
  res.setHeader("Cache-Control", "private, max-age=3600");
  res.send(buffer);
  return true;
}

const thumbCache = new Map();
const THUMB_CACHE_MAX = 16;
const THUMB_CACHE_BYTES = 4 * 1024 * 1024;
let thumbCacheBytes = 0;

function bucketThumbWidth(value) {
  const width = Number(value);
  if (!Number.isFinite(width) || width <= 0) return 0;
  if (width <= 560) return 480;
  if (width <= 880) return 720;
  return 1200;
}

function rememberThumb(key, value) {
  const bytes = value?.buffer?.length || 0;
  if (!bytes || bytes > 350 * 1024) return;
  if (thumbCache.has(key)) {
    thumbCacheBytes -= thumbCache.get(key)?.buffer?.length || 0;
    thumbCache.delete(key);
  }
  thumbCache.set(key, { ...value, at: Date.now() });
  thumbCacheBytes += bytes;
  while (thumbCache.size > THUMB_CACHE_MAX || thumbCacheBytes > THUMB_CACHE_BYTES) {
    const oldest = thumbCache.keys().next().value;
    thumbCacheBytes -= thumbCache.get(oldest)?.buffer?.length || 0;
    thumbCache.delete(oldest);
  }
}

function cachedThumb(key) {
  const hit = thumbCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > 1000 * 60 * 30) {
    thumbCacheBytes -= hit.buffer?.length || 0;
    thumbCache.delete(key);
    return null;
  }
  thumbCache.delete(key);
  thumbCache.set(key, hit);
  return hit;
}

function sendThumbBuffer(res, buffer, contentType) {
  res.setHeader("Content-Type", contentType || "image/jpeg");
  res.setHeader("Cache-Control", "public, max-age=86400, stale-while-revalidate=604800");
  res.setHeader("Content-Length", buffer.length);
  res.end(buffer);
}

function sendThumbPlaceholder(res) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4 5"><rect width="4" height="5" fill="#d8d4ce"/></svg>`;
  res.setHeader("Content-Type", "image/svg+xml; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=60");
  res.send(svg);
}

async function fetchPublicThumb(id, width) {
  const urls = [
    `https://drive.google.com/thumbnail?id=${encodeURIComponent(id)}&sz=w${width}`,
    `https://lh3.googleusercontent.com/d/${encodeURIComponent(id)}=s${width}`,
  ];
  for (const url of urls) {
    try {
      const upstream = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(8000) });
      if (!upstream.ok) continue;
      const contentType = (upstream.headers.get("content-type") || "").toLowerCase();
      if (!contentType.startsWith("image/")) continue;
      const buffer = Buffer.from(await upstream.arrayBuffer());
      if (buffer.length < 32 || buffer.length > 800 * 1024) continue;
      return { buffer, contentType: contentType.split(";")[0] };
    } catch (err) {
      console.error("Drive thumbnail fetch failed:", err.message);
    }
  }
  return null;
}

async function sendDriveThumb(res, id, width) {
  const key = `${id}:${width}`;
  const cached = cachedThumb(key);
  if (cached) {
    sendThumbBuffer(res, cached.buffer, cached.contentType);
    return;
  }
  let thumb = null;
  if (driveAlbum.connected()) {
    try {
      thumb = await driveAlbum.fetchThumbnail(id, width);
    } catch (err) {
      console.error("Drive thumbnail failed:", err.message);
    }
  }
  if (!thumb) thumb = await fetchPublicThumb(id, width);
  if (!thumb) {
    sendThumbPlaceholder(res);
    return;
  }
  rememberThumb(key, thumb);
  sendThumbBuffer(res, thumb.buffer, thumb.contentType);
}

async function streamOwnedDrive(req, res, id, preferVideo) {
  let upstream;
  try {
    upstream = await driveAlbum.openFile(id, req.headers.range);
  } catch (err) {
    console.error("Drive stream failed:", err.message);
    return false;
  }
  if (!upstream) return false;
  const contentType = (upstream.headers.get("content-type") || "").toLowerCase();
  if (contentType.includes("text/html")) {
    await upstream.body?.cancel?.();
    return false;
  }
  let outType = contentType.split(";")[0];
  if (!outType.startsWith("image/") && !outType.startsWith("video/")) {
    outType = preferVideo ? "video/mp4" : "image/jpeg";
  }
  res.status(upstream.status === 206 || upstream.status === 416 ? upstream.status : 200);
  res.setHeader("Content-Type", outType);
  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("Cache-Control", "public, max-age=86400");
  const length = upstream.headers.get("content-length");
  const range = upstream.headers.get("content-range");
  if (length) res.setHeader("Content-Length", length);
  if (range) res.setHeader("Content-Range", range);
  if (!upstream.body) {
    res.end();
    return true;
  }
  const stream = Readable.fromWeb(upstream.body);
  stream.on("error", () => {
    if (!res.headersSent) res.status(502).end();
    else res.destroy();
  });
  res.on("close", () => stream.destroy());
  stream.pipe(res);
  return true;
}

function looksLikeHtml(bytes) {
  const sample = Buffer.from(bytes).subarray(0, 32).toString("utf8").trim().toLowerCase();
  return sample.startsWith("<!doctype") || sample.startsWith("<html");
}

async function forwardUpstream(res, upstream, preferVideo) {
  const contentType = (upstream.headers.get("content-type") || "").toLowerCase();
  if (!upstream.body || contentType.includes("text/html")) {
    await upstream.body?.cancel?.();
    return false;
  }
  const reader = upstream.body.getReader();
  const first = await reader.read();
  if (!first.value?.byteLength) {
    try { await reader.cancel(); } catch { /* ignore */ }
    return false;
  }
  if (looksLikeHtml(first.value)) {
    try { await reader.cancel(); } catch { /* ignore */ }
    return false;
  }
  const isImage = contentType.startsWith("image/") || contentType.includes("octet-stream") || contentType.includes("application/binary");
  const isVideo = contentType.startsWith("video/");
  if (contentType && !isImage && !isVideo) {
    try { await reader.cancel(); } catch { /* ignore */ }
    return false;
  }
  let outType = preferVideo ? "video/mp4" : "image/jpeg";
  if (contentType.startsWith("image/") || contentType.startsWith("video/")) outType = contentType.split(";")[0];
  res.setHeader("Content-Type", outType);
  res.setHeader("Cache-Control", "public, max-age=86400, stale-while-revalidate=604800");
  const length = upstream.headers.get("content-length");
  if (length) res.setHeader("Content-Length", length);
  let pending = first.value;
  const nodeStream = Readable.fromWeb(new ReadableStream({
    async pull(controller) {
      if (pending) {
        const chunk = pending;
        pending = null;
        controller.enqueue(chunk);
        return;
      }
      const next = await reader.read();
      if (next.done) controller.close();
      else controller.enqueue(next.value);
    },
    cancel() {
      reader.cancel().catch(() => {});
    },
  }));
  nodeStream.on("error", () => {
    if (!res.headersSent) res.status(502).end();
    else res.destroy();
  });
  res.on("close", () => nodeStream.destroy());
  nodeStream.pipe(res);
  return true;
}

// Proxy Google Drive media so photos and short videos display reliably
app.get("/api/media/drive/:id", async (req, res) => {
  const id = String(req.params.id || "").trim();
  if (!/^[a-zA-Z0-9_-]{10,}$/.test(id)) {
    return res.status(400).type("text").send("Invalid Drive file id");
  }

  const preferVideo = String(req.query.type || "").toLowerCase() === "video";
  const thumbWidth = bucketThumbWidth(req.query.w);
  if (thumbWidth) {
    await sendDriveThumb(res, id, thumbWidth);
    return;
  }
  if (driveAlbum.connected()) {
    const streamed = await streamOwnedDrive(req, res, id, preferVideo);
    if (streamed) return;
  }
  const candidates = preferVideo
    ? [
        `https://drive.google.com/uc?export=download&id=${encodeURIComponent(id)}`,
        `https://drive.google.com/thumbnail?id=${encodeURIComponent(id)}&sz=w2000`,
        `https://lh3.googleusercontent.com/d/${encodeURIComponent(id)}=w2000`,
      ]
    : [
        `https://drive.google.com/thumbnail?id=${encodeURIComponent(id)}&sz=w2000`,
        `https://lh3.googleusercontent.com/d/${encodeURIComponent(id)}=w2000`,
        `https://drive.google.com/uc?export=download&id=${encodeURIComponent(id)}`,
      ];

  for (const url of candidates) {
    try {
      const upstream = await fetch(url, {
        redirect: "follow",
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; WeddingInvitation/1.0)",
          Accept: preferVideo ? "video/*,image/*,*/*;q=0.8" : "image/*,*/*;q=0.8",
        },
      });
      if (!upstream.ok) continue;
      const sent = await forwardUpstream(res, upstream, preferVideo);
      if (sent) return;
    } catch (err) {
      console.error("Drive proxy fetch failed:", url, err.message);
      if (res.headersSent) return;
    }
  }

  return res
    .status(404)
    .type("text")
    .send("Drive media unavailable. Check sharing is set to Anyone with the link.");
});

app.post("/api/admin/gallery", requireAdmin, (req, res, next) => {
  galleryUpload.single("photo")(req, res, (err) => (err ? rejectUpload(err, res) : next()));
}, async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Photo or video file is required" });
  try {
    await prepareUpload(req.file);
  } catch (err) {
    removeUpload(req.file);
    if (err.code === "too_long") return res.status(400).json({ error: err.message });
    throw err;
  }

  const src = `/uploads/${req.file.filename}`;
  const type = galleryItemType({ type: req.body?.type, src }, req.file.mimetype);
  const gallery = readJson("gallery.json", []);
  const item = {
    id: `g-${Date.now()}`,
    src,
    type,
    caption: String(req.body.caption || "").trim() || "Untitled",
    alt: String(req.body.alt || req.body.caption || (type === "video" ? "Prenup video" : "Prenup photo")).trim(),
    source: "upload",
  };
  gallery.unshift(item);
  writeJson("gallery.json", gallery);
  res.status(201).json(item);
});

app.post("/api/admin/gallery/url", requireAdmin, (req, res) => {
  const raw = req.body?.url || req.body?.src;
  const src = normalizeImageUrl(raw);
  if (!src) return res.status(400).json({ error: "Media URL is required" });
  if (!isAllowedGallerySrc(src)) {
    return res.status(400).json({ error: "URL must be http(s), a Drive link, or an uploaded file path" });
  }

  const type = galleryItemType({ type: req.body?.type, src });
  const gallery = readJson("gallery.json", []);
  const item = {
    id: `g-${Date.now()}`,
    src,
    type,
    caption: String(req.body.caption || "").trim() || "Untitled",
    alt: String(req.body.alt || req.body.caption || (type === "video" ? "Prenup video" : "Prenup photo")).trim(),
    source: "url",
  };
  gallery.unshift(item);
  writeJson("gallery.json", gallery);
  res.status(201).json(item);
});

app.patch("/api/admin/gallery/:id", requireAdmin, (req, res) => {
  const gallery = readJson("gallery.json", []);
  const idx = gallery.findIndex((g) => g.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "Not found" });

  if (req.body.caption !== undefined) gallery[idx].caption = String(req.body.caption).trim();
  if (req.body.alt !== undefined) gallery[idx].alt = String(req.body.alt).trim();
  if (req.body.type !== undefined) {
    gallery[idx].type = galleryItemType({ type: req.body.type, src: gallery[idx].src });
  }
  if (req.body.url !== undefined || req.body.src !== undefined) {
    const next = normalizeImageUrl(req.body.url || req.body.src);
    if (!next || !isAllowedGallerySrc(next)) {
      return res.status(400).json({ error: "Media URL is required" });
    }
    gallery[idx].src = next;
    gallery[idx].source = "url";
    if (req.body.type === undefined) {
      gallery[idx].type = galleryItemType({ ...gallery[idx], src: next });
    }
  }
  writeJson("gallery.json", gallery);
  res.json({ ...gallery[idx], type: galleryItemType(gallery[idx]) });
});

app.delete("/api/admin/gallery/:id", requireAdmin, (req, res) => {
  const gallery = readJson("gallery.json", []);
  const idx = gallery.findIndex((g) => g.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "Not found" });

  const [removed] = gallery.splice(idx, 1);
  writeJson("gallery.json", gallery);

  if (removed.src?.startsWith("/uploads/")) {
    const filePath = join(UPLOAD_DIR, removed.src.replace("/uploads/", ""));
    if (existsSync(filePath)) {
      try {
        unlinkSync(filePath);
      } catch {
        /* ignore */
      }
    }
  }

  res.json({ ok: true });
});

// ── Admin RSVPs ──

app.get("/api/admin/rsvps", requireAdmin, (_req, res) => {
  const rsvps = readJson("rsvps.json", []).map((r) => {
    const person = hydratePerson(r);
    const companions = (Array.isArray(r.companions) ? r.companions : []).map(parseCompanion);
    return { ...person, companions };
  });
  res.json(rsvps);
});

app.put("/api/admin/rsvps/:id", requireAdmin, async (req, res) => {
  const rsvps = readJson("rsvps.json", []);
  const idx = rsvps.findIndex((r) => r.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "RSVP not found" });

  const current = hydratePerson(rsvps[idx]);
  const person = parsePersonName(
    req.body?.name,
    req.body?.firstName ?? current.firstName,
    req.body?.surname ?? current.surname
  );
  if (!person.surname || !person.firstName) {
    return res.status(400).json({ error: "Surname and first name are required" });
  }

  const nameTaken = rsvps.some(
    (r, i) => i !== idx && namesMatch(hydratePerson(r), person)
  );
  if (nameTaken) {
    return res.status(400).json({ error: "Another RSVP already uses that name" });
  }

  const allocation = Math.min(10, Math.max(1, Number(current.allocation) || 1));
  const maxCompanions = Math.max(0, allocation - 1);
  let companions = Array.isArray(req.body?.companions)
    ? req.body.companions.map(parseCompanion).filter((c) => c.firstName && c.surname)
    : (Array.isArray(current.companions) ? current.companions.map(parseCompanion) : []);
  if (current.attendance !== "attending") companions = [];
  companions = companions.slice(0, maxCompanions);

  const next = {
    ...current,
    name: person.name,
    firstName: person.firstName,
    surname: person.surname,
    companions,
    partySize: current.attendance === "attending" ? 1 + companions.length : 1,
    updatedAt: new Date().toISOString(),
  };

  let guestListUpdated = false;
  if (current.guestId) {
    const guests = readJson("guests.json", []).map(hydratePerson);
    const gIdx = guests.findIndex((g) => g.id === current.guestId);
    if (gIdx !== -1) {
      const clash = guests.some((g, i) => i !== gIdx && namesMatch(g, person));
      if (!clash) {
        guests[gIdx] = {
          ...guests[gIdx],
          name: person.name,
          firstName: person.firstName,
          surname: person.surname,
        };
        sortGuestsBySurname(guests);
        writeJson("guests.json", guests);
        guestListUpdated = true;
        next.guestMatched = true;
      }
    }
  }

  rsvps[idx] = next;
  writeJson("rsvps.json", rsvps);
  await rememberRecords();
  res.json({ ...next, guestListUpdated });
});

app.delete("/api/admin/rsvps/:id", requireAdmin, async (req, res) => {
  const rsvps = readJson("rsvps.json", []);
  const next = rsvps.filter((r) => r.id !== req.params.id);
  if (next.length === rsvps.length) return res.status(404).json({ error: "Not found" });
  writeJson("rsvps.json", next);
  await rememberRecords();
  res.json({ ok: true });
});

// ── Guest album: photos and short films from the day ──

const GUEST_ALBUM_LABEL = "Guest album";
const guestRateBuckets = new Map();

const guestStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = extname(file.originalname || "").toLowerCase();
    const allowed = {
      ".jpg": ".jpg",
      ".jpeg": ".jpg",
      ".png": ".png",
      ".webp": ".webp",
      ".gif": ".gif",
      ".mp4": ".mp4",
      ".webm": ".webm",
      ".mov": ".mov",
    };
    const safe = allowed[ext] || (VIDEO_MIME.test(file.mimetype) ? ".mp4" : ".jpg");
    cb(null, `guest-${Date.now()}-${randomBytes(4).toString("hex")}${safe}`);
  },
});

const guestUpload = multer({
  storage: guestStorage,
  limits: { fileSize: 40 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (IMAGE_MIME.test(file.mimetype) || VIDEO_MIME.test(file.mimetype)) cb(null, true);
    else cb(new Error("Only photo (JPEG/PNG/WebP/GIF) or short video (MP4/WebM/MOV) uploads are allowed"));
  },
});

function clipText(value, max) {
  return String(value || "").replace(/[\u0000-\u001F\u007F]/g, "").trim().slice(0, max);
}

function guestTokenHash(token) {
  const value = String(token || "").trim();
  if (!/^[a-zA-Z0-9_-]{16,80}$/.test(value)) return "";
  return createHash("sha256").update(`guest-album:${value}`).digest("hex");
}

function readGuestToken(req) {
  return guestTokenHash(req.get("x-guest-token") || req.body?.token || "");
}

function allowGuestAction(req, action, limit, windowMs) {
  const now = Date.now();
  const key = `${action}:${req.ip || "unknown"}`;
  const bucket = guestRateBuckets.get(key) || { count: 0, reset: now + windowMs };
  if (now > bucket.reset) {
    bucket.count = 0;
    bucket.reset = now + windowMs;
  }
  bucket.count += 1;
  guestRateBuckets.set(key, bucket);
  return bucket.count <= limit;
}

function readGuestAlbum() {
  const saved = readJson("guest-album.json", { posts: [] });
  const posts = Array.isArray(saved.posts) ? saved.posts : [];
  let changed = false;
  for (const post of posts) {
    if (post.album !== "main") {
      post.album = "main";
      changed = true;
    }
  }
  const album = { posts };
  if (changed) writeGuestAlbum(album);
  return album;
}

function writeGuestAlbum(album) {
  writeJson("guest-album.json", { posts: album.posts });
}

function safeGuestFile(src) {
  const base = basename(String(src || ""));
  if (!/^guest-\d+-[a-f0-9]+\.(jpg|png|webp|gif|mp4|webm|mov)$/i.test(base)) return null;
  const full = resolve(UPLOAD_DIR, base);
  const root = resolve(UPLOAD_DIR);
  if (!full.startsWith(root + "/") && full !== root) return null;
  if (!existsSync(full)) return null;
  return full;
}

function publicGuestPost(post, tokenHash, options = {}) {
  const hearts = Array.isArray(post.hearts) ? post.hearts : [];
  const laughs = Array.isArray(post.laughs) ? post.laughs : [];
  const row = {
    id: post.id,
    album: post.album,
    type: post.type === "video" ? "video" : "photo",
    src: post.src,
    caption: post.caption || "",
    createdAt: post.createdAt,
    heartCount: hearts.length,
    liked: !!(tokenHash && hearts.includes(tokenHash)),
    laughCount: laughs.length,
    laughed: !!(tokenHash && laughs.includes(tokenHash)),
  };
  if (options.includeName) row.name = post.name || "";
  return row;
}

function guestFileExt(contentType, type) {
  const kind = String(contentType || "").toLowerCase();
  if (kind.includes("png")) return ".png";
  if (kind.includes("webp")) return ".webp";
  if (kind.includes("gif")) return ".gif";
  if (kind.includes("webm")) return ".webm";
  if (kind.includes("quicktime")) return ".mov";
  if (kind.startsWith("video/") || type === "video") return ".mp4";
  return ".jpg";
}

function guestFileType(ext, fallback) {
  return {
    ".jpg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".mp4": "video/mp4",
    ".webm": "video/webm",
    ".mov": "video/quicktime",
  }[ext] || fallback || "application/octet-stream";
}

function guestDownloadName(post, ext, used, hideName) {
  const raw = hideName ? (post.caption || "moment") : (post.name || "guest");
  const base = clipText(raw, 40).replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "") || (hideName ? "moment" : "guest");
  let name = `${base}${ext}`;
  if (used.has(name.toLowerCase())) name = `${base}-${String(post.id).replace(/[^\w.-]+/g, "").slice(-8)}${ext}`;
  used.add(name.toLowerCase());
  return name;
}

async function writeGuestFile(post, folder, used, hideName) {
  if (!existsSync(folder)) mkdirSync(folder, { recursive: true });
  const local = safeGuestFile(post.src);
  if (local) {
    const ext = extname(local).toLowerCase() || guestFileExt("", post.type);
    const name = guestDownloadName(post, ext, used, hideName);
    copyFileSync(local, join(folder, name));
    return name;
  }
  const driveId = post.driveId || driveIdFromSrc(post.src);
  if (!driveId || !driveAlbum.connected()) return "";
  const part = join(folder, `${String(post.id).replace(/[^\w.-]+/g, "")}.part`);
  const saved = await driveAlbum.downloadToFile(driveId, part);
  if (!saved) {
    try { unlinkSync(part); } catch { /* ignore */ }
    return "";
  }
  const ext = guestFileExt(saved.contentType, post.type);
  const name = guestDownloadName(post, ext, used, hideName);
  renameSync(part, join(folder, name));
  return name;
}

function uploadTooLarge(err) {
  return err?.code === "LIMIT_FILE_SIZE";
}

function rejectUpload(err, res) {
  if (uploadTooLarge(err)) {
    return res.status(413).json({ error: "That file is too large for this site. Please use a photo or a video under 40 MB." });
  }
  return res.status(400).json({ error: err?.message || "That file could not be uploaded." });
}

function sortedGuestPosts(posts) {
  return posts.slice().sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
}

app.get("/api/guest-album", async (req, res) => {
  try {
    await Promise.race([
      refreshGuestAlbumFromDrive(false),
      new Promise((resolve) => setTimeout(resolve, 12000)),
    ]);
  } catch (err) {
    console.error("Guest album sync failed:", err.detail || err.message);
  }
  const album = readGuestAlbum();
  const tokenHash = readGuestToken(req);
  const posts = sortedGuestPosts(album.posts);
  res.json({
    albums: [{ id: "main", label: GUEST_ALBUM_LABEL, count: posts.length }],
    posts: posts.map((post) => publicGuestPost(post, tokenHash)),
  });
});

function removeUpload(file) {
  if (!file?.path) return;
  try { unlinkSync(file.path); } catch { /* ignore */ }
}

app.post("/api/guest-album", (req, res, next) => {
  guestUpload.single("media")(req, res, (err) => (err ? rejectUpload(err, res) : next()));
}, async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Choose a photo or video to share." });
  const name = clipText(req.body?.name, 60);
  const caption = clipText(req.body?.caption, 240);
  if (name.length < 2) {
    removeUpload(req.file);
    return res.status(400).json({ error: "Add your name so guests know who shared this." });
  }
  if (!driveAlbum.configured() || !driveAlbum.connected()) {
    removeUpload(req.file);
    return res.status(503).json({ error: "Google Drive is not connected yet. The couple can connect it from the admin page, then try again." });
  }
  try {
    await prepareUpload(req.file);
    const type = VIDEO_MIME.test(req.file.mimetype) || isVideoSrc(req.file.filename, req.file.mimetype) ? "video" : "photo";
    const driveId = await driveAlbum.uploadGuestFile({
      filePath: req.file.path,
      mimeType: req.file.mimetype,
      originalName: req.file.originalname,
      guestName: name,
      caption,
      albumId: "main",
    });
    removeUpload(req.file);
    const post = {
      id: `p_${Date.now().toString(36)}${randomBytes(3).toString("hex")}`,
      album: "main",
      type: type === "video" ? "video" : "photo",
      src: `/api/media/drive/${driveId}${type === "video" ? "?type=video" : ""}`,
      driveId,
      name,
      caption,
      hearts: [],
      laughs: [],
      createdAt: new Date().toISOString(),
    };
    const album = readGuestAlbum();
    album.posts.push(post);
    writeGuestAlbum(album);
    res.status(201).json({
      ...publicGuestPost(post, readGuestToken(req)),
      notifyEmail: RSVP_EMAIL,
    });
  } catch (err) {
    removeUpload(req.file);
    if (err.code === "too_long") return res.status(400).json({ error: err.message });
    console.error("Guest Drive upload failed:", err.detail || err.message);
    res.status(502).json({ error: "That moment could not be saved to Google Drive. Try again in a moment." });
  }
});

function toggleGuestReaction(req, res, field) {
  if (!allowGuestAction(req, field, 80, 60 * 60 * 1000)) {
    return res.status(429).json({ error: "Too many reactions. Try again in a little while." });
  }
  const tokenHash = readGuestToken(req);
  if (!tokenHash) return res.status(400).json({ error: "This browser could not leave a reaction. Refresh and try again." });
  const album = readGuestAlbum();
  const post = album.posts.find((item) => item.id === req.params.id);
  if (!post) return res.status(404).json({ error: "That moment is no longer in the album." });
  const current = Array.isArray(post[field]) ? post[field] : [];
  post[field] = current.includes(tokenHash) ? current.filter((id) => id !== tokenHash) : current.concat(tokenHash);
  writeGuestAlbum(album);
  res.json(publicGuestPost(post, tokenHash));
}

app.post("/api/guest-album/:id/heart", (req, res) => toggleGuestReaction(req, res, "hearts"));
app.post("/api/guest-album/:id/laugh", (req, res) => toggleGuestReaction(req, res, "laughs"));

app.get("/api/guest-album/:id/file", async (req, res) => {
  if (!allowGuestAction(req, "download", 120, 60 * 60 * 1000)) {
    return res.status(429).json({ error: "Too many downloads. Try again in a little while." });
  }
  const album = readGuestAlbum();
  const post = album.posts.find((item) => item.id === req.params.id);
  if (!post) return res.status(404).json({ error: "That moment is no longer in the album." });
  const local = safeGuestFile(post.src);
  if (local) {
    const ext = extname(local).toLowerCase() || guestFileExt("", post.type);
    return res.download(local, guestDownloadName(post, ext, new Set(), true));
  }
  const driveId = post.driveId || driveIdFromSrc(post.src);
  if (!driveId) return res.status(404).json({ error: "That file is not available to download." });
  if (!driveAlbum.connected()) {
    return res.status(503).json({ error: "Google Drive is not connected yet, so these files cannot be downloaded." });
  }
  try {
    const upstream = await driveAlbum.openFile(driveId);
    if (!upstream?.body) return res.status(404).json({ error: "That file is not available to download." });
    const contentType = (upstream.headers.get("content-type") || "").toLowerCase();
    if (contentType.includes("text/html")) {
      await upstream.body.cancel?.();
      return res.status(404).json({ error: "That file is not available to download." });
    }
    const ext = guestFileExt(contentType, post.type);
    const filename = guestDownloadName(post, ext, new Set(), true).replace(/["\r\n]/g, "");
    const type = contentType.startsWith("image/") || contentType.startsWith("video/")
      ? contentType.split(";")[0]
      : guestFileType(ext, post.type === "video" ? "video/mp4" : "image/jpeg");
    res.setHeader("Content-Type", type);
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    const length = upstream.headers.get("content-length");
    if (length) res.setHeader("Content-Length", length);
    const stream = Readable.fromWeb(upstream.body);
    stream.on("error", () => {
      if (!res.headersSent) res.status(502).end();
      else res.destroy();
    });
    res.on("close", () => stream.destroy());
    stream.pipe(res);
  } catch (err) {
    if (!res.headersSent) res.status(err.status || 502).json({ error: err.message || "That file could not be downloaded." });
  }
});

app.post("/api/guest-album/download", async (req, res) => {
  if (!allowGuestAction(req, "download-zip", 12, 60 * 60 * 1000)) {
    return res.status(429).json({ error: "Too many downloads. Try again in a little while." });
  }
  const album = readGuestAlbum();
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map((id) => String(id)) : [];
  let chosen = sortedGuestPosts(album.posts);
  if (ids.length) {
    const wanted = new Set(ids);
    chosen = chosen.filter((post) => wanted.has(post.id));
  }
  if (!chosen.length) return res.status(404).json({ error: "Choose at least one photo or video to download." });
  if (chosen.length > 200) return res.status(400).json({ error: "That is a very large set. Download a smaller selection." });
  const dir = mkdtempSync(join(tmpdir(), "guest-download-"));
  const zipPath = join(tmpdir(), `guest-download-${Date.now()}.zip`);
  try {
    const used = new Set();
    let saved = 0;
    const folder = join(dir, GUEST_ALBUM_LABEL);
    for (const post of chosen) {
      const name = await writeGuestFile(post, folder, used, true);
      if (name) saved += 1;
    }
    if (!saved) {
      rmSync(dir, { recursive: true, force: true });
      return res.status(404).json({ error: "Those files are not available to download." });
    }
    await new Promise((resolvePromise, reject) => {
      const child = spawn("zip", ["-r", "-q", zipPath, "."], { cwd: dir });
      child.on("error", reject);
      child.on("close", (code) => (code === 0 ? resolvePromise() : reject(new Error("Could not package the download"))));
    });
    res.download(zipPath, "gio-augiela-guest-album.zip", () => {
      rmSync(dir, { recursive: true, force: true });
      rmSync(zipPath, { force: true });
    });
  } catch (err) {
    rmSync(dir, { recursive: true, force: true });
    rmSync(zipPath, { force: true });
    if (!res.headersSent) res.status(err.status || 502).json({ error: err.message || "The download could not be prepared." });
  }
});

function guestMediaKind(file) {
  const mime = String(file.mimeType || "").toLowerCase();
  if (/^image\/(jpeg|jpg|pjpeg|png|webp|gif)$/.test(mime)) return "photo";
  if (/^video\/(mp4|webm|quicktime|mov)$/.test(mime)) return "video";
  const name = String(file.name || "").toLowerCase();
  if (/\.(jpe?g|png|webp|gif)$/.test(name)) return "photo";
  if (/\.(mp4|webm|mov)$/.test(name)) return "video";
  return "";
}

function guestNameFromDrive(file) {
  const description = String(file.description || "").trim();
  if (description.includes(" — ")) {
    const [name, ...rest] = description.split(" — ");
    return { name: clipText(name, 60), caption: clipText(rest.join(" — "), 240) };
  }
  if (description) return { name: clipText(description, 60), caption: "" };
  const stripped = String(file.name || "")
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/\s+\d{4}-\d{2}-\d{2}t[\d-]+z?$/i, "")
    .trim();
  return { name: clipText(stripped, 60) || "Guest", caption: "" };
}

async function syncGuestAlbumFromDrive() {
  if (!driveAlbum.connected()) return { connected: false, added: 0, total: 0 };
  const files = await driveAlbum.listAlbumFiles();
  const album = readGuestAlbum();
  const byDrive = new Map();
  for (const post of album.posts) {
    const driveId = post.driveId || driveIdFromSrc(post.src);
    if (driveId) byDrive.set(driveId, post);
  }
  let added = 0;
  let changed = false;
  for (const file of files) {
    const kind = guestMediaKind(file);
    if (!kind || !file.id) continue;
    const src = `/api/media/drive/${file.id}${kind === "video" ? "?type=video" : ""}`;
    const existing = byDrive.get(file.id);
    if (existing) {
      if (!existing.driveId) {
        existing.driveId = file.id;
        changed = true;
      }
      if (existing.src !== src) {
        existing.src = src;
        changed = true;
      }
      if (existing.type !== kind) {
        existing.type = kind;
        changed = true;
      }
      if (existing.album !== "main") {
        existing.album = "main";
        changed = true;
      }
      continue;
    }
    const named = guestNameFromDrive(file);
    const post = {
      id: `p_${file.id}`,
      album: "main",
      type: kind,
      src,
      driveId: file.id,
      name: named.name || "Guest",
      caption: named.caption,
      hearts: [],
      laughs: [],
      createdAt: file.createdTime || new Date().toISOString(),
    };
    album.posts.push(post);
    byDrive.set(file.id, post);
    added += 1;
    changed = true;
  }
  if (changed) writeGuestAlbum(album);
  const mediaCount = files.filter((file) => guestMediaKind(file)).length;
  return { connected: true, added, total: mediaCount };
}

let albumSyncAt = 0;
let albumSyncing = null;

async function refreshGuestAlbumFromDrive(force) {
  if (!driveAlbum.connected()) return { connected: false, added: 0, total: 0 };
  const now = Date.now();
  if (!force && now - albumSyncAt < 60 * 1000) return { connected: true, added: 0, total: 0, cached: true };
  if (albumSyncing) return albumSyncing;
  albumSyncing = syncGuestAlbumFromDrive()
    .catch((err) => {
      console.error("Drive album sync failed:", err.detail || err.message);
      return { connected: true, added: 0, total: 0, error: "Google Drive is connected, but the album files could not be loaded. Try Refresh." };
    })
    .finally(() => {
      albumSyncAt = Date.now();
      albumSyncing = null;
    });
  return albumSyncing;
}

app.get("/api/admin/guest-album", requireAdmin, async (_req, res) => {
  const drive = await refreshGuestAlbumFromDrive(true);
  const album = readGuestAlbum();
  res.json({
    albums: [{ id: "main", label: GUEST_ALBUM_LABEL }],
    posts: sortedGuestPosts(album.posts).map((post) => publicGuestPost(post, "", { includeName: true })),
    drive,
  });
});

app.delete("/api/admin/guest-album/:id/comments/:commentId", requireAdmin, (req, res) => {
  const album = readGuestAlbum();
  const post = album.posts.find((item) => item.id === req.params.id);
  if (!post) return res.status(404).json({ error: "Not found" });
  const before = (post.comments || []).length;
  post.comments = (post.comments || []).filter((comment) => comment.id !== req.params.commentId);
  if (post.comments.length === before) return res.status(404).json({ error: "Comment not found" });
  writeGuestAlbum(album);
  res.json(publicGuestPost(post, "", { includeName: true }));
});

async function removeGuestPosts(ids) {
  const wanted = new Set(ids.map((id) => String(id)));
  const album = readGuestAlbum();
  const removed = [];
  album.posts = album.posts.filter((post) => {
    if (!wanted.has(String(post.id))) return true;
    removed.push(post);
    return false;
  });
  if (!removed.length) return [];
  writeGuestAlbum(album);
  for (const post of removed) {
    const filePath = safeGuestFile(post.src);
    if (filePath) {
      try { unlinkSync(filePath); } catch { /* ignore */ }
    }
    const driveId = post.driveId || driveIdFromSrc(post.src);
    if (driveId) {
      try { await driveAlbum.deleteFile(driveId); } catch (err) { console.error(err.message); }
    }
  }
  return removed;
}

app.post("/api/admin/guest-album/bulk-delete", requireAdmin, async (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map((id) => String(id)).filter(Boolean) : [];
  if (!ids.length) return res.status(400).json({ error: "Choose at least one photo to delete." });
  const removed = await removeGuestPosts(ids);
  if (!removed.length) return res.status(404).json({ error: "Those photos are no longer in the album." });
  res.json({ ok: true, deleted: removed.length });
});

app.delete("/api/admin/guest-album/:id", requireAdmin, async (req, res) => {
  const removed = await removeGuestPosts([req.params.id]);
  if (!removed.length) return res.status(404).json({ error: "Not found" });
  res.json({ ok: true });
});

app.get("/api/admin/guest-album/download", requireAdmin, async (_req, res) => {
  const album = readGuestAlbum();
  const dir = mkdtempSync(join(tmpdir(), "guest-album-"));
  const zipPath = join(tmpdir(), `guest-album-${Date.now()}.zip`);
  try {
    const rows = [["Album", "Name", "Caption", "Type", "File", "Hearts", "Hahas", "Posted"]];
    const used = new Set();
    for (const post of sortedGuestPosts(album.posts)) {
      const label = GUEST_ALBUM_LABEL;
      const folder = join(dir, label);
      const fileName = await writeGuestFile(post, folder, used, false);
      rows.push([
        label,
        post.name || "",
        post.caption || "",
        post.type || "photo",
        fileName,
        String((post.hearts || []).length),
        String((post.laughs || []).length),
        post.createdAt || "",
      ]);
    }
    const csv = rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")).join("\n");
    writeFileSync(join(dir, "guest-album.csv"), csv);
    await new Promise((resolvePromise, reject) => {
      const child = spawn("zip", ["-r", "-q", zipPath, "."], { cwd: dir });
      child.on("error", reject);
      child.on("close", (code) => (code === 0 ? resolvePromise() : reject(new Error("Could not package the album"))));
    });
    res.download(zipPath, "gio-augiela-guest-album.zip", () => {
      rmSync(dir, { recursive: true, force: true });
      rmSync(zipPath, { force: true });
    });
  } catch (err) {
    rmSync(dir, { recursive: true, force: true });
    rmSync(zipPath, { force: true });
    console.error(err);
    if (!res.headersSent) res.status(500).json({ error: "Could not package the album" });
  }
});

app.get("/api/admin/drive", requireAdmin, (req, res) => {
  res.json(driveAlbum.status(req));
});

app.get("/api/admin/drive/connect", (req, res) => {
  if (!sessions.has(getSessionToken(req))) return res.redirect("/admin/");
  try {
    res.redirect(driveAlbum.authUrl(req));
  } catch (err) {
    const uri = driveAlbum.redirectUri(req);
    res.status(400).type("html").send(
      "<!doctype html><meta charset=\"utf-8\"><title>Connect Google Drive</title>" +
      "<body style=\"font-family:Georgia,serif;padding:2rem;max-width:38rem;line-height:1.5\">" +
      "<h1>Connect Google Drive</h1>" +
      "<p>The Google client is not ready yet. Add the client id and secret, then open this page again.</p>" +
      "<p>In Google Cloud, use this redirect URI:</p>" +
      `<p><code>${uri.replace(/[&<>"]/g, "")}</code></p>` +
      "<p><a href=\"/admin/\">Back to admin</a></p></body>"
    );
  }
});

app.get("/api/admin/drive/callback", async (req, res) => {
  if (req.query.error) return res.redirect("/admin/?drive=error");
  try {
    await driveAlbum.finishAuth(req);
    let added = 0;
    let total = 0;
    try {
      await restoreWeddingRecords();
      const sync = await syncGuestAlbumFromDrive();
      added = sync.added || 0;
      total = sync.total || 0;
    } catch (err) {
      console.error("Drive album sync failed:", err.detail || err.message);
    }
    res.redirect(`/admin/?drive=connected&driveAdded=${added}&driveTotal=${total}`);
  } catch (err) {
    console.error("Drive connect failed:", err.detail || err.message);
    res.redirect("/admin/?drive=error");
  }
});

app.post("/api/admin/drive/disconnect", requireAdmin, (_req, res) => {
  driveAlbum.disconnect();
  res.json({ ok: true });
});

app.get("/api/admin/backup", requireAdmin, (_req, res) => {
  const bundle = readBackupBundle();
  const stamp = String(bundle.savedAt).slice(0, 10);
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="wedding-backup-${stamp}.json"`);
  res.send(JSON.stringify(bundle, null, 2));
});

app.post("/api/admin/backup", requireAdmin, (req, res) => {
  backupUpload.single("file")(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message || "Please upload the backup file." });
    if (!req.file?.buffer) return res.status(400).json({ error: "Choose the backup .json file." });
    let bundle;
    try {
      bundle = JSON.parse(req.file.buffer.toString("utf8"));
    } catch {
      return res.status(400).json({ error: "That file could not be read as a backup." });
    }
    try {
      res.json(applyBackupBundle(bundle));
    } catch (error) {
      res.status(error.status || 400).json({ error: error.message || "The backup could not be restored." });
    }
  });
});

app.post("/api/admin/backup/restore-drive", requireAdmin, async (_req, res) => {
  if (!driveAlbum.connected()) {
    return res.status(400).json({ error: "Connect Google Drive first, or upload a backup file." });
  }
  try {
    const bundle = await driveAlbum.loadJsonRecord("wedding-backup.json");
    if (!bundle) return res.status(404).json({ error: "There is no backup in Google Drive yet. Download one and keep it, or change the site while Drive is connected." });
    res.json(applyBackupBundle(bundle));
  } catch (err) {
    console.error("Drive backup restore failed:", err.detail || err.message);
    res.status(502).json({ error: "The Google Drive backup could not be restored." });
  }
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(400).json({ error: err.message || "Request failed" });
});

async function restoreWeddingRecords() {
  if (!driveAlbum.connected()) {
    console.log("Google Drive is not connected on this disk. Add GOOGLE_REFRESH_TOKEN on the host so a restart can bring the RSVPs back.");
    return;
  }
  const work = (async () => {
    let bundle = null;
    try {
      bundle = await driveAlbum.loadJsonRecord("wedding-backup.json");
    } catch (err) {
      console.error("Could not read the Drive backup", err.detail || err.message);
    }
    const fromBundle = bundle && bundle.kind === "augiela-gio-wedding-backup" ? {
      "content.json": bundle.content,
      "gallery.json": bundle.gallery,
      "guests.json": bundle.guests,
      "rsvps.json": bundle.rsvps,
      "guest-album.json": bundle.guestAlbum,
    } : {};
    try {
      const directRsvps = await driveAlbum.loadJsonRecord("rsvps.json");
      if (Array.isArray(directRsvps)) fromBundle["rsvps.json"] = directRsvps;
    } catch (err) {
      console.error("Could not read RSVPs from Google Drive", err.detail || err.message);
    }
    const stamp = readLiveStamp();
    const driveSavedAt = String(bundle?.savedAt || "");
    const freshDisk = !stamp && !existsSync(join(DATA_DIR, "rsvps.json")) && !existsSync(join(DATA_DIR, "guest-album.json"));
    const driveIsNewer = Boolean(driveSavedAt && stamp && driveSavedAt > stamp);
    for (const name of BACKUP_FILES) {
      const path = join(DATA_DIR, name);
      const missing = !existsSync(path);
      if (!missing && !freshDisk && !driveIsNewer) continue;
      const data = fromBundle[name];
      if (data == null) continue;
      const tmp = `${path}.tmp`;
      writeFileSync(tmp, JSON.stringify(data, null, 2));
      renameSync(tmp, path);
      console.log("Restored", name, "from Google Drive");
    }
    if (driveSavedAt && (freshDisk || driveIsNewer)) writeLiveStamp(driveSavedAt);
    try {
      await syncGuestAlbumFromDrive();
    } catch (err) {
      console.error("Guest album sync after restore failed:", err.detail || err.message);
    }
    await scheduleRecordBackup();
  })();
  await Promise.race([work, new Promise((resolve) => setTimeout(resolve, 20000))]);
}

function shutDownAfterBackup() {
  const pending = backupRunning || Promise.resolve();
  Promise.race([
    pending.then(() => (backupQueued ? flushRecordBackup() : null)),
    new Promise((resolve) => setTimeout(resolve, 4000)),
  ]).finally(() => process.exit(0));
}

process.once("SIGTERM", shutDownAfterBackup);
process.once("SIGINT", shutDownAfterBackup);

restoreWeddingRecords().finally(() => {
  app.listen(PORT, HOST, () => {
    console.log(`Wedding invitation server running at http://${HOST}:${PORT}`);
    console.log(`Local preview: http://127.0.0.1:${PORT}`);
    console.log(`Admin dashboard: http://127.0.0.1:${PORT}/admin/`);
  });
});
