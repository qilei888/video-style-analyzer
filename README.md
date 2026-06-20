# 视频风格分析与提示词反推工具

本项目是一个本地运行的 Web App，用于学习视频画面语言，并把参考视频拆解为分镜结构、景别变化、构图策略、光影逻辑、色彩系统、运镜规律、节奏曲线、人物调度和原创 AI 视频提示词。

它不是复刻工具。页面和模型提示都要求自动泛化水印、logo、明星脸、影视角色、品牌标识、字幕等元素，最终输出面向原创变体。

## 项目结构

```text
.
├─ package.json
├─ .env.example
├─ vite.config.js
├─ index.html
├─ src/
│  ├─ main.jsx
│  └─ styles.css
└─ server/
   ├─ index.js
   ├─ data/
   │  ├─ uploads/        # 运行时自动生成
   │  └─ frames/         # 运行时自动生成
   └─ services/
      └─ visionModel.js  # 可替换的视觉模型 Provider
```

## 本地运行

1. 安装依赖

```bash
npm install
```

Windows PowerShell 如果提示 `npm.ps1 cannot be loaded`，请使用：

```bash
npm.cmd install
```

2. 创建环境变量

复制 `.env.example` 为 `.env`，填入模型配置：

```env
MODEL_PROVIDER=openai-compatible
MODEL_API_KEY=你的 API Key
MODEL_BASE_URL=https://api.openai.com/v1
MODEL_NAME=gpt-4o-mini
```

支持 OpenAI-compatible 的中转站接口。以后要替换 OpenAI、Gemini、Claude、Qwen-VL 等，只需要改 `/server/services/visionModel.js`。

3. 启动开发服务

```bash
npm run dev
```

Windows PowerShell 可用：

```bash
npm.cmd run dev
```

浏览器打开：

```text
http://localhost:5183
```

手机访问时，让手机和电脑处于同一网络，然后打开：

```text
http://你的电脑局域网IP:5183
```

## 使用流程

1. 上传 mp4 / mov，或输入抖音分享链接、公开视频页面链接、可直接读取的视频文件链接。
2. 选择抽帧模式：每 1 秒、每 2 秒、自动镜头变化。
3. 勾选保留需要分析的关键帧。
4. 点击“分析整条视频结构并生成中文提示词”。
5. 在右侧复制结果，或导出 `.md` / `.txt`。

页面会自动保存当前视频、关键帧选择和分析结果；刷新页面或切换回来后，会尽量恢复上次工作进度。后端也会把已上传视频登记到 `server/data/videos.json`，方便服务重启后继续识别已有文件。

## 常见报错处理

- `请先配置模型 API Key`：检查 `.env` 是否存在，`MODEL_API_KEY` 是否已填写，改完后重启服务。
- `无法读取该链接` / `未能从该页面解析到可直接读取的视频源`：解析功能只尝试公开页面里能直接发现的视频地址，不处理登录态、签名破解、私密视频或反爬限制。请先手动下载为 mp4 / mov 后上传。
- 抖音链接解析：普通 HTML 解析失败后，可选启用 `yt-dlp` 兜底。先安装 `yt-dlp`，再在 `.env` 设置 `YTDLP_ENABLED=true` 和 `YTDLP_PYTHON=你的 Python 路径`。
- 抽帧失败：确认视频文件可正常播放；项目使用 `@ffmpeg-installer/ffmpeg`，通常不需要额外安装 ffmpeg。
- 模型 API 调用失败：检查 `MODEL_BASE_URL`、`MODEL_NAME`、余额、网络和中转站接口格式。
- 手机打不开：确认开发服务是 `vite --host 0.0.0.0` 启动，电脑防火墙允许 5183 和 5184 端口。

## 合规边界

本工具用于学习和原创改写，不用于复制、盗用或伪造他人作品。最终提示词不应保留原视频人物身份、商标、logo、字幕、水印、独特版权角色或可识别影视形象。
