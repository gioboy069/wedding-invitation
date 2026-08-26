import express from "express";
import multer from "multer";
import cookieParser from "cookie-parser";
import { randomBytes, timingSafeEqual, scryptSync, createHash } from "crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from "fs";
import { join, dirname, extname } from "path";
import { fileURLToPath } from "url";

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
    console.error("Admin reset email failed:", emailRes.status, body);
    return false;
  }
  return true;
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
  writeFileSync(join(DATA_DIR, name), JSON.stringify(data, null, 2));
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

const upload = multer({
  storage,
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (/^image\/(jpeg|png|webp|gif)$/.test(file.mimetype)) cb(null, true);
    else cb(new Error("Only image uploads are allowed"));
  },
});

const app = express();
app.set("trust proxy", 1);
app.use(express.json({ limit: "2mb" }));
app.use(cookieParser());

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
app.use(["/data", "/server.js", "/package.json", "/package-lock.json", "/.git", "/.env"], (_req, res) => {
  res.status(404).end();
});


// Force download of project ZIP (avoids preview proxy hang on static zip)
app.get(["/download", "/download.zip"], (_req, res) => {
  const zipPath = join(ROOT, "augiela-gio-wedding-invitation.zip");
  if (!existsSync(zipPath)) return res.status(404).send("ZIP not found");
  res.download(zipPath, "augiela-gio-wedding-invitation.zip");
});

app.use("/uploads", express.static(UPLOAD_DIR));

// Admin dashboard — explicit routes so /admin and /admin/ always work on Render
const adminIndex = join(ROOT, "admin", "index.html");
app.get(["/admin", "/admin/"], (_req, res) => {
  if (!existsSync(adminIndex)) {
    return res.status(404).type("text").send(
      "Admin page not found. Make sure the admin/index.html folder was uploaded to your GitHub repo, then redeploy on Render."
    );
  }
  res.sendFile(adminIndex);
});
app.use("/admin", express.static(join(ROOT, "admin")));

app.use(express.static(ROOT, {
  index: "index.html",
  extensions: ["html"],
}));

// ── Public API ──

app.get("/api/content", (_req, res) => {
  res.json(rewriteDriveUrlsInContent(readJson("content.json", {})));
});

