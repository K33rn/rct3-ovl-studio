# MODLOG - RCT3 OVL extractor + 3D model viewer

## Goal
A better RCT3 .ovl extractor than GameExtractor's Plugin_OVL_FGRK (which only slices v1 files into numbered
raw blobs) plus a 3D model viewer. Personal tool; game files never shipped.

## Inputs
- Game files: `%USERPROFILE%\Desktop\RCT3 Files\New folder` (6,843 files, 6,022 .ovl, ~1 GB). Includes RCT3 + Soaked + Wild
  content (OVL versions 1 / 4 / 5).
- References (GPL-2, reading only, in `~/rct3-work/ref`):
  - GameExtractor `Plugin_OVL_FGRK.java` (wattostudios) - naive.
  - OVL Extractor 2.0 (gamemodderz/OVLExtractor-2) - full container reader (v1/v4/v5).
  - RCT3 Importer / libOVL / libOVLDump (chances/rct3-importer) - struct layouts (shs/bsh/ban/tex/flic/ftx).
  License note: this tool is written fresh; if code is ever copied from those, the tool must be GPL.

## Format (container)
- Header: 'FGRK', headerversion, version (1/4/5). v4/v5: +u32 16; v4: +u32 refcount; v5: +u32 subversion
  [if 1: 3 u32 + NUL string padded to 4] + u32 refcount. v1: refcount is the 4th header u32.
- refs (u16 len + str), u32 unknown, u32 loader count, loaders {u16+'FGDK'/..., u16+name, u32 type, u16+tag}.
- v5: per loader {u32 index, u32 symbol count}.
- 9 chunks: u32 count; v4/v5: u32 unknown, v5-sub1: u32 extra, then u32 sizes. v4: 2 u32. v5: u32 n + n bytes, u32 m + m u32.
- Block data in chunk order (v1: u32 size before each block). Virtual address space = common blocks then unique blocks.
- u32 reloc count + reloc offsets (pointer sites). v4 / v5-sub1: one more u32. Then extra-data: for each loader ref
  with hasextradata = n: n x (u32 size + data), in loader order.
- Chunk0 block0 = string table. Chunk2: block0 symbols (v1 12 B {str,data,isptr}; v4/v5 16 B {+hash}; v5 isptr/loader u16),
  block1 loader refs 20 B {loader, data, hasextra (v5: low u16), symbol*, symbols-to-resolve}, block2 symbol refs.

## Status 2026-10-06
- Container, textures (tex/flic/btbl DXT1/3/5/RGBA, ftx paletted), meshes (shs/bsh incl. skeleton), glTF export,
  game-wide name index, CLI extract, browser viewer (three.js via jsDelivr). All 3011 pairs / 6762 models / 1878 textures, 0 errors.
- Gotchas: indices are u32 in v1 shs, u16 otherwise (detected by range); vertex colour is BGRA; flic extra = header+mips,
  or a 4-byte index into the preceding btbl table; materials come from the txs style name, not texture alpha;
  bone matrix1 = local bind (row-major D3D), matrix2 = world bind; glTF conversion negates z + flips winding.
- Viewer: python -m rct3ovl view "<folder>" (port 8765). Test UI headless: msedge --headless=new --use-angle=swiftshader --screenshot.
- Next: ban/san animations, mms morph meshes, people parts, snd -> wav, txt strings, recolour preview for ftx.

