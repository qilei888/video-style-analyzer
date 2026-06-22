const { execFileSync } = require("child_process");

if (process.env.YTDLP_AUTO_UPDATE === "false") {
  process.exit(0);
}

const pythonPath = process.env.YTDLP_PYTHON || "python";

try {
  execFileSync(
    pythonPath,
    ["-m", "pip", "install", "--no-cache-dir", "--upgrade", "yt-dlp"],
    {
      stdio: "inherit",
      timeout: 120000,
      windowsHide: true
    }
  );
} catch (error) {
  console.warn(`Unable to auto-update yt-dlp: ${error.message}`);
}
