# RCT3 file types

RCT3 keeps almost everything in **`.ovl` files**. An OVL is a package, like a zip, and inside it are many
**resources**. Every resource has a name and a short **type tag**, e.g. `PirateShip:sid` is a resource called
`PirateShip` of type `sid`. So the "file types" below (`.ric`, `.shs`, `.snd`…) are really resource types inside
OVLs. rct3ovl writes each one out as a normal file.

Resources constantly point at each other, often across different OVLs. A scenery item (`sid`) points at its look
(`svd`), which points at its 3D model (`bsh`), which points at its textures (`ftx`), and so on. The viewer and the
extractor follow those links for you.

Every type entry below covers:
- **What it is:** the type in one line;
- **In the game:** what the game uses it for;
- **Inside:** what the record holds;
- **You get:** what rct3ovl turns it into;
- **Found in:** where it lives in the game folder.

The counts are from a full install (base game + Soaked! + Wild!).

**Quick reference:**

| Tag | In one line | You get |
|---|---|---|
| `shs` | Solid 3D model (scenery, path pieces, food, ride parts) | `.glb` |
| `bsh` | 3D model with a skeleton (ride cars, flat rides, animatronics) | `.glb` with animations |
| `svd` | An object's look: models per detail level, and their animations | `.json` |
| `ban` | Animation for a `bsh` (lap bar opening, ride motion) | inside the `.glb`, plus `.json` |
| `mdl`, `modelanim`, `wad` | Wild!'s walking-animal model and animations (elephant) | `.json` |
| `mam` | Invisible stand-in shape for complex pieces | `.json` |
| `tex` + `flic` + `btbl` | A picture and its pixels | `.png` |
| `ftx` | 256-colour picture you can recolour in-game | `.png`, plus a recolour preview |
| `gsi` | An icon cut from an icon sheet | `.png` |
| `fct` | Interface font | `.json` (letters via `tex`) |
| `psi` | Look of a particle (sparks, smoke, splashes) | `.json` |
| `ppg`, `prt` | Which parts make up a character (body, legs, head, extras) | `.json`, whole people as `.glb` |
| `mms` | Flip-book animated mesh: guest bodies, small animals | `.glb` with animations |
| `ssk`, `san`, `sal` | Detailed guest heads, their animations, and their bone list | `.glb`, `.json` |
| `phd` | Where hats and glasses sit on a head | `.json` |
| `ent` | Costumed entertainer (panda, shark, tiger…) | `.json`, plus People list |
| `snd` | Sound effect or ambient loop | `.wav` |
| `txt` | One piece of on-screen text, in every language | `text.json` |
| `spl` | Smooth 3D curve: ride routes, guest and animal walk paths, fences | `.json` with points |
| `sid` | **A buildable object**: type, size, cost, look, icon, name, behaviour | `.json` with named fields |
| `ptd`, `qtd`, `ter` | Path style, queue style, ground-paint texture | `.json` |
| `enc`, `asd`, `vwg` | Wild! enclosure fences, animal shelters, viewing gallery | `.json` |
| `chg`, `sat` | Soaked! changing rooms; special buildings (medical centre) | `.json` |
| `ric` | **One ride car**: its model and seating and physics numbers | `.json` (model in `models/`) |
| `rit` | **A whole train** of cars: car types, links, paint textures | `.json` |
| `anr` | **A flat ride** (pirate ship, carousel): routes, motion, prices | `.json` |
| `trr` | A ride on a fixed track (elevator) | `.json` |
| `sta` | **A shop or stall**: what it sells, its model and shutter animations | `.json` |
| `cid`, `ced` | **Things guests buy** (food, balloons, hats) and their extras (salt, ketchup) | `.json` (model in `models/`) |
| `rcg` | Research category | `.json` |
| `was` | Wild! animal species (elephant): models, sounds, needs | `.json` |
| `txs`, `tks` | Built into the game, never stored in OVLs: texture styles and track sections | names only |

## The containers

### `.common.ovl` and `.unique.ovl`
- **What it is:** the two halves of one package. They always come in pairs with the same name, e.g.
  `MineRide.common.ovl` + `MineRide.unique.ovl`.