## Status 2026-10-07 (v2: everything decoded)
- New: ban (bone anims, linked to models through svd LODs), svd, mms morph meshes (people parts, per-frame vertex
  positions 11/10/11 bits + u8 normals; frame size = (4*npos + 3*nnrm + 3)//4*4), prt/ppg/phd, ssk heads, san/sal,
  snd -> WAV, txt, spl splines, gsi icons, sid scenery items (named fields), generic *.fields.json dump for the rest,
  ftx recolour, whole-people assembly (57 variants), CLI person/recolour/--language, viewer integration.
- Full extract: 3011 pairs, ~50k files, 0 errors, ~6-13 min, 2.4 GB.
- Gotchas:
  - ssk +0x0C is the TRIANGLE count (indices = 3*tc u16 triangle list), not an index count / strip.
  - Name offset 0 in the string table is valid; decide null by is_pointer (Ovl.str_field).
  - Recolour palette ranges are 1-85 / 86-170 / 171-255 (index 0 is not part of channel 1).
  - gui/<Language>.common.ovl all define the same txt names; the index prefers RCT3OVL_LANGUAGE (default English).
  - Head-only guest variants (AF03) wear the family's base outfit; mascots have no ssk head (keep the mms head).
  - Head animations: head_<variant>_l<n>_<anim>:san in Characters/<X>/Shared; staff keep them next to the ssk (SS_ prefix).
  - PowerShell Get-Content/Set-Content round trips corrupt UTF-8 (mojibake) - edit files with the Edit tool.
- Open: trr/ric/rit/anr/sta/cid etc. are field dumps only (no named fields yet).

## 2026-10-07: animals / colour variants
- User saw a broken duck and seagull in the viewer. Causes: (1) animal OVLs have no prt, so there was no texture; now
  the texture comes from the same OVL. (2) People/animal textures are grids of colour variants (AF01 4x4 outfits,
  duck/seagull 2x2); the stored UVs point at one tile (often bottom-left = plain tan duck / black gull). Added
  MorphMesh.variant_grid/with_variant, `--variant`/`--outfit` (default 0 = top-left) and a viewer Variant menu.
- The decode itself was verified: 11/10/11 is the smoothest split for every duck animation; shark and ray look right.
  The duck is just 80 triangles.

## 2026-10-07: see-through people (user report, POPSTAR / JPOP01 swimsuit)
- Morph meshes were inside out in browsers (back-face culling; Blender's default render hides this). The mms winding
  is opposite to shs/bsh/ssk: the signed volume as stored is negative for every part, so the z mirror alone gives
  outward faces. Removed the extra [0,2,1] flip in gltf_people._add_morph.
- mms normal bytes are stored z, y, x (mean cos with face normals 0.71-0.81 vs ~0.2 before). Fixed in morph.py.
- tests/winding.py (face vs vertex normals in the GLBs; now 0.88-1.00 for mms, 1.00 for ssk/bsh),
  tests/mms_orient.py, tests/mms_normals.py.
- POPSTAR01 had a faceless low-detail head: the groups are popstar01_* but the parts are PF01. The skinned-head lookup
  now also tries the variant from the head part names. 45/57 characters have a detailed head; the other 12
  (mascots, uniformed staff) have no ssk in the game.

## 2026-10-07: boxy trousers / floating arms (user report, People tab)
- Real cause: the morph's offset and scale triples are stored z, y, x relative to the packed position fields
  (x:11 low | y:10 | z:11). Bit-split smoothness can't detect this (same boundaries). It shows when the x and z
  ranges differ a lot (walking): AM01's waist came out 0.67 m deep x 0.08 m wide in Walk but 0.16 x 0.33 in
  Applause. Swapped, the waist is about 0.23 x 0.23 in every animation. Fixed in morph._unpack.
- That also fixes the animals. The duck is now a recognisable mallard; the earlier note that the "wedge" duck was
  genuine was WRONG.
- The winding/normal fixes from earlier still hold on top (tests/mms_outward.py: normals point away from each
  piece's centre; tests/winding.py 0.89-1.00).
- Lesson: check that proportions stay the same across animations, not just within one frame.

## 2026-10-07: heads sideways, icons/logos upside down (user report)
- Morph positions are packed (x << 21) | (y << 11) | z: x in the HIGH bits. The previous "fix" (offset/scale
  stored z,y,x) gave the right proportions but mirrored every body across the x=z diagonal, so bodies faced 90
  degrees away from their skinned heads. That mirror is also why the earlier normal-byte-order (z,y,x) and winding
  ("no flip") findings were needed. With the true packing all three are natural: offset/scale x,y,z; normal bytes
  x,y,z; winding like shs/bsh/ssk ([0,2,1] after the z mirror). Head and body now face the same way (rendered from 4 sides).
- All RCT3 textures store pixel rows bottom-up (FrontEndLogo, icon atlases; "JAN 30" only reads correctly flipped
  vertically, not rotated). TextureSet.image() now returns upright images and every glTF writer uses v' = 1 - v
  (gltf.gl_uv). GUI icon rects are top-down on the upright image (Guest_Stats_Calendar = [360,0,400,40]), so icon
  crops are now the right icons; before they cut the wrong cells from the upside-down atlas.
- Checks: tests/facing.py, tests/mms_outward.py, tests/winding.py, renders. mesh_all/tex_all and the Characters/Animals
  extraction pass.

## 2026-10-07: file type guide moved into the program; README = what it is + tutorial + author (K3rn)
- Guide lives in rct3ovl/static/filetypes.md. Viewer: "File types" button, "?" on each resource group,
  deep link #types=<tag>, search box, Download saves the .md. CLI: `rct3ovl types [tag]`.
- Program name: "RCT3 OVL Extractor & Viewer (rct3ovl)", author K3rn (README author block, viewer header, CLI help).
- Headless screenshots: Edge fails while the user's Edge is open; headless Chrome run directly (& $chrome ...) works.

## 2026-10-07: "VIPs" were vendors; VF01 floating head; navy vendor arms
- VF/VM live in Characters\VM and play Serve/IdleStackShelfs: they are the vendors. People list categories now come
  from the Characters\<folder> names (characters.describe_variant): Guests / Staff / Entertainers / VIPs & celebrities.
- VF01 matched an unrelated SS_Head_VF01 skin (walk/swim clips). Skinned heads are now only used when their clips
  match the body's animations; otherwise the group's own head part is kept.
- Variant grids: shared skin textures (TM01_Skin...) are 4x4 variants of 2x2 cells, and arm UVs fill one 1/8 cell.
  morph._layout_repeat widens the UV cell to the texture's real repeat (edge-map autocorrelation >= 0.6; skin
  ~0.9 at 1/4, ~0.1 at 1/8). Designs that never repeat (AF01 outfits) keep the UV cell.

## 2026-10-07: zoom/pan for pictures
- Viewer picture view: wheel zoom anchored at the cursor (2%..6400%), drag to pan, double-click / Fit / 1:1 / +/-,
  keys + - 0 1. Fit caps small icons at 800%. Recolouring keeps the zoom. tests/ui_zoom.py drives it with the
  installed Chrome via Playwright (channel='chrome', no browser download).
- The user renamed the game folder to Desktop\RCT# files\New folder (the launcher re-asks when the saved path is gone).

## 2026-10-07: recolour UI removed; standalone heads; missing textures; Wild! mdl decoded
- Viewer: recolour pickers removed (the CLI `recolour` command remains). Rotate X/Z buttons (display only).
- Standalone ssk heads: clips fall back to the head's other detail levels (pop star L2 heads have none) and then a
  neutral guest pose; texture comes from the character's own head part, preferring the same folder (SS_Head_VF01 in
  MovieStar vs the vendor VF01 in VM).
- Missing textures: 54 names are referenced but absent. Engine-made ones (chrome, water, fakeglass, UseAdTexture,
  useterraintexture...) get stand-in materials; the rest (Elevator01, Observe1/2, DoubleDecker, RotoDrop,
  LauncherFreefall, ts2..ts8, Pool1...) are missing from the user's copy: tracks, WildAnimals, Pool and Water are
  EMPTY there. Info box shows "No picture" + reason (gltf.texture_note, tests/missing_textures.py).
- mdl decoded (rct3ovl/mdl.py, tests/mdl_probe.py, tests/mdl_uvmatch.py): 52 x 96 B bones {pos, quat, inverse bind},
  parent table, material name list (mesh n -> material n), 4 detail levels of meshes with 32 B headers (0x1305),
  44 B vertices {pos, normal, 4 bone idx, 4 weights /255, colour, uv}, u16 indices. Exported static (bind pose);
  modelanim not decoded.

## 2026-10-07: elephant (mdl + modelanim) fully decoded
- Bones 96 B {local pos xyz, 1, quaternion xyzw, inverse bind 4x4}; row-vector local rotation = quat matrix
  transposed. Parent table entry i = (parent of bone i | 0xFFFF, i+1 | 0xFFFF). Chaining the locals reproduces all
  52 inverse bind matrices exactly (tests/mdl_bones.py).
- Levels: vertex data starts 16-byte aligned after the 32 B mesh headers. AFTER each level's data: nmat x 16 B
  {u16 material, u16 used} then per mesh {u16 slot into the used-material list, u16 1}. Level 3 uses the shared
  animal thumbnail sheet (Normal/Alpha) for the body. (Colour-matching heuristics picked wrong; the table is exact.)
- modelanim: f32 duration, u32 frames (30 fps), 0,0,0,0, u32 position tracks, u32 rotation tracks, 0,0,
  ptr positions [frame][track] xyz, ptr rotations [frame][track] xyzw; track bone names in extra data (positions
  first). Frame-major verified by smoothness (1.9 deg/frame vs 108 track-major), loops close (0.1 deg).
- Export: ElephantTransport.mdl.glb (skinned, Walk/Run/Stand/Idle1/Idle2) + lod1..3; data/modelanim/*.json.

## 2026-10-07: full RCT3 Gold install (Desktop\Rollercoaster Tycoon 3 Gold)
- 7,484 OVL pairs (old copy 3,011 was missing tracks, WildAnimals, Pool, Water). All open; 18,523 shs/bsh models
  load (4.0 M triangles). Elevator01, Observe, RotoDrop, ts2..ts8 etc. textures now present; the remaining 33
  unresolved names are engine-made (chrome, water, glass, ads, terrain) or leftovers on a few LOD meshes.
- Wild! animals: 50 mdl, 1,125 modelanim, 41 wad, 22 was. Material name list is 16-byte aligned (padding varies).
  Animations: was lists {mdl import, wad import} pairs (tiger -> lion:wad, zebra -> horse:wad); wad imports its
  modelanims. Names shortened by common prefix (AdultCamelWalk -> Walk). All 50 decode, 4 levels each.
- tks (3,805 track pieces): name, sid (-> svd -> model), L/R rail splines. Exported as models/<piece>.tks.glb +
  data/tks json. New tags wai (animal toys), pty (pool style): field dumps; guide entries added.
- A first, interrupted copy of the folder had 68 half pairs; textures now return None instead of raising.

## 2026-10-07: Peeps + Thrill Rides tabs
- People button renamed Peeps. New Thrill Rides button (rides.py, /api/rides, /api/ride, #ride=<anr>): anr ->
  sid -> svd (fallback: <sid name>:svd for the standard rides, whose sid lists no visuals) -> LOD0 model + its ban
  animations (names shortened: pirateshiploop -> Loop); opens on the Loop animation. 86 of 89 anr resolve; the
  2 observation towers are track-built (base tks + car) and the hall of mirrors has no matching model.

## 2026-10-07: bsh bone indices are UNSIGNED bytes (user report: thrill rides wrong)
- Vertex bone numbers were read as int8; values 128-255 became negative and were dropped to bone 0, so those
  parts stayed put when animated (Barn Stormer planes, Aileron seats, Double SkyWheel wheels). Rest pose looked
  fine because every bone is at its bind pose there. 27 bsh models use bones 128+ (Zipper, Skywheel, Giant Ferris
  Wheel, Pop Concert, Dolphin/Lion/Tiger shows...). Now u8, with numbers >= bone count treated as unused.

## 2026-10-07: food/drink in peeps' hands; track pieces per ride
- AttachmentR/L mms parts are 3-vertex triangles = the hand attachment points. people_to_glb adds animated empty nodes
  hand_R / hand_L (frame: origin centroid, X = p0-p1, Y = edge midpoint - p2, Z = X x Y; glTF space). Viewer Hold
  menu (eat/drink animations) parents a carried-item shs to the hand node. Items: characters.carried_items: cid with a
  model; food if the leftover is wrapper/box/stick (or a scoop), drink if empty can/bottle/cup/shell (65 food, 41 drink).
- rides.track_sets: trr lists its tks by (shared) name; some trr hold a path string ('../Track1/Track1'), the rest are
  matched to the TrackNN OVL containing all their pieces (Stormrunner needs two). 121 rides; viewer tree shows a
  'track pieces' entry in each ride folder (/api/tracksets, /api/trackset, openOvl('trackset:<trr>')).

## 2026-10-07: held items into the palm; track pieces resolved per track folder
- Hand frame: the attachment triangle's vertex ORDER differs between peeps (AM01 vs AF01), so the frame flipped and
  items sank into the fist on some. Now: long edge + apex define X/Y, and X is flipped per animation so Z points away
  from the peep's own hand vertices (SkinBody/Body within 9 cm). Item models sit on +Z (can z = +0.02..+0.11).
- cid numbers +0x34/+0x38 are hunger/thirst effects, not holding offsets.
- Track pieces: TrackNN.common.ovl holds the tks + sid; each piece's svd/shs are in <Piece>_data OVLs in the SAME
  folder, and names repeat across track styles, so the global index picked e.g. Track11's model for Bobsleigh
  (Track2). Library.find_near: this OVL, then the folder's OVLs, then global. 6,086/6,086 pieces now resolve in-folder.

## 2026-10-07: Ride Designs tab (premade .trk designs)
- .trk = RCT3 self-describing save format (rct3ovl/trk.py): header, u32 type count @80, schema {u16 name, u32 nfields,
  fields {u16 name, u16 type, u32 size, u32 nchildren, children}}, u32 object count, objects {u32 type, u64 id, fields
  in schema order}. Variable data (array/list, size-0 struct, graphedValue) = u32 byte length + data; arrays: then u32
  count + elements; string = u32 length + EFEFEFEF + UTF-16. All 208 designs parse (4-byte trailer).
- TrackPiece: SYMBOLNAME, SceneryItemDataField POSX/POSZ (4 m tiles), HEIGHT (1 m), DIRECTION, Next. Multi-tile
  pieces' reference tile is not their start/corner (not solved), so designs.py chains pieces: first by grid, then
  each joined to the previous exit, rotation/reversal chosen by heading, stored HEIGHT and tile. 160/189 closed
  circuits close within 10 cm; the rest are special types (splitting/racing, rivers, towers, robot arm, tilt lift).

## 2026-10-07: design fixes (Twin Thunder, grid)
- Designs can hold several separate track chains (Butterfly Knot/Firestorm/Racing Demon: 2): each is walked on
  its own; circuits start at a StationMiddle piece (one tile, so its grid position is exact).
- Vertical joints (top hats): all 4 rotations continue straight up/down, so DIRECTION alone isn't enough (Topsection
  points the other way to normal pieces). Now picks the rotation whose exit lands nearest the NEXT piece's stored
  tile. Twin Thunder closes; 165/189 circuits close within 10 cm (was 160). Tried a per-piece "base turn" from the
  entry tangent instead: worse (147), reverted.
- "Off the grid": the viewer grid was centred on the world origin, designs sat at park coords (~150-500 m away).
  designs.py now shifts the ride by whole tiles + half a tile to the origin (tile edges on multiples of 4 m, lowest
  point at y=0) and the viewer draws a 4 m tile grid sized to the ride for designs. Info shows the footprint in tiles.
- tests/design_closure.py (closure over all designs), tests/design_trace.py (per-piece rotation/tile vs stored).

## 2026-10-07: tab bar + resizable columns
- Header: title + "by K3rn" on one line; the 4 tabs in a segmented bar (2x2 below 330 px column width via a container
  query, 1x4 above), active tab highlighted (setTab; cleared when an OVL is opened from the tree).
- Column dividers (.resizer on each list column's right edge): pointer drag sets --c1/--c2 on #app, min 180 px,
  keeps >= 360 px for the 3D view, saved in localStorage, double-click resets. tests/ui_layout.py checks it.
- Fix: narrowing the 3D view wrapped its toolbar and the canvas (height:100%, in flow) then fed its pixel height back
  into #stage, so the view grew past the window (1832 px in an 850 px window) and the model drew off-screen. Canvas is now
  absolutely positioned in #stage, #app rows minmax(0,1fr) + overflow hidden, #view min-height 0. Left column min
  220 px so the tab labels fit. tests/ui_resize_bug.py drags both dividers across and back and checks sizes.

## 2026-10-07: Scenery tab
- rct3ovl/scenery.py: every sid -> svd (import, else load_sid visuals, else '<name>:svd') -> LOD0 shs/bsh + ban anims.
  Two sid layouts: base game Style\Vanilla\Scenery.common.ovl uses an older one (cost word 9, type word 12, numbered
  like SID_TYPES except 6 = all path extras and one lower from 19 up); detected by word 12 < 64.
- Categories from sid type; ride track, rides, supports, paths, litter, injection points left out. Theme from the
  sid's / model's / visual's folder (Standard, Wild!, Soaked!, Themed: X). 1,330 items, 186 animated, all build.
- List cached in ~/.rct3ovl/scenery2_<root>.json (keyed on the index file's mtime).
- Viewer: 5th tab, /api/scenery + /api/scenery_item; category groups with theme subgroups; the resource filter now
  filters tab lists in place (filterList). Tabs: 3+2 below 400 px column width, 5 in a row above.

## 2026-10-07: Fireworks tab (full-window show editor)
- .frw / .fwd = the trk save format with no header (type count at offset 0); Trk(start=None) detects it.
- .frw: ParticleBaseDesc -> ParticleEmitterDescs -> ParticleDesc -> ... Emitter Start/EndTime are fractions of the
  parent's life; NumParticles, ParticleSpeed along the parent's heading (the tube for the base), SpeedRandom
  (sphere), SpeedRandomCircle (ring), ParentSpeedFactor, PositionRandom(Circle), TimeRandom, Spin*, ParticleRelative.
  Particles: Lifetime(+Random), Start/EndSize, SizeRandom, Drag, GravityScale, VelStretch, ColourR/G/B curves
  (times 0..1 of life), ColourA constant 0 (additive glow) or 1 (blended), TextureNameReduced -> psi, SoundName -> snd.
  Names %%FireworkNameNN -> FireworkNameNN:txt.
- .fwd SavedFireworkDisplay: Entries {Name, SceneryEntry, SlotIndex, Time, Track (int bits in a float32)},
  SceneryEntries {Row, Col, Dir, Corner, SID -> SIDDatabaseEntry.SYMBOLNAME}, MusicSelection (Music\*.wma).
- psi ParticleSkin: u32 1, rect* -> {ptr, u0, v0, u1, v1} (v from bottom), +8 texture import (ParticlePage01).
  Flare sprites: RGB glow, alpha 0 everywhere -> draw with one+one blending (multiplying by alpha made them black).
- Launchers: tube N = effect points fireworkstartNN -> fireworkendNN (shs); bones on the animated CWFW.
- fireworks.py + /api/fw/*; static/fireworks.js: instanced stretched quads, fixed-step sim, bloom, CSS2D labels,
  WebAudio sounds by distance, music via ffmpeg (imageio-ffmpeg added to the .bat) cached as ogg in ~/.rct3ovl/music.
- Bug found by tests/fw_debug.py: the server dropped emitters' NumParticles when trimming fields -> nothing burst.
- Double-click on the timeline is detected in pointerdown (the redraw between clicks swallowed dblclick).
- Fireworks editor, multi-select + clipboard: S.multi (set) + S.sel (detail); box select on empty timeline space,
  Ctrl/Shift-click toggles, group drag (Alt = no snap; Shift is now the add-to-selection key), arrow-key nudge,
  Ctrl+A/C/X/V. Clipboard in localStorage (rct3fw.clipboard) with launcher types, so pasting into another show
  maps launchers by type. Paste = at the playhead, spacing and tracks kept. Bulk firework/launcher/tint changes.
  tests/ui_fw_clipboard.py covers it.

## 2026-10-07: MixMaster - AFE, lasers, water jets, aiming, landscape, export to RCT3
- Game text (txt resources) gave the feature lists: RCParticleEditorDialog = "Firework Designer" (particledescdialog_*,
  particledescwindow_* groups), Advanced Laser Designer (laserdesigner_*), Advanced WaterJet Designer, MixMaster effect
  types Fireworks / Lasers / Water Jets, base aiming controls (tutorialtext_lasers1_step11-15: angle control points on a
  bar over the timeline, one point can drive several emitters, right-click removes). Cheat guest names:
  cheatpeepname_* -> the AFE unlock name is "Atari".
- .las / .wjt: trk format (header 80). Blender {FixedPts[20] {BlenderElement, PointTime}, NumPts, MaxTime,
  DurationTransform}; unused points repeat an element with time 0xCDCDCDCD. Colour elements ARGB int32. Units:
  elevation rad above horizon (lasers) / from vertical (jets), rotvel rad/s, power = beam length m, pressure m/s.
  .lwr: header 64, LaserWritingLetter {DragPoints[1022] X/Y (NumPts used), SolidConnection bytes, Duration, Preview}.
- trk.py writer (Trk.dump): header + schema copied, objects re-encoded. Strings = EFEFEFEF + UTF-16, no terminator,
  marker also for empty strings. tests/trk_roundtrip.py: all 208 .trk, 28 .frw, 140 ParticleEffects .frw, 4 .fwd,
  8 .las, 2 .wjt, 4 .lwr byte-identical. tests/fw_build_check.py: game file -> editor data -> built file -> same
  content (fireworks keep their %%FireworkNameNN base name). save_to_game never overwrites files it didn't write
  (manifest ~/.rct3ovl/created_files.json); tests/fw_save_check.py runs on a temp copy.
- Client: fireworks.js rewritten around REG {firework, laser, jet} (game + yours in localStorage, embedded in saved
  shows), modules fw_terrain.js, fw_effects.js, fw_designers.js, fw_afe.js (served by viewer as /fw_*.js).
- Bugs found: ribbons invisible (view-space quads can face away: DoubleSide); whole view black after painting water
  (computeVertexNormals reuses a too-short normal buffer -> NaN -> spreads through the half-float bloom: delete
  'normal' first); flare thumbnails black (2D canvas drops RGB of alpha-0 pixels: /api/fw/page?opaque=1).
- WebGLRenderer needs stencil: true and the composer a stencil render target (reflections only where water is).
- AFE unlocked: no name prompt any more (afeUnlocked() always true); the button shows ✎ and opens the editor directly.
- Fix: AFE view stretched sideways. setAfeMode hid the side panels before the AFE panes were added, so the view sat in
  the 280 px left column when resize() ran; it then returned to its old size, so the ResizeObserver never fired and the
  canvas stayed 280 px wide (aspect 0.40 for a 1.86 view). Now resizes two frames later. tests/fw_afe_aspect.py.
- Fix: landscape panel sliders ran past the panel (range inputs' intrinsic width grew the 1fr column): minmax(0, 1fr)
  + width 100% / min-width 0. tests/fw_land_panel.py checks every control is inside.

## 2026-10-07: MixMaster placement, prices, scene
- Prices toggle ($): CSS class noprices hides every .price (palette, inspector, show totals); remembered.
- Bases tab: the 6 launchers with pictures rendered once in an offscreen WebGLRenderer. HTML5 drag into the 3D view
  (dragState kept in JS: dataTransfer data is unreadable during dragover): ghost model + ring follows the ground
  (snapped), drag card shows what/where. Effects dropped on a matching launcher, or on the ground (new matching base),
  at the playhead on the first free track. Launchers move by dragging in 3D; R / Shift+R turn them.
- Grid snap: big bases on tile centres, small ones (Mortarx1, LazerDome, WaterJet) in tile corners (corner 0-3);
  off: fractional col/row, corner -1, free angle (l.angle, 15° steps). The view centre is fixed once a show opens
  (re-centring on every change made placed things jump). Export rounds to tiles / quarter turns.
- Scene: sky dome shader on Sky\skycolour (x = time of day: 0.2 day, 0.72 sunset, 0.985 night; y = zenith..horizon,
  sampled with sqrt(height)), clouds and stars textures (must repeat: clamped they smeared into bright bands), skyline
  backdrop = background<name>1 + 2 joined in a canvas around a cylinder (separate panels left gaps). Ground: the 32
  Terrain_NN textures (no names in the game; named by look) repeating every 2 tiles, the outer ground too, optional
  tile-line overlay. /api/fw/tex?name= serves any game texture. Day: bloom threshold 0.92 (else the sky washed white).
- tests/ui_place.py.

## 2026-10-07: MixMaster scenery
- Scenery palette tab (from /api/scenery, 1,330 items; first 400 shown, search/category/animated filter). Models from
  /api/scenery_item (GLB with its bone animations), cloned with SkeletonUtils.clone (skinned meshes need it).
- show.scenery [{name, title, col, row, dir, angle, lift, anim: loop|cues|still, clip}]. surfaceAt(x, z, exclude):
  raycast down from 600 m through the scenery group -> highest surface; launchers and pieces stand on it. Dragging a
  piece carries the launchers standing on it (found by comparing surfaceAt with and without the piece).
- Cues: entries {kind: 'scenery', scenery, clip, time, track, repeat, length} drawn like effects (cueDef). Each frame
  the latest cue at or before the playhead sets the clip time (S.t - cue.time; repeat: modulo for `length`); without
  one the piece loops (own clock) or holds still. Deterministic, so scrubbing matches playback.
- Export notes that scenery stays in the editor. tests/ui_scenery_mix.py (stacking, riders, cue timing 2.0 s cue:
  3.5 s -> 1.5 s clip time).

## 2026-10-07: walkthroughs
- static/tour.js: spotlight tour engine (hole with a 9999px box-shadow, card placed below / above / right / left of the
  target, waits up to 8 s for targets, owns the keyboard in the capture phase so app shortcuts don't fire, remembers
  seen tours in localStorage rct3ovl.tour.<id>). Tours: main (17 steps, opens real examples on every tab), mixmaster
  (24), afe (7), designers (3); each starts on first open, "? Tour" replays. tests/ui_tours.py walks all of them.
- Drag lag: every dragover ran full-mesh raycasts (20k-triangle ground + every launcher model) and rebuilt the drag
  card. Now: terrain.raycast() marches the height grid (0.011 ms vs 1.06 ms per hit), launchers are picked through an
  invisible box each, the drag preview runs at most once per frame (requestAnimationFrame) and the card is only
  rewritten when its text changes.
- Tours: steps fade out while the next one prepares (tab / panel / editor), wait until the target stops moving, then
  appear in place (no sliding, no wrong highlight). The MixMaster tour (39 steps) opens and walks through the AFE and
  both designers (afeTourSteps / designerTourSteps exported; ensureEditor() keeps the right one open, also going back)
  and marks their own tours seen. "? Tour" runs the tour of whatever is open. tests/ui_tours.py checks no spotlight
  moves after appearing. Other UI tests mark the tours seen first.

## 2026-10-09: firework files in the file list; tour hand-off
- /api/tree also returns `files` (fireworks.list_files): Fireworks/*.frw, ParticleEffects/*.frw, FireworkDisplays/*.fwd,
  Lasers/*.las, WaterJets/*.wjt, LaserWriting/*.lwr, Music/*.wma (240 in RCT3 Gold), with a `custom` flag from the
  created-files manifest. /api/fw/file?path= (file_info: every object with its fields, plus the firework / show / effect
  / drawing as the editor loads it) and /api/fw/raw?path= (download); only paths inside those folders are served.
- Tree entries `file:<path>`; openGameFile shows a summary + buttons and lists the objects in the middle column;
  #file=<path> in the URL. Buttons call openFw({type, file, def, action}) -> openFireworks({open}) -> ui.openFile:
  shows load into the timeline, palette items are selected and previewed (or opened in their editor),
  ParticleEffects (not palette items) fire from their definition / open in the AFE as a copy.
- Trk: 21 ParticleEffects files have a 64-byte header (like .lwr); the auto-detection now tries 64 when the first
  guess fails. All 166 parse; 161 round-trip byte for byte (5 older ones store an empty string without the EFEFEFEF
  marker; the writer isn't used for them).
- Tour: between steps the spotlight and card stay frozen where they were (outline and card fade, dimming stays) and
  then move straight to the next place; before, target = null made place() put the hole in the middle for the
  hand-off. tests/ui_tour_jump.py samples the hole every frame across 54 step changes (old code: middle every time).
  tests/ui_files.py covers the file list.

## 2026-10-09: editor steps in the MixMaster tour; firework files in File types
- fullTour wrapped the editor steps in outside() as well as inEditor(), so each Next ran ensureEditor(null) (closed
  the editor: a flash of the MixMaster) and then reopened it. inEditor steps are marked `inside` and left unwrapped.
  tests/ui_tour_editors.py samples the open view every frame (old code: back to the MixMaster on all 12 editor-to-editor
  steps; now none).
- filetypes.md: intro paragraph and quick-reference rows for .frw (fireworks + particle effects), .fwd, .las, .wjt,
  .lwr, .wma; new .wma entry; particle effects under .frw. Table links strip the leading dot to find the entry.
  A firework file's summary has a ? linking to its entry. tests/ui_filetypes.py.

## 2026-10-09: Parks tab (campaign scenarios and sandbox in 3D, with goals)
- Campaigns\Base\*.dat (18 + Blank Landscape + Coaster Designer), Base\Soaked (9), Base\Wild (12), Sandbox (1): whole
  saves in the trk format (146 types, ~10k objects, 0.2-0.6 s to parse). rct3ovl/parks.py, static/parks.js
  (full window, like the MixMaster). Order and titles from text: scenarioNN_lookup / aop0_ (Soaked) / aop1_ (Wild)
  -> key -> <key>_filename, scenario<key>_title / _text.
- RCT3Terrain.EngineTerrain: u8 cols, u8 rows, f32 x0, z0, tile x, z (4), then 24 B/tile: 4 f32 corner heights
  (x0z0, x1z0, x0z1, x1z1, shared with neighbours), u8 texture (terrain_NN), u8 cliff, u8, u8 sloped flag, u8
  ownership (2 owned, 1/4 construction rights, 32 entrance, 64 for sale), 3 B. Maps aren't always centred (Zoo
  Rescue x0 -140, z0 -180). WaterManager: u8 cols, rows, u32 bodies, each f32 height, u32 n, n x (col, row, half, mask).
- Placement (SceneryItemDataField; scenery, path pieces, platforms, flat rides, shops): tile (POSX col, POSZ row)
  centred on x0 + 4c + 2; HEIGHT metres in terrain space (items on slopes sit on the slope). DIRECTION: the edge
  an item faces, 0 -col, 1 +row, 2 +col, 3 -row (from paired benches); models keep their edge side at -x;
  'path edge' items and walls move out to that edge, quarter-tile items to CORNER. Multi-tile (sid words 4/5:
  squares) cover squares from the stored tile towards +col/+row, swapped at odd directions: checked on 23 flat rides
  against their own entrances / exits. sid word 2 is the size in both sid layouts.
- glTF mirrors z (gltf.py), so the client mirrors everything it builds (terrain, water, paths, placements, people,
  camera) z -> -z with reversed winding; tracks are laid in grid space by designs.lay_track (split out of
  build_design; design_closure unchanged, 165/189) and shifted by (x0 + 2, z0 + 2) before export.
- Ground paths: path_<style>_grounda/b are 2x2 auto-tile atlases; the solid quarter is used for now.
- Goals: Objective {Difficulty, Prize} + one object per condition (Value, Consistant months). CoasterCondition
  Flags: stat (& 15, in the order of the exe's CoasterCondition_* strings: excitement, intensity, nausea, length,
  -G, +G, lateral G, speed (m/s: 36 = the "80 mph" challenge), altitude, air time, inversions, drop) | 16 maximum
  | 64 water slides. Challenges: IsChallengeCondtion; texts challenge_<prefix>N(title|comp), prefix spelled
  freely (captbc, world_of_the_sea, foutainofyouth) -> matched by normalised name.
- graphedValue: i32 -1, 64, 64 + 64 f32, newest first (GuestsInPark[0] = guest count). Some saves hold NaN
  (BlankLandscape research timer): parks.finite() before JSON.
- People: Guest / staff / Duck WorldMatrix; Wild! animals: WildAnimal.Entry -> WASDatabaseEntry species ->
  adult/male/female/baby mdl (the elephant's was points at the transport ride's elephant: species name first),
  WildAnimal.Visual -> WildAnimalVisual.WorldMatrix; /api/park_animal (mdl + its Stand animation).
- Tests: ui_parks (park, tabs), ui_parks_all (all 42: no errors, every track built), ui_parks_tour.

## 2026-10-09: Parks: paths and structures, people, trains, supports
- Rotation of placed items: ((DIRECTION + 2) % 4) x 90 degrees in RCT3 space, the same rule as track pieces, i.e.
  three rotation.y = -((dir + 2) % 4) * pi / 2 after the z mirror. Found on raised path slopes: the slope model
  rises towards local -x, and neighbouring HEIGHTs give the uphill side for each DIRECTION (0 +col, 1 -row, 2 -col,
  3 +row); HEIGHT is the low end, in metres; HEIGHTOFFSET is only the support height under the piece. Edge items
  (benches, lamps, walls) then sit on the model's +x side. The earlier -dir rule (from benches alone) turned
  slopes, turns and buildings the wrong way round.
- People: PPGDatabaseEntry.SymbolName of Body/Legs/HeadPartGroup (mixed characters: AM01 body, AM05 legs, AM07
  head) -> one model per combination (characters.assemble, full detail: the medium detail head renders white,
  the low one has none). Each part's texture is a grid of outfit colours (MorphMesh.variant_grid): the model uses
  tile 0 and the viewer moves each person's UVs by texture offset to UpperClothingPalette (body, attachments),
  LowerClothingPalette (legs), SkinPalette (skin parts). Walk or Idle by MoveSpeed.
- Trains: RideCarInstance.Stats {Pos (world), Orient: 3 f32 Euler, yaw in the middle; 0 faces +z}. Car model:
  RideTrainInstance.RideTrainSymbolName (rit) lists its cars at +8 + 4 * WhichRideTrainCar (front, second, middle,
  second to last, rear, link), each car (ric) imports its body visual first. Rides closed in the save (The Money
  Pit's Avenger) have no trains. Swinging cars' hanging parts (RideCarSwingingPart) aren't drawn yet.
- Supports: the game builds them from per-style pieces (Supports folder), not decoded; parks._supports puts a
  column under the track's lowest point in every 4 m cell where it is more than 1.5 m above the ground.

## 2026-10-09: Parks: game supports, cars, riders, queues
- Supports aren't saved; the game builds them from scenery items in Supports\ whose sid type is support bottom /
  middle (1, 2, 4, 8 m: box_size y) / top / girder / cap and whose 'supports' string names the style (ts1 steel,
  ts2 wooden, ts3 mine train, steel, scaffolding, flatqueueset1...). A track piece's sid names its style in the
  same field (SuspendedSwinging, Giga, LayDown: ts1; WoodenRC: ts2; MineTrain: ts3). parks._supports: per tile
  the track crosses (not stations), a bottom piece, middles greedy 8/4/2/1, a top piece; thin styles under the
  track's lowest point, lattice styles on the tile centre turned to the track; inverted tracks (pieces Inv*) hang
  from a column 1.6 m to the side with the style's girder across. The game's exact rules (which pieces get one)
  aren't decoded. Supports come from /api/park_supports (too big for a header).
- Cars: the car (ric) has its visual at +0x0C and, for swinging cars, the swinging part's at +0x14 (the
  Biplane: bogie + plane). RideCarSwingingPart: PivotPos, Length, RotatedEndOrient; the car hangs Length below the
  pivot along its own down axis. Stats.Orient of a suspended car includes the half turn (0, 0, pi).
- Riders: Guest.AttractionPersonInfo -> *PersonInfo {State 3 = riding, Matrix (seat, world, row-vector 4x4)};
  pose by the ride (laydown/flying: RideLayWait; inverted/suspended/swinging/floorless: RideSitHarnessFeetDangleWait;
  else RideSitBarWait), loaded with each person model.
- Queues: PathQueue.StartDirection / EndDirection are the open edges, 0 -col, 1 +col, 2 -row, 3 +row (fits all
  598 open edges in the 42 parks); FenceEntry is the fence sid (wall size), placed on the other edges. Floor: the
  queue type's (QueueSet1:qtd -> GroundQueueSet1:ftx, a 2x2 atlas; its straight piece, turned along the queue).
  /api/park_tex serves any tex/ftx by name.

## 2026-10-09: Parks: queue railings, raised path supports, riders' poses
- Queue railings: queue types have no railing models (their Straight/TurnL/TurnR/Slope sids are raised floor
  pieces). The game draws railings from the railing part of the queue type's raised texture (RaisedQueueSet1,
  WildWestSet, SpaceQueueRaised, SpookyQRaised, IncaQRaised: QUEUE_RAILS, pixel rectangles); the viewer builds a
  1 m panel along each edge a queue tile doesn't open on. PathQueue.FenceEntry (Van_Scaffold2...) isn't the
  railing and is no longer drawn.
- Raised paths and queues: the piece's sid 'supports' style (pathcrazy, pathasphalt, pathdirt, pathleafy,
  pathtarmac, flatqueueset1...) stacked from the tile's lowest ground up to 0.5 m under the deck (world
  path_supports, the same stacking as coaster supports: parks._stack).
- Riders: Guest WorldMatrix == the seat matrix already. Poses: karts RideCar; fallback to any RideSit / Ride
  clip a model has. Swinging cars hang straight down (only the yaw of RotatedEndOrient, whose roll swung them
  out from under their riders).

## 2026-10-09: Parks: item sizes, supports, poses, path quarters
- sid word 2 = size in its low 16 bits, flags above (Style\Vanilla\style.common.ovl's items read 0x20001 etc.):
  the unmasked word made fences, walls and lamps "full tile" -> fences stood across tile centres (the crosses
  in Box Office). Masked now.
- Suspended coaster supports: column 1 m beside the track up to its top, girder (1.66 m) over the track from the
  column; no two columns within 2.5 m (cells along a track made doubles).
- Raised path supports: the viewer drops any column whose way down is blocked by a ride's track (raycast against
  the loaded tracks), e.g. the Checkered Flag boardwalk over the go-kart track.
- Poses: suspended swinging cars (Biplane) have seats: RideSitBarWait; harness only for inverted / floorless.
  Guest.AnimType isn't an index into the people's animation list (81 / 110 aren't RideCar / ride poses).
- Path textures: the most opaque quarter of each style's atlas (all base styles: top left).

## 2026-10-10: Fireworks bug list (tester's sheet)
- Music always restarted at 0:00: the server sent the music without byte ranges, so the browser could not seek.
  `send()` now answers `Range:` for audio/video (206 + Content-Range); play() seeks once the length is known.
- psi (particle sprite) layout: u32 frame count, pointer to an array of that many pointers, each -> {u0, v0, u1, v1}.
  The old reader took "ptr + 4" as the rect, right only for 1-frame sprites (the rect follows the pointer). Animated
  sheets (SmokeAnim / FireAnim 16 frames, WaterAnim 3, ConcreteAnim / ElectricAnim 4) read as a zero rect: every
  smoke / fire particle drew one texel. Now all frames are read; a particle shows frame floor(life% * AnimTimeScale
  * n) mod n. Effects made in the game's own designer (smoke, fire) render as in the game.
- Firework Designer slider ranges from RCT3plus.exe: the dialog code calls 0x6a82d0 (ecx = slider) with pushes
  (step, max[, min]) right after creating labels from "ParticleDescDialog_*" text objects in the same order.
  Start/End/Random 0-1; Speed, Sphere, Circle, Pos Sphere/Circle 0-100; Parent 0-1; SpinOffset 0-2pi;
  emitter SpinRate +-20pi; Lifetime 0.05-20 (step 0.05); LifetimeRandom, SoundPlayTime 0-1; Sound dists 0-1000 (5);
  Start/End size 0-50; SizeRandom 0-1; CameraSpinRate +-2pi; VelStretch 0-1; BurnSize 0-50; Drag 0-5;
  Gravity -2-2 (0.005); UpScale 0-100; particle SpinRate +-20pi; StrengthModifierDefault 0-1.
  (# particles, BurnLength: no slider - spinners.)
- The game itself defaults to FireworkDisplays\Stratosphere.fwd (string in the exe); the MixMaster now starts on the
  autosave or an empty show, and file building falls back to any game file of the kind when its usual template
  (GreenPeony.frw, CrabLaser.las, MultiSpurt.wjt, Stratosphere.fwd) is gone.
- Saving: localStorage errors were swallowed (a "saved" toast, nothing kept). Your effects now also go to
  ~/.rct3ovl/my_effects.json (/api/fw/mine), merged at start. Game folders under Program Files: RCT3 (no manifest)
  is virtualised, its saves land in %LOCALAPPDATA%\VirtualStore\<path>; the viewer lists those too and writes there
  on PermissionError.
- Laser image frames: game drawings are in pad units x 0..32, y 0..24 (LaserWriting\*.lwr, Crab, Atari...); the
  sketch pad used -10..10 so the game's frames drew off the thumbnail (black). Pad and thumbnails now use the game's
  units; old -10..10 frames are converted once (pad: 2 marks converted frames). Non-centred images project around
  the pad middle (16, 12).
- Laser Spread (beam width): drawn `width` m across (0.35 x at the dome), slider to 10.
- AFE colour editor rebuilt (gradient + stop markers, picker / swatches / location / reverse / distribute); the old
  one rebuilt its inputs on every input event, closing the colour picker after the first change.
- Particle count: "N particles per launch" (base + sum of N x children) beside "on screen now"; each edit clears the
  previous version's particles before refiring (they used to pile up after adding an emitter).
- Aiming turns the tube directions (and laser/jet frames) by the aim, not the base model (mortars spun about).
- Timeline: right-click removes, drag the ruler / playhead to scrub (music snippets), burst lines on firework bars
  (emitters releasing >= 8 particles within 0.15 s, following 1-3 particle shell chains; a single particle over a
  window leaves at its end), timeline-only edits redraw only the timeline + inspector, autosave debounced, undo
  rebuilds 3D launchers only when launchers / scenery / ground changed.
- Shift-drag / PageUp-PageDown raise launchers (new `lift`) and scenery. New firework = base only.

## 2026-10-11: Fireworks bug list, round 2
- Ctrl-drag clone: the clone redrew the timeline, the dragged block left the DOM and lost pointer capture, so the
  copies never moved (they sat on the originals). Block drags now capture on the timeline canvas. Ctrl-drag on a
  block outside the selection clones only that block.
- Seek re-simulated 10 s of every launch (80-130 ms per timeline click on Stratosphere): now only launches still
  burning at t (from their own start; jets: the last 3 s), in 1/20 s steps.
- Aim points: launchers point between points, so editing a point away from the playhead barely moved them (with
  several points it felt stuck/laggy). Selecting / editing / dragging a point (or its launcher) moves the playhead
  to it. A click on a point no longer nudges it (4 px threshold). 3D aim drags update the sliders in place.
- New child emitter: every value at its lowest (N 0, sphere 0, end time 0; particle life 0.05, sizes 0).
- Particle fields the preview ignored (unused by the shipped fireworks, used in hand-made ones): BurnLength/BurnSize
  (trail of N fading copies 0.025 s apart), CameraSpinRate (sprite rotation, unstretched sprites), particle
  SpinRateX/Y (turns the heading children are released along). UpScale still unknown (game values 0.2-20, often
  with gravity 2-4: maybe upward lift) - not drawn.
- Editors stop the show and palette previews (a palette laser preview kept looping on the designer's dome); the AFE
  frames its launcher and restores the camera on close.
- Laser beams dim as they widen (alpha x (1.5 / width)^0.85): 12 beams at width 10 washed the view white.
- Checked: an AFE-style firework (new string ids, 4-stop colours, burn, SmokeAnim) round-trips .frw exactly.

## 2026-10-12: Fireworks bug list, round 3
- Particle blending is premultiplied alpha (fits every game particle): out = tex.rgb * colour + dst * (1 - tex.a *
  alpha(t)). Flares / fire sheets have alpha 0 -> always glow; smoke (RGB = alpha in the sheet: white smoke) fades
  with the alpha curve (game smoke: 0 -> 1 -> 0); Krakatoa's FWFlares01_07 (has alpha) with alpha 0 still glows.
  The old rule (alpha >= 0.5 = straight-alpha solid) drew smoke as black blobs (tester's screenshot) and made a
  flare with Glow off vanish. AFE: per-stop Opacity replaces the Glow checkbox; new particles alpha 1.
  /api/fw/data sprites carry `solid` (sheet has transparency) for the editor's hint.
- RCT3plus.exe user folders (under SHGetSpecialFolderLocation -> My Documents\RCT3): \Fireworks \LaserWriting
  \WaterJetEffects \FireworkEffects \LaserEffects \Parks \Scenarios \Pools \Campaigns \Coasters \Atari. Effects made
  in the game's designers live there (fireworks FireworkEffects, lasers LaserEffects, jets WaterJetEffects, shows
  Fireworks): now read (game_files), marked "made in game". RCT3_USER_DIR overrides (tests). .las files always carry
  the 64-byte 0xF11EDA2A header (shipped ones too).
- Laser Designer ranges (label, then control + 0x6a82d0(step, max, min)): Trail Persist 0-2 (0.01), Spread
  (control "BeamSpread", file ImageSpread) 1-45, Power 5-20000 (5); NumBeams an integer box. The BeamWidth timeline
  (SpreadBlender) range isn't set there; shipped values: 1.005 normal, Hyperspace 0.94-1.59, Searchlight pi/2 ->
  width -> half-angle 0.0025*w up to 1, then exponential to 0.3 rad at pi/2 (cap 0.6); designer 0-2.
- New child emitter: tester's defaults (N 1, end 1, life 1, sizes 1; rest lowest).
- 3D view renders only when something can change (playing, particles / beams / previews, camera or 3D edits via
  kick(), animated launchers / scenery, drags) and at least once a second: an idle full-rate bloom render competed
  with timeline drags. Box selection restyles only when the set under the box changes; right-click on a selected
  effect removes the whole selection.

## 2026-10-13: Black particles from the in-game designer (Steam RCT3 Platinum installed, app 2700)
- Verified in the game: the Advanced firework editor is unlocked by a guest named "Guido Fawkes" (cheatpeepname_fawkes;
  "Atari" only makes guests laugh) and opens by double-clicking a firework in the MixMaster effect picker (Scenery ->
  MixMaster -> Add MixMaster display, click a timeline track). It saves to My Documents\RCT3\FireworkEffects
  (64-byte 0xF11EDA2A header; new emitter: N 0, Parent 1, Move with parent on, empty colour curves, Flare_00).
- Cause of the black blobs: several sheets are black where opaque - FWFlares01_07 and all LensFlares_* have RGB 0,
  alpha ~254 (alpha-only masks); SmokeAnim RGB/alpha ~0.5, ConcreteAnim ~0.55, WaterAnim ~0.7 (Spray0, Bubble0 ~1).
  Using the sheet RGB as colour drew them black (the game's Blood: red LensFlares_12, alpha 1). In the game,
  CoasterSmoke draws light grey over a dark preview. Now: solid particles = particle colour with sheet alpha x alpha
  curve as opacity (normal blending); glowing particles = max(sheet RGB, sheet alpha) x colour, additive.

## 2026-10-13: Parks compared with the game (Steam RCT3 Platinum)
- Object colours: FlexiColourField COL0-2 index the game's 32 colours (flexicolour_0..31:gsi swatches, sampled ->
  parks.FLEXI_COLOURS). Applied to recolourable ftx: placed items (their own or owner's FlexiColourField), track
  (Track.TrackFlexiColours) and its supports, ride cars (ride's CarFlexiColours), queue floors / railings
  (QueueTypeGroundSurface.Colours, passed as 'Name:ftx|a,b,c' to /api/park_tex). Placeholders (blue/magenta/yellow)
  are gone; High Flier blue track on yellow supports and red cars as in the game.
- Coaster supports: not in the save (no support objects; TrackSection has no support data) - the game builds them.
  Steel/suspended now placed along the real centreline (rail splines, designs._piece_path), every 4 m of track,
  none on steep (>~49 deg) track or station tiles; suspended: column 1.6 m beside the track on the curve's outside,
  2-tile girder (ts1_girder_2L, 2.66 m) resting on the track top. Spacing 6 m (4 m was ~1.5x denser than the game).
- Queue type stub has deck models only (Straight/TurnL/TurnR/Slope*:sid, raised deck slabs); the game's railings
  (thin dark posts, two grey handrails) are drawn by the engine - the viewer now builds them for QueueSet1: posts
  every 2 m along closed edges, handrails at 0.5 / 0.95 m (fixed colours; themed sets keep their texture panels).
