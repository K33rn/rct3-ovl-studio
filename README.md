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
- **Left column:** every OVL file in the game, in its folders. Each coaster and tracked ride folder (`tracks\coasters\WoodenRC`…) also has a **🛤 … track pieces** entry with exactly that ride's pieces; the game keeps them in shared `TrackNN` files. Type in the box to filter, e.g. `coaster` or
  `chess`.
- The same list has every **firework-related file** in its folder, with an icon for each kind: fireworks
  (`Fireworks\*.frw` 🎆), the game's other particle effects (`ParticleEffects\*.frw` ✨: smoke, splashes, sparkles),
  firework shows (`FireworkDisplays\*.fwd` 🎇), lasers (`Lasers\*.las` ✳), water jets (`WaterJets\*.wjt` ⛲), laser
  drawings (`LaserWriting\*.lwr` ✎) and the music (`Music\*.wma` ♪). Files you saved from the Fireworks tab are
  marked **yours**. Picking one shows a summary (name, cost, colours, particle tree, launchers and launches, the
  drawing, a music player) with buttons to **preview** it or **open** it in the Fireworks tab (the show in the
  MixMaster, a firework or particle effect in the Advanced Firework Editor, a laser or jet in its designer) and to
  download it. The middle column lists every object stored in the file; pick one to see all of its fields.
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
- **Peeps** lists every guest, staff member and entertainer as a whole, animated character. In eating and drinking animations (WalkEatRHand, SitBenchDrinkL…) a **Hold** menu puts any of the game's foods or drinks in the right hand; the item follows the game's own hand attachment point.
- **Thrill Rides** lists the flat rides (Pirate Ship, Top Spin, Ferris Wheel, Soaked! and Wild! rides, themed rides…) with their ride animations: Static, Start, Loop and Stop. Each ride opens playing its loop.
- **Ride Designs** lists the game's 208 premade coasters and tracked rides (the `Coaster Designs` folder), grouped by ride type. Each is built from its track pieces into one 3D model, with its stats: excitement/intensity/nausea, top speed, length, drops, inversions and cost.
- **Scenery** lists all 1,330 scenery items (trees and plants, scenery, animatronics, walls and roofs, fences, path extras, shops and stalls, entrances, ride events, pools, enclosures, terrain, effects), grouped by category and theme. Animated items are marked ⟳ and play their animation. The filter box narrows the list as you type.
- **Fireworks** opens the **MixMaster**, a full-window show editor; **← Back** (or Esc) returns to the viewer.
  - It starts on your autosaved show, or a new empty one. The game's firework shows (Haunted Skies, Lunar Lights, Pirate Pyrotechnics, Stratosphere) open from the show list; any of them may be missing from your game folder.
  - Three kinds of effects, as in RCT3 Soaked!, each with its own palette tab:
    - **Fireworks:** the 28 game fireworks, simulated from the game's own particle data and drawn with its sprites, sounds and a glow effect.
    - **Lasers:** the 8 game lasers (cone of light, plane of light, persisting image).
    - Particle textures that are animated sheets (smoke, fire, water, rubble, electric sparks) play their frames over each particle's life, as in the game.
    - Particles are blended as in the game (premultiplied alpha): flares and fire always glow; smoke, spray, bubbles and rubble fade in and out with the particle's alpha (opacity) curve.
    - What you made in the game's own designers is read too: fireworks from `My Documents\RCT3\FireworkEffects`, lasers from `LaserEffects`, water jets from `WaterJetEffects`, shows from `Fireworks` and drawings from `LaserWriting`. They are marked *made in game* in the palette and the file list.
    - **Water Jets:** the 2 game water jets.
  - ▶ previews any effect, ✎ edits it (a game effect is copied first). Drag effects onto the timeline, or double-click an empty spot to add the one picked in the palette.
  - Effects need the right launcher: mortars and the Catherine wheel fire fireworks, laser domes fire lasers, water jet bases fire water jets. A matching launcher is added for you if the show has none.
  - **Per launch:** time, track, launcher and tube, colour (the game's colour modifier), and strength for fireworks (more or fewer particles, the game's strength modifier).
  - **Base aiming controls:** click the *Aiming* bar above the tracks to add an angle control point for the selected launcher. Set its turn and tilt in the right-hand panel, or drag a green-highlighted launcher in 3D. One point can control several launchers (tick them). Right-click a point to remove it. Aiming turns where a launcher fires (an orange arrow shows it while you edit the point); the launcher itself stays where it stands. Selecting or editing a point moves the playhead to it, so you see exactly that point's aim.
  - **Landscape:** raise, lower, smooth and flatten the ground, and paint water at a level. Fireworks and lasers reflect in the water.
  - **Placing things in 3D:** the **Bases** tab shows the six MixMaster bases with pictures. Drag one into the 3D view: a see-through preview follows the mouse and it is placed where you let go.
    - Drag a firework, laser or water jet into the 3D view as well. Drop it on a matching launcher, or on the ground to place a new matching base there. It is added at the playhead on a free track.
    - Drag a launcher in the 3D view to move it. **Shift-drag** a launcher or scenery piece up or down to raise or lower it (PageUp / PageDown: 0.5 m, with Shift 2 m). **R** turns the selected launcher (Shift+R the other way).
  - **Grid snap** (top bar): on, bases snap to park tiles, and the small ones (single mortar, laser dome, water jet) to tile corners, as in the game; R turns a quarter. Off, bases go anywhere and R turns 15°. Export to RCT3 snaps free placements to the nearest tile.
  - **Scene** (top bar): time of day (Day, Sunset, Night) with the game's sky colours, clouds and stars; a skyline backdrop (Hill, City, Desert, Island, Mountain, Snow, Spooky, Space); tile grid lines on or off; and the ground texture (plain night grass, or any of the game's 32 ground textures). Kept with the show.
  - **$** (palette footer) shows or hides all prices.
  - **Scenery:** the **Scenery** palette tab lists all 1,330 of the game's scenery pieces (search, filter by category or *animated only*, ⟳ = animated). Drag one into the 3D view (a see-through preview follows the mouse) to place it.
    - Click a piece to select it (orange box); drag it to move it, **R** turns it, **Delete** removes it; the right-hand panel also raises, duplicates or removes it.
    - Pieces and launchers stand on the highest surface under them. Drop launchers or effects onto a piece to put them on top. Move the piece and the launchers on it go with it.
    - **Animations:** a piece loops its animation all the time, only plays when cued, or stands still. Pick its clip in the panel.
    - **Timing:** *Cue at playhead* puts a ⟳ block on the timeline that starts the piece's animation at that moment, as long as the animation (or repeating for a set time). Line fireworks, lasers and water jets up with it. Playing or scrubbing shows the animation exactly where it would be at that time. Cue blocks can be moved, copied and pasted like any effect.
  - **Show settings:** name, daily start time, the months it plays, and music (the game's tracks or any music file).
  - **Playback:** play, pause, stop and rewind, ¼× to 2× speed. Music plays from the playhead. **Scrubbing:** drag the time ruler or the red playhead; the show follows and a snippet of the music plays at each spot. Change the time scale with − / +.
  - **Bursts on the bar:** a firework's bar marks each moment it bursts (thin lines), as in the game, so you can time bursts to the music.
  - **Cameras:** crowd view, autolook (follows the bursts), close up, top down, slow orbit and freelook.
  - **Selecting several effects:** drag a box across empty timeline space, or Ctrl/Shift-click them. Ctrl+A selects everything.
  - **Clipboard:** copy, cut and paste parts of a show (Ctrl+C / Ctrl+X / Ctrl+V). Pasting puts them at the playhead with their spacing and tracks kept, also into another show.
  - **Group edits:** drag one selected effect to move them all; Ctrl-drag clones them, as in the game. ←/→ nudges 0.1 s (Shift: 1 s), ↑/↓ changes track. Duplicate, Delete, Preview with their own timing, or change their effect, launcher, colour or strength together.
  - **Removing:** right-click an effect on the timeline (or select it and press Delete).
  - **Keys:** Space play, Delete remove, Ctrl+Z/Ctrl+Y undo/redo, Ctrl+D duplicate, F fire the selection, Esc deselect (again: back), +/- time scale. Hold Alt while dragging to turn off snapping.
  - **Saving:** your show is autosaved in the browser. Your own fireworks, lasers and water jets are kept in the browser and on disk (`~/.rct3ovl/my_effects.json`), so they survive clearing the browser's storage. **Save** downloads it as a `.fireworks.json` (including your own effects) to **Open…** later.
  - **Export to RCT3…:** downloads the show as a `.fwd`, or saves it straight into the game's `FireworkDisplays` folder, along with any of your own fireworks it uses. The game's display format only holds fireworks, launchers, music, start time and months, so lasers, water jets, aiming, landscape and colour/strength changes stay in the editor.
  - **Advanced firework editor (AFE):** RCT3's hidden Firework Designer (in the game: rename a guest to "Guido Fawkes", then in the MixMaster double-click a firework in the effect picker; here it is always available). Click ✎ *Advanced firework editor* on the Fireworks tab.
    - It edits a firework's whole particle tree: add, duplicate, move or remove emitters, with every setting in the game's groups (emitter rate, speed and rotation; particle basics, life, motion, special effects, modifiers). Each slider has the game's own range and step (read from the game's Firework Designer), e.g. Parent 0–1, Gravity −2–2.
    - **New** starts an empty firework (only the base); add emitters with **+ Child emitter**. A new emitter starts at the defaults: 1 particle, end time 1, lifetime 1, start and end size 1, everything else at its lowest.
    - The preview frames the launcher it fires from, and plays alone (the show and other previews stop while an editor is open).
    - Particle extras drawn as in the game: **Burn Length / Burn Size** (a fading trail of that many copies behind each particle), **Spin Rate** (the sprite turns), **SpinRateX / Y** (the particle turns, so what it releases spins), **UpScale** (a push of that many g sideways to the particle's path, along its own "up", which SpinRateY turns about the path: a bent path, or a corkscrew - as the game's particle update does it).
    - Bottom panel: the particle's colour over its life, as a gradient with colour stops (click to add, drag to move, drag off or right-click to remove; colour picker, quick swatches, location, Reverse, Distribute), and its texture. Each stop also has an **Opacity**, which fades textures with transparency (smoke, spray, bubbles, rubble) in and out; flares and fire always glow.
    - Under the colour: how many particles one launch releases, how long it lasts and how many are on screen.
    - The firework fires in the 3D view as you edit, and Ctrl+Z undoes.
    - **Save firework** adds it to your fireworks; **Save to game** writes a `.frw` into the game's `Fireworks` folder; **Download .frw** saves the file.
    - A game installed under Program Files: Windows keeps what RCT3 saves there in its VirtualStore folder (`%LOCALAPPDATA%\VirtualStore\...`). The viewer reads fireworks, lasers, water jets, shows and drawings from there too (so the ones you made in the game's own designer show up), and saves there when it may not write into the game folder.
  - **Advanced laser designer** and **advanced water jet designer:** type, duration, power (5–20,000 m), beams, trail persistence (0–2 s), image spread (1–45) and centring, with the game's ranges. Timelines of control points for colour, rotation speed, elevation and beam width (lasers: on the game's scale, 1 is a normal thin beam and about 1.57 a broad searchlight cone, up to 2; wider beams spread their light, so they glow less), or pressure, elevation, jet radius and colour (water jets).
    - Persisting-image lasers draw frames you sketch on the game's 32 × 24 drawing pad, or the game's laser drawings.
    - Save to your lasers / water jets, to the game (`.las` / `.wjt`) or as a download.
  - **Game files:** files written into the game folder are built from the game's own files of the same kind, so they load like the originals. The MixMaster never overwrites the game's own files (the Textures & GUI tab does, after copying them).
  - The game's `.wma` music is converted once with ffmpeg; `rct3ovl-viewer.bat` includes it (`--with imageio-ffmpeg`).
