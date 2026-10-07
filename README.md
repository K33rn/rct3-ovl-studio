# RCT3 OVL Extractor & Viewer (`rct3ovl`)

```
Program:  RCT3 OVL Extractor & Viewer (rct3ovl)
Author:   K3rn
For:      RollerCoaster Tycoon 3 (base game, Soaked!, Wild!)
```

## What it is

RollerCoaster Tycoon 3 keeps almost all of its content in `.ovl` package files. This program opens them and
turns what's inside into normal files you can use anywhere:

| Inside the game | What you get |
|---|---|
| 3D models (rides, scenery, cars, stalls, food) | `.glb` files with textures and animations (Blender, Windows 3D Viewer…) |
| Guests, staff and entertainers | Whole animated characters as `.glb` |
| Textures, icons and logos | `.png` pictures |
| Sounds | `.wav` audio |
| Text (names, descriptions, in 10 languages) | `.json` |
| Rides, shops, scenery items, paths and everything else | Readable `.json` records |

It also has a **viewer** that runs in your web browser. You can:
- browse the whole game folder;
- spin and animate models;
- play sounds and read text;
- look at whole people;
- download anything you see.

**Not sure what a `.ric` or `.sid` is?** Click **File types** in the viewer, or run `rct3ovl types` (see below).
Every file type is explained there: what it is, what it does in the game, and what you get from it.

## Tutorial: getting it working

### 1. What you need
- **Windows** with an internet connection for the first run.
- **RollerCoaster Tycoon 3's game files.** Either the installed game or a copy of its data folder: the folder that
  contains the `Characters`, `Style`, `Animals` and `Cars` folders.
  - On Steam (Complete Edition) it's usually
    `C:\Program Files (x86)\Steam\steamapps\common\RollerCoaster Tycoon 3 Complete Edition\RCT3`.
  - Right-click the game in Steam → **Manage** → **Browse local files** to find it.
- You **don't** need to install Python. The launcher sets everything up.

### 2. Get the program
Unzip `rct3ovl.zip` somewhere easy to find, e.g. `Documents\rct3ovl`. Keep the files together.

### 3. Start the viewer
1. Double-click **`rct3ovl-viewer.bat`** in the `rct3ovl` folder.
2. **First time only:**
   - It asks where the game files are. Paste the game data folder from step 1 and press Enter. It remembers your
     answer in `game_folder.txt`; delete that file to choose a different folder later.
   - It installs a small helper called **uv**, which downloads Python and the two libraries the program needs.
     This takes a minute or two.
   - It scans the game, which takes about a minute.
3. Your web browser opens the viewer at http://127.0.0.1:8765. Keep the black launcher window open while you use
   it; closing that window stops the viewer.

### 4. Use the viewer
- **Left column:** every OVL file in the game, in its folders. Type in the box to filter, e.g. `coaster` or
  `chess`.
- **Middle column:** what's inside the OVL you picked, grouped by type. Click the **?** next to a group to learn
  what that type is.
- **Right side:** the selected item.

| What you picked | What the right side shows |
|---|---|
| Models | 3D view. Drag to orbit, scroll to zoom, right-drag to pan. Pick an **animation** from the menu; use **Wireframe**, **Bones**, **Grid** and **Spin** to change the view. **Rotate X** / **Rotate Z** turn the model 90° (cars of vertical rides such as the elevator are stored lying down; the game stands them up on the track). A **No picture** line in the info box lists textures that can't be shown, and why |
| Guest parts and animals | Also a **Variant** menu to switch outfits and colours |
| Textures, icons and logos | The picture. **Scroll** to zoom in and out where the mouse points, **drag** to move around, **double-click** to fit it back in the window. The toolbar has **−**, **+**, **Fit** and **1:1** (actual pixels), or use the keys `+`, `-`, `0` and `1` |
| Sounds | A player |
| Text | A searchable table |
| Everything else | The decoded record |

