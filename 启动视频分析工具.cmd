@echo off
chcp 65001 >nul
title 视频风格分析工具 - 本机服务
cd /d "%~dp0"
echo.
echo 正在启动视频风格分析工具...
echo.
echo 启动成功后，请在电脑网页顶部查看“手机访问地址”。
echo 手机和电脑需要连接同一个 Wi-Fi。
echo.
npm.cmd run dev
echo.
echo 服务已停止。按任意键关闭窗口。
pause >nul
