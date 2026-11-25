import { spawn } from "child_process";
import { existsSync, renameSync, statSync, unlinkSync } from "fs";
import { basename, dirname, join } from "path";
import sharp from "sharp";
import ffmpegStatic from "ffmpeg-static";
import ffprobeStatic from "ffprobe-static";

sharp.cache(false);
sharp.concurrency(1);

const PHOTO_MAX = 2048;
const PHOTO_JPEG_QUALITY = 82;
const VIDEO_MAX = 1280;
const VIDEO_CRF = "28";
const VIDEO_MAX_SECONDS = 60;

let toolsPromise;

function run(command, args, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, MALLOC_ARENA_MAX: "2" },
    });
    const chunks = [];
    const collect = (buf) => {
      chunks.push(buf);
      let size = chunks.reduce((sum, part) => sum + part.length, 0);
      while (size > 8000 && chunks.length) {
        size -= chunks[0].length;
        chunks.shift();
      }
    };
    let killed = false;
    let settled = false;
    const timer = setTimeout(() => {
      killed = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    child.on("error", (err) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      if (killed) {
        reject(new Error("That video took too long to prepare on this small server. Try a shorter clip."));
        return;
      }
      const output = Buffer.concat(chunks).toString("utf8");
      if (code === 0) resolve(output);
      else reject(new Error(output.trim().slice(-500) || `${command} failed`));
    });
  });
}

async function mediaTools() {
  if (!toolsPromise) {
    toolsPromise = (async () => {
      try {
        await run("ffmpeg", ["-version"]);
        await run("ffprobe", ["-version"]);
        return { ffmpeg: "ffmpeg", ffprobe: "ffprobe" };
      } catch {
        if (ffmpegStatic && ffprobeStatic?.path && existsSync(ffmpegStatic) && existsSync(ffprobeStatic.path)) {
          return { ffmpeg: ffmpegStatic, ffprobe: ffprobeStatic.path };
        }
        return null;
      }
    })();
  }
  return toolsPromise;
}

function replaceFile(file, nextPath, mime, ext) {
  const size = statSync(nextPath).size;
  const dest = join(dirname(file.path), `${basename(file.path, "." + basename(file.path).split(".").pop())}${ext}`);
  if (existsSync(dest) && dest !== nextPath) unlinkSync(dest);
  if (dest !== nextPath) renameSync(nextPath, dest);
  if (file.path !== dest && existsSync(file.path)) unlinkSync(file.path);
  file.path = dest;
  file.filename = basename(dest);
  file.mimetype = mime;
  file.size = size;
  const stem = String(file.originalname || "upload").replace(/\.[^.]+$/, "") || "upload";
  file.originalname = `${stem}${ext}`;
  return file;
}

async function prepareImage(file) {
  const mime = String(file.mimetype || "").toLowerCase();
  if (mime === "image/gif") return file;
  const meta = await sharp(file.path, { failOn: "none", limitInputPixels: 80_000_000, sequentialRead: true }).metadata();
  const oriented = !meta.orientation || meta.orientation === 1;
  const sized = (meta.width || 0) > 0 && meta.width <= PHOTO_MAX && (meta.height || 0) <= PHOTO_MAX;
  if (mime === "image/jpeg" && oriented && sized) return file;
  const input = sharp(file.path, { failOn: "none", animated: false, limitInputPixels: 80_000_000, sequentialRead: true }).rotate();
  const before = statSync(file.path).size;
  const needsResize = (meta.width || 0) > PHOTO_MAX || (meta.height || 0) > PHOTO_MAX;
  let pipeline = input.resize({
    width: PHOTO_MAX,
    height: PHOTO_MAX,
    fit: "inside",
    withoutEnlargement: true,
  });
  const keepPng = mime === "image/png" && meta.hasAlpha;
  const ext = keepPng ? ".png" : ".jpg";
  const mimeOut = keepPng ? "image/png" : "image/jpeg";
  pipeline = keepPng
    ? pipeline.png({ compressionLevel: 6 })
    : pipeline.jpeg({ quality: PHOTO_JPEG_QUALITY, mozjpeg: false });
  const nextPath = `${file.path}.prep${ext}`;
  await pipeline.toFile(nextPath);
  const after = statSync(nextPath).size;
  if (!needsResize && after >= before) {
    unlinkSync(nextPath);
    return file;
  }
  return replaceFile(file, nextPath, mimeOut, ext);
}