- **Parks** opens every park the game ships with full-window: the 18 campaign scenarios, the 9 Soaked! and 12 Wild!
  ones, Blank Landscape, Coaster Designer and the sandbox (`Campaigns\*.dat`). **← Back** (or Esc) returns to the viewer.
  - **In 3D:** the landscape with the game's ground textures (land the park doesn't own shaded, land for sale yellow),
    water and the sea around island parks, footpaths and queues, and every placed item at its tile, height and
    direction: trees, buildings, walls, path extras, flat rides, shops, entrances and raised paths (bridges and
    slopes join up, standing on their path style's supports, which reach up to the middle of slopes and stairs and
    stand on any path below). Queues have their queue type's floor and railings. Every coaster and tracked ride is built from
    its track pieces, standing on the game's own supports for its style (steel columns, wooden or mine-train
    lattice; suspended coasters hang from columns with girders), with its trains where they stood: every car,
    including the hanging cars of swinging coasters. Guests and staff are full models (their own body, legs and head
    and their clothing colours, walking or standing); riders sit in their seats in the ride's pose (lap bar,
    harness with dangling feet, or lying), with the ducks and Wild! animals where they were when the park was
    saved. Animated scenery, rides, people and animals play. People load last (the first time a park is opened this
    takes a minute or so). Far from the camera people are drawn as simple figures (they'd be a few pixels tall) so
    the whole park stays smooth when you zoom out; their full models come back as you get closer.
  - Drag to turn, right-drag to move, wheel to zoom, arrows or WASD to move. Click anything to see what it is, which
    tile it stands on and how high. **Whole park** frames the park's land; **Park camera** jumps to where the game's
    camera was. The buttons along the top turn scenery, rides, paths, water, people, land shading, the tile grid
    and animations on or off.
  - **Information** (right): **Overview** (description, guests, rating, cash, loan, opening hours, land, weather,
    the park rating breakdown and history), **Goals** (what to reach for **Apprentice**, **Entrepreneur** and
    **Tycoon**: guests, park value, rating, income, coaster stats, VIP visits, repaying the loan, animal goals,
    each with how long it must be held; plus the Soaked!/Wild! challenges with their story texts), **Rides** (ratings,
    price, takings, trains; click one to fly to it), **Shops** (items, prices, sales), **People** (guests with
    happiness, cash and rides; staff), **Money** (every money field, the monthly income and spending table, history
    graphs), **Research**, **Scenery** (every item used, counted) and **Data** (all the park's settings and every
    kind of object in the save).
  - It has its own walkthrough, the first time it opens (**? Tour** replays it).
- **Textures & GUI** opens two editors full-window, switched at the top: the **Texture Editor** and the **GUI Editor**.
  What you change is saved back into the game's own files. Before the first change to a game file, the file is
  copied (to `.rct3ovl\backups` in your user folder); **Changed files** (top right) lists what you changed and
  **Restore original** puts a file back. Close RollerCoaster Tycoon 3 before saving. The game checks the main
  interface and style files against the `.CHK` files beside them when it starts, so those are updated with every
  save (and put back on restore). Tried in the game: a changed front-screen picture and changed menu texts show up.
  - **Texture Editor:** every texture in the game (2,366: ground, paths, buildings, rides, people, signs, the menus
    and icon sheets), searchable and filtered by folder and kind (256-colour, recolourable, animated, interface, changed
    by you). Tools: brush, pencil, eraser, fill, colour picker, line, rectangle, ellipse, text and select (drag inside a
    selection to move it; copy, cut and paste, also pictures copied from other programs). Adjust brightness, contrast,
    hue and saturation, invert, greyscale, tint, flip and turn, for the selection or the whole picture. Undo and redo,
    a pixel grid when zoomed in, colour-only or transparency-only views, the frames of animated textures (with Play),
    and a preview of recolourable textures in colours you pick. **Import…** takes a PNG or JPG (scaled to the
    texture's size, or into the selection), **Export PNG** saves it. **Save into game** writes it in the same size and
    format (DXT1/3/5 compressed, 32-bit, or 256 colours; the smaller mipmap copies are made for you; recolourable
    textures keep their recolour palette).
  - **GUI Editor:** the interface. **Game interface** (Main, the front screen scenario logos, the loading screen) and
    **Object icons** (scenery, rides, shops, paths, pools, animals, carried items) open their icon sheets with every
    icon outlined: drag an icon's box to move it, its handles to resize it (or type the numbers), double-click or
    **Edit pixels** to paint it in the Texture Editor, **Replace with picture…** to put your own picture in its place.
    **All icons** shows them as a gallery. **Button states** plays each button with its own pictures (normal, hover,
    pressed, disabled). **Animations** plays numbered icon sets frame by frame at the speed you choose (and exports
    them as a strip). **Window frames** shows the window, panel and scroll bar pieces cut where the game cuts them and
    stretched to the size you pick. **Menu screens, sheets & fonts** open the front-end backgrounds, logos, icon
    sheets and font letter sheets in the Texture Editor. **Menu text** edits every text of each language (a text can be
    as long as the one it replaces).
  - It has its own walkthrough, the first time it opens (**? Tour** replays it).
- **Walkthrough:** a guided tour starts the first time you open the viewer. It highlights each part of the screen, explains it and opens examples on every tab. The MixMaster has its own tour the first time it opens, and it opens and walks through the Advanced Firework Editor, the laser designer and the water jet designer on the way. **? Tour** (top left in the viewer, next to MixMaster in the MixMaster) replays it; pressed while the firework editor or a designer is open, it explains that editor. ← → or Enter move, Esc stops.
- **File types** opens the guide to every file type: the OVL resource types and the loose firework files (`.frw`, `.fwd`, `.las`, `.wjt`, `.lwr`, `.wma`). A firework file's summary has a **?** that jumps to its entry.
- The eight tabs (File types, Peeps, Thrill Rides, Ride Designs, Scenery, Fireworks, Parks, Textures & GUI) sit under the title; the one in use is highlighted.
- Drag the thin divider on the right edge of either list column to make it wider or narrower (double-click a divider to reset it). Widths are remembered.
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

**Thanks to:**
- OVL Extractor 2.0 (gamemodderz) and the RCT3 Importer / libOVL (Jonathan Wilson, belgabor et al.), for their
  OVL format research;
- GameExtractor (wattostudios), which was the starting point.

rct3ovl is a fresh implementation.

**Note:** this tool is for your own copy of the game. Don't share the game's files or the files extracted from
them.
