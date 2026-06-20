const fs = require("fs");
const path = require("path");
const cors = require("cors");
const multer = require("multer");
const express = require("express");
const dotenv = require("dotenv");
const ffmpeg = require("fluent-ffmpeg");
const ffmpegInstaller = require("@ffmpeg-installer/ffmpeg");
const { pipeline } = require("stream/promises");
const { Readable } = require("stream");
const { v4: uuidv4 } = require("uuid");
const { resolvePublicVideoUrl } = require("./services/linkResolver");
const { analyzeVideoStyle, hasModelConfig } = require("./services/visionModel");

dotenv.config();
ffmpeg.setFfmpegPath(process.env.FFMPEG_PATH || ffmpegInstaller.path);

const app = express();
const PORT = Number(process.env.PORT || 5174);
const PROJECT_ROOT = path.resolve(__dirname, "..");
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, "data");
const UPLOAD_DIR = path.join(DATA_DIR, "uploads");
const FRAMES_DIR = path.join(DATA_DIR, "frames");
const VIDEO_REGISTRY_FILE = path.join(DATA_DIR, "videos.json");
const MAX_UPLOAD_MB = Number(process.env.MAX_UPLOAD_MB || 800);
const videos = new Map();

for (const dir of [DATA_DIR, UPLOAD_DIR, FRAMES_DIR]) {
  fs.mkdirSync(dir, { recursive: true });
}

function isAllowedOrigin(origin) {
  if (!origin) return true;
  const configured = (process.env.CLIENT_ORIGIN || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  if (configured.length === 0) return true;
  if (configured.includes(origin)) return true;
  try {
    const host = new URL(origin).hostname;
    return configured.some((item) => item === "*.vercel.app" && host.endsWith(".vercel.app"));
  } catch {
    return false;
  }
}

app.use(
  cors({
    origin(origin, callback) {
      callback(null, isAllowedOrigin(origin));
    }
  })
);
app.use(express.json({ limit: "10mb" }));
app.use("/media", express.static(DATA_DIR));

const upload = multer({
  dest: UPLOAD_DIR,
  limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ["video/mp4", "video/quicktime", "application/octet-stream"];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(file.mimetype) || [".mp4", ".mov"].includes(ext)) cb(null, true);
    else cb(new Error("只支持 mp4 / mov 视频文件"));
  }
});

function publicUrlForVideo(fileName) {
  return `/media/uploads/${fileName}`;
}

function publicUrlForFrame(videoId, fileName) {
  return `/media/frames/${videoId}/${fileName}`;
}

function saveVideoRegistry() {
  const items = Array.from(videos.values()).map(({ id, fileName, originalName, source, path: filePath, url }) => ({
    id,
    fileName,
    originalName,
    source,
    path: filePath,
    url
  }));
  fs.writeFileSync(VIDEO_REGISTRY_FILE, JSON.stringify(items, null, 2), "utf8");
}

function loadVideoRegistry() {
  if (!fs.existsSync(VIDEO_REGISTRY_FILE)) return;
  try {
    const items = JSON.parse(fs.readFileSync(VIDEO_REGISTRY_FILE, "utf8"));
    for (const item of Array.isArray(items) ? items : []) {
      if (item?.id && item?.path && fs.existsSync(item.path)) {
        videos.set(item.id, item);
      }
    }
  } catch (error) {
    console.warn("Unable to load video registry:", error.message);
  }
}

function registerVideo({ filePath, originalName, source }) {
  const videoId = uuidv4();
  const ext = path.extname(originalName).toLowerCase() || ".mp4";
  const finalName = `${videoId}${ext}`;
  const finalPath = path.join(UPLOAD_DIR, finalName);
  fs.renameSync(filePath, finalPath);
  const video = {
    id: videoId,
    fileName: finalName,
    originalName,
    source,
    path: finalPath,
    url: publicUrlForVideo(finalName)
  };
  videos.set(videoId, video);
  saveVideoRegistry();
  return video;
}

