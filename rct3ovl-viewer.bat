@echo off
cd /d "%~dp0"
uv run --no-project --with numpy --with pillow python -m rct3ovl view "%USERPROFILE%\Desktop\RCT3 Files\New folder"
pause
