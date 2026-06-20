FROM node:20-bookworm

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg python3 python3-venv ca-certificates \
  && python3 -m venv /opt/yt-dlp \
  && /opt/yt-dlp/bin/python -m pip install --no-cache-dir --upgrade pip yt-dlp \
  && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci

COPY . .

ENV NODE_ENV=production
ENV FFMPEG_PATH=/usr/bin/ffmpeg
ENV YTDLP_ENABLED=true
ENV YTDLP_PYTHON=/opt/yt-dlp/bin/python
ENV DATA_DIR=/var/data

EXPOSE 10000

CMD ["npm", "start"]
