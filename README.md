# rct3ovl: RollerCoaster Tycoon 3 OVL extractor and 3D viewer

Reads RCT3's `.common.ovl` / `.unique.ovl` pairs (base game v1, Soaked! v4, Wild! v5) and turns them into
normal files:
- textures and icons to PNG;
- models to glTF (`.glb`, with textures, skeletons and animations);
- whole guests and staff to animated GLBs;
- sounds to WAV;
- text to JSON;
- every other definition (scenery items, rides, stalls, splines…) to readable JSON.

A browser viewer shows all of it for the whole game folder.

Compared with GameExtractor's `Plugin_OVL_FGRK`, which only cuts v1 files into numbered raw blobs (`0001.unk`),
rct3ovl:
- reads all three OVL versions;
- resolves the shared common+unique address space, relocations and cross-file symbol names;
- decodes the content instead of dumping bytes.

## Use

Needs Python 3.10+ with `numpy` and `pillow` (or `uv`, which fetches them):

```
uv run --no-project --with numpy --with pillow python -m rct3ovl <command> ...
```

| Command | What it does |
|---|---|
| `view "<game data folder>"` | Opens the viewer at http://127.0.0.1:8765 (or double-click `rct3ovl-viewer.bat`) |
| `extract "<folder or .ovl>" -o out` | Everything in the table below, plus `manifest.json` and `text.json` per OVL and whole people in `out/people/`. See the options below |
| `person "<game data folder>" AF01 [--anims Walk,Idle] [--expression Happy] [-o AF01.glb]` | One whole character as an animated GLB. Use `list` instead of a name to see all 57 |
| `recolour <ftx ovl> <name> --colors ff0000,00ff00,0000ff [-o out.png]` | Preview a recolourable FlexiTexture in your own colours. Leave a slot empty (`ff0000,,0000ff`) to keep a channel |
| `info <ovl>` / `list <ovl> [--type shs]` | Header, loaders, resources |
| `index "<game data folder>"` | Rebuild the name index (cached in `~/.rct3ovl`) |

Options for `extract`:

| Option | Effect |
|---|---|
| `--type shs,tex` | Only these types |
| `--anims Walk` | Only these animations in models, parts and heads |
| `--person-anims` | Animations for the whole-people exports (default `Walk,Idle,Applause,Converse`) |
| `--no-people` | Skip the whole-people exports |
| `--raw` | Also dump extra-data blobs |

`--language German` (before the command) picks the language for names and text. The choices are English (the
default), German, French, Spanish, Dutch, Danish, Finnish, Italian, Norwegian and Swedish.

Many things live in a different OVL from the one that uses them: a model's texture, a scenery item's name text,
a guest's head animations. Extraction and the viewer resolve these across the whole game folder through the
index.

### Viewer
- **Tree** of all OVLs, with badges for models, textures and sounds.
- **Resource list** grouped by type. Everything is clickable.
- **3D view:**
  - orbit, wireframe, skeleton, grid and spin;
  - an **animation picker** with play/pause, for ride bars, animatronics, guest walk/dance/vomit and so on;
  - animations that aren't in the current file load when you pick them.
- **Texture view** with **recolour pickers** for recolourable FlexiTextures.
- **Sound player.**
- **Searchable text table.**
- **JSON view** for definitions.
- The **People** button lists every guest, staff member and mascot, assembled from their parts.
- **Download** saves whatever is shown (GLB, PNG, WAV, JSON).
- **Deep links:**
  - `#ovl=<path>&res=<name>[&anim=<name>]`
  - `#ovl=<path>&texts=1`
  - `#person=af01[&anim=Dance]`

## What every file type is

An OVL holds *resources*, each tagged with a short type code. The pair splits them: `.common.ovl` holds data
shared between game sessions, `.unique.ovl` holds per-object data. The tags below are every type in a full
install (base game, Soaked!, Wild!), most common first, with what each does in the game and what rct3ovl gives
you.

### Things you can see or hear

