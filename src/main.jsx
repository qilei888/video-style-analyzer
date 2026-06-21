import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Check,
  Clipboard,
  Download,
  Film,
  Image as ImageIcon,
  Link,
  Loader2,
  Play,
  RefreshCcw,
  ScanSearch,
  Trash2,
  Upload
} from "lucide-react";
import "./styles.css";

const STATE_KEY = "video-style-analysis-workspace-v5";
const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/$/, "");

function apiUrl(path) {
  if (/^https?:\/\//i.test(path)) return path;
  return `${API_BASE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}

function mediaUrl(path) {
  if (!path || /^https?:\/\//i.test(path) || path.startsWith("data:")) return path;
  return apiUrl(path);
}

const frameModes = [
  { id: "1s", label: "每 1 秒", detail: "更细" },
  { id: "2s", label: "每 2 秒", detail: "更少" },
  { id: "scene", label: "镜头变化", detail: "自动" }
];

const scriptFields = [
  ["title", "标题"],
  ["projectBasics", "项目基础信息"],
  ["storySynopsis", "故事梗概"],
  ["dramaticStructure", "剧本结构拆解"],
  ["sceneBreakdown", "场景美术与空间设定"],
  ["characterProfiles", "人物小传"],
  ["visualStyleGuide", "画面风格指南"],
  ["lightingColorGuide", "光影与色彩指南"],
  ["productionDesignGuide", "美术设计原则"],
  ["shotLanguageGuide", "镜头语言拆解"],
  ["emotionalRhythmCurve", "情绪节奏曲线"],
  ["dialogueVoiceoverSubtitleNotes", "对白 / 旁白 / 字幕 / 文字"],
  ["aiVideoRecreationNotes", "AI 视频复刻关键信息"],
  ["standardShortDramaScript", "标准短剧剧本"]
];

const summaryFields = [
  ["coreAttraction", "真正吸引人的核心"],
  ["mostImportantLearning", "最应该学习什么"],
  ["newStoryAdaptationDirection", "新故事改编方向"],
  ["aiGenerationFailureRisks", "AI 生成最容易翻车的地方"]
];

function loadSavedWorkspace() {
  try {
    const saved = sessionStorage.getItem(STATE_KEY);
    return saved ? JSON.parse(saved) : {};
  } catch {
    return {};
  }
}

function App() {
  const savedWorkspace = useMemo(loadSavedWorkspace, []);
  const [config, setConfig] = useState({ modelConfigured: false });
  const [video, setVideo] = useState(savedWorkspace.video || null);
  const [videoLink, setVideoLink] = useState(savedWorkspace.videoLink || "");
  const [mode, setMode] = useState(savedWorkspace.mode || "1s");
  const [frames, setFrames] = useState(savedWorkspace.frames || []);
  const [activeFrame, setActiveFrame] = useState(savedWorkspace.activeFrame || null);
  const [analysis, setAnalysis] = useState(savedWorkspace.analysis || null);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState(savedWorkspace.video ? "已恢复上次工作进度" : "");
  const [copied, setCopied] = useState("");

  useEffect(() => {
    fetch(apiUrl("/api/config"))
      .then((res) => res.json())
      .then(setConfig)
      .catch(() => setNotice("后端服务未连接，请确认 Node 服务已启动"));
  }, []);

  useEffect(() => {
    const workspace = {
      video,
      videoLink,
      mode,
      frames,
      activeFrame,
      analysis,
      savedAt: new Date().toISOString()
    };
    try {
      sessionStorage.setItem(STATE_KEY, JSON.stringify(workspace));
    } catch {
      try {
        sessionStorage.setItem(STATE_KEY, JSON.stringify({ ...workspace, analysis: null }));
      } catch {
        // Very large model outputs can exceed mobile browser storage. Keep the UI alive.
      }
    }
  }, [video, videoLink, mode, frames, activeFrame, analysis]);

  const selectedFrames = useMemo(() => frames.filter((frame) => frame.selected), [frames]);

  async function request(url, options = {}) {
    const response = await fetch(apiUrl(url), options);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || "请求失败");
    return data;
  }

  async function uploadVideo(file) {
    if (!file) return;
    setBusy("upload");
    setNotice("");
    setAnalysis(null);
    setFrames([]);
    const formData = new FormData();
    formData.append("video", file);
    try {
      const data = await request("/api/videos/upload", {
        method: "POST",
        body: formData
      });
      setVideo(data.video);
      setNotice("视频已载入，可以开始抽帧");
    } catch (error) {
      setNotice(error.message);
    } finally {
      setBusy("");
    }
  }

  async function loadVideoLink() {
    if (!videoLink.trim()) return;
    setBusy("link");
    setNotice("");
    setAnalysis(null);
    setFrames([]);
    try {
      const data = await request("/api/videos/link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: videoLink.trim() })
      });
      setVideo(data.video);
      setNotice(data.meta?.resolvedFromPage ? "已从公开页面解析到视频源，可以开始抽帧" : "公开视频已读取，可以开始抽帧");
    } catch (error) {
      setNotice(error.message);
    } finally {
      setBusy("");
    }
  }

  async function extractFrames() {
    if (!video) {
      setNotice("请先上传或读取一个视频");
      return;
    }
    setBusy("frames");
    setNotice("");
    setAnalysis(null);
    try {
      const data = await request(`/api/videos/${video.id}/frames`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode })
      });
      const nextFrames = data.frames.map((frame) => ({ ...frame, selected: true }));
      setFrames(nextFrames);
      setActiveFrame(nextFrames[0] || null);
      setNotice(nextFrames.length ? `已抽取 ${nextFrames.length} 张关键帧` : "未抽取到关键帧，请换一种模式");
    } catch (error) {
      setNotice(error.message);
    } finally {
      setBusy("");
    }
  }

  async function analyzeFrames() {
    if (!config.modelConfigured) {
      setNotice("请先配置模型 API Key");
      return;
    }
    if (!video || selectedFrames.length === 0) {
      setNotice("请至少保留一张关键帧");
      return;
    }
    setBusy("analyze");
    setNotice("");
    try {
      const data = await request("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          videoId: video.id,
          frameNames: selectedFrames.map((frame) => frame.fileName),
          language: "zh-CN"
        })
      });
      setAnalysis(data);
      setActiveFrame(selectedFrames[0]);
      setNotice("分析完成，已生成可复用剧情版本和最终总结");
    } catch (error) {
      setNotice(error.message);
    } finally {
      setBusy("");
    }
  }

  function toggleFrame(frameName) {
    setFrames((items) =>
      items.map((item) => (item.fileName === frameName ? { ...item, selected: !item.selected } : item))
    );
  }

  function removeFrame(frameName) {
    setFrames((items) => items.filter((item) => item.fileName !== frameName));
    if (activeFrame?.fileName === frameName) setActiveFrame(null);
  }

  function resetWorkspace() {
    setVideo(null);
    setVideoLink("");
    setMode("1s");
    setFrames([]);
    setActiveFrame(null);
    setAnalysis(null);
    setNotice("已清空当前工作区");
    sessionStorage.removeItem(STATE_KEY);
  }

  function makeExportText() {
    if (!analysis) return "";
    const storyVersion = analysis.reusableStoryVersion || analysis.reusableScriptVersion || {};
    const lines = [
      "# 可复用剧情版本与最终总结",
      "",
      "## 可复用剧情版本"
    ];

    for (const [key, label] of scriptFields) lines.push(`- ${label}: ${formatValue(storyVersion?.[key])}`);

    lines.push("", "## 最终总结");
    for (const [key, label] of summaryFields) lines.push(`- ${label}: ${formatValue(analysis.finalSummary?.[key])}`);
    return lines.filter((line) => line !== undefined).join("\n");
  }

  async function copyText(key, text) {
    await navigator.clipboard.writeText(text || "");
    setCopied(key);
    setTimeout(() => setCopied(""), 1200);
  }

  function downloadExport(extension) {
    const text = makeExportText();
    if (!text) return;
    const blob = new Blob([text], { type: extension === "md" ? "text/markdown" : "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `video-style-analysis.${extension}`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Local AI Video Study Tool</p>
          <h1>视频风格分析与提示词反推工具</h1>
        </div>
        <div className={config.modelConfigured ? "status ok" : "status warn"}>
          {config.modelConfigured ? "模型已配置" : "请先配置模型 API Key"}
        </div>
      </header>

      <section className="policy">
        本工具用于学习视频画面语言和生成相似风格的原创变体提示词，不用于复制、盗用或伪造他人作品。检测到水印、logo、明星脸、影视角色、品牌标识、字幕等元素时，应在最终提示词中泛化改写并排除原始身份。
      </section>

      {notice && <div className="notice">{notice}</div>}

      <section className="workspace">
        <Panel title="视频输入与关键帧" icon={<Film size={18} />}>
          <div className="upload-area">
            <label className="file-picker">
              <Upload size={18} />
              <span>{busy === "upload" ? "上传中..." : "上传 mp4 / mov"}</span>
              <input
                type="file"
                accept="video/mp4,video/quicktime,.mp4,.mov"
                onChange={(event) => uploadVideo(event.target.files?.[0])}
              />
            </label>

            <div className="link-row">
              <Link size={17} />
              <input
                value={videoLink}
                placeholder="抖音分享链接 / 视频直链，解析不了请上传文件"
                onChange={(event) => setVideoLink(event.target.value)}
              />
              <button className="icon-button" onClick={loadVideoLink} disabled={busy === "link"} title="解析/读取链接">
                {busy === "link" ? <Loader2 className="spin" size={17} /> : <Play size={17} />}
              </button>
            </div>
          </div>

          {video && (
            <div className="video-card">
              <video src={mediaUrl(video.url)} controls />
              <div className="video-meta">
                <div>
                  <strong>{video.originalName}</strong>
                  <span>{video.source === "upload" ? "本地上传" : "链接解析读取"}</span>
                </div>
                <a className="ghost download-link" href={apiUrl(`/api/videos/${video.id}/save-page`)}>
                  <Download size={16} />
                  保存/下载
                </a>
              </div>
            </div>
          )}

          <div className="mode-row">
            {frameModes.map((item) => (
              <button
                key={item.id}
                className={mode === item.id ? "mode active" : "mode"}
                onClick={() => setMode(item.id)}
              >
                <span>{item.label}</span>
                <small>{item.detail}</small>
              </button>
            ))}
          </div>

          <button className="primary wide" onClick={extractFrames} disabled={!video || busy === "frames"}>
            {busy === "frames" ? <Loader2 className="spin" size={18} /> : <ScanSearch size={18} />}
            抽取关键帧
          </button>

          <div className="frames-head">
            <span>{selectedFrames.length} / {frames.length} 已保留</span>
            <button className="ghost" onClick={() => setFrames((items) => items.map((frame) => ({ ...frame, selected: true })))}>
              全选
            </button>
          </div>

          <div className="frame-grid">
            {frames.map((frame) => (
              <div
                className={activeFrame?.fileName === frame.fileName ? "frame active" : "frame"}
                key={frame.fileName}
                onClick={() => setActiveFrame(frame)}
              >
                <img src={mediaUrl(frame.url)} alt={frame.fileName} />
                <div className="frame-actions">
                  <button
                    className={frame.selected ? "tiny selected" : "tiny"}
                    onClick={(event) => {
                      event.stopPropagation();
                      toggleFrame(frame.fileName);
                    }}
                    title={frame.selected ? "取消保留" : "保留"}
                  >
                    <Check size={14} />
                  </button>
                  <button
                    className="tiny danger"
                    onClick={(event) => {
                      event.stopPropagation();
                      removeFrame(frame.fileName);
                    }}
                    title="删除"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
                <span>{frame.index}</span>
              </div>
            ))}
          </div>

          <button className="primary wide" onClick={analyzeFrames} disabled={busy === "analyze" || selectedFrames.length === 0}>
            {busy === "analyze" ? <Loader2 className="spin" size={18} /> : <RefreshCcw size={18} />}
            生成剧情版本和最终总结
          </button>
          {(video || frames.length > 0 || analysis) && (
            <button className="ghost wide" onClick={resetWorkspace}>
              清空当前项目
            </button>
          )}
        </Panel>

        <Panel title="可复用剧情版本" icon={<ImageIcon size={18} />}>
          {analysis ? (
            <div className="right-results">
              <div className="toolbar">
                <button className="ghost" onClick={() => copyText("script", stringifyFields(analysis.reusableStoryVersion || analysis.reusableScriptVersion, scriptFields))}>
                  <Clipboard size={16} /> {copied === "script" ? "已复制" : "复制可复用剧情版本"}
                </button>
              </div>
              <dl className="field-list compact">
                {scriptFields.map(([key, label]) => (
                  <React.Fragment key={key}>
                    <dt>{label}</dt>
                    <dd>{formatValue((analysis.reusableStoryVersion || analysis.reusableScriptVersion)?.[key]) || "..."}</dd>
                  </React.Fragment>
                ))}
              </dl>
            </div>
          ) : (
            <EmptyState text="完成分析后，这里会生成一版高信息密度的可复用剧情版本，包含故事、人物、场景、美术、镜头、情绪节奏和标准短剧剧本。" />
          )}
        </Panel>

        <Panel title="最终总结" icon={<Clipboard size={18} />}>
          {analysis ? (
            <div className="right-results">
              <div className="toolbar">
                <button className="ghost" onClick={() => copyText("summary", stringifyFields(analysis.finalSummary, summaryFields))}>
                  <Clipboard size={16} /> {copied === "summary" ? "已复制" : "复制最终总结"}
                </button>
                <button className="ghost" onClick={() => copyText("all", makeExportText())}>
                  <Clipboard size={16} /> {copied === "all" ? "已复制" : "复制两板块"}
                </button>
                <button className="ghost" onClick={() => downloadExport("md")}>
                  <Download size={16} /> .md
                </button>
                <button className="ghost" onClick={() => downloadExport("txt")}>
                  <Download size={16} /> .txt
                </button>
              </div>

              <Block title="最终总结" copy={() => copyText("summary", stringifyFields(analysis.finalSummary, summaryFields))} copied={copied === "summary"}>
                <dl className="field-list compact">
                  {summaryFields.map(([key, label]) => (
                    <React.Fragment key={key}>
                      <dt>{label}</dt>
                      <dd>{formatValue(analysis.finalSummary?.[key]) || "..."}</dd>
                    </React.Fragment>
                  ))}
                </dl>
              </Block>
            </div>
          ) : (
            <EmptyState text="完成分析后，这里会生成导演视角的最终总结。" />
          )}
        </Panel>
      </section>
    </main>
  );
}

function Panel({ title, icon, children }) {
  return (
    <section className="panel">
      <div className="panel-title">
        {icon}
        <h2>{title}</h2>
      </div>
      {children}
    </section>
  );
}

function Block({ title, children, copy, copied }) {
  return (
    <section className="block">
      <div className="result-head">
        <h3>{title}</h3>
        {copy && <CopyButton copied={copied} onClick={copy} />}
      </div>
      {children}
    </section>
  );
}

function CopyButton({ copied, onClick }) {
  return (
    <button className="icon-button" onClick={onClick} title="复制">
      {copied ? <Check size={16} /> : <Clipboard size={16} />}
    </button>
  );
}

function EmptyState({ text }) {
  return <div className="empty">{text}</div>;
}

function humanizeKey(key) {
  return String(key)
    .replace(/([A-Z])/g, " $1")
    .replace(/[_-]+/g, " ")
    .trim();
}

function formatValue(value) {
  if (value === null || value === undefined || value === "") return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    return value
      .map((item, index) => {
        const text = formatValue(item);
        return text ? `${index + 1}. ${text}` : "";
      })
      .filter(Boolean)
      .join("\n");
  }
  if (typeof value === "object") {
    return Object.entries(value)
      .map(([key, item]) => {
        const text = formatValue(item);
        return text ? `${humanizeKey(key)}：${text}` : "";
      })
      .filter(Boolean)
      .join("\n");
  }
  return String(value);
}

function stringifyFields(value = {}, fields = []) {
  return fields.map(([key, label]) => `${label}: ${formatValue(value?.[key])}`).join("\n");
}

createRoot(document.getElementById("root")).render(<App />);
