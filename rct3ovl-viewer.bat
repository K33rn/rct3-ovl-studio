@echo off
setlocal
cd /d "%~dp0"

rem ---- the RCT3 game data folder (the one holding Characters, Style, Animals ... folders) -------------------
rem Remembered in game_folder.txt next to this file. Delete that file to choose again.
set "GAME="
if exist "game_folder.txt" set /p GAME=<"game_folder.txt"
if not defined GAME if exist "%USERPROFILE%\Desktop\RCT3 Files\New folder\Characters" set "GAME=%USERPROFILE%\Desktop\RCT3 Files\New folder"
if not defined GAME (
  echo Where are the RollerCoaster Tycoon 3 game files?
  echo Paste the folder that contains the Characters, Style and Animals folders,
  echo e.g. C:\Program Files ^(x86^)\Steam\steamapps\common\RollerCoaster Tycoon 3 Complete Edition\RCT3
  set /p "GAME=Folder: "
)
set "GAME=%GAME:"=%"
if not exist "%GAME%\Characters" (
  echo.
  echo "%GAME%" does not look like the RCT3 data folder ^(no Characters folder inside^).
  if exist "game_folder.txt" del "game_folder.txt"
  pause
  exit /b 1
)
> "game_folder.txt" echo %GAME%

rem ---- uv (fetches Python, numpy and pillow on first run) -----------------------------------------------------
where uv >nul 2>nul
if errorlevel 1 (
  if exist "%USERPROFILE%\.local\bin\uv.exe" (
    set "PATH=%USERPROFILE%\.local\bin;%PATH%"
  ) else (
    echo Installing uv ^(one time^)...
    powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://astral.sh/uv/install.ps1 | iex"
    set "PATH=%USERPROFILE%\.local\bin;%PATH%"
  )
)

echo Starting the viewer for "%GAME%"
echo (the first start indexes the game, which takes about a minute)
uv run --no-project --with numpy --with pillow --with imageio-ffmpeg python -m rct3ovl view "%GAME%"
pause
