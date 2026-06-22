const MAX_HTML_BYTES = 5 * 1024 * 1024;
const { execFile } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { promisify } = require("util");

const execFileAsync = promisify(execFile);

const REQUEST_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,video/mp4,video/*;q=0.8,*/*;q=0.7",
  "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.7"
};

function isHttpUrl(url) {
  try {
    const parsed = new URL(url);
    return ["http:", "https:"].includes(parsed.protocol);
  } catch {
    return false;
  }
}

function extractFirstHttpUrl(text) {
  const match = String(text || "").match(/https?:\/\/[^\s"'<>]+/i);
  if (!match) return "";
  return match[0].replace(/[),.;:!?，。；：！？）】》、]+$/u, "");
}

function isDouyinUrl(url = "") {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === "douyin.com" || host.endsWith(".douyin.com");
  } catch {
    return false;
  }
}

function isVideoContentType(contentType = "") {
  return contentType.toLowerCase().startsWith("video/");
}

function hasVideoExtension(url = "") {
  try {
    const ext = new URL(url).pathname.toLowerCase();
    return ext.endsWith(".mp4") || ext.endsWith(".mov") || ext.endsWith(".m4v");
  } catch {
    return false;
  }
}

function decodeHtmlEntities(text) {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#34;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function normalizeCandidateUrl(raw, baseUrl) {
  let value = decodeHtmlEntities(String(raw || "").trim());
  value = value
    .replace(/\\u0026/gi, "&")
    .replace(/\\u003d/gi, "=")
    .replace(/\\u003a/gi, ":")
    .replace(/\\u002f/gi, "/")
    .replace(/\\\//g, "/")
    .replace(/\\&/g, "&");

  value = value.replace(/^["']|["']$/g, "");
  value = value.split("\\u0022")[0].split("\\\"")[0].split('"')[0].split("'")[0];

  if (value.startsWith("//")) value = `https:${value}`;

  try {
    return new URL(value, baseUrl).toString();
  } catch {
    return "";
  }
}

function extractMetaVideoUrls(html, baseUrl) {
  const urls = [];
  const metaPattern =
    /<meta[^>]+(?:property|name)=["'](?:og:video|og:video:url|og:video:secure_url|twitter:player:stream)["'][^>]+content=["']([^"']+)["'][^>]*>/gi;
  let match;
  while ((match = metaPattern.exec(html))) {
    const normalized = normalizeCandidateUrl(match[1], baseUrl);
    if (normalized) urls.push(normalized);
  }
  return urls;
}

function extractScriptVideoUrls(html, baseUrl) {
  const urls = [];
  const patterns = [
    /(?:https?:)?(?:\\?\/\\?\/)[^"'<>\\\s]+?(?:\.mp4|\.mov|\.m4v)(?:[^"'<>\\\s]*)/gi,
    /(?:https?:)?(?:\\?\/\\?\/)[^"'<>\\\s]+?\/aweme\/v1\/play\/(?:[^"'<>\\\s]*)/gi,
    /(?:https?:)?(?:\\?\/\\?\/)[^"'<>\\\s]+?video_id=[^"'<>\\\s]+/gi,
    /["'](?:playAddr|play_addr|downloadAddr|download_addr|src)["']\s*:\s*["']([^"']+)["']/gi
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(html))) {
      const normalized = normalizeCandidateUrl(match[1] || match[0], baseUrl);
      if (normalized) urls.push(normalized);
    }
  }

  return urls;
}

function rankCandidate(url) {
  let score = 0;
  if (url.includes(".mp4")) score += 20;
  if (url.includes("/aweme/v1/play/")) score += 16;
  if (url.includes("video_id=")) score += 12;
  if (url.includes("playwm")) score += 4;
  if (url.includes("watermark")) score -= 8;
  if (url.includes("avatar") || url.includes("poster") || url.includes("cover")) score -= 20;
  return score;
}

function extractVideoCandidates(html, baseUrl) {
  const candidates = [...extractMetaVideoUrls(html, baseUrl), ...extractScriptVideoUrls(html, baseUrl)]
    .filter(Boolean)
    .filter((url) => isHttpUrl(url))
    .filter((url) => !/\.(jpg|jpeg|png|webp|gif|svg)(?:\?|$)/i.test(url));

  return Array.from(new Set(candidates))
    .sort((a, b) => rankCandidate(b) - rankCandidate(a))
    .slice(0, 12);
}

async function fetchPublicUrl(url, extraHeaders = {}) {
  return fetch(url, {
    redirect: "follow",
    headers: {
      ...REQUEST_HEADERS,
      ...extraHeaders
    }
  });
}

async function resolveWithYtDlp(inputUrl, options = {}) {
  if (process.env.YTDLP_ENABLED === "false" && !isDouyinUrl(inputUrl)) return null;

  const pythonPath = process.env.YTDLP_PYTHON || "python";
  const cookieArgs = buildYtDlpCookieArgs(inputUrl);
  const args = [
    "-m",
    "yt_dlp",
    "--dump-json",
    "--no-warnings",
    "--no-check-certificate",
    "--no-playlist",
    "-f",
    "best[vcodec^=h264][ext=mp4]/best[ext=mp4]/best",
    ...cookieArgs,
    inputUrl
  ];

  try {
    const { stdout } = await execFileAsync(pythonPath, args, {
      windowsHide: true,
      maxBuffer: 20 * 1024 * 1024,
      timeout: 60000
    });
    const firstLine = stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)[0];
    if (!firstLine) return null;

    const data = JSON.parse(firstLine);
    if (!data.url || !isHttpUrl(data.url)) return null;

    const headers = data.http_headers || {};
    return {
      videoUrl: data.url,
      headers,
      title: data.title || data.fulltitle || data.id || "remote-video",
      extractor: data.extractor || "yt-dlp",
      width: data.width,
      height: data.height,
      duration: data.duration
    };
  } catch (error) {
    if (options.throwOnError) {
      const details = String(error.stderr || error.stdout || error.message || error).slice(0, 1200);
      const err = new Error(`yt-dlp 解析失败：${details}`);
      err.status = 400;
      throw err;
    }
    return null;
  }
}

async function readLimitedText(response) {
  const contentLength = Number(response.headers.get("content-length") || 0);
  if (contentLength > MAX_HTML_BYTES) {
    throw new Error("页面过大，无法解析公开视频链接");
  }
  const text = await response.text();
  return text.slice(0, MAX_HTML_BYTES);
}

async function resolveYtDlpToResponse(inputUrl, pageUrl = inputUrl, candidatesTried = 0, options = {}) {
  const ytDlpResult = await resolveWithYtDlp(inputUrl, options);
  if (!ytDlpResult) return null;

  const response = await fetchPublicUrl(ytDlpResult.videoUrl, ytDlpResult.headers);
  const candidateType = response.headers.get("content-type") || "";
  if (!response.ok || !response.body || (!isVideoContentType(candidateType) && !hasVideoExtension(response.url))) {
    if (options.throwOnError) {
      const err = new Error(`yt-dlp 已找到视频地址，但云端无法下载视频文件，状态码 ${response.status}，类型 ${candidateType || "未知"}`);
      err.status = 400;
      throw err;
    }
    return null;
  }

  return {
    response,
    finalUrl: response.url,
    pageUrl,
    resolvedFromPage: true,
    resolver: ytDlpResult.extractor,
    candidatesTried,
    title: ytDlpResult.title,
    width: ytDlpResult.width,
    height: ytDlpResult.height,
    duration: ytDlpResult.duration
  };
}

async function resolvePublicVideoUrl(inputUrl) {
  const normalizedInputUrl = isHttpUrl(inputUrl) ? inputUrl : extractFirstHttpUrl(inputUrl);

  if (!isHttpUrl(normalizedInputUrl)) {
    const err = new Error("请输入有效的 http/https 视频链接");
    err.status = 400;
    throw err;
  }

  const isDouyin = isDouyinUrl(normalizedInputUrl);

  if (isDouyin) {
    const resolved = await resolveYtDlpToResponse(normalizedInputUrl, normalizedInputUrl, 1);
    if (resolved) return resolved;
  }

  const pageResponse = await fetchPublicUrl(normalizedInputUrl);
  if (!pageResponse.ok || !pageResponse.body) {
    const err = new Error("无法读取该链接，请下载后手动上传视频文件");
    err.status = 400;
    throw err;
  }

  const contentType = pageResponse.headers.get("content-type") || "";
  if (isVideoContentType(contentType) || hasVideoExtension(pageResponse.url)) {
    return {
      response: pageResponse,
      finalUrl: pageResponse.url,
      resolvedFromPage: false,
      candidatesTried: 0
    };
  }

  if (!contentType.includes("text/html")) {
    const err = new Error("这个链接不是可直接读取的视频或公开视频页面，请上传 mp4 / mov 文件");
    err.status = 400;
    throw err;
  }

  const html = await readLimitedText(pageResponse);
  const candidates = extractVideoCandidates(html, pageResponse.url);

  for (const candidate of candidates) {
    try {
      const response = await fetchPublicUrl(candidate, { Referer: pageResponse.url });
      const candidateType = response.headers.get("content-type") || "";
      if (response.ok && response.body && (isVideoContentType(candidateType) || hasVideoExtension(response.url))) {
        return {
          response,
          finalUrl: response.url,
          pageUrl: pageResponse.url,
          resolvedFromPage: true,
          candidatesTried: candidates.indexOf(candidate) + 1
        };
      }
    } catch {
      // Try the next public candidate. Some platforms expire individual URLs quickly.
    }
  }

  const ytDlpResult = await resolveWithYtDlp(normalizedInputUrl);
  if (ytDlpResult) {
    const response = await fetchPublicUrl(ytDlpResult.videoUrl, ytDlpResult.headers);
    const candidateType = response.headers.get("content-type") || "";
    if (response.ok && response.body && (isVideoContentType(candidateType) || hasVideoExtension(response.url))) {
      return {
        response,
        finalUrl: response.url,
        pageUrl: pageResponse.url,
        resolvedFromPage: true,
        resolver: ytDlpResult.extractor,
        candidatesTried: candidates.length,
        title: ytDlpResult.title,
        width: ytDlpResult.width,
        height: ytDlpResult.height,
        duration: ytDlpResult.duration
      };
    }
  }

  const err = new Error(
    isDouyin
      ? "抖音限制了云端直接解析，未能拿到可读取的视频源。请重新复制一次最新分享链接再试；如果仍失败，请先在手机里保存视频，再上传 mp4 / mov 文件。"
      : "未能从该页面解析到可直接读取的视频源，请下载后上传 mp4 / mov 文件"
  );
  err.status = 400;
  err.details = { resolvedPageUrl: pageResponse.url, candidatesFound: candidates.length };
  throw err;
}

function buildYtDlpCookieArgs(inputUrl) {
  const rawCookies = process.env.YTDLP_COOKIES || (isDouyinUrl(inputUrl) ? process.env.DOUYIN_COOKIES : "");
  if (!rawCookies) return [];

  if (fs.existsSync(rawCookies)) return ["--cookies", rawCookies];

  const normalized = rawCookies.replace(/\\n/g, "\n").trim();
  if (!normalized) return [];

  if (normalized.includes("\n") || normalized.startsWith("# Netscape")) {
    const cookiePath = path.join(os.tmpdir(), "yt-dlp-cookies.txt");
    fs.writeFileSync(cookiePath, normalized, "utf8");
    return ["--cookies", cookiePath];
  }

  const cookieFile = cookieHeaderToNetscapeFile(normalized, inputUrl);
  if (cookieFile) return ["--cookies", cookieFile];

  return ["--add-header", `Cookie:${normalized.replace(/^cookie:\s*/i, "")}`];
}

function cookieHeaderToNetscapeFile(cookieHeader, inputUrl) {
  const cookieText = cookieHeader.replace(/^cookie:\s*/i, "").trim();
  const pairs = cookieText
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const separator = part.indexOf("=");
      if (separator <= 0) return null;
      return {
        name: part.slice(0, separator).trim(),
        value: part.slice(separator + 1).trim()
      };
    })
    .filter((pair) => pair && pair.name && pair.value);

  if (!pairs.length) return "";

  const domains = new Set([".douyin.com", "douyin.com"]);
  try {
    const host = new URL(inputUrl).hostname.toLowerCase();
    domains.add(host);
    if (host.endsWith(".douyin.com")) domains.add(`.${host.split(".").slice(-2).join(".")}`);
  } catch {
    // Use the broad Douyin domains above.
  }

  const expires = 2147483647;
  const lines = [
    "# Netscape HTTP Cookie File",
    "# Generated from DOUYIN_COOKIES. Do not share this file."
  ];

  for (const domain of domains) {
    const includeSubdomains = domain.startsWith(".") ? "TRUE" : "FALSE";
    for (const pair of pairs) {
      lines.push(`${domain}\t${includeSubdomains}\t/\tTRUE\t${expires}\t${pair.name}\t${pair.value}`);
    }
  }

  const cookiePath = path.join(os.tmpdir(), "yt-dlp-cookies.txt");
  fs.writeFileSync(cookiePath, `${lines.join("\n")}\n`, "utf8");
  return cookiePath;
}

module.exports = {
  extractVideoCandidates,
  resolvePublicVideoUrl
};
