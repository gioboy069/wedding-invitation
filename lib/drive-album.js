import { readFileSync, writeFileSync, existsSync, unlinkSync, createReadStream, statSync } from "fs";
import { join, extname } from "path";
import { randomBytes } from "crypto";

const TOKEN_FILE = "drive-token.json";
const ROOT_FOLDER_NAME = "Augiela & Gio — Guest album";
const ALBUM_LABELS = {
  main: "Guest album",
};
const SCOPES = [
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/userinfo.email",
].join(" ");

function credentials() {
  const clientId = String(process.env.GOOGLE_CLIENT_ID || "").trim();
  const clientSecret = String(process.env.GOOGLE_CLIENT_SECRET || "").trim();
  return { clientId, clientSecret, configured: Boolean(clientId && clientSecret) };
}

function safeDriveName(value, fallback) {
  const cleaned = String(value || "")
    .replace(/[\\/:*?"<>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return cleaned || fallback;
}

export function createDriveAlbum({ dataDir, publicBaseUrl }) {
  const tokenPath = join(dataDir, TOKEN_FILE);
  const pendingStates = new Map();
  let accessCache = { token: "", expires: 0 };

  function readToken() {
    if (!existsSync(tokenPath)) return {};
    try {
      return JSON.parse(readFileSync(tokenPath, "utf8"));
    } catch {
      return {};
    }
  }

  function writeToken(token) {
    writeFileSync(tokenPath, JSON.stringify(token, null, 2));
    accessCache = { token: "", expires: 0 };
  }

  function redirectUri(req) {
    const pinned = String(process.env.GOOGLE_REDIRECT_URI || "").trim();
    if (pinned) return pinned;
    return `${publicBaseUrl(req)}/api/admin/drive/callback`;
  }

  function status(req) {
    const creds = credentials();
    const saved = readToken();
    const connected = Boolean(saved.refreshToken);
    return {
      configured: creds.configured,
      connected,
      email: connected ? saved.email || "" : "",
      folderUrl: connected && saved.rootFolderId
        ? `https://drive.google.com/drive/folders/${saved.rootFolderId}`
        : "",
      redirectUri: req ? redirectUri(req) : "",
    };
  }

  function authUrl(req) {
    const creds = credentials();
    if (!creds.configured) {
      const error = new Error("Google Drive credentials are not set yet.");
      error.code = "not_configured";
      throw error;
    }
    const state = randomBytes(24).toString("hex");
    pendingStates.set(state, Date.now());
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.searchParams.set("client_id", creds.clientId);
    url.searchParams.set("redirect_uri", redirectUri(req));
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", SCOPES);
    url.searchParams.set("access_type", "offline");
    url.searchParams.set("prompt", "consent");
    url.searchParams.set("include_granted_scopes", "true");
    url.searchParams.set("state", state);
    return url.toString();
  }

  async function exchange(body) {
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(body),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error("Google Drive could not be authorized.");
      error.detail = data.error_description || data.error || response.status;
      throw error;
    }
    return data;
  }

  async function finishAuth(req) {
    const creds = credentials();
    const state = String(req.query.state || "");
    const started = pendingStates.get(state);
    pendingStates.delete(state);
    if (!started || Date.now() - started > 10 * 60 * 1000) {
      throw new Error("That Google connection expired. Start it again from the admin page.");
    }
    const code = String(req.query.code || "");
    if (!code) throw new Error("Google did not return a connection code.");
    const token = await exchange({
      code,
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      redirect_uri: redirectUri(req),
      grant_type: "authorization_code",
    });
    if (!token.refresh_token) {
      throw new Error("Google did not grant a lasting connection. Disconnect the app in your Google account and connect again.");
    }
    accessCache = {
      token: token.access_token,
      expires: Date.now() + (Number(token.expires_in) || 3600) * 1000,
    };
    let email = "";
    try {
      const profile = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
        headers: { Authorization: `Bearer ${token.access_token}` },
      });
      const profileJson = await profile.json().catch(() => ({}));
      email = String(profileJson.email || "");
    } catch {
      email = "";
    }
    const saved = {
      refreshToken: token.refresh_token,
      email,
      rootFolderId: "",
      albums: {},
    };
    writeToken(saved);
    await ensureFolders();
    return status(req);
  }

  function disconnect() {
    accessCache = { token: "", expires: 0 };
    if (existsSync(tokenPath)) unlinkSync(tokenPath);
  }

  function connected() {
    return Boolean(readToken().refreshToken);
  }

  async function accessToken() {
    if (accessCache.token && Date.now() < accessCache.expires - 30000) return accessCache.token;
    const saved = readToken();
    const creds = credentials();
    if (!creds.configured) {
      const error = new Error("Google Drive credentials are not set yet.");
      error.code = "not_configured";
      throw error;
    }
    if (!saved.refreshToken) {
      const error = new Error("Google Drive is not connected yet.");
      error.code = "not_connected";
      throw error;
    }
    const token = await exchange({
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      refresh_token: saved.refreshToken,
      grant_type: "refresh_token",
    });
    accessCache = {
      token: token.access_token,
      expires: Date.now() + (Number(token.expires_in) || 3600) * 1000,
    };
    return accessCache.token;
  }

  async function driveFetch(url, options = {}) {
    const token = await accessToken();
    const headers = { ...(options.headers || {}), Authorization: `Bearer ${token}` };
    const response = await fetch(url, { ...options, headers });
    return response;
  }

  async function findFolder(name, parentId) {
    const escaped = name.replace(/'/g, "\\'");
    const parent = parentId ? `'${parentId}' in parents` : "'root' in parents";
    const q = `mimeType='application/vnd.google-apps.folder' and name='${escaped}' and ${parent} and trashed=false`;
    const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)&spaces=drive&pageSize=5`;
    const response = await driveFetch(url);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return "";
    return data.files && data.files[0] ? data.files[0].id : "";
  }

  async function findFile(name, parentId) {
    const escaped = name.replace(/'/g, "\\'");
    const q = `name='${escaped}' and '${parentId}' in parents and trashed=false`;
    const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)&spaces=drive&pageSize=5`;
    const response = await driveFetch(url);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return "";
    return data.files && data.files[0] ? data.files[0].id : "";
  }

  async function ensureRecordsFolder() {
    const folders = await ensureFolders();
    const saved = readToken();
    let recordsId = saved.recordsFolderId || "";
    if (recordsId) {
      const check = await driveFetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(recordsId)}?fields=id,trashed`);
      const info = await check.json().catch(() => ({}));
      if (!check.ok || info.trashed) recordsId = "";
    }
    if (!recordsId) {
      recordsId = await findFolder("Wedding records", folders.rootId) || await createFolder("Wedding records", folders.rootId);
      writeToken({ ...readToken(), recordsFolderId: recordsId });
    }
    return recordsId;
  }

  async function saveJsonRecord(name, data) {
    if (!connected()) return;
    const parentId = await ensureRecordsFolder();
    const body = JSON.stringify(data);
    let fileId = await findFile(name, parentId);
    if (!fileId) {
      const created = await driveFetch("https://www.googleapis.com/drive/v3/files?fields=id", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          mimeType: "application/json",
          parents: [parentId],
        }),
      });
      const createdJson = await created.json().catch(() => ({}));
      if (!created.ok || !createdJson.id) throw new Error("Google Drive could not store the wedding records.");
      fileId = createdJson.id;
    }
    const saved = await driveFetch(`https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(fileId)}?uploadType=media`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body,
    });
    if (!saved.ok) throw new Error("Google Drive could not update the wedding records.");
  }

  async function loadJsonRecord(name) {
    if (!connected()) return null;
    const parentId = await ensureRecordsFolder();
    const fileId = await findFile(name, parentId);
    if (!fileId) return null;
    const file = await downloadFile(fileId);
    if (!file) return null;
    try {
      return JSON.parse(file.buffer.toString("utf8"));
    } catch {
      return null;
    }
  }

  async function createFolder(name, parentId) {
    const response = await driveFetch("https://www.googleapis.com/drive/v3/files?fields=id", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        mimeType: "application/vnd.google-apps.folder",
        parents: parentId ? [parentId] : undefined,
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.id) {
      throw new Error("Google Drive could not create the album folder.");
    }
    return data.id;
  }

  async function ensureFolders() {
    const saved = readToken();
    if (!saved.refreshToken) {
      const error = new Error("Google Drive is not connected yet.");
      error.code = "not_connected";
      throw error;
    }
    let rootId = saved.rootFolderId || "";
    if (rootId) {
      const check = await driveFetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(rootId)}?fields=id,trashed`);
      const info = await check.json().catch(() => ({}));
      if (!check.ok || info.trashed) rootId = "";
    }
    if (!rootId) {
      rootId = await findFolder(ROOT_FOLDER_NAME, "") || await createFolder(ROOT_FOLDER_NAME, "");
    }
    const albums = { ...(saved.albums || {}) };
    for (const [id, label] of Object.entries(ALBUM_LABELS)) {
      let folderId = albums[id] || "";
      if (folderId) {
        const check = await driveFetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(folderId)}?fields=id,trashed`);
        const info = await check.json().catch(() => ({}));
        if (!check.ok || info.trashed) folderId = "";
      }
      if (!folderId) {
        folderId = await findFolder(label, rootId) || await createFolder(label, rootId);
      }
      albums[id] = folderId;
    }
    writeToken({ ...saved, rootFolderId: rootId, albums });
    return { rootId, albums };
  }

  async function uploadGuestFile({ filePath, mimeType, originalName, guestName, caption, albumId }) {
    const folders = await ensureFolders();
    const parentId = folders.albums[albumId] || folders.rootId;
    const ext = extname(originalName || "").toLowerCase();
    const allowed = [".jpg", ".jpeg", ".png", ".webp", ".gif", ".mp4", ".webm", ".mov"];
    const safeExt = allowed.includes(ext) ? ext : (String(mimeType).startsWith("video/") ? ".mp4" : ".jpg");
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `${safeDriveName(guestName, "Guest")} ${stamp}${safeExt}`;
    const description = [guestName, caption].filter(Boolean).join(" — ").slice(0, 500);
    const size = statSync(filePath).size;
    const start = await driveFetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id", {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Type": mimeType || "application/octet-stream",
        "X-Upload-Content-Length": String(size),
      },
      body: JSON.stringify({ name: filename, description, parents: [parentId] }),
    });
    if (!start.ok) throw new Error("Google Drive could not start the upload.");
    const location = start.headers.get("location");
    if (!location) throw new Error("Google Drive did not accept the upload.");
    const put = await fetch(location, {
      method: "PUT",
      duplex: "half",
      headers: {
        "Content-Type": mimeType || "application/octet-stream",
        "Content-Length": String(size),
      },
      body: createReadStream(filePath),
    });
    const file = await put.json().catch(() => ({}));
    if (!put.ok || !file.id) throw new Error("Google Drive did not save the file.");
    const permission = await driveFetch(`https://www.googleapis.com/drive/v3/files/${file.id}/permissions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: "reader", type: "anyone" }),
    });
    if (!permission.ok) {
      console.error("Drive link sharing was not applied", permission.status);
    }
    return file.id;
  }

  async function deleteFile(fileId) {
    if (!fileId || !connected()) return;
    const response = await driveFetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`, {
      method: "DELETE",
    });
    if (!response.ok && response.status !== 404) {
      console.error("Drive delete failed", response.status);
    }
  }

  async function listChildren(parentId) {
    const files = [];
    let pageToken = "";
    do {
      const q = `'${parentId}' in parents and trashed=false and mimeType!='application/vnd.google-apps.folder'`;
      const url = new URL("https://www.googleapis.com/drive/v3/files");
      url.searchParams.set("q", q);
      url.searchParams.set("fields", "nextPageToken,files(id,name,mimeType,description,createdTime)");
      url.searchParams.set("pageSize", "100");
      url.searchParams.set("spaces", "drive");
      url.searchParams.set("orderBy", "createdTime desc");
      if (pageToken) url.searchParams.set("pageToken", pageToken);
      const response = await driveFetch(url);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const error = new Error("Google Drive could not list the album.");
        error.detail = data.error?.message || String(response.status);
        throw error;
      }
      files.push(...(data.files || []));
      pageToken = data.nextPageToken || "";
    } while (pageToken);
    return files;
  }

  async function listAlbumFiles() {
    const folders = await ensureFolders();
    const all = [];
    for (const [albumId, folderId] of Object.entries(folders.albums)) {
      if (!folderId) continue;
      const files = await listChildren(folderId);
      for (const file of files) all.push({ ...file, albumId });
    }
    return all;
  }

  async function downloadFile(fileId) {
    const response = await driveFetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`);
    if (!response.ok) return null;
    const contentType = response.headers.get("content-type") || "application/octet-stream";
    const buffer = Buffer.from(await response.arrayBuffer());
    if (!buffer.length) return null;
    return { buffer, contentType };
  }

  async function openFile(fileId, range) {
    const headers = {};
    if (range) headers.Range = String(range);
    const response = await driveFetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`,
      { headers }
    );
    if (response.ok || response.status === 206 || response.status === 416) return response;
    await response.body?.cancel?.();
    return null;
  }

  async function fetchThumbnail(fileId, width) {
    const size = Math.max(200, Math.min(1200, Number(width) || 720));
    const metaRes = await driveFetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=thumbnailLink,mimeType`
    );
    const meta = await metaRes.json().catch(() => ({}));
    if (!metaRes.ok || !meta.thumbnailLink) return null;
    const link = String(meta.thumbnailLink).replace(/=s\d+/, `=s${size}`);
    let imgRes = await fetch(link, { signal: AbortSignal.timeout(8000) }).catch(() => null);
    if (!imgRes || !imgRes.ok) {
      const token = await accessToken();
      imgRes = await fetch(link, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(8000),
      }).catch(() => null);
    }
    if (!imgRes || !imgRes.ok) return null;
    const contentType = (imgRes.headers.get("content-type") || "").toLowerCase();
    if (!contentType.startsWith("image/")) return null;
    const buffer = Buffer.from(await imgRes.arrayBuffer());
    if (buffer.length < 32) return null;
    return { buffer, contentType: contentType.split(";")[0] };
  }

  return {
    status,
    authUrl,
    finishAuth,
    disconnect,
    connected,
    configured: () => credentials().configured,
    uploadGuestFile,
    deleteFile,
    downloadFile,
    openFile,
    fetchThumbnail,
    listAlbumFiles,
    saveJsonRecord,
    loadJsonRecord,
    redirectUri,
  };
}