The buttons at the top:
- **Peeps** lists every guest, staff member and entertainer as a whole, animated character.
- **Thrill Rides** lists the flat rides (Pirate Ship, Top Spin, Ferris Wheel, Soaked! and Wild! rides, themed rides…) with their ride animations: Static, Start, Loop and Stop. Each ride opens playing its loop.
- **File types** opens the guide to every file type.
- **Download** saves what you're looking at: `.glb`, `.png`, `.wav` or `.json`.

**After updating the program:** close the launcher window and start `rct3ovl-viewer.bat` again.

### 5. Extract everything to files (optional)
To turn the whole game, or one folder, into files at once:

1. Open a terminal in the `rct3ovl` folder: click the folder's address bar, type `cmd` and press Enter.
2. Run:

```
uv run --no-project --with numpy --with pillow python -m rct3ovl extract "<game folder>" -o "<output folder>"
```

The whole game takes about 6–13 minutes and about 2.4 GB. The output has one folder per OVL, each with:

| Folder or file | Contents |
|---|---|
| `models` | 3D models (`.glb`) |
| `textures` | Textures (`.png`) |
| `icons` | Icons (`.png`) |
| `sounds` | Sounds (`.wav`) |
| `data` | Decoded records (`.json`) |
| `text.json` | Every text string in that OVL |
| `manifest.json` | A list of everything in that OVL |

Whole characters go in `people` at the top of the output folder.

Use a single game folder instead, e.g. `"<game folder>\Cars"`, to extract just that part.

### 6. Other commands
All commands start with `uv run --no-project --with numpy --with pillow python -m rct3ovl`, followed by:

| Command | What it does |
|---|---|
| `types` | Prints the file type guide. Add a type to see just that one, e.g. `types ric` |
| `view "<game folder>"` | Starts the viewer, the same as the `.bat` |
| `person "<game folder>" AF01 -o AF01.glb` | Exports one whole character. Use `list` instead of a name to see all 57. Options: `--anims Walk,Idle`, `--expression Happy`, `--outfit 2` |
| `recolour "<path to .common.ovl>" <texture name> --colors ff0000,00ff00,0000ff` | Saves a recoloured preview of a recolourable texture |
| `extract … --type shs,tex` | Only some types |
| `extract … --anims Walk` | Only some animations |
| `extract … --variant 3` | Pick a colour variant for people and animals |
| `extract … --no-people` | Skip whole characters |
| `--language German …` | Names and text in another language. Goes before the command name. Choices: English, German, French, Spanish, Dutch, Danish, Finnish, Italian, Norwegian, Swedish |
| `info "<ovl>"`, `list "<ovl>"` | Technical details of one OVL |

### 7. If something goes wrong
- **"does not look like the RCT3 data folder":** you picked the wrong folder. Pick the one that has a
  `Characters` folder directly inside it. The launcher will ask again.
- **The viewer shows something old or broken after an update:** close the launcher window and start it again.
- **Some models are plain grey, or there are no track pieces or zoo animals:** the game folder is incomplete. A
  full RCT3 Gold folder is about 1.3 GB with about 7,500 OVL pairs, and `tracks`, `WildAnimals`, `Pool` and `Water`
  are full of `.ovl` files. If a copy was interrupted, copy again and let it finish. The info box shows
  **No picture** with the reason for each texture it can't find. A few names (`chrome`, `water`, `fakeglass`…) are
  always made by the game while it runs; those get a stand-in colour.
- **3D view stays empty:** the viewer loads its 3D library from the internet, so check your connection.
- **Port already in use:** another viewer is still running. Close its window, or start a second one with
  `view "<game folder>" --port 8766`.

## Author

```
RCT3 OVL Extractor & Viewer (rct3ovl)
Author: K3rn
```

Built with the help of Claude (AI).

**Thanks to:**
- OVL Extractor 2.0 (gamemodderz) and the RCT3 Importer / libOVL (Jonathan Wilson, belgabor et al.), for their
  OVL format research;
- GameExtractor (wattostudios), which was the starting point.

rct3ovl is a fresh implementation.

**Note:** this tool is for your own copy of the game. Don't share the game's files or the files extracted from
them.
