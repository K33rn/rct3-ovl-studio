#!/usr/bin/env bash
# Linux launcher: the same steps as rct3ovl-viewer.bat.
set -euo pipefail
cd "$(dirname "$0")"

# ---- the RCT3 game data folder (the one holding Characters, Style, Animals ... folders) ----------------------
# Remembered in game_folder.txt next to this file. Delete that file to choose again.
GAME=""
[ -f game_folder.txt ] && GAME=$(head -n1 game_folder.txt)
if [ -z "$GAME" ]; then
  echo "Where are the RollerCoaster Tycoon 3 game files?"
  echo "Paste the folder that contains the Characters, Style and Animals folders,"
  echo "e.g. ~/.local/share/Steam/steamapps/common/RollerCoaster Tycoon 3 Complete Edition"
  read -r -p "Folder: " GAME
  GAME=${GAME//\"/}
  GAME=${GAME/#\~/$HOME}
fi
if [ ! -d "$GAME/Characters" ]; then
  echo "\"$GAME\" does not look like the RCT3 data folder (no Characters folder inside)."
  rm -f game_folder.txt
  exit 1
fi
echo "$GAME" > game_folder.txt

# ---- the game's user folder (My Documents/RCT3): saved parks, designs, fireworks ------------------------------
# Under Steam's Proton it lives in the game's prefix, next to steamapps/common.
if [ -z "${RCT3_USER_DIR:-}" ]; then
  apps=$(dirname "$(dirname "$GAME")")
  for id in 1368820 2700; do       # Complete Edition, Platinum
    d="$apps/compatdata/$id/pfx/drive_c/users/steamuser/My Documents/RCT3"
    if [ -d "$d" ]; then export RCT3_USER_DIR="$d"; break; fi
  done
fi
[ -n "${RCT3_USER_DIR:-}" ] && echo "Your parks and designs: $RCT3_USER_DIR"

echo "Starting the viewer for \"$GAME\""
echo "(the first start indexes the game files once, which can take a few minutes; a progress bar shows how far it has got)"
if command -v uv >/dev/null; then
  exec uv run --no-project --with numpy --with pillow python -m rct3ovl view "$GAME"
fi
python3 -c 'import numpy, PIL' 2>/dev/null || {
  echo "Needs Python 3 with numpy and pillow (e.g. pacman -S python-numpy python-pillow, apt install python3-numpy python3-pil),"
  echo "or uv (https://docs.astral.sh/uv/), which fetches them itself."
  exit 1
}
exec python3 -m rct3ovl view "$GAME"