- **In the game:** the game loads both halves together as one block of memory. *Common* holds data that can be
  shared, *unique* holds data that belongs to one object only. A resource can sit in either half, and pointers
  freely cross between them.
- **Inside:** a header, a list of loaders (one per type tag), the data blocks, a relocation table (which tells the
  game where all the pointers are), and a list of *imports*: names of resources this package needs from other
  packages.
- **You get:** rct3ovl reads both halves as one. In the viewer an OVL pair is one entry; the extractor writes one
  folder per pair with a `manifest.json` listing every resource in it.
- **Found in:** everywhere. The game has 3,011 pairs, in three format versions: 1 for the base game, 4 for
  Soaked! and 5 for Wild!.

### Built-in types: `txs`, `tks`
- **What it is:** types that OVLs *refer to* but never contain. The game defines them itself.
- **In the game:**
  - `txs` (**texture style**) is how a surface is drawn, e.g. `SIOpaque` (solid), `SIAlphaMask` (cut-out leaves
    and fences), `SIGlass`/`SIWater` (see-through) or `SIOpaqueSpecular50Reflection` (shiny).
  - `tks` (**track section**) is used by tracked rides, e.g. `ElevatorBaseSec:tks`.
- **You get:** `txs` names decide the material in exported models (solid, cut-out or see-through, lit or unlit).
  `tks` names are listed in the ride's JSON.

## 3D models

### `shs`: StaticShape (4,909)
- **What it is:** a solid 3D model that doesn't bend.
- **In the game:** most scenery (rocks, buildings, fences, signs), path pieces, ride parts, carried items (food,
  hats, balloons), and the low-detail versions of moving models.
- **Inside:** one or more meshes, each with:
  - vertices (position, normal, colour, texture coordinates) and triangles;
  - the texture it uses and its texture style (`txs`).

  Plus named **effect points**: spots where the game attaches lights, particle effects, seats, cameras or
  people.
- **You get:** `models/<name>.shs.glb`, a glTF model with its textures built in. It opens in Blender, Windows 3D
  Viewer and most 3D tools. Effect points become named empty objects.
- **Found in:** almost every folder.

### `bsh`: BoneShape (1,853)
- **What it is:** a 3D model with a skeleton, so parts of it can move.
- **In the game:** ride cars (lap bars opening), flat rides (the pirate ship swinging), animatronics, moving
  scenery, stalls with moving parts, animals.
- **Inside:** meshes like `shs`, plus a list of **bones** (each with a name, a parent and its resting position).
  Each vertex says which bones move it and by how much.
- **You get:** `models/<name>.bsh.glb` with the skeleton, skinning and **every animation that belongs to it**. The
  tool finds these through the model's `svd`. The viewer has an animation menu to play them.
- **Found in:** `Cars`, `Style\…\Rides`, `…\ShopsandStalls`, animated scenery.

### `svd`: SceneryItemVisual (2,263)
- **What it is:** the *look* of an object: which models to show, and which animations they can play.
- **In the game:** the game swaps models as you zoom out (**levels of detail**). For each level, `svd` lists:
  - the model (`shs` or `bsh`) or a flat billboard;
  - the distance at which it switches;
  - the bone animations (`ban`) that can play on it.

  Trees also get a **sway** value (how much they move in the wind) and a brightness.
- **Inside:** flags, sway, brightness, scale, and a list of levels of detail (model, distance, animations).
- **You get:** `data/svd/<name>.json`. It's also how rct3ovl knows which animations go with which `bsh`.
- **Found in:** next to the models it describes.

### `mdl`: Model (1)
- **What it is:** Wild!'s newer model format, used for animals that walk around.
- **In the game:** the elephant transport ride's elephant.
- **Inside:** a bounding box and two big extra-data blocks holding the mesh. The layout isn't decoded yet.
- **You get:** `data/mdl/*.fields.json` (header fields only).
- **Found in:** `Cars\TrackedRideCars\Elephant`.

### `mam`: ManifoldMesh (35)
- **What it is:** a simple invisible shape (a *proxy*) that stands in for a complex piece.
- **In the game:** used for underwater path pieces (`WaterCornerAHi_Proxy`), most likely for collision and
  clicking rather than drawing.
