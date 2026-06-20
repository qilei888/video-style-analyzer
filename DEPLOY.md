# 云部署步骤：Vercel 前端 + Render 后端

下面步骤沿用你已有账号：

- GitHub：`qilei888`
- Vercel：现有 Vercel 账号
- Render：现有 Render 账号

不要把 `.env` 上传到 GitHub。API Key 只放 Render 环境变量。

## 1. 在 GitHub 创建仓库

1. 打开 GitHub 并登录 `qilei888`。
2. 右上角点 `+`。
3. 点 `New repository`。
4. Repository name 建议填：`video-style-analysis-tool`。
5. 选择 `Private` 或 `Public` 都可以。
6. 不要勾选 `Add a README file`。
7. 点 `Create repository`。

创建后，把本地项目推送到这个仓库。

## 2. 部署后端到 Render

1. 打开 Render，使用你现有账号登录。
2. 点 `New +`。
3. 选择 `Web Service`。
4. 连接 GitHub 仓库：`qilei888/video-style-analysis-tool`。
5. 如果 Render 询问部署方式，选择 `Docker`。
6. Service name 建议：`video-style-analysis-api`。
7. Region 选离你近的区域即可。
8. Instance 先选最低可用规格；视频处理和 gpt-5.4 分析会比较慢，后续可升级。
9. Environment Variables 填下面这些：

```text
NODE_ENV=production
DATA_DIR=/var/data
FFMPEG_PATH=/usr/bin/ffmpeg
YTDLP_ENABLED=true
YTDLP_PYTHON=/opt/yt-dlp/bin/python
MODEL_PROVIDER=openai-compatible
MODEL_API_KEY=你的云雾 API Key
MODEL_BASE_URL=https://yunwu.ai/v1
MODEL_NAME=gpt-5.4
MODEL_MAX_TOKENS=12000
MAX_UPLOAD_MB=800
CLIENT_ORIGIN=*.vercel.app
```

10. 如果页面里有 Disk 设置，添加磁盘：

```text
Mount Path: /var/data
Size: 5 GB 或更大
```

11. 点 `Create Web Service`。
12. 等部署完成后，打开：

```text
https://你的-render服务名.onrender.com/api/health
```

看到类似下面内容就说明后端成功：

```json
{"ok":true,"modelConfigured":true,"ffmpegReady":true}
```

## 3. 部署前端到 Vercel

1. 打开 Vercel，使用你现有账号登录。
2. 点 `Add New...`。
3. 点 `Project`。
4. 选择 GitHub 仓库：`qilei888/video-style-analysis-tool`。
5. Framework Preset 选择 `Vite`。
6. Build Command 保持：

```text
npm run build
```

7. Output Directory 保持：

```text
dist
```

8. Environment Variables 增加：

```text
VITE_API_BASE_URL=https://你的-render服务名.onrender.com
```

9. 点 `Deploy`。

部署完成后，打开 Vercel 给你的域名。

## 4. 回填正式前端域名到 Render

Vercel 部署完成后，你会得到一个类似：

```text
https://video-style-analysis-tool.vercel.app
```

回到 Render：

1. 打开后端服务。
2. 进入 `Environment`。
3. 把 `CLIENT_ORIGIN` 改为：

```text
https://你的-vercel域名.vercel.app,*.vercel.app
```

4. 保存后 Render 会自动重新部署。

## 5. 使用注意

- API Key 只放 Render，不要放 Vercel。
- Render 免费或低配服务可能会休眠，首次打开会慢。
- 上传视频会占用 Render 磁盘，建议定期清理。
- 抖音链接解析依赖 `yt-dlp`，Dockerfile 已安装。
- 如果 Render 构建失败，先看 Build Logs 里是否是网络下载失败。
- 如果前端提示后端连接失败，检查 `VITE_API_BASE_URL` 是否填成 Render 后端地址。
- 如果浏览器提示跨域，检查 Render 的 `CLIENT_ORIGIN` 是否包含 Vercel 域名。