function getVideoOrThrow(videoId) {
  const video = videos.get(videoId);
  if (!video || !fs.existsSync(video.path)) {
    const err = new Error("找不到视频，请重新上传");
    err.status = 404;
    throw err;
  }
  return video;
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function runFfmpegExtract(videoPath, frameDir, mode) {
  fs.rmSync(frameDir, { recursive: true, force: true });
  fs.mkdirSync(frameDir, { recursive: true });

  const outputPattern = path.join(frameDir, "frame-%04d.jpg");
  const filters = {
    "1s": "fps=1",
    "2s": "fps=1/2",
    scene: "select=gt(scene\\,0.35)"
  };
  const filter = filters[mode] || filters["1s"];
  const options =
    mode === "scene"
      ? ["-vf", filter, "-vsync", "vfr", "-q:v", "2"]
      : ["-vf", filter, "-q:v", "2"];

  return new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .outputOptions(options)
      .output(outputPattern)
      .on("end", resolve)
      .on("error", reject)
      .run();
  });
}

async function extractFrames(video, mode) {
  const frameDir = path.join(FRAMES_DIR, video.id);
  await runFfmpegExtract(video.path, frameDir, mode);
  let files = fs.readdirSync(frameDir).filter((name) => name.endsWith(".jpg")).sort();

  if (mode === "scene" && files.length === 0) {
    await runFfmpegExtract(video.path, frameDir, "2s");
    files = fs.readdirSync(frameDir).filter((name) => name.endsWith(".jpg")).sort();
  }

  return files.map((fileName, index) => ({
    id: `${video.id}-${fileName}`,
    videoId: video.id,
    fileName,
    index: index + 1,
    url: publicUrlForFrame(video.id, fileName)
  }));
}

loadVideoRegistry();

async function saveVideoResponse(response, sourceUrl, originalName) {
  const contentType = response.headers.get("content-type") || "";
  const contentLength = Number(response.headers.get("content-length") || 0);
  const extFromUrl = path.extname(new URL(response.url).pathname).toLowerCase();
  const ext = [".mp4", ".mov"].includes(extFromUrl)
    ? extFromUrl
    : contentType.includes("quicktime")
      ? ".mov"
      : ".mp4";

  if (!contentType.startsWith("video/") && ![".mp4", ".mov"].includes(extFromUrl)) {
    const err = new Error("这个链接不像可直接读取的视频文件，请上传 mp4 / mov 文件");
    err.status = 400;
    throw err;
  }

  if (contentLength > MAX_UPLOAD_MB * 1024 * 1024) {
    const err = new Error(`视频超过 ${MAX_UPLOAD_MB}MB，请压缩后再上传`);
    err.status = 413;
    throw err;
  }

  const tempPath = path.join(UPLOAD_DIR, `${uuidv4()}${ext}.download`);
  await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(tempPath));
  return registerVideo({
    filePath: tempPath,
    originalName: originalName ? `${originalName.slice(0, 80)}${ext}` : `remote-video${ext}`,
    source: sourceUrl
  });
}

async function downloadVideoFromUrl(url) {
  const resolved = await resolvePublicVideoUrl(url);
  const video = await saveVideoResponse(resolved.response, url, resolved.title);
  return {
    video,
    meta: {
      finalUrl: resolved.finalUrl,
      pageUrl: resolved.pageUrl || "",
      resolver: resolved.resolver || "direct",
      width: resolved.width || null,
      height: resolved.height || null,
      duration: resolved.duration || null,
      resolvedFromPage: resolved.resolvedFromPage,
      candidatesTried: resolved.candidatesTried
    }
  };
}

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    modelConfigured: hasModelConfig(),
    ffmpegReady: Boolean(process.env.FFMPEG_PATH || ffmpegInstaller.path)
  });
});

app.get("/api/config", (_req, res) => {
  res.json({
    modelConfigured: hasModelConfig(),
    provider: process.env.MODEL_PROVIDER || "openai-compatible",
    modelName: process.env.MODEL_NAME || ""
  });
});

app.post("/api/videos/upload", upload.single("video"), (req, res, next) => {
  try {
    if (!req.file) {
      const err = new Error("请选择 mp4 / mov 视频文件");
      err.status = 400;
      throw err;
    }
    const video = registerVideo({
      filePath: req.file.path,
      originalName: req.file.originalname,
      source: "upload"
    });
    res.json({ video });
  } catch (error) {
    next(error);
  }
});

app.post("/api/videos/link", async (req, res, next) => {
  try {
    const result = await downloadVideoFromUrl(req.body.url || "");
    res.json(result);
  } catch (error) {
    next(error);
  }
});

app.post("/api/videos/:videoId/frames", async (req, res, next) => {
  try {
    const video = getVideoOrThrow(req.params.videoId);
    const frames = await extractFrames(video, req.body.mode || "1s");
    res.json({ frames });
  } catch (error) {
    next(error);
  }
});