| Tag | Type (count) | What it is in the game | Output |
|---|---|---|---|
| `shs` | StaticShape (4,909) | A rigid 3D model: scenery, path pieces, ride parts, low-detail versions of skinned models. Holds meshes (vertices, triangles, texture name, material style) plus named *effect points*, which are attachment spots for lights, particles, seats and camera | `models/*.shs.glb`; effect points become named empty nodes |
| `bsh` | BoneShape (1,853) | A skinned 3D model with a skeleton: ride cars, flat rides, animatronics, animals. Each vertex is weighted to up to 4 bones | `models/*.bsh.glb` with skin, skeleton and every animation that belongs to it (found through `svd`) |
| `ban` | BoneAnim (1,337) | A skeletal animation for a `bsh`: per bone, timed position keys and rotation keys (axis-angle). Examples: a coaster's lap bar opening, a flat ride spinning, an animatronic dinosaur | Built into the model GLBs; also `data/ban/*.json` |
| `svd` | SceneryItemVisual (2,263) | The *look* of an object: its levels of detail (model + switch distance), and for each level the animations that can play on it, plus sway (for trees), brightness and flags. This is the link between models and their animations | `data/svd/*.json` |
| `tex` | Texture (538) | A normal texture header: points at its pixel data (`flic`) and says how it is drawn (`txs` texture style) | `textures/*.tex.png` |
| `flic` | Flic (525) | The actual pixel data of a `tex`: DXT1, DXT3, DXT5 or 32-bit BGRA, with mipmaps | Merged into the texture PNGs |
| `btbl` | BmpTbl (158) | A bitmap table: many `flic` images packed together, with each `flic` holding only an index into it | Merged into the texture PNGs |
| `ftx` | FlexiTexture (1,358) | An 8-bit paletted texture. Used for the textures players can recolour (palette ranges 1–85, 86–170 and 171–255 are the three recolour channels, drawn in placeholder blue, magenta and yellow) and for animated textures (several frames) | `textures/*.ftx.png` in the placeholder colours; recolour with the viewer or the `recolour` command |
| `gsi` | GUISkinItem (3,833) | An icon or UI element: a rectangle cut out of a texture atlas. Scenery icons, ride icons, buttons | `icons/*.png` (the cut-out) |
| `mms` | MorphMesh (798) | A *person part* (body, legs, skin, hat, handbag…). Instead of bones, every animation frame stores all vertex positions (packed 11+10+11 bits) and normals. All parts of one character share the same set of about 190 animations (walk, applause, vomit, dance…) | `morphs/*.mms.glb`: one glTF morph target per frame and a weights animation per clip (the first 12 clips, or `--anims`) |
| `ssk` | SimpleSkin (1,014) | A detailed *head* for people: a small rigid-skinned mesh (Neck, Head, Ponytail and Glasses bones). Each guest head comes in two detail levels and six moods (normal, Angry, Happy, Sad, Scared, Sick) | `heads/*.ssk.glb` with its animations |
| `san` | SimpleAnim (3,010) | An animation for an `ssk` head: per bone, a position and a compressed rotation (two int16 matrix rows) per key. Guest heads have one per body animation (`head_af01_l1_walk`) | Built into heads and people; also `data/san/*.json` |
| `sal` | SimpleAnimList (27) | The bone list and animation index for a family of heads | `data/sal/*.json` |
| `prt` | PeoplePart (791) | One person part per detail level: which texture and which `mms` mesh | `data/prt/*.json` |
| `ppg` | PeoplePartGroup (157) | A character's body, legs or head: the part list for each detail level. A character variant (AF01 = adult female 1) is its `_Body`, `_Legs` and `_Head` groups together | Used to assemble `people/<VARIANT>.glb`; also `data/ppg/*.json` |
| `phd` | PeopleHead (87) | Head attachment frames (matrices for hats and glasses) | `data/phd/*.json` (raw matrices) |
| `snd` | Sound (546) | A sound effect or ambient loop. All of them are mono 16-bit PCM (11–22 kHz), with a loop flag and 3D-falloff parameters | `sounds/*.wav` |
| `txt` | Text (124,296) | Every string the player sees: object names, descriptions, UI text, guest thoughts. One full set per language in `gui/<Language>.common.ovl`, plus a few in other files | `text.json` per OVL (name → string) |
| `spl` | Spline (887) | A 3D Bézier path: how a ride car or tracked object moves through a section, fence and wall runs, water paths. Nodes with in/out control points, a total length and a cyclic flag | `splines/*.spl.json` with nodes and 12 sampled points per segment |
| `mam` | ManifoldMesh (35) | A simplified collision / selection mesh | `data/mam/*.fields.json` |
| `psi` | ParticleSkin (41) | How a particle effect is drawn (fountains, fireworks, smoke) | `data/psi/*.fields.json` |
| `fct` | Font (18) | A UI font (glyph table pointing into a texture) | `data/fct/*.fields.json` |
| `mdl`, `modelanim` | Model, ModelAnim (6) | Wild!'s newer model/animation container, used for a few animals | `data/*/…fields.json` |

### Things that define how the game behaves

These are records of numbers, names and links to other resources. `sid` is decoded into named fields. The rest
come out as a field-by-field dump (`*.fields.json`, see below).