app.get("/api/gallery", (_req, res) => {
  const gallery = readJson("gallery.json", []);
  res.json(
    gallery.map((item) => ({
      ...item,
      src: normalizeImageUrl(item.src || item.url || ""),
    }))
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
    guestId: matchedGuest ? matchedGuest.id : null,
    guestMatched: !!matchedGuest,
    submittedAt: new Date().toISOString(),
  };

  try {
    rsvps.push(entry);
    writeJson("rsvps.json", rsvps);
  } catch (err) {
    console.error("Failed to save RSVP locally:", err);
  }

  let emailed = false;
  try {
    const emailRes = await fetch(`https://formsubmit.co/ajax/${encodeURIComponent(RSVP_EMAIL)}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        name: entry.name,
        firstName: entry.firstName,
        surname: entry.surname,
        attendance: entry.attendance === "attending" ? "Joyfully Accepts" : "Regretfully Declines",
        partySize: entry.partySize,
        companions: companionList.length ? companionList.map((c) => c.name).join(", ") : "(none)",
        message: entry.message || "(no message)",
        guestMatched: entry.guestMatched ? "Yes" : "No",
        submittedAt: entry.submittedAt,
        _subject: `Wedding RSVP: ${entry.name} — ${entry.attendance}`,
        _template: "table",
        _captcha: "false",
      }),
    });
    emailed = emailRes.ok;
    if (!emailed) {
      const body = await emailRes.text();
      console.error("RSVP email failed:", emailRes.status, body);
    }
  } catch (err) {
    console.error("RSVP email error:", err);
  }

  res.status(201).json({ ok: true, id: entry.id, emailed });
});

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

function parseCompanion(value) {
  if (value && typeof value === "object") {
    return parsePersonName(value.name, value.firstName, value.surname);
  }
  return parsePersonName(String(value || ""));
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
    return res.json({
      matched: !!guest,
      alreadySubmitted: true,
      guest: guest
        ? {
            id: guest.id,
            name: guest.name,
            firstName: guest.firstName,
            surname: guest.surname,
            allocation: Math.min(10, Math.max(1, Number(guest.allocation) || 1)),
            maxCompanions: Math.max(0, Math.min(10, Math.max(1, Number(guest.allocation) || 1)) - 1),
          }
        : null,
    });
  }
  if (!guest) return res.json({ matched: false, alreadySubmitted: false });
  const allocation = Math.min(10, Math.max(1, Number(guest.allocation) || 1));
  res.json({
    matched: true,
    alreadySubmitted: false,
    guest: {
      id: guest.id,
      name: guest.name,
      firstName: guest.firstName,
      surname: guest.surname,
      allocation,
      maxCompanions: Math.max(0, allocation - 1),
    },
  });
});

// ── Admin guest list ──

app.get("/api/admin/guests", requireAdmin, (_req, res) => {
  res.json(readJson("guests.json", []).map(hydratePerson));
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

  const item = {
    id: `guest-${Date.now()}-${randomBytes(3).toString("hex")}`,
    name: person.name,
    firstName: person.firstName,
    surname: person.surname,
    allocation,
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

  guests[idx] = {
    ...guests[idx],
    name: person.name,
    firstName: person.firstName,
    surname: person.surname,
    allocation,
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

app.post("/api/admin/login", (req, res) => {
  const { password } = req.body || {};
  if (!verifyPassword(password || "")) {
    return res.status(401).json({ error: "Invalid password." });
  }
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
  if (!emailed) {
    console.log("Admin password reset link (email delivery failed):", resetUrl);
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

  writeJson("content.json", content);
  res.json({ ok: true, content });
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

// Proxy Google Drive images so they display reliably in <img> tags
app.get("/api/media/drive/:id", async (req, res) => {
  const id = String(req.params.id || "").trim();
  if (!/^[a-zA-Z0-9_-]{10,}$/.test(id)) {
    return res.status(400).type("text").send("Invalid Drive file id");
  }

  const candidates = [
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
          Accept: "image/*,*/*;q=0.8",
        },
      });
      if (!upstream.ok) continue;

      const contentType = (upstream.headers.get("content-type") || "").toLowerCase();
      const buffer = Buffer.from(await upstream.arrayBuffer());
      if (!buffer.length) continue;

      // Skip HTML virus-scan / login interstitial pages
      const looksHtml =
        contentType.includes("text/html") ||
        buffer.slice(0, 32).toString("utf8").trim().toLowerCase().startsWith("<!doctype") ||
        buffer.slice(0, 32).toString("utf8").trim().toLowerCase().startsWith("<html");
      if (looksHtml) continue;

      const isImage =
        contentType.startsWith("image/") ||
        contentType.includes("octet-stream") ||
        contentType.includes("application/binary");
      if (!isImage && contentType) continue;

      res.setHeader(
        "Content-Type",
        contentType.startsWith("image/") ? contentType.split(";")[0] : "image/jpeg"
      );
      res.setHeader("Cache-Control", "public, max-age=86400, stale-while-revalidate=604800");
      return res.send(buffer);
    } catch (err) {
      console.error("Drive proxy fetch failed:", url, err.message);
    }
  }

  return res.status(404).type("text").send("Drive image unavailable. Check sharing is set to Anyone with the link.");
});

app.post("/api/admin/gallery", requireAdmin, upload.single("photo"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Photo file is required" });

  const gallery = readJson("gallery.json", []);
  const item = {
    id: `g-${Date.now()}`,
    src: `/uploads/${req.file.filename}`,
    caption: String(req.body.caption || "").trim() || "Untitled",
    alt: String(req.body.alt || req.body.caption || "Prenup photo").trim(),
    source: "upload",
  };
  gallery.unshift(item);
  writeJson("gallery.json", gallery);
  res.status(201).json(item);
});

app.post("/api/admin/gallery/url", requireAdmin, (req, res) => {
  const src = normalizeImageUrl(req.body?.url || req.body?.src);
  if (!src) return res.status(400).json({ error: "Image URL is required" });
  if (!/^https?:\/\//i.test(src)) {
    return res.status(400).json({ error: "URL must start with http:// or https://" });
  }

  const gallery = readJson("gallery.json", []);
  const item = {
    id: `g-${Date.now()}`,
    src,
    caption: String(req.body.caption || "").trim() || "Untitled",
    alt: String(req.body.alt || req.body.caption || "Prenup photo").trim(),
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
  if (req.body.url !== undefined || req.body.src !== undefined) {
    const next = normalizeImageUrl(req.body.url || req.body.src);
    if (!next) return res.status(400).json({ error: "Image URL is required" });
    gallery[idx].src = next;
    gallery[idx].source = "url";
  }
  writeJson("gallery.json", gallery);
  res.json(gallery[idx]);
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

app.put("/api/admin/rsvps/:id", requireAdmin, (req, res) => {
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
  res.json({ ...next, guestListUpdated });
});

app.delete("/api/admin/rsvps/:id", requireAdmin, (req, res) => {
  const rsvps = readJson("rsvps.json", []);
  const next = rsvps.filter((r) => r.id !== req.params.id);
  if (next.length === rsvps.length) return res.status(404).json({ error: "Not found" });
  writeJson("rsvps.json", next);
  res.json({ ok: true });
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(400).json({ error: err.message || "Request failed" });
});

app.listen(PORT, HOST, () => {
  console.log(`Wedding invitation server running at http://${HOST}:${PORT}`);
  console.log(`Local preview: http://127.0.0.1:${PORT}`);
  console.log(`Admin dashboard: http://127.0.0.1:${PORT}/admin/`);
});
