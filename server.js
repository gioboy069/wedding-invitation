import express from "express";
import multer from "multer";
import cookieParser from "cookie-parser";
import { randomBytes, timingSafeEqual } from "crypto";
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

loadSessions();

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
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

function requireAdmin(req, res, next) {
  const token = req.cookies?.admin_session;
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
app.use(express.json({ limit: "2mb" }));
app.use(cookieParser());

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
  const { name, attendance, message, companions, guestId } = req.body || {};
  if (!name || !String(name).trim()) {
    return res.status(400).json({ error: "Name is required" });
  }
  if (!["attending", "declined"].includes(attendance)) {
    return res.status(400).json({ error: "Attendance must be attending or declined" });
  }

  const guests = readJson("guests.json", []);
  const normalizedName = normalizeGuestName(name);
  let matchedGuest = null;
  if (guestId) {
    matchedGuest = guests.find((g) => g.id === guestId) || null;
  }
  if (!matchedGuest) {
    matchedGuest = guests.find((g) => normalizeGuestName(g.name) === normalizedName) || null;
  }

  const allocation = matchedGuest
    ? Math.min(10, Math.max(1, Number(matchedGuest.allocation) || 1))
    : 1;
  const maxCompanions = Math.max(0, allocation - 1);
  const companionList = Array.isArray(companions)
    ? companions.map((c) => String(c || "").trim()).filter(Boolean).slice(0, maxCompanions)
    : [];

  const entry = {
    id: `rsvp-${Date.now()}-${randomBytes(3).toString("hex")}`,
    name: String(name).trim(),
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
    const rsvps = readJson("rsvps.json", []);
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
        attendance: entry.attendance === "attending" ? "Joyfully Accepts" : "Regretfully Declines",
        partySize: entry.partySize,
        companions: companionList.length ? companionList.join(", ") : "(none)",
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

// Public guest lookup for RSVP form (does not expose full list)
app.get("/api/guests/lookup", (req, res) => {
  const name = String(req.query.name || "").trim();
  if (!name || name.length < 2) {
    return res.json({ matched: false });
  }
  const guests = readJson("guests.json", []);
  const needle = normalizeGuestName(name);
  const guest = guests.find((g) => normalizeGuestName(g.name) === needle);
  if (!guest) return res.json({ matched: false });
  const allocation = Math.min(10, Math.max(1, Number(guest.allocation) || 1));
  res.json({
    matched: true,
    guest: {
      id: guest.id,
      name: guest.name,
      allocation,
      maxCompanions: Math.max(0, allocation - 1),
    },
  });
});

// ── Admin guest list ──

app.get("/api/admin/guests", requireAdmin, (_req, res) => {
  res.json(readJson("guests.json", []));
});

app.post("/api/admin/guests", requireAdmin, (req, res) => {
  const name = String(req.body?.name || "").trim();
  let allocation = Number(req.body?.allocation);
  if (!name) return res.status(400).json({ error: "Guest name is required" });
  if (!Number.isFinite(allocation)) allocation = 1;
  allocation = Math.min(10, Math.max(1, Math.round(allocation)));

  const guests = readJson("guests.json", []);
  const exists = guests.some((g) => normalizeGuestName(g.name) === normalizeGuestName(name));
  if (exists) return res.status(400).json({ error: "That guest is already on the list" });

  const item = {
    id: `guest-${Date.now()}-${randomBytes(3).toString("hex")}`,
    name,
    allocation,
  };
  guests.push(item);
  guests.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  writeJson("guests.json", guests);
  res.status(201).json(item);
});

app.put("/api/admin/guests/:id", requireAdmin, (req, res) => {
  const guests = readJson("guests.json", []);
  const idx = guests.findIndex((g) => g.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "Guest not found" });

  const name = String(req.body?.name ?? guests[idx].name).trim();
  let allocation = Number(req.body?.allocation ?? guests[idx].allocation);
  if (!name) return res.status(400).json({ error: "Guest name is required" });
  if (!Number.isFinite(allocation)) allocation = guests[idx].allocation || 1;
  allocation = Math.min(10, Math.max(1, Math.round(allocation)));

  const duplicate = guests.some(
    (g, i) => i !== idx && normalizeGuestName(g.name) === normalizeGuestName(name)
  );
  if (duplicate) return res.status(400).json({ error: "That guest is already on the list" });

  guests[idx] = { ...guests[idx], name, allocation };
  guests.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
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
  if (!safeEqual(password || "", ADMIN_PASSWORD)) {
    return res.status(401).json({ error: "Invalid password" });
  }
  const token = createToken();
  sessions.set(token, Date.now());
  persistSessions();
  res.cookie("admin_session", token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 1000 * 60 * 60 * 12,
  });
  res.json({ ok: true });
});

app.post("/api/admin/logout", (req, res) => {
  const token = req.cookies?.admin_session;
  if (token) sessions.delete(token);
  persistSessions();
  res.clearCookie("admin_session", { path: "/" });
  res.json({ ok: true });
});

app.get("/api/admin/me", (req, res) => {
  const token = req.cookies?.admin_session;
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
  const rsvps = readJson("rsvps.json", []);
  res.json(rsvps);
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