- **Inside:** a bounding box, counts, and a list of points and faces.
- **You get:** `data/mam/*.fields.json`.
- **Found in:** `Path\UnderWater`.

## Animation

### `ban`: BoneAnim (1,337)
- **What it is:** an animation for a `bsh` model.
- **In the game:** a coaster lap bar opening and closing (`CarBarOpen`), a flat ride's motion cycle, an
  animatronic dinosaur's roar, a stall shutter.
- **Inside:** a total duration, and for each bone a list of timed positions and timed rotations.
- **You get:** built into the model GLBs (play them in the viewer's animation menu), plus `data/ban/<name>.json`
  with the raw keys.
- **Found in:** next to the models they animate.

### `modelanim` (5) and `wad`: WildAnimalAnimData (1)
- **What it is:** animations for Wild!'s `mdl` animals, and the list tying them together.
- **In the game:** the elephant's walk, run, stand and two idles. `wad` lists which `modelanim` to play for each
  behaviour.
- **Inside:**
  - `modelanim`: a duration, a frame count and keyframe data;
  - `wad`: a list of animation links with blend timings.
- **You get:** `data/modelanim/*.fields.json`, `data/wad/*.fields.json`.
- **Found in:** `Cars\TrackedRideCars\Elephant`.

## Pictures

RCT3 stores all of its images **upside down** (bottom row first). rct3ovl flips them the right way up, and adjusts
the models to match.

### `tex`: Texture (538)
- **What it is:** a normal picture used on models or in the interface.
- **In the game:** ground and building textures, the menu backgrounds, logos, icon sheets.
- **Inside:** settings plus a link to the actual pixels (`flic`).
- **You get:** `textures/<name>.tex.png`.
- **Found in:** many folders. The interface ones are in `Main.common.ovl`.

### `flic`: Flic (525)
- **What it is:** the raw pixels of a `tex`.
- **In the game:** loaded straight onto the graphics card.
- **Inside:** a format (DXT1, DXT3, DXT5 compression, or plain 32-bit colour), a size, and every smaller copy of
  the image (mipmaps).
- **You get:** merged into the matching `tex` PNG. It isn't exported separately.

### `btbl`: BmpTbl (158)
- **What it is:** a bundle of many images packed into one block.
- **In the game:** used where an OVL has lots of textures. Each `flic` then just holds a number pointing into the
  bundle.
- **Inside:** a list of image headers and one big block of pixels.
- **You get:** merged into the matching texture PNGs.

### `ftx`: FlexiTexture (1,358)
- **What it is:** a 256-colour (paletted) picture. It's the type that makes **recolouring** possible.
- **In the game:** anything whose colours you can change in-game:
  - ride trains, stalls and buildings;
  - staff uniforms.

  Also animated textures, which have several frames. Palette colours 1–85, 86–170 and 171–255 are the 1st, 2nd and
  3rd recolourable colour. In the file they're drawn in placeholder blue, magenta and yellow; the game swaps in
  your chosen colours.
- **Inside:** a size, the frame count, and per frame a 256-colour palette, the pixels and transparency.
- **You get:**
  - `textures/<name>.ftx.png` in the placeholder colours;
  - a recolour preview with your own colours, in the viewer (colour pickers) or with the `recolour` command.
- **Found in:** next to the models, plus `Cars\SharedTextures`.

### `gsi`: GUISkinItem (3,833)
- **What it is:** an **icon**: a rectangle cut out of a big icon sheet (a `tex`).
- **In the game:** every build-menu thumbnail, ride icon, toolbar button and stat icon (the calendar, the save
  disk…).
- **Inside:** a type, the icon sheet it comes from, and the rectangle (left, top, right, bottom in pixels).
- **You get:** `icons/<name>.png`, the cut-out icon.
- **Found in:** `Main.common.ovl`, plus next to the objects they show.

### `fct`: Font (18)
- **What it is:** a text font for the interface.
- **In the game:** menus, numbers and labels, e.g. `GUIFontSmallNumbers`.
- **Inside:** character sizes and spacing, and the texture holding the letters.
- **You get:** the letter sheet as a PNG via its `tex`; the font record as `data/fct/*.fields.json`.
- **Found in:** `Main.common.ovl`, and `gui\800`, `gui\1024`, `gui\1280` (`Resolution.common.ovl`, one set per
  screen size).

### `psi`: ParticleSkin (41)
- **What it is:** the look of one kind of particle.
- **In the game:** sparks, flares, smoke, splashes, fountain spray and fireworks.
- **Inside:** blending settings and the particle picture sheet it draws from (`ParticlePage01`…).
- **You get:** the sheet as a PNG via its `tex`; the record as `data/psi/*.fields.json`.
- **Found in:** `Particles`.

## People

A guest is built from parts, like a dress-up doll: body, legs and head, plus extras like a hat or a handbag.

### `ppg`: PeoplePartGroup (157)
- **What it is:** one third of a character (`AF01_Body`, `AF01_Legs` or `AF01_Head`), with the part list for each
  level of detail.
- **In the game:** a character variant (AF01 = adult female no. 1) is its body, legs and head groups put together.
- **Inside:** lists of `prt` links, one list per detail level.
- **You get:** `data/ppg/*.json`, and whole characters in `people/<VARIANT>.glb` (also the viewer's **People**
  button).
- **Found in:** `Characters\<type>\<variant>_Body_Stub`, `_Legs_Stub`, `_Head_Stub`. Swimwear has its own
  groups (`…_SwimSuitBody1_Stub`).

### `prt`: PeoplePart (791)
- **What it is:** one wearable part, e.g. a body, a skirt, legs, a hat or a bag.
- **In the game:** says which mesh (`mms`) and which texture to use, for each level of detail.
- **Inside:** per detail level, a texture link and a mesh link.
- **You get:** `data/prt/*.json`. It's used for colouring parts and assembling people.

### `mms`: MorphMesh (798)
- **What it is:** a mesh that animates by storing **every vertex position for every frame**, a bit like a
  flip-book, instead of using bones.
- **In the game:** guest and staff bodies, legs and accessories, plus small animals (duck, seagull, fish, shark,
  ray). All parts of one character share the same set of about 190 animations: walk, applause, vomit, dance,
  sit…
- **Inside:**
  - the triangles, and for each animation the timings and frames;
  - per frame, each position packed into 32 bits (x:11, y:10, z:11) and each normal in 3 bytes.

  The textures are grids of **colour variants**: AF01's outfit texture holds 16 outfits, and the duck's holds
  4 plumages.
- **You get:**
  - `morphs/<name>.mms.glb` with the animations as glTF morph targets (the first 12, or the ones you pick with
    `--anims`);
  - the colour variant is chosen with `--variant` or the viewer's **Variant** menu.

### `ssk`: SimpleSkin (1,014)
- **What it is:** a detailed **head** with a few bones: neck, head, ponytail, glasses.
- **In the game:** used up close. Each guest head comes in two detail levels and six moods: normal, angry,
  happy, sad, scared, sick.
- **Inside:** bone names, vertices grouped by bone, and triangles.
- **You get:** `heads/<name>.ssk.glb` with its animations. It's also fitted onto whole people.

### `san`: SimpleAnim (3,010)
- **What it is:** an animation for an `ssk` head.
- **In the game:** keeps the head moving in step with the body. There's one per body animation, e.g.
  `head_af01_l1_walk`.
- **Inside:** timings, and per bone a position and a compressed rotation.
- **You get:** built into heads and people, plus `data/san/*.json`.

### `sal`: SimpleAnimList (27)
- **What it is:** the bone list shared by a family of heads.
- **You get:** `data/sal/*.json`.

### `phd`: PeopleHead (87)
- **What it is:** attachment frames for a head: where hats and glasses sit.
- **Inside:** a few 4×4 position/rotation matrices.
- **You get:** `data/phd/*.json`.

### `ent`: Entertainer (14)
- **What it is:** a costumed entertainer: panda, shark, tiger, alien…
- **In the game:** the staff member you hire to cheer guests up.
- **Inside:**
  - the costume's head, body and legs part names (`Panda_Head`, `Panda_Body`, `Panda_Legs`);
  - the name (`txt`) and the costume icon;
  - an icon (`gsi`) for each of the uniform colours you can pick.
- **You get:** `data/ent/*.fields.json`. The costume itself is in the People list (PANDA, SHARKY…).
- **Found in:** `Characters\Entertainers`.

## Sound and text

### `snd`: Sound (546)
- **What it is:** a sound effect or ambient loop: screams, splashes, music stingers, animal noises, ride sounds.
- **Inside:** the audio format (all are mono, 16-bit, 11–22 kHz), a loop flag, 3D distance settings, and the raw
  audio.
- **You get:** `sounds/<name>.wav`. The viewer plays it.
- **Found in:** `Sounds` (the main set, plus `CTNewFX` for Soaked!, `Waterfall` and `Wild`), `Main.common.ovl` and
  `Particles`.

### `txt`: Text (124,296)
- **What it is:** one piece of text the player can see: a ride name, a description, a menu label, a guest thought.
- **In the game:** every language has its own full set in `gui\<Language>.common.ovl`. Other resources link to
  text by name (`PirateShipRideName:txt`).
- **Inside:** the text in Unicode.
- **You get:** a `text.json` per OVL (name → text), and a searchable table in the viewer. `--language German` etc.
  picks the language used for names everywhere.

## Paths and motion

### `spl`: Spline (887)
- **What it is:** a smooth 3D curve.
- **In the game:**
  - the route a ride's cars or boats follow (`pirateshipLoop`, `ElevatorPath01`);
  - where guests walk inside an attraction;
  - how fences and walls run between posts;
  - where animals eat, drink and sleep in their shelters.
- **Inside:** points with curve handles, the total length, and whether it loops.
- **You get:** `splines/<name>.spl.json` with the points and a ready-to-draw list of sampled positions.

## Buildable things

### `sid`: SceneryItem (2,082)
- **What it is:** a **buildable object**, i.e. anything that appears in a build menu.
- **In the game:** trees, benches, bins, lamps, signs, walls, path pieces, track pieces, supports, rides, stalls
  and entrances. It's the central record that ties everything else together.
- **Inside:**
  - **type:** tree, bench, ride, stall, wall, path, support, ride track…;
  - **footprint** in tiles and size class (full tile, half tile, path edge…);
  - **placement box**;
  - **cost and refund** (in the game's money units);
  - **looks:** its visuals (`svd`) and its icon (`gsi`);
  - its **name** (`txt`) and **special behaviours** (`ParkBench`, `LitterBin`, `Sign`, `RideEvent`, `Waterable`…);
  - **supports** and **sound sets**.
- **You get:** `data/sid/<name>.json` with named fields and the name in your language, e.g. "Log bench", type
  bench, cost 300.
- **Found in:** `Style\…`, `Path`, `Scenery`, ride folders.

### `ptd`: PathType (10)
- **What it is:** a footpath style: asphalt, crazy paving, tarmac…
- **Inside:**
  - the name, icon and research category;
  - the names of all its pieces: flat, straight, corners, slopes, ground textures.
- **You get:** `data/ptd/*.fields.json`.
- **Found in:** `Path\<Style>`.

### `qtd`: QueueType (5)
- **What it is:** a queue-line style.
- **Inside:** the name, icon, ground texture, and the piece names (straight, turn left/right, slope up/down).
- **You get:** `data/qtd/*.fields.json`.
- **Found in:** `Queue\<Style>`.

### `ter`: TerrainType (38)
- **What it is:** a ground texture you can paint with the land tool.
- **Inside:** the texture, the help-text name, and tiling and colour values.
- **You get:** the picture via its `tex`; the record as `data/ter/*.fields.json`.
- **Found in:** `terrain`.

### `enc`: EnclosureType (3), Wild!
- **What it is:** an animal enclosure fence style: chain-link, wood…
- **Inside:** the piece names (full, end, corner, gate, viewing windows…), the name and icon, the fence splines,
  and price and strength numbers.
- **You get:** `data/enc/*.fields.json`.
- **Found in:** `Enclosures\Fences`.

### `asd`: AnimalShelterDesc (6), Wild!
- **What it is:** an animal shelter, e.g. `BigCatShelter`.
- **Inside:** its scenery item, the keeper's shed, and splines for where animals eat, drink and sleep (separate
  male/female routes).
- **You get:** `data/asd/*.fields.json`.
- **Found in:** `Enclosures\Shelters`.

### `vwg`: ViewingGallery (1), Wild!
- **What it is:** the viewing gallery guests use to watch animals.
- **Inside:** its name, icon, a spline and settings.
- **You get:** `data/vwg/*.fields.json`.

### `chg`: ChangingRoom (4), Soaked!
- **What it is:** a pool changing room.
- **Inside:** its scenery item, its name, and the walking spline guests follow inside.
- **You get:** `data/chg/*.fields.json`.
- **Found in:** `Style\…`.

### `sat`: SpecialAttraction (9)
- **What it is:** a special building with its own job, e.g. the **medical centre** (`Mcentre`).
- **Inside:** the name and description, icon, guest spline, its scenery item, and money values.
- **You get:** `data/sat/*.fields.json`.
- **Found in:** `Style\…\Scenery`.

## Rides

### `ric`: RideCar (280)
- **What it is:** **one car of a ride**, e.g. the "6 Peep Wooden Reversed Car".
- **In the game:** the vehicle guests sit in. Coasters, flat-ride gondolas and boats all use cars.
- **Inside:**
  - the car's internal name and display name;
  - its visual (`svd`, which holds the model and the lap-bar animations);
  - about 60 numbers for seating, size and physics. Their exact meanings aren't named yet.
- **You get:** `data/ric/*.fields.json`. The car model itself is in `models/` (`bsh`).
- **Found in:** `Cars\CoasterCars\<car>`, `Cars\TrackedRideCars\<car>`.

### `rit`: RideTrain (186)
- **What it is:** **a whole train** made from cars.
- **In the game:** sets the front car, the middle cars, the coupling links between them, and the train's name and
  style.
- **Inside:**
  - links to its `ric` cars (`6PWoodenRCReversed:ric`, `ArrowsLink:ric`);
  - the recolourable textures and texture styles for the paint options;
  - car counts and physics and spacing numbers.
- **You get:** `data/rit/*.fields.json`.
- **Found in:** next to the cars.

### `anr`: AnimatedRide (125)
- **What it is:** **a flat ride**, one that moves on the spot instead of along a track: pirate ship, carousel,
  top spin…
- **In the game:** defines the ride you place: its name and description, the route guests walk to board, the
  ride's motion loop and the paths of its moving parts, its scenery item, and prices and capacity.
- **Inside:** name and description (`txt`), icon (`gsi`), a loop spline and path splines (`spl`), its scenery item
  (`sid`), and timing and money numbers.
- **You get:** `data/anr/*.fields.json`. The ride model and its animation are in `models/`.
- **Found in:** `Style\<theme>\Style.common.ovl` (the definitions) and `Style\…\Rides` (the models).

### `trr`: TrackedRide (4)
- **What it is:** a ride that runs on a fixed track, defined in an OVL. Example: the elevator.
- **Inside:**
  - name, description and icon;
  - the loop and path splines;
  - the track section (`tks`) it uses, e.g. `ElevatorBaseSec:tks`;
  - speed and timing numbers.
- **You get:** `data/trr/*.fields.json`.
- **Note:** most coasters' track pieces aren't `trr`: they're scenery items of type *ride track*, plus their
  visuals and splines.

## Shops and items

### `sta`: Stall (111)
- **What it is:** **a shop or stall**, e.g. the toy cutlass stall, burger bar or balloon stall.
- **In the game:** what the stall sells, its building, how it animates, and what it costs.
- **Inside:**
  - name and description, icon, the guest spline, its scenery item;
  - the **items it sells** (`cid`);
  - its model at four detail levels (High, Medium, Low, UltraLow) with their shutter animations (`ban`);
  - prices and numbers.
- **You get:** `data/sta/*.fields.json`. The stall models are in `models/`.
- **Found in:** `Style\<theme>\ShopsandStalls\<stall>`.

### `cid`: CarriedItem (179)
- **What it is:** **something a guest buys and carries**: food, drinks, balloons, hats, sunglasses, maps, toy
  swords, swimwear…
- **In the game:** the model in the guest's hand, how it's held, and what it does to the guest: hunger, thirst,
  happiness, how long it lasts, and the litter it leaves (`FoodWrapper:cid`).
- **Inside:**
  - the name, plus a plural for shop menus ("Hershey's bars");
  - icon (`gsi`) and model (`shs`);
  - the leftover item;
  - optional extras (`ced`, e.g. nuts, caramel);
  - numbers for price and effects.
- **You get:** `data/cid/*.fields.json`. The item model is in `models/` (e.g. `BagOfSweets.shs.glb`).
- **Found in:** `CarriedItems`.

### `ced`: CarriedItemExtra (41)
- **What it is:** **an optional extra** for food or drink: salt, sugar, ketchup, crushed nuts, caramel…
- **Inside:** its name, its icon and one effect number.
- **You get:** `data/ced/*.fields.json`.
- **Found in:** `CarriedItems`.

## Research

### `rcg`: ResearchCategory (58)
- **What it is:** **a research category**, e.g. "Mini rides", "Basic path".
- **In the game:** groups what gets researched together, with a cost or speed number. Other things link to their
  category (paths link to `BasicPath:rcg`).
- **Inside:** a name, a display name and two numbers.
- **You get:** `data/rcg/*.fields.json`.
- **Found in:** `Inventions`.

## Wild! animals

### `was`: WildAnimalSpecies (1)
- **What it is:** **an animal species**, e.g. the elephant.
- **In the game:** everything about the species:
  - name, description and icons;
  - models for adult and young, and its animation set (`wad`);
  - its sounds (`AnimalEat:snd`) and its shelter type;
  - size, speed, lifespan and needs.
- **You get:** `data/was/*.fields.json`.
- **Found in:** `Cars\TrackedRideCars\Elephant` (the elephant transport ride).

## What the extractor writes

| File | Contents | Opens in |
|---|---|---|
| `models/*.glb`, `morphs/*.glb`, `heads/*.glb`, `people/*.glb` | 3D models with textures and animations | Blender, Windows 3D Viewer, https://gltf-viewer.donmccurdy.com, game engines |
| `textures/*.png`, `icons/*.png` | Pictures (the right way up) | Any image viewer or editor |
| `sounds/*.wav` | Audio | Any media player |
| `splines/*.spl.json` | Curves with sampled points | Text editor; plot in Blender or Python |
| `data/<type>/*.json` | Decoded records with named fields (`sid`, `svd`, `ban`, `san`, `ppg`, `prt`…) | Text editor, browser |
| `data/<type>/*.fields.json` | Field-by-field dump of any record (see below) | Text editor, browser |
| `text.json` | Every text string in that OVL, name → text | Text editor, browser |
| `manifest.json` | Every resource in that OVL: type, name, which half it's in, the files made from it | Text editor, browser |

**How a `*.fields.json` dump works:** for types whose fields don't have names yet, each 32-bit field is shown
as one of the following, using the OVL's relocation table to tell them apart:
- **an import:** the name of a resource it links to, often in another OVL, e.g. `"import": "LongLink:svd"`;
- **a pointer:** followed into the text, named resource or nested record it points at;
- **a decimal number**, if it looks like one, e.g. `50.0`;
- **a whole number.**

That makes even undocumented records readable. You can see what links to what, and compare numbers between
similar items.

## Whole people
A guest is built from three part groups (body, legs, head). Each group lists, per detail level, morph-mesh parts
with textures. At the highest detail the head is a skinned `ssk` with matching `san` animations instead of a
morph mesh.

`people/<VARIANT>.glb` and the viewer's People list put all of that together, and they handle some special
cases:
- head-only variants (AF03 wears AF01's outfit);
- variants whose parts use another name (POPSTAR01's parts are `PF01`);
- mascots without a detailed head (PANDA, SHARKY, ALIEN01, TIGER);
- staff with their own animation sets (lifeguard LG01: seated idle, mechanic, handyman, vendor…).

Variant names:

| Prefix | Who |
|---|---|
| AF, AM | Adult female / male |
| CF, CM | Child female / male |
| TF, TM | Teen female / male |
| VF, VM | VIP female / male |

Other variants are staff and specials.
