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
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "augiela-gio-2027";
const RSVP_EMAIL = process.env.RSVP_EMAIL || "gomez.wed2027@gmail.com";

if (!existsSync(UPLOAD_DIR)) mkdirSync(UPLOAD_DIR, { recursive: true });
if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

const sessions = new Map();

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
  res.json(readJson("content.json", {}));
});

app.get("/api/gallery", (_req, res) => {
  res.json(readJson("gallery.json", []));
});

app.post("/api/rsvp", async (req, res) => {
  const { name, attendance, message } = req.body || {};
  if (!name || !String(name).trim()) {
    return res.status(400).json({ error: "Name is required" });
  }
  if (!["attending", "declined"].includes(attendance)) {
    return res.status(400).json({ error: "Attendance must be attending or declined" });
  }

  const entry = {
    id: `rsvp-${Date.now()}-${randomBytes(3).toString("hex")}`,
    name: String(name).trim(),
    attendance,
    message: String(message || "").trim(),
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
        message: entry.message || "(no message)",
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

// ── Admin auth ──

app.post("/api/admin/login", (req, res) => {
  const { password } = req.body || {};
  if (!safeEqual(password || "", ADMIN_PASSWORD)) {
    return res.status(401).json({ error: "Invalid password" });
  }
  const token = createToken();
  sessions.set(token, Date.now());
  res.cookie("admin_session", token, {
    httpOnly: true,
    sameSite: "lax",
    maxAge: 1000 * 60 * 60 * 12,
  });
  res.json({ ok: true });
});

app.post("/api/admin/logout", (req, res) => {
  const token = req.cookies?.admin_session;
  if (token) sessions.delete(token);
  res.clearCookie("admin_session");
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

  writeJson("content.json", content);
  res.json({ ok: true, content });
});

// ── Admin gallery ──

function normalizeImageUrl(raw) {
  const input = String(raw || "").trim();
  if (!input) return "";

  // Google Drive share links → direct view URL
  // https://drive.google.com/file/d/FILE_ID/view?...
  let match = input.match(/drive\.google\.com\/file\/d\/([^/]+)/i);
  if (match) {
    return `https://drive.google.com/uc?export=view&id=${match[1]}`;
  }

  // https://drive.google.com/open?id=FILE_ID
  match = input.match(/drive\.google\.com\/open\?id=([^&]+)/i);
  if (match) {
    return `https://drive.google.com/uc?export=view&id=${match[1]}`;
  }

  // https://drive.google.com/uc?id=FILE_ID or already uc?export=view&id=
  match = input.match(/[?&]id=([^&]+)/i);
  if (/drive\.google\.com/i.test(input) && match) {
    return `https://drive.google.com/uc?export=view&id=${match[1]}`;
  }

  return input;
}

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