async function probe(ffprobe, filePath) {
  const raw = await run(ffprobe, [
    "-v", "error",
    "-print_format", "json",
    "-show_streams",
    "-show_format",
    filePath,
  ]);
  return JSON.parse(raw);
}

function videoPlan(info) {
  const streams = Array.isArray(info.streams) ? info.streams : [];
  const video = streams.find((stream) => stream.codec_type === "video");
  if (!video) return null;
  const audio = streams.find((stream) => stream.codec_type === "audio");
  const width = Number(video.width) || 0;
  const height = Number(video.height) || 0;
  const longEdge = Math.max(width, height);
  const bitrate = Number(info.format?.bit_rate) || 0;
  const codec = String(video.codec_name || "");
  const audioCodec = audio ? String(audio.codec_name || "") : "";
  const readyVideo = codec === "h264" || codec === "vp8" || codec === "vp9" || codec === "av1";
  const readyAudio = !audio || audioCodec === "aac" || audioCodec === "mp3" || audioCodec === "opus";
  const compact = longEdge > 0 && longEdge <= VIDEO_MAX && bitrate > 0 && bitrate <= 8_000_000;
  if (readyVideo && readyAudio && compact && codec === "h264") return { action: "skip", audio: Boolean(audio) };
  if (codec === "h264" && readyAudio && compact) return { action: "remux", audio: Boolean(audio) };
  return { action: "transcode", audio: Boolean(audio) };
}

async function prepareVideo(file) {
  const tools = await mediaTools();
  if (!tools) return file;
  const info = await probe(tools.ffprobe, file.path);
  const duration = Number(info.format?.duration) || 0;
  if (duration > VIDEO_MAX_SECONDS + 0.4) {
    const error = new Error("Videos can be up to 1 minute. Choose a shorter clip.");
    error.code = "too_long";
    throw error;
  }
  const plan = videoPlan(info);
  if (!plan || plan.action === "skip") return file;
  const before = statSync(file.path).size;
  const nextPath = `${file.path}.prep.mp4`;
  const scale = "scale=w='min(1280,iw)':h='min(1280,ih)':force_original_aspect_ratio=decrease,scale=trunc(iw/2)*2:trunc(ih/2)*2";
  const args = ["-y", "-threads", "1", "-i", file.path];
  if (plan.action === "remux") {
    args.push("-c", "copy", "-movflags", "+faststart", nextPath);
  } else {
    args.push(
      "-vf", scale,
      "-c:v", "libx264",
      "-preset", "ultrafast",
      "-threads", "1",
      "-filter_threads", "1",
      "-crf", VIDEO_CRF,
      "-pix_fmt", "yuv420p",
      "-movflags", "+faststart"
    );
    if (plan.audio) args.push("-c:a", "aac", "-b:a", "160k");
    else args.push("-an");
    args.push(nextPath);
  }
  try {
    await run(tools.ffmpeg, args, 90_000);
  } catch (err) {
    try { unlinkSync(nextPath); } catch { /* ignore */ }
    throw err;
  }
  const after = statSync(nextPath).size;
  if (plan.action === "transcode" && after >= before) {
    unlinkSync(nextPath);
    return file;
  }
  return replaceFile(file, nextPath, "video/mp4", ".mp4");
}

async function prepareUploadNow(file) {
  if (!file?.path || !existsSync(file.path)) return file;
  const mime = String(file.mimetype || "").toLowerCase();
  try {
    if (mime.startsWith("image/")) return await prepareImage(file);
    if (mime.startsWith("video/")) return await prepareVideo(file);
  } catch (err) {
    if (err.code === "too_long") throw err;
    console.error("Upload kept at original quality:", err.message);
  }
  return file;
}

let prepareChain = Promise.resolve();

export function prepareUpload(file) {
  const runJob = prepareChain.then(() => prepareUploadNow(file), () => prepareUploadNow(file));
  prepareChain = runJob.then(() => {}, () => {});
  return runJob;
}