app.get("/api/videos/:videoId/download", (req, res, next) => {
  try {
    const video = getVideoOrThrow(req.params.videoId);
    const safeBaseName = path
      .basename(video.originalName || video.fileName)
      .replace(/[\\/:*?"<>|]/g, "_")
      .slice(0, 120);
    const ext = path.extname(safeBaseName) || path.extname(video.fileName) || ".mp4";
    const downloadName = safeBaseName.toLowerCase().endsWith(ext.toLowerCase())
      ? safeBaseName
      : `${safeBaseName}${ext}`;
    res.download(video.path, downloadName);
  } catch (error) {
    next(error);
  }
});

app.get("/api/videos/:videoId/save-page", (req, res, next) => {
  try {
    const video = getVideoOrThrow(req.params.videoId);
    const returnUrl = req.get("referer") || process.env.CLIENT_ORIGIN || "/";
    const videoUrl = `/media/uploads/${encodeURIComponent(video.fileName)}`;
    const downloadUrl = `/api/videos/${encodeURIComponent(video.id)}/download`;
    const title = escapeHtml(video.originalName || "视频文件");

    res.type("html").send(`<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>保存视频</title>
    <style>
      * { box-sizing: border-box; }
      body {
        margin: 0;
        min-height: 100vh;
        font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif;
        background: #f6f7f2;
        color: #20231f;
        padding: 16px;
      }
      main {
        max-width: 860px;
        margin: 0 auto;
        display: grid;
        gap: 14px;
      }
      h1 {
        font-size: 22px;
        line-height: 1.25;
        margin: 0;
        overflow-wrap: anywhere;
      }
      video {
        width: 100%;
        max-height: 68vh;
        background: #111;
        border-radius: 8px;
      }
      .actions {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 10px;
      }
      a {
        min-height: 46px;
        border-radius: 8px;
        display: grid;
        place-items: center;
        text-decoration: none;
        font-weight: 800;
      }
      .download {
        background: #203923;
        color: #fff;
      }
      .back {
        background: #fff;
        color: #253024;
        border: 1px solid #d4dbcf;
      }
      p {
        margin: 0;
        color: #657060;
        line-height: 1.55;
      }
      @media (max-width: 640px) {
        .actions { grid-template-columns: 1fr; }
      }
    </style>
  </head>
  <body>
    <main>
      <h1>${title}</h1>
      <video src="${videoUrl}" controls playsinline></video>
      <div class="actions">
        <a class="download" href="${downloadUrl}">下载视频</a>
        <a class="back" href="${escapeHtml(returnUrl)}">返回工具</a>
      </div>
      <p>手机上如果没有直接保存到相册选项，可以先下载到“文件”，再从系统分享菜单保存到相册。</p>
    </main>
  </body>
</html>`);
  } catch (error) {
    next(error);
  }
});

app.post("/api/analyze", async (req, res, next) => {
  try {
    if (!hasModelConfig()) {
      const err = new Error("请先配置模型 API Key");
      err.status = 400;
      throw err;
    }

    const video = getVideoOrThrow(req.body.videoId);
    const frameNames = Array.isArray(req.body.frameNames) ? req.body.frameNames : [];
    if (frameNames.length === 0) {
      const err = new Error("请至少选择一张关键帧");
      err.status = 400;
      throw err;
    }

    const framePaths = frameNames.map((fileName) => {
      const cleanName = path.basename(fileName);
      const framePath = path.join(FRAMES_DIR, video.id, cleanName);
      if (!fs.existsSync(framePath)) {
        const err = new Error(`关键帧不存在：${cleanName}`);
        err.status = 400;
        throw err;
      }
      return { fileName: cleanName, path: framePath };
    });

    const analysis = await analyzeVideoStyle({
      videoName: video.originalName,
      frames: framePaths,
      language: req.body.language || "zh-CN"
    });
    res.json(analysis);
  } catch (error) {
    next(error);
  }
});

if (process.env.NODE_ENV === "production") {
  const distDir = path.join(PROJECT_ROOT, "dist");
  app.use(express.static(distDir));
  app.get("*", (_req, res) => res.sendFile(path.join(distDir, "index.html")));
}

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(err.status || 500).json({
    message: err.message || "服务器发生错误"
  });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
