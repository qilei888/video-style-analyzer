# 云部署步骤

目标：

- GitHub：使用现有 `qilei888` 账号
- Render：部署后端 Node/Express + ffmpeg
- Vercel：部署前端 React/Vite

## 1. GitHub

新建仓库名建议：

```text
video-style-analyzer
```

仓库建好后，把本项目推送到这个仓库。

## 2. Render 后端

在 Render 创建 New Web Service，选择 GitHub 仓库 `video-style-analyzer`。

保持这些配置：

```text
Runtime: Node
Build Command: npm ci && npm run build
Start Command: npm start
Plan: Free
```

环境变量：

```text
NODE_ENV=production
MODEL_PROVIDER=openai-compatible
MODEL_API_KEY=你的模型 API 令牌
MODEL_BASE_URL=https://yunwu.ai/v1
MODEL_NAME=gpt-4o-mini
MODEL_MAX_TOKENS=12000
MAX_UPLOAD_MB=250
DATA_DIR=/tmp/video-style-analyzer
YTDLP_ENABLED=false
CLIENT_ORIGIN=https://你的-vercel-前端域名
```

第一次还不知道 Vercel 域名时，`CLIENT_ORIGIN` 可以先填：

```text
*.vercel.app
```

部署成功后测试：

```text
https://你的-render-后端.onrender.com/api/health
```

看到 `ok: true` 就说明后端活着。

## 3. Vercel 前端

在 Vercel 导入同一个 GitHub 仓库 `video-style-analyzer`。

保持这些配置：

```text
Framework Preset: Vite
Build Command: npm run build
Output Directory: dist
```

环境变量：

```text
VITE_API_BASE_URL=https://你的-render-后端.onrender.com
```

部署完成后，用 Vercel 给你的域名打开网页。

## 4. 注意

- API Key 只填在 Render 的 `MODEL_API_KEY`，不要填进前端代码。
- 免费 Render 会休眠，第一次上传/抽帧/分析可能会慢几十秒。
- 免费 Render 磁盘是临时的，服务重启后上传的视频和抽帧可能丢失，适合自己临时分析，不适合长期存储。
- 视频尽量先用短视频测试，建议 30 秒以内，文件不要太大。