| Tag | Type (count) | What it is in the game |
|---|---|---|
| `sid` | SceneryItem (2,082) | **The buildable object**: what shows up in a build menu. Its fields: <ul><li>type (tree, bench, ride, stall, wall, path, support, ride track…)</li><li>footprint in tiles and tile size class</li><li>placement box</li><li>cost and refund</li><li>visuals (`svd`) and icon (`gsi`)</li><li>name (`txt`)</li><li>special behaviours (`ParkBench`, `LitterBin`, `Sign`, `RideEvent`, `Waterable`…)</li><li>supports</li><li>sound sets</li></ul> Track pieces are scenery items of type "ride track". Output: `data/sid/*.json` with named fields and the name resolved to text |
| `ric` | RideCar (280) | One car of a ride: which visual it uses, seats, mass and physics numbers |
| `rit` | RideTrain (186) | A train: front, middle and rear car types and how many cars |
| `anr` | AnimatedRide (125) | A flat ride (one that doesn't run on a track): its animation sequence, timings and capacity |
| `trr` | TrackedRide (4) | A track-ride definition in this install. Track sections themselves are `sid` + `svd` + `spl` |
| `sta` | Stall (111) | Shops and stalls: what they sell (carried items), prices, and the stall's scenery item |
| `cid` | CarriedItem (179) | Things guests carry or eat: balloons, hats, food, drinks. Their model, how they're held, and what they do (hunger, thirst…) |
| `ced` | CarriedItemExtra (41) | Extra data for carried items |
| `ptd` | PathType (10) | A path surface: its textures and the scenery items that make it up |
| `qtd` | QueueType (5) | A queue-line style |
| `ter` | TerrainType (38) | A ground texture for terrain painting |
| `rcg` | ResearchCategory (58) | A research category and its order |
| `ent` | Entertainer (14) | A costumed entertainer (panda, shark, tiger…): which person parts and animations to use |
| `sat` | SpecialAttraction (9) | Special park attractions (Soaked!/Wild! shows) |
| `chg` | ChangingRoom (4) | Soaked! pool changing rooms |
| `enc` | EnclosureType (3) | Wild! animal enclosure fences |
| `asd` | AnimalShelterDesc (6) | Wild! animal shelters |
| `was`, `wad` | WildAnimalSpecies, WildAnimalAnimData (1 each) | Wild! animal species data |
| `vwg` | ViewingGallery (1) | Wild! viewing gallery |

**How a `*.fields.json` dump works:** each 32-bit field is shown as one of the following, using the OVL's
relocation table to tell them apart:
- **an import:** the name of a resource the field links to, often in another OVL;
- **a pointer:** followed into the string, named resource or nested record it points at;
- **a float**, if it looks like one;
- **an integer.**

That makes even undocumented records readable, e.g. `"+0x0C": {"import": "LongLink:svd"}`, `"+0x10": 50.0`.

### Whole people
A guest is built from three part groups (body, legs, head). Each group lists, per detail level, morph-mesh parts
with textures. At the highest detail the head is a skinned `ssk` with matching `san` animations instead of a
morph mesh.

`people/<VARIANT>.glb` and the viewer's People list put all of that together, and they handle some special
cases:
- head-only variants (AF03 wears AF01's outfit);
- mascots without a detailed head (PANDA, SHARKY, ALIEN01, TIGER);
- staff with their own animation sets (lifeguard LG01: seated idle, mechanic, handyman…).

Variant names:

| Prefix | Who |
|---|---|
| AF, AM | Adult female / male |
| CF, CM | Child female / male |
| TF, TM | Teen female / male |
| VF, VM | VIP female / male |

Other variants are staff and specials.

## Verified on a full install
- Every one of the 3,011 OVL pairs opens.
- The full extraction has no errors.
- Totals extracted:

| Kind | Count |
|---|---|
| Models (every `shs`/`bsh`) | 6,762 |
| Textures (18 engine placeholders have no pixels) | 1,878 |
| Icons | 3,565 |
| Morph parts | 798 |
| Heads | 1,014 |
| Sounds | 546 |
| Splines | 887 |
| Scenery items (all decoded) | 2,082 |
| Whole people | 57 |
| Text strings | 124,296 |
| JSON records | about 32,000 |

How the decoders were checked:
- **Bone animations:** the mine-train lap bar opening was rendered.
- **Morph meshes:** smooth motion in the walk cycle.
- **Heads:** faces, hair and sunglasses render correctly. Their triangle lists use every vertex exactly once (checked on four heads).
- **Sounds:** real audio (sample-to-sample correlation 0.999).
- **Recolour:** matches the in-game channels.

A full extraction takes about 6 minutes and about 2.4 GB.

## Credits
OVL format knowledge comes from:
- OVL Extractor 2.0 (gamemodderz);
- the RCT3 Importer / libOVL (Jonathan Wilson, belgabor et al.; GPL-2), including its scenery-item and
  GUI-icon layouts;
- GameExtractor (wattostudios), which was the starting point.

This code is a fresh implementation. Built with Claude (AI). Personal use: never share game files or extracted
assets.
