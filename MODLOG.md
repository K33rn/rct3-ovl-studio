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
- Terrain (compared on Chequered Flag and Vanilla Hills): the game blends each tile's ground texture into its
  neighbours' over about one tile (between tile centres) with terraindetail (grey, mean 127) over it as a x2
  modulate; flat ground shows ~1.25x its texture colour (sand 174 -> ~220, grass 124 -> ~145). Steep faces (Chequered
  Flag col 80, 0 -> 18 m) are side-projected, not stretched. Corner heights are not always shared: where two tiles'
  edges differ the game builds a wall textured with the higher tile's byte 17 (cliff style -> TerrainCliffN, copies
  of Terrain_13..18; style 5 dark olive under the go-kart track). Byte 19 is 1 on most sloped tiles (not the split).
  Viewer: one ground mesh, shader blends a texture array by per-tile layer index (smoothstep bilinear), triplanar
  on slopes, detail x2 then x1.6 linear; cliff walls per style. Not drawn yet: the park boundary fence.
  TerrainType +0x20/+0x24 is exactly the texture's mean colour. Game vs viewer ground variation is about the same
  (green std ~3.5 both); open: terrain_10's white daisies show in the viewer, not seen in the game at that distance.
- Switching parks leaked GPU memory (headless Chrome 1.8 -> 4.5 GB over 6 parks; the 42-park run got OOM-killed):
  clear() freed geometry only. Now it also frees materials, their textures (not cached ones) and skinned clones'
  skeletons (bone textures, one per person / car / animal); texture and model caches drop what the new park didn't
  ask for. Chrome stays ~2-2.5 GB; ui_parks_all: 42 parks, no problems. Supports at 6 m checked against the game
  on the High Flier (station U-turn: ~6 girders both); the lift-hill "density" was two crossing sections.
- Park fence (engine-drawn, no objects in the save): chain-link panels from perimiterfence:ftx (top-left panel: posts,
  top rail, concrete base), ~2 m wide x 2 m tall, dark (~0.3 of the texture's brightness), along every edge between
  owned (bit 2) and other land, gap where a path crosses. Viewer: same, alpha-to-coverage so the mesh shows.
- RCT3Terrain.SkirtTrees: u32 n + n x (u32 SceneryItem copied, u32 0, f32 x y z); all outside the map (VH 857, CF
  163). The game draws hilly land with these trees beyond the map edge (its camera can't go there). Viewer: trees as
  items of kind 5 (world x/z); land beyond the map = 4 m grid, heights inverse-distance from the map edge + tree
  heights, fading to flat 240-320 m out, textured with the commonest edge texture (per-edge-tile stretching striped).
- QueueSet1 railing in the game (closer look, VH station queue, 3 tiles): square dark posts ~3 m apart along each
  straight run (4 gaps over 12 m) and one thick grey top rail at ~0.85 m. Viewer changed to that.
- Brightness vs game (same spot): path 0.86, grass 0.9, queue floor 0.85, supports ~1.0 -> hemisphere light
  1.25 -> 1.5 (flat surfaces gain more than vertical ones).
- Daisies (terrain_10): game shows none even close up near the station, identical Terrain_RCT3 OVL in both installs;
  probably the game's texture detail setting (couldn't reach the options from inside a park). Left as is.
- Tests waited for the loader's opacity to read 0, which it still does for a moment after a new load starts (0.3 s
  fade) - fast (cached) parks were measured before loading (Gemini Basin "tracks 0/2"). The viewer now sets
  __pkdebug.loaded = file when a load finishes; ui_parks / ui_parks_all wait for that.

## 2026-10-13: Downloaded firework (WP-W1-Co-G-Comet.frw, an AFE-made comet) - particle sheets, emission timing, open
- Each particle sheet's tex names its texture style (import at +44): LensFlares -> ParticleAdditive, ParticlePage01 ->
  ParticlePreMultipliedAlpha (BurnTrail -> ParticleBurnTrail). sprites() now carries `blend` ('add' / 'pre').
- The client bound only ParticlePage01: LensFlares_* sprites used their LensFlares rects on ParticlePage01 (drawing
  pieces of the smoke / fire sheets). LensFlares is RGB shapes with alpha 255 everywhere (the 10-13 note "RGB 0" was
  wrong). Now one layer per sheet: 'add' = sheet RGB x colour x alpha curve, added (Blood's red LensFlares_12 still
  red); 'pre' = sheet RGB x colour added, dst x (1 - sheet alpha x alpha curve). Replaces the glow / solid guess.
  FWFlares01_07: RGB is a small star glow, alpha an off-centre blob (artist leftover) - with alpha 1 it draws dark;
  the Comet uses it with colour 0-0.095 as its dark smoke trail. Water jet drops: alpha 0 (glow).
- Emission: the first particle leaves at the window's start (count = floor(N (f - a) / (b - a)) + 1), not at
  a + (b - a)/N. Titan Missile / Monkey Missile / Thunder Blitz stars release 1 glow at 1% that lives exactly as long
  as the star; at the window's end it outlived it. The Comet's 1-particle shell over 0-63% of a 4 s base left 2.5 s
  late. Timeline burst lines follow.
- Empty colour curves stay 1 (white): the game's flamethrower / pan fire / brazier FireAnim particles have them.
- Open… (and dropping files on the MixMaster) also takes .frw / .las / .wjt from anywhere (POST /api/fw/parse,
  fireworks.parse_upload): added to your effects, selected and previewed; opening the same file again replaces it.
  tests/ui_fw_open.py. Not compared with the game yet (user at the PC).

## 2026-10-13: OVL tree - new folders, all folders closed at start
- Library.refresh_index(): walks the game folder (~0.15 s for 7484 pairs) and reads only OVL pairs added or changed
  (index entries now keep `mtime`, the later of the pair's two files; old entries take it on first sight) and drops
  removed ones and their names; caches built on the library (`_rides`, `_scenery`, `_fireworks`...) are dropped and
  rebuilt on next use, the scenery disk cache follows the index file's mtime. Runs at start (folders copied in while
  the viewer was closed) and from /api/tree?refresh=1.
- Viewer: ⟳ Refresh beside the filter, and a check when the window regains focus (at most every 15 s). New / changed
  OVLs and loose firework files get a "new" badge, as do the (closed) folders holding them; the message line says
  what was found / removed.
- Every folder starts closed (was: the top level open). Folders you open stay open through redraws (filter,
  refresh, track sets arriving); a filter opens every matching folder; an OVL opened from a link opens its folders.
- tests/ui_tree_refresh.py (scratch game folder: copies an OVL pair in and out). ui_checks skips the welcome tour.

## 2026-10-13: Comet in daylight - no black trail (checked in the game)
- User's screenshots: in a day sky the Comet left a black column (its 100 FWFlares01_07 trail particles, alpha 1,
  colour 0-0.095, drawn premultiplied over the alpha blob in that cell).
- Game (Steam, sandbox, MixMaster): Scenery > MixMaster (68,455) > Add display (185,683); bases: MixMaster Bases
  (barrel icon 148,718) > single mortar (288,701), place on owned land (green ghost); a timeline track click opens the
  effect picker (Fireworks list, preview pane on black; WP-W1-Co-G-Comet listed from Fireworks\); the effect bar's red
  dot -> click it, then the mortar (green dot = linked); Play 182,702. The display also fires on its own at its start
  time (9 pm). In daylight the Comet is a pink-white glowing head with yellow sparks at the mortar - no dark trail.
- FWFlares01_07's cell: RGB a star, alpha the Puke blob (Puke's own cell two rows down has alpha 0) - a misplaced alpha
  in the texture. _sprite_solid now also needs the RGB under the opaque alpha to be visible (mean max(RGB) >= 16):
  FWFlares01_07 is no longer "solid", and on ParticlePage01 a non-solid sprite's alpha curve doesn't dim what is
  behind (`covers`). Only FWFlares01_07 changes (smoke, spray, rubble, bubbles, lightning keep their alpha).
- The Comet file was copied into the Steam game's Fireworks folder for the test (left there: it plays in the game).

## 2026-10-13: Path supports, zoom-out lag, UpScale (exe)
- Raised path / queue supports (user: Chequered Flag's were buggy). Three faults: (1) slopes / stairs: the column
  stopped at HEIGHT - 0.5 (the slope's low end) while the deck at the tile centre is ~1 m higher (Slope) / 0.5 m
  (Slope_Straight) - a visible gap under 21 slope tiles; (2) a path above another path: the upper column ran through
  the lower deck to the ground; (3) the last bit of a column was a 1 m piece overlapping the one below (flicker).
  Now the server sends one column per piece (world.path_supports = [style, x, z, ground, deck HEIGHT]) and the
  style's pieces (world.support_parts); the viewer casts rays against the path pieces' own models (kind 1 items;
  PathQueue pieces are kind 1 too now): up from deck - 1.5 m = where the column meets the piece's underside (Leafy
  pieces' underside is exactly 1 m under the deck: a ray starting there hit at 0 and dropped 4 Vanilla Hills
  columns), then down from just under that = the deck of a path below, else the ground; then stacks it
  (stackSupport, as parks._stack). Rays need the materials double-sided for the moment (a deck seen from above is a
  back face) - without that the down ray missed lower decks (Monster Lake, Lost Atlantis: 25 m columns through
  lower paths). parks._stack's last bit is now a 1 m piece
  squashed to fit ([sid, x, y, z, yaw, sy]; addSupports scales it), also for coaster supports.
- Check (gap3.js, run in the page on every park): per column (stacks split where pieces don't touch; piece heights
  from support_parts, not names - QS12m is queue set 1's 2 m piece), the top must be the first path surface straight
  above its bottom (0.1 m) and no pieces overlap. Two headless runs against one viewer at once time out loading.
- Zoom-out lag: Chequered Flag whole-park view, 3,174 draw calls / 550 ms a frame (headless swiftshader); people alone
  2,854 calls / 410 ms (386 guests, each cloneSkinned with several meshes and its own cloned materials from dress()),
  terrain 7 calls, scenery 165, rides 147. Close up: 77 calls. Now people beyond the distance where they'd be ~14 px
  tall (1.8 m x view height / (2 tan(fov/2) x 14), ~100 m at 820 px) are drawn as their stand-in figure (the
  instanced capsules shown while loading, kept now: a near person's instance is scaled to 0) and their mixers stop
  (crowdLod, rechecked when the camera moves > 1 m). Whole-park view after: 1,095 calls / 19 ms (people 4 calls); the
  rest is mostly the go-kart tracks (~900 meshes in rides: track glbs aren't merged - next if it's still slow).
- Ride tracks merged: each /api/park_track glb (hundreds of piece meshes, ~5 materials; Formula RCT 02 is 401
  meshes) becomes one mesh per material + attribute set on load (mergeByMaterial, BufferGeometryUtils.mergeGeometries,
  pieces baked to world; a glb with animations, skinned meshes or multi-materials is left as it is). Rides layer 876
  -> 142 meshes; whole-park view 1,095 -> 361 calls, 19 -> 14 ms. Picking (one title per track) and clearOfTracks
  (raycasts the track) unchanged.
- parks._supports' rounding unpacked 5 values per piece; the squashed piece's 6th crashed every coaster's supports
  (/api/park_supports 500) until fixed - ui_parks_all (tracks n/n) is the check that catches it.
- ui_parks_all now also checks path supports: 42 parks, 1,686 columns, none off, none overlapping.
- UpScale (firework particle): RCT3plus.exe registers the particle description's fields at 0x9ca7c0 (push offset,
  size, type, name; call 0x8088c0): TextureTileIndex 0x124, AnimTimeScale 0x128, CameraSpinRate 0x12c, StartSize
  0x130, EndSize 0x134, SizeRandom 0x138, VelStretch 0x13c, BurnLength 0x140, BurnSize 0x144, ColourModifierEnable
  0x198, Drag 0x19c, GravityScale 0x1a0, UpScale 0x1a4, SpinRateX 0x1a8, SpinRateY 0x1ac. Copy at 0x9cb88c. No float
  reads of [reg + 0x19c/0x1a0/0x1a4] (non-stack) look like particle code (0x4850de: a scale matrix; 0xcd75c0: the
  camera projection). The simulation probably works on a copy at another base; next: find the callers of the copy
  function / where the description's fields are read as a block, or test in the game (UpScale 0 vs 20 on one star).
- UpScale found. The C++ particle description is the registered layout shifted by -0x40 (the registration's offsets
  count from 0x40 before the object): Drag 0x15c, GravityScale 0x160, UpScale 0x164, SpinRateX/Y 0x168/0x16c,
  Particles 0x54 (stride 0x90) / NumParticles 0x5c. The update is 0x9c8390 (vtable 0xf84dec; finds -9.81 at
  0xf37b30, 9.81 at 0xf84910). A particle (copied to esp+0x40): Time 0, Lifetime 4, Position 0x10, Velocity 0x20,
  Orientation 0x30 = three rows of 16 bytes (0x30, 0x40, 0x50) + a renormalise counter. Each step: rotate the
  orientation by SpinRateX x dt about row 0 (0xbedd30, mixes rows 1/2) and SpinRateY x dt about row 1 (0xbeddc0:
  r0' = c r0 - s r2, r2' = s r0 + c r2); accel = (0, -9.81 GravityScale, 0) + 9.81 UpScale x row 2 - Drag x v;
  v += a dt; x += v dt; then 0xbed6e0(velocity, row 2) rebuilds the frame: row 1 = normalised velocity, row 0 =
  row1 x old row2 (normalised), row 2 = row0 x row1. So row 1 is always the direction of travel and UpScale is a
  sideways push along the particle's own up (row 2), which SpinRateY turns about the path: corkscrews.
  Emission (0x9cbdf0, the emitter, ret 0xc): the new particle's frame M = parent's (interpolated) frame if
  ParticleRelative else identity, turned by SpinOffset + SpinRate x t (relative: 0xbedd30/0xbeddc0/0xbede50; else
  0xbedee0/0xbedf70/0xbee000); velocity = ParticleSpeed x M row 1 + ParentSpeedFactor x parent velocity + SpeedRandom
  sphere + SpeedRandomCircle in the M row0/row2 plane; PositionRandomCircle also in that plane; added by 0x9c7340.
  So a non-relative emitter fires along world +Y (turned by its spin), not along the parent's travel - the viewer
  still uses the parent's travel (unchanged, most of those emitters have ParticleSpeed 0).
- Viewer: particles carry an up vector u (spawn: parent's when relative, else world +Z, turned like the heading);
  upPush() keeps it across the velocity, turns it by SpinRateY dt about the path and adds 9.81 UpScale u dt. 27 of
  143 game particle types have UpScale; big ones with fast SpinRateY: Thunder Blitz 20 / 31.4 rad/s (its stars
  slow at the top under 4 g and the push loops them off: separate bursts instead of one column), Spheres of Fire
  7.4 / 18.6, Fountain 6.2 / 6.8, Fairy Fountain 3 / 6.8. Path depends on the step (game: its frame rate). All 29
  fireworks run 6 s without NaN. Not compared with the game on screen yet.

## 2026-10-14: Textures & GUI tab (8th tab): Texture Editor + GUI Editor, saved into the game's OVLs
- Request: an 8th tab, a complete texture editor for every texture in the game and a GUI editor for the menus, icons and
  their animations, switchable inside the tab like the MixMaster's editors.
- Route: in-place OVL patching (no OVL writer exists). Every edit keeps the resource's size and layout, so only bytes
  inside the files change - no pointers, relocations or symbol tables touched. texedit.py; client static/texgui.js
  (index.html tab b-texgui, openTexGuiTab, #textures[=path|name]).
  - tex: container.LoaderRef.extra_at (file offset of each extra blob) -> TextureSet.flic_where[flic vaddr] = (part,
    file offset of every mip): flic extra = FlicHeader(16) + per mip FlicMipHeader(16) + pixels; btbl: extra[1] at the
    running offset of that table entry. Re-encoded with Pillow 12.3's BCn encoder (im.tobytes('bcn', 1|2|3) =
    DXT1/3/5; mips under 4x4 padded to a block, edges repeated) or BGRA; each mip must come out the stored length.
    Pictures are stored bottom row first (flipped on the way in and out).
  - ftx: per frame palette (1024 B BGRA) / 8-bit pixels / alpha at their vaddrs. Recolourable (recol flags != 0): the
    palette stays (its 1-85 / 86-170 / 171-255 recolour ranges) and pixels take the nearest entry; else a new
    256-colour MEDIANCUT palette. Animated ftx: one frame at a time, the others untouched.
  - gsi: types and coords decoded (structs.load_gsi): 0 icon l,t,r,b; 2/3 panel / window frame 4 x + 4 y cuts (3x3,
    middle often 0 wide = the pixel at the cut is stretched); 4 bar x0..x3 + y0,y1; 5 bar x0,x1 + y0..y3; 1 no picture.
    The old reader took 4 numbers for every type (wrong for 2-5; writing a "rect" over them would have corrupted
    them). Edges: right / bottom exclusive (Main's icons sit on 40 px and 16 px grids as [40,320,80,360]; object
    icons are [0,0,63,63], a pixel short - texture edge coordinates). gsi_image now crops (l, t, r, b), not r+1 (the
    old crop took a column / row of the neighbouring icon). Moving a 2-5 piece shifts all its cuts; only type 0 resizes.
  - txt: UTF-16 in place; room = up to the next text (its NULs and padding), so a text can't grow past its slot.
- Backups: before the first change to a pair both files are copied to ~/.rct3ovl/backups/<md5(root)[:10]>/<rel>
  (long-path '\?\' copies: the first try with the root as folder name passed 260 chars), edits.json lists changed
  pairs and resources; restore copies back and drops the entry. Writes go to <file>.rct3ovl-tmp then os.replace (a
  PermissionError says to close the game); the pair is re-parsed after writing; the Library forgets the open copy
  and derived caches (texedit._reload keeps the texture catalogue: names / sizes don't change).
- .CHK files next to Main.*.ovl and Style\Vanilla\Style.*.ovl: WRONG at first ("not checked") - see the in-game
  test below; the exe builds the name from "CHK" (0xf29cac) and the game quits at start-up on a mismatch.
- Catalogue: 2,366 textures (1,601 ftx, 765 tex: 404 DXT3, 188 DXT1, 173 BGRA; 2,013 distinct names), built in ~39 s
  the first time, cached in ~/.rct3ovl/texcat_<root>.json keyed on the OVLs' mtimes. GUI: 18 OVLs with gsi (Main 1,887;
  Style\SceneryIcons 1,161; Style\Vanilla\Scenery 241; RideIcons 208; FrontScreen logos; CarriedItems; ...), texts in
  Main (1,523) and gui\<Language> (~12,300 each).
- GUI Editor groups an OVL's icons: sheets (by texture), button states (stems with Up/Over/Pressed/Disabled/NoFocus...;
  Up/Down alone are directions, e.g. ArrowUp / ArrowDown), numbered sets as animations (State0..3 etc. first, the
  16-colour uniform swatch sets after), window frames (types 2-5, previewed from their real cuts).
- Tests (scratch copy of Main / gui\English / Style\Vanilla / ACAM\Truck / Saucer, never the real folder):
  round trip DXT1 33.5 dB, DXT3 36.5 dB, BGRA and plain ftx exact, recolour ftx nearest-palette (recolour still
  works), ftx frame 2 of 4 written with frames 1/3/4 identical; icon rect, text (too long refused); restore =
  byte-identical originals. UI (playwright, fake server on 8767): paint, shapes, text, select-move, adjust, save,
  rect drag + save, texts save, restore all -> md5 of the copies identical again, no page errors. Real game read-only:
  all kinds open (anim / recolour preview / DXT3 with 8 mips), SceneryIcons sheets, English texts; md5 of Main and
  English unchanged.
- Not tried in the game yet (needs the user's PC): a saved texture / icon rect / text showing in RCT3.
- GUI Editor "Replace with picture…" tested (scratch copy): a PNG with a transparent corner put into an icon's place
  used to be drawn over the old icon (its pixels showed through the clear parts); an imported picture now clears the
  place first, in the preview and when put down. Saved, read back (red where opaque, clear where clear, neighbours
  untouched), restored byte-identical.
- Fireworks viewer: emitters that are not ParticleRelative now fire in the firework's own frame (tube direction, an up
  across it - world +Y / +Z for a straight tube, as 0x9cbdf0's identity frame) instead of along the parent particle's
  travel, and the parent's SpinRate no longer turns them. Most such emitters hang off the stationary launch particle,
  so they were already right; with a seeded Math.random over all 29 fireworks + 1 own (6 s each) only Shanghai
  Surprise (top 40 -> 37 m) and Solar Blaster (its 40 sparks thrown off the falling shell now leave upward) change; no
  NaN, no page errors. Assumes a tilted tube tilts the identity frame too (untested in game: needs a tilted launcher).

## 2026-10-14: Textures & GUI edits tried in the game (Steam RCT3 Platinum, app 2700; user approved writing to it)
- Steam folder (C:\Program Files (x86)\Steam\steamapps\common\Rollercoaster Tycoon 3 Gold) = the one the game runs;
  its Main and English OVLs are identical to the Desktop copy. Extra backup of the 4 files + md5 in the scratchpad.
- Menu texts (gui\English): FrontScreen_Career_TT -> "CLAUDE TEST" shows as the Career button's label under Play;
  FrontScreen_SandboxMenu -> "CLAUDE MENU!" is the Sandbox screen's title. Works as written.
- FrontEndLogo (Main, DXT3 512x512, 5 mips; the two kids on the front screen): the game quit ~4 s after start (Steam
  log: process added / removed), with or without the text edit; the originals start. Cause: the .CHK beside
  Main.*.ovl and Style\Vanilla\Style.*.ovl. RCT3plus.exe 0x457e10(name, ?, write): appends "CHK" (0xf29cac) to the
  name, computes the file's checksum (object 0x457da0: CRC table 0x457740 = reflected 0x04C11DB7, i.e. CRC-32;
  0x456e60 reads a byte at a time and tests EOF after the update, so the last byte is counted twice), then writes it
  ("wb") or compares it with the .CHK (4 bytes LE); 0x457fa0 runs it for Main.common/unique and Style.common/unique.
  CHK = zlib.crc32(data + data[-1:]) matches all four. texedit.game_crc; _patch backs the .CHK up with the pair and
  rewrites it after every change; restore copies it back. With that the logo edit loads: pink "EDITED!" sign and blue
  balloon on the front screen (screenshot ingame_logo.png in the scratchpad).
- Restored through the editor: all four OVLs and both .CHK byte-identical to the originals. tgui / trep UI tests on the
  scratch copy with .CHK files present: pass, restore byte-identical including .CHK.
- Clicking in RCT3 needs a hover first: move to the icon, wait ~1 s, click (clicks on the label text do nothing).

## 2026-10-14: "Neon Nights" custom front screen (in the game, Steam install; left installed for the user)
- fal could not be used (API key rejected, 401) - all art drawn with Pillow: examples/neon_nights/neon.py (+ apply.py,
  which drives the viewer's /api/tx endpoints).
- Front-screen layout found with labelled test textures (one launch): a 1024 x 768 layout stretched to the window
  (1280 x 800 here). FrontEndBG1 = top-left 512 x 512 (blue band, a see-through grey band - pale RGB, alpha 187-204
  with scan lines - and a white ring, alpha 221-255); FrontEndBG2 rows 0-255 at (0, 512), rows 257-511 at (512, 512)
  (the bottom bar: light blue bar, title pill with a black line); FrontEndBG4 = the pieces over the 3D park circle;
  BG1b / BG3 not seen on the main menu. The 3D park behind is live (AttractSequences). FrontEndParts: icon discs
  (Circle 2,2-89,89), button-bar end (IconCircle_Back, white half disc) + Triangle (white), People (other menus),
  RCT3Logo (275,0-512,140). The white button bars' bodies are drawn by the game (not textured). FrontEndLogo (the
  kids) is drawn over the left side from y ~310 of 800 (tex y 40 -> screen 345, 0.875 px/px). The shark / tiger
  badges are GUI2Main2 (320,0-420,100 / 320,100-420,200). Labels: black text, so pills must stay pale.
- Theme: the night (gradient, stars, striped synthwave sun, skyline with lit windows, pink perspective grid) painted
  as one 1024 x 768 picture and cut where each piece sits; veil -> violet glass (alpha 150); rings -> pink neon with a
  glow; title pill pale with a cyan rim (thick white found by a 31 px erosion grown back inside the white - with the
  black line counted in, else the line splits the pill and it erodes away); bar -> violet-pink gradient with a cyan
  top line. 18 neon line icons, neon discs, RCT3 / NEON NIGHTS logo, neon coaster (lift hill, loop, train) + OPEN
  ALL NIGHT sign, a neon ferris wheel for the crowd picture, SOAKED / WILD badges. Texts: RIDE, BUILD, SETUP,
  NEON PARK, RIDE MENU, BUILD MENU, EXIT and three help lines.
- First try: the coaster's lift hill and the OPEN sign covered the SETUP button (art drawn larger / higher than
  guessed) -> art scaled 0.8 and moved down. Screenshots: Desktop\RCT3_NeonNights_StartMenu(.png, _hover.png).
- apply.py tested on the scratch copy (all saved; restore byte-identical).

## 2026-10-14: The three untested items, tried in the game
- Icon rectangles (gsi) work in the game: FrontScreen_Icon_Play moved to the Sandbox cell -> the RIDE button showed
  the cube; FrontScreen_Icon_Options cut to its top half -> SETUP showed half a gear. Both put back afterwards.
- Route to fireworks in the game (scripted, scratchpad topicker.sh): Play 110,194 > Sandbox 106,414 > Start game
  96,194 (~45 s) > Scenery 27,472 > MixMaster 68,455 > Add display 185,683 > a timeline track 400,640 opens the
  effect picker (Fireworks + at 79,328; preview pane 500,316 228 x 228; wheel scrolls the list). The picker lists
  Fireworks\*.frw read at game start only (a new file needs a restart). Bases: barrel 148,718, Mortar wall x 8 at
  238,750; red dot on the effect bar then the base links it (green); sequencer Play 180,702; PageDown tilts the camera.
- UpScale: Thunder Blitz in the preview is a narrow column of curling stars; the viewer threw them into separate
  clumps. A test firework built with /api/fw/build from Thunder Blitz's parts (ZZUpScaleTest: plain star, UpScale 20
  without spin, Thunder Blitz's star, each with a still 3 s trail; copied into Fireworks\ for the test, removed after)
  measured in the preview (launch y ~159, plain star's top 84 px = 20.4 m): no-spin star 0.42 of the plain star's
  height, Thunder Blitz's 0.94, its hook ~5 m. Model (offline, tbfit.py): the spin star's height and drift depend
  strongly on the step (C/A 1.37 at 1/60 s, 1.0 at 1/480 s; 31 rad/s x 1/60 = 0.52 rad per step), and the no-spin
  star needs a push of ~125 m/s2, not 9.81 x 20 = 196 (B/A 0.31 at any step). Viewer: pushed particles with a turning
  up are sub-stepped (<= 0.1 rad per step, up to 16) and the push is x 0.64 (UP_SEEN - measured, not found in the
  code; the update's 9.81 x [0x164] reading stands). Now: 0.42 / 1.02 / 6.5 m; Thunder Blitz a column of curls.
- Non-relative emitters and tilted tubes: Mortar wall x 8's tubes lean +-20 deg alternately along the wall (glb
  effect points). Gemini Rockets (shells from a non-relative emitter, 100 m/s) fired from it in the game climb almost
  straight up (~5-10 deg on screen, where following the tube would show ~25). So non-relative = world +Y / +Z,
  as 0x9cbdf0's identity frame says - the viewer's earlier "tube's frame" guess is dropped (WORLD_DIR / WORLD_UP).
- All 29 fireworks run without NaN; ui_fireworks passes (only the favicon 404).

## 2026-10-14: Neon Nights v2 - buttons moved and restyled (RCT3plus.exe patched, user approved)
- Front-screen layout is code, not data. Buttons: 0xa47190(type, slot, button, icon, menu, flag) -> x 0xa45110(type)
  = radius (650/560/470/435/520/275 for types 0-5), y 0xa451d0(type, slot) = angle start + step x slot (type 0: 3.06 +
  0.165 n; 1: 3.2 + 0.17 n; 2: 3.3 + 0.2 n; 3: 2.7 + 0.15 n; 4: 3.7 + 0.08 n; 5: 2.4 / 5.9 + 0.25 n), size 0xa45570
  (83 / 64 / 100), placed by 0xa45670 on a circle round (734, 527) of a 1024 x 768 layout minus half the size;
  measured: disc centres at (734 + r cos t, 239.5 - r sin t) (the parent panel's offset). Type 0 = the main menu and
  the Tools menu's four designers (slots 0-3); its constants (0xf8db6c / 84 / 80) are used nowhere else.
- Bars: the label control's colour is an immediate ARGB in the code (0xa4b48e mov [eax], 0xfff7f2f2 ->
  0x6ad0b0); the bar's rounded end is FrontScreen_IconCircle_Back, the slanted end FrontScreen_Triangle, the badge
  behind the icon FrontScreen_IconCircle_New (global 0x12fce8c via the stub at 0xecc380; the stubs write
  "push 1; push 0x1303cfc; push name; mov ecx, global - 8; call 0x41cb90"). FrontEndLogo (the kids) is anchored to
  the window's bottom-left by code (0xa55c80), no constant - so the big picture was redrawn in place instead.
- Tried in the game (several launches): r 350 (stack inside the circle), r 330 / 3.234 / 0.333 (curved column
  mid-screen; the Tools menu's 3rd/4th bars overlapped where the arc turns), r 460 / 2.7216 / 0.29 (even gaps but the
  badges under the ring), final r 360, start 2.7216 (pi - 0.42), step 0.29: buttons on an even arc at the top of the
  circle, Tools' four readable. Bar colour 0xff28f0ff (neon cyan) + flat cyan bar ends; hexagon badges; giant neon
  ferris wheel + coaster + OPEN sign as the big picture. RIDE opens the Play menu, BUILD the Tools menu (checked).
- texedit.patch_exe (POST /api/tx/exe {name, patches: [{va, f32 | u32, old}], what}): checks each old value (refuses
  another program version), copies the original to the backups folder first, writes via tmp + replace, lists it in
  edits.json; restore('RCT3plus.exe') copies it back. Tested on a copy: patch, restore byte-identical, wrong old value
  refused with nothing written. The Steam exe was restored to the original and re-patched through it (same 12 bytes).
  The first manual backup is also at ~/.rct3ovl/exe_backup/RCT3plus.exe (md5 c73be70d...).
- Screenshots: Desktop\RCT3_NeonNights_StartMenu_v2.png, RCT3_NeonNights_BuildMenu_v2.png.

## 2026-10-14: Front screen designer (GUI Editor > Main menus) - every front-screen menu customisable
- Request: build the main-menu customisation into the program.
- All front-screen buttons (0xa47190 call sites): type 0 = every menu (main 3, Play 4, Tools 4, Sandbox / Custom
  scenario 2, plus 4 dynamic ones at 0xa4f720.. with register slots), type 4 = Back / Quit (slots 4, 5) and the
  in-game scenario-end menu (slots 0-5), type 3 = scenario / campaign lists, type 5 = tutorial pages (slot -1 =
  forward). Each number is read by one `fld dword [addr]` (D9 05) in 0xa45110 / 0xa451d0 / 0xa45570; types 1-5 share
  constants with unrelated code (560, 3.2, 0.2, 0.25, 64, 100 ...), so frontscreen.py points the instruction's
  address at its own 4-byte slot in the int3 padding between functions near 0xa450c4 (never executed, in .text so
  readable) and writes the value there. reset_layout points them back, refills the slots with CC and restores
  constants an earlier in-place patch wrote. _check refuses a program where any of the 16 instructions is not
  fld [original | slot], or a slot not CC while unused, or the colour's mov opcode differs.
- Verified in the game: with the Neon numbers redirected into slots the menu looks exactly as before, and
  corner_r 420 / corner_start 4.3 moved the Quit badge from (540, 695) to (900, 680) as computed. Put back afterwards
  (Steam exe now: Neon layout only, through slots).
- API: GET /api/tx/menu (params with original values, colour, themes), POST /api/tx/menu {values, colour},
  /api/tx/menu/reset, /api/tx/menu/theme {name, restore_main}. Themes: rct3ovl/themes/neon_nights.py (moved from the
  example) drawn from the game's own textures, then textures + English menu words + layout saved.
- UI: canvas preview 1280 x 800 from the game's pictures (BG1/BG1b, BG2 halves, logo, badges, bar ends, icon cuts,
  menu words) with the live-park area as a stand-in; drag the first button = r + start, another = step; inputs in
  degrees; colour picker; words with max lengths; picture shortcuts to the Texture Editor; theme buttons. Tests on the
  scratch copy (fstest.py backend, tfront.py UI): set / bad value refused / reset byte-identical / theme twice
  (second needs restore_main) / restore all byte-identical; UI drag -> save -> menus -> reset -> restore, no page
  errors. Race fixed: openOvl's icons arriving after another item was opened.

## 2026-10-15: GUI Editor fixes - preview over the menu tabs; free places, remove / add menu buttons
- Preview overlap (user screenshots): '#tg .stage canvas {position:absolute; inset:0}' also caught the designer's
  canvas, pinning it to the panel's top-left over the menu tabs at its full 1280 x 800. Now position:static, sized
  by a ResizeObserver to fit #fs-stage (checked at 1920 x 950 and 1280 x 680).
- (Launch "detects nothing" report: not reproducible here - both installs and a fresh zip extract index 7,484 pairs;
  no cache file newer than the zip, so it ran on another PC/account. Resolved itself.)
- Front-screen buttons (RCT3plus.exe, ctor 0xa4c810): widgets in the front object. Panels: main +0x340, Play +0x314,
  Tools +0x32c, Sandbox +0x250, Custom scenario +0x2b4, Profile +0x230. Buttons: Play 344, Tools 348, Options 350,
  Tutorial 324, Career 318, Sandbox 320, Custom 328, People 334, Scenario editor 330, Coaster 338, Building 33c,
  New 254, Load 2ac, custom New 2b8 / Load 310 (Back 358, Exit 354 are type 4). Nav buttons (ctor 0xa476b0, vtable
  0xf8df70) keep their target panel at +0x13c; click (0xa48c20) closes the parent panel (+0x3c) and opens the target,
  so they work from any menu. 0xa4a750 (vtable slot) = label text per widget; 0xa49ab0 = hover help line.
- Placement: 0xa47190 (type, slot, button, icon, menu, flag) parents the button to `menu` and, for type 0, starts it
  at -1000 with an animator (0xa45370: angle, r, size, ButtonBox [front+0x100+4 slot]) that 0xa50330 runs every frame
  (open: angle first, then radius; close: radius x2; idle: 1.885 rad / 480). The bar with the words is the per-slot
  ButtonBox (0xa4bb00 sets its label on open), placed by slot in the ctor loop (0xa4f199) and on resize (0xa47d62).
  Resize (0xa47d30) puts type-0 buttons at -1000 (0xa457a0 type 0, flag 0) - the animator owns them.
- Code cave in .text's zero tail (0xf25d00; VirtualSize 0xb24ce5 -> 0xb25000): angle(type 0, slot < 5) via
  jump-table entry 0xa452c0 -> ANG[slot]; the 4 calls of r() (0xa457ab, 0xa47285, 0xa47d79, 0xa4f18b) -> stubs that
  know where their slot is -> RAD[slot]. Each button's 0xa47190 call: slot byte, menu disp32 in its mov, and target
  (SKIP stub 'ret 0x18' = removed, never parented, not shown). Angles are kept within pi of 1.885 so the slide-in
  takes the short way.
- In the game (Steam, Neon v2): places (160,140) (470,520) (880,640); main = RIDE, Coaster Designer (moved from Tools),
  BUILD; Options removed - all three showed with bars where set, Options gone; Coaster Designer opened the coaster
  designer; RIDE opened the Play menu on the same places. Place 3 at (880,640) sits under the Wild expansion badge
  (clicks hit the badge). Steam exe put back after (menus uninstalled, Neon layout kept).
- Tests on copies: set / read back / 5 refusals / second set / reset_layout and reset_menus byte-identical / restore;
  UI (drag, remove, add with "moves from", save, read back, Game's own layout -> md5 of the original), no page errors.
- Limit: a game button is one widget, so it can be in one menu at a time (copies would need new widgets built in the
  ctor - possible for nav buttons, not done).

## 2026-10-15: Fireworks - tester's feedback "motions a bit strange like stretching, some tails too much sphere"
- Screenshot (Discord, the Comet in the viewer): the head low, a column of round blobs above it.
- Parent carry (viewer since 0df5a92, never checked): a child of a living parent was also moved by the parent's
  velocity each step. RCT3plus.exe's update (0x9c8390) only does v += a dt, x += v dt per particle; a child follows its
  parent only through ParentSpeedFactor at birth (0x9cbdf0). With both, the Comet's 100 trail sprites (speed 0, psf 1)
  ran ahead of the head at twice its speed (the column above it) and its 4 s Flare_00 tail (psf 0) stayed balled up
  round the head. Removed. In the game (Steam, MixMaster picker preview) the Comet is a head with a short sparkly tail
  hanging below it, as the viewer now draws it. Shipped fireworks change little (6 s tops: Thunder Blitz 24.1 -> 23.4 m,
  Green Peony ~57 both, Spheres of Fire 13.7 both, Fairy Fountain ~33 -> ~29.5 m).
- VelStretch (sprite builder 0x9cf24f, desc in its registered layout: AnimTimeScale 0x128, CameraSpinRate 0x12c,
  StartSize 0x130, EndSize 0x134, SizeRandom 0x138, VelStretch 0x13c): the quad stays camera-facing, turned by its spin;
  each corner offset o gets +0.5 VelStretch v if dot(o, v) >= 0, else -0.5 VelStretch v - in 3D. The viewer stretched by
  the full 3D length along the on-screen direction of travel, so particles flying at / away from the camera became long
  smears in a random direction. Shader now does the game's corner shift (spin kept on stretched sprites too).
- Burn trails (BurnLength 0x100 / BurnSize 0x104 in the update's layout): BurnLength > 1 makes a trail object (0x9d3a60
  -> 0x9d0c60: ring of BurnLength 32-byte points, +0x30 points, +0x34 head, +0x38 count); each rendered frame 0x9cdba0
  stores the particle's position (camera-relative) and colour; when the particle dies the count drops by one a frame
  until < 2. Drawn by 0x9d0170 as one camera-facing strip, BurnSize wide (+-0.5), side averaged over the two segments
  at a point, texture BurnTrail (64 x 64 soft round glow, style ParticleBurnTrail, added) with u across and v from 0.5
  (newest) to 1.0 (oldest): bright at the particle, fading behind and to the sides. The viewer drew BurnLength fading
  copies of the particle's own sprite (a string of balls). Now createTrails (fw_effects.js) draws that strip; points at
  a steady 40 a second (the game: its frame rate), dead particles' trails shrink away (ghosts). No shipped firework and
  not the Comet uses BurnLength (all 0); checked by giving Gemini Rockets' particles BurnLength 30 in the page.
- Not done: the strip's per-point weight min(1, 0.01 x ...) (a screen-space term, unclear) - points kept at full colour.
- Checks: all 29 fireworks (+ the Comet) 6 s without NaN, no page errors; ui_fireworks unchanged (favicon 404 only).

## 2026-10-15: GUI Editor - in-park screen (top bar, left buttons) and an animation editor
- Request: the bar along the top of the screen in a park and the buttons down the left in the Game interface page;
  editing the animations of every GUI item that has them.
- In-park HUD, from RCT3plus.exe: top bar built at 0x655788 (strings 0xf4cb00-0xf4d200): Top_WindowFrame_Left /
  _Middle / _Right, DayNightModeButton, ObjectiveStatusButton, Pause / Play / FastForward / SuperFastForwardButton
  (Top_Pause / Top_PauseSelected ... switched at 0x65760f-0x657b0b), Money, PeopleInPark, Top_ThumbsDown,
  ParkRatingBar, Top_ThumbsUp, Temperature, IconCloudWithSun / IconWeatherArrow / IconCloud, DateAndTime,
  AvatarNameButton (Guest_Group / _Disabled), Fireworks, EscapedAnimals (DartCam_*), then MainBottomLeft /
  MainBottomRight (not done). Left toolbar at 0x5f686a: Obj_Delete, Land, Obj_Paths, Obj_Scenery, Obj_Shops,
  Obj_Rides, Man, File_Quit, File_CareerMap, File, View, Map (icons on GUI2LargeIcons), on MenuButtonSmall discs
  (GUI2MainIcons). Positions are not immediates (a layout pass); measured in the game (Steam, sandbox, 1280 x 800):
  bar x 301-975, y 0-22 (Left piece stretched over the left half through its cuts, Middle 600-638 = the notch,
  Right the right half); icons 1:1 except the 40 px ones drawn 16 (hat, weather, dart cam, firework, avatar); left
  discs 32 x 33 at x 12, y 157 + 40 k (60 between the 4th and 5th), icon 27 x 27 at +3,+3. Icon names for the hat /
  weather / right-end buttons identified by eye (template matching at small sizes was unreliable on flat icons).
- GUI Editor: Main interface opens on a new **In-park screen** tab (texgui.js HUD table, showHud / drawHud): whole
  screen or zoomed bar / buttons; speed, weather, hat, day / night, career and greyed-button options; click a piece
  -> its pictures (states / alternatives) on the right with the usual icon editing; double-click paints it.
- No interface texture has animation frames (all 20 animated ftx are scenery / rides); GUI animations are numbered
  icon sets (62 in Main: MassiveWaiting_1-6, the editor's state icons, colour sets...). Animations tab now edits them:
  order (each frame takes another frame's rectangle, saved as rectangles; ◀ ▶, drag, Reverse), "Same as" another
  frame, paint / replace one frame, Import animation (PNG strip, across or stacked by the frames' shape, or an
  animated GIF / WebP via ImageDecoder) painted into the frames' places on their sheets (/api/tx/write per sheet).
  Playback speed is the game code's, so only a preview setting here.
- tests/ui_hud_anims.py (viewer on the scratch copy fg/): clicks resolve to Pause (2 pictures), the bar halves, the
  middle, weather, Paths; reorder -> 2 rectangles moved; import a 6-colour strip into MassiveWaiting -> frame 3's
  place reads (80,140,255); restore -> Main.common.ovl md5 identical. No page errors. Not tried in the game this
  time (icon rectangles and pixels were shown to work in the game on 2026-10-14).

## 2026-10-15: Front screen designer - simulate the menus; pick several buttons and remove them
- **▶ Simulate** (front screen toolbar): click through the menus with the current layout (saved or not). Play / Tools /
  Sandbox / Custom scenario open their menu wherever they sit (the button carries its action, frontscreen.py);
  the other 11 buttons leave the front screen, shown as a note. Back (the corner button, Backspace, Esc) walks a
  history, Quit on the main menu. Opening a menu slides the buttons round the circle from the animator's resting
  angle 1.885 rad to their places, staggered (an approximation of the game's slide-in, timing not measured).
- Picking: Shift / Ctrl-click, a box on empty space, or the list's tick boxes; picked places drag together; Delete /
  Backspace or **Remove picked** removes them (the main menu keeps at least one button); Ctrl+A picks all.
- tests/ui_front_sim.py (viewer on fg/): Main > Play > Sandbox, New sandbox note, Esc Esc back to Play, Back to
  Main, Esc stays in the editor; Shift-pick places 1 + 3 of Play, drag moves both by 32 and not place 2; Delete
  leaves 2 of 4; box picks all 3 of Main, removing all refused, removing 2 leaves 1. Nothing saved. No page errors.

## 2026-10-16: Fireworks - tester: "this effect is supposed to be a fan" (preview: a couple of balls high up)
- Emission RE (0x9cbdf0, loop 0x9cbf04-0x9cc9db): the k-th particle's time t = start + k x [esi+0xc0] (window / N),
  advanced per particle; the parent's position, velocity and frame are interpolated to t between the previous and the
  new step ([esp+0x18] / [esp+0x1c] weights); the spin is SpinOffset + SpinRate x t (fmul [esi+0x94/98/9c] by
  [esp+0x20], fadd [esi+0x88/8c/90]) - per particle. The viewer turned every particle of a step by SpinRate x the
  step's age, so a fast-spinning emitter (a fan: N stars over a short window) stacked them into 1-2 balls.
- Fix (fireworks.js emit): each particle's own time tj = (a + (b - a) j / N) life + delay; spin and the parent's
  particle spin use tj; it starts where the parent was at tj, moved on by its own velocity for the rest of the step
  (age = that remainder, not stepped again this frame).
- tests/fw_fan.py: 11 stars over 0.02 s, SpinRateX 100: before 2 distinct directions, now 11 over 1.92 rad. All
  shipped fireworks 6 s without NaN; tops change within the random spread. Not seen in the game (the tester's fan
  file is not here).

## 2026-10-16: GUI Editor - simulate the in-park screen (left button menus, top bar)
- Measured in the game (Steam, Neon Nights front screen, sandbox, 1280 x 800; game closed after): a left button opens a
  column of MenuButtonSmall discs at x 52-84, 40 apart, the last one centred 19 px above the button's centre, pushed
  down to start at y 24 if it would go off the top (Rides 12 and View 9 do). The button in use / under the pointer is
  drawn ~1.35x. Tooltips below-right, the game's text <icon>Help (MapHelp, Obj_Rides_RollerCoastersHelp...).
- Flyouts, top to bottom (icons identified against Main.common.ovl + tooltips hovered in the game):
  View: Land_Grid, Land_Contours, Land_RideHeights, Land_PathHeights, Land_People, Land_Supports, Land_SceneryVisible,
  Land_TerrainVisible, AnimalWalkingGridOff (toggles; the other icon when on). File: File_AboutRCT, File_GameOptions,
  File_SaveGame, File_LoadGame. Man: Park, Finances, Staff, Objectives, Research, Rides, Guests, Challenges. Rides:
  RollerCoasters, JuniorCoasters, ThrillRides, WaterRides, GentleRides, TransportRides, PoolRides, OtherRides,
  TrackImport, Obj_Pools, Obj_Rides_Animals, Obj_Enclosures. Shops: Food, Drink, Stalls, Utilities. Scenery:
  TreesNPlants, Fences, WallsRoofsAndBuildings, PathExtras, ThemeProps, RideEvents, TerrainSurfaces, Adverts,
  CustomStructions_Icon ("Custom structures"), ThreeXFireworks (MixMaster). Land: Land_Brush_Height, Land_Brush_Paint,
  Land_Water, Land_Waterfall. Delete: GUI2_DeleteSelection, GUI2_DeleteSingleItem. Map opens the Maps window (64,0
  370 x 368, tabs Map_Scenery / Attractions / People); Paths and terrain tools a round panel at the bottom left; ride /
  shop / scenery categories a list at 84,0 288 x 318; management items a window (Park Operations 400,296). Top bar:
  hat -> Scenario objectives window (400,170 477 x 460); day / night -> its 3 icons in a list under it; others tooltips.
- Windows = WindowBackground (white) + GUI2Dialog_Frame stretched (the frame picture holds the blue title strip, the
  round header disc at the top left and the shadow; its middle is transparent). Quit = GUI2MiniDialog_Background +
  _Frame with _Confirm / _Cancel.
- Viewer: In-park screen > ▶ Simulate (texgui.js FLY, drawHudSim, hudWindow); what is clicked is selected for editing;
  Esc closes window -> day/night list -> flyout -> stops simulating. Not checked in the game: what Pools, Enclosures,
  Animals, Track import and the MixMaster item open (assumed tool / tool / list / window / window).
- tests/ui_hud_sim.py (viewer on fg/): Rides flyout, RollerCoasters list, Park Operations window, grid toggle, fast
  forward, objectives, day/night pick, Map, Quit, Esc x2 stops simulating and stays in the editor; no page errors.
  ui_hud_anims still passes, fg Main md5 unchanged.

## 2026-10-16: track placement as the game does it; park entrances, fences, raised walls
- Tester screenshots: some ride designs drawn wrong; Money Pit coaster pieces in wrong places; floating fences; wrong
  park entrances; texture glitches in parks.
- Track pieces were chained end to end (each joined to the previous exit), which drifts on any piece whose geometry
  was misjudged (Inferno Tower's TowerCap, ring slides, tilt lift, robotic arm...). Learned from the 165 designs that
  closed: every piece's origin is its footprint's centre, the stored tile (POSX/POSZ) the footprint's lowest corner,
  footprint = the sid's squares (swapped at odd rotations), rotation (DIRECTION + 2) % 4, HEIGHT its base (2,148 of
  2,200 piece kinds, the rest learned from the chaining's own mistakes). designs.lay_track now places every piece
  from its grid data alone; the check is the gap between consecutive pieces (info joint_gap, tests/design_direct.py).
- Lift pieces (Sky Swinger LiftBottom/Middle/Top, ThrillLift*) list the lift car's rails first; the train rides the
  '...joinSpline' pair. Stormrunner names Track5 + Track9_CT pieces: Track5 held more of the names, but its
  Straight2Steepslope is 4 tiles, the Track9 one 5 - track_sets now prefers one track folder holding every piece.
- Result: 207 / 208 designs every joint < 10 cm (King Rapids 0.27 m at one piece); 39 / 39 tracked rides in the parks.
- Park entrances: themed styles keep the sid in Style\Themed\X\Style.common.ovl and the model in a subfolder OVL named
  after it (EntranceExit\MainEntrance\MainEntrance.common.ovl); the global name index gave every theme the Vanilla
  art-deco gate. Library.find_near now also looks in the folder's subfolders at OVLs named like the resource (also
  fixes Broom Lake's Space entrance wall set 'Straight', which was a queue piece). Entrance (3 x 1) placement: the
  stored tile is the middle one and the gate straddles the land edge: half a tile towards +row / +col / -row / -col at
  directions 0-3 (Chequered Flag / Box Office / Vanilla Hills / Zoo Rescue, checked against the game on CF).
- Park fence: Park.ParkFenceEntry names the fence item (CorralBarbedWireFence in Wild West parks, LazerFence,
  SpiderWebFence, RickertyFence, Standard2Chain...). All are 4 m along local z; viewer lays one per land-edge tile side,
  each vertex lifted to the ground along the edge (CF barbed wire matches the game). Placed fence items (sid type
  'fence') bend to the ground too instead of floating over slopes.
- Raised items: HEIGHT = round(tile mean ground) + HEIGHTOFFSET (16,783 items on slopes, 30 parks). Items with an
  offset were dropped onto the slope when HEIGHT fell inside the tile's height range (Box Office WWest_Fence balcony
  rails, walls 1-3 m up); place() now keeps HEIGHT when HEIGHTOFFSET > 0.

## 2026-10-16: Fireworks made in the game's Advanced firework editor (simple and complex), and back
- In the game (Steam RCT3, Money Pit copy loaded from My Documents\RCT3\Parks): a guest renamed "Guido Fawkes" adds
  "Advanced firework editor" to the top of the MixMaster effect picker (double-click it). Its buttons, top to bottom:
  add emitter (to the selected node; with nothing selected nothing happens), remove, Firework Designer (settings window,
  groups in a drop-down), Load, Save. Clicks only register after the pointer has hovered (hc.sh: move, wait, click).
  Colour: clicking the Particle basics colour area opens an R/G/B bar picker; the stop is saved as R/G/B/A curves
  with one point (A 1.0).
- Made there: ZZSimpleBurst (base -> 89 x Flare_00, Start 0 End 0, speed 2.37, sphere 1.87, empty colour curves) and
  ZZComplex (burst -> 89 stars 2 s -> 55 orange trail sparks per star). All parse in the viewer field for field.
- FireworkEffects files: 80-byte header (0, 0, 0xF11EDA2A, 0x40, 2, 0, 2, 3, 32 x 0, -1, -1, 0, 0), the trk body, and
  a u32 checksum: Adobe eexec over every byte before it - c = byte ^ (r >> 8), sum += c, r = (c + r) * 52845 + 22719
  (written 0x58BF - (c + r) * 0x3193), r0 = 55665 (RCT3plus.exe 0x801de4, seed found as `mov word [x+0x14], 55665`).
  Brute force over the seed also matched 0x8B15 on one file (sums collide); the game rejected that ("may have been
  corrupted"). fireworks.designer_file() rebuilds the game's own file byte for byte. Shipped Fireworks\*.frw have no
  header or checksum.
- The game's editor preview showed NOTHING for ZZSimpleBurst, nor for copies with white colour curves, faster stars
  or ParticleRelative off; End Time 0.05 or 1 showed the burst (white, empty curves = white). Emitter code 0x9cbdf0:
  returns unless t0 < end and t1 >= start (t0/t1 = the parent's previous/current time, absolute); count =
  k1 - k0 with k = floor((t - start) / window x N) + 1 (k0 = 0 when t0 <= start, k1 = N when t1 >= end). A particle's
  first step has t0 = 0, so End 0 never fires; Start = End > 0 (Golden Explosion, Solar Strike 1.0; Comet 0.8) fire
  all N at once. The viewer released all N for any empty window: now an emitter with End <= 0 is skipped
  (fireworks.js emit), and the AFE tree / panel mark such emitters "never fires". Shipped files with End 0 emitters:
  AtlantisTorch, Bonfire, Candlefire (1 particle each, now not drawn, as the game's rule says).
- Save to game now also writes the firework into My Documents\RCT3\FireworkEffects in the designer format (never over
  a file you made there): a Green Peony saved this way opened and played in the game's editor.
- tests/fw_game_made.py (fixtures tests/data/ZZ*.frw, made in the game): End 0 -> 0 stars, End 0.05 -> 89, complex ->
  89 stars + 162 sparks at most. fw_fan passes. Test files removed from My Documents\RCT3 and the game folder after.

## 2026-10-16: session summary and open items
- Commits this session: 5efa4a2 front-screen simulate + multi-select; 2dbb4ea fireworks fan; 6f37707 in-park screen
  simulate; 5045e85 track placement / entrances / park fence / bent fences / raised walls; 3ff9c4e game-made
  fireworks (End 0 never fires, designer-format save with eexec checksum). Desktop rct3ovl.zip rebuilt after each.
- Tests added: design_direct.py (joints in every design: 207/208 < 10 cm), park_tracks.py (39/39 park coasters),
  ui_park_shots.py (park screenshots: @cam, @x,y,z,d, @tCOL,ROW,d[,yaw]), fw_game_made.py (fixtures tests/data/ZZ*.frw).
- Game driving that worked (Steam, 1280 x 800): career map -> Checkered Flag / Box Office; locked parks via copies in
  My Documents\RCT3\Parks + Load game (copies removed afterwards). RCT3 widgets need hover before click (move, wait
  0.4 s, click); Esc in a park asks "quit to main menu" (cancel with the red X ~704,424). Map window (28,173) jumps
  the camera to a clicked point.
- Open:
  - The tester's 10 screenshots (Pictures\Screenshots image.png ... ima9ge.png) could not be viewed (image request
    limit); "texture glitching" was taken to mean the wrong models / floating fences found - ask for them if more remain.
  - King Rapids: one joint 0.27 m (Medslope2straight at piece 3).
  - Terrain look at a distance not re-compared with the game this session.
  - In-park simulate: Pools / Enclosures / Animals / Track import / MixMaster item targets not checked in the game.
  - Fireworks: viewer vs game compared by particle counts and shape (column burst), not frame by frame.

## 2026-10-21: open items - tester's screenshots, King Rapids
- Tester's 9 screenshots (Pictures\Screenshots image.png, ima2ge, im3age..im9age, Oct 16 03:55-04:00, taken on the
  old build): designs that don't close (Butterfly Knot 54.7 m, Inferno Tower 16 m, Towering Turns 40 m) and Money Pit
  coaster pieces - fixed by 5045e85. Still there with today's code: blotchy ground (pink / white / grey round patches
  on Cosmic Craggs, Broom Lake, Checkered Flag; a dark smudge at a Box Office fence corner).
- Those patches are in the data: designers speckled single tiles of other textures (Broom Lake 203 isolated tiles of
  terrain_14, 171 of 18; Cosmic Craggs 191 of 15 (pink)). The viewer's smoothstep bilinear blend turns each into a
  soft round 4 m blob. No blend / mask texture in the game (Terrain_RCT3 OVL: terrain_NN, Cliff_0N:ter,
  TerrainCliffN; terrain_NN alpha all 255), so the shape comes from the engine's shader -> needs a look in the game.
- King Rapids 0.27 m joint: not a placement error. Rapids Medslope2straight has two rail pairs, '_spline' (starts at
  +1.75, on the Medslope's end, ends 0.29 m high) and '_joinSpline' (starts 0.25 m off, ends on the Straight); the
  Medslope / Straight2medslope rails run +1.75 .. -2.25. designs._piece_ends: the joint check takes the nearest end of
  any rail pair. design_direct 208 / 208 < 10 cm (only King Rapids changed, 0.265 -> 0.01); park_tracks 39 / 39.
- 2026-10-21 game session: backup of My Documents\RCT3 at ~\.universal-modder\backups\rct3-userdir\20261021-193604.zip
  (um backup restore). Temporary copies: My Documents\RCT3\Parks\ZZ BroomLake.dat, ZZ CosmicCraggs.dat (remove after).

## 2026-10-21: terrain blend as the game does it (painted single tiles in the game)
- Game (Steam, Cosmic Craggs copy via Custom scenario > Load game, 1280 x 800, grid on): Terrain tools > Terrain
  textures, brush 1, painted one green tile (27, 84), one black, a black 2 x 2 (rows 26-27, cols 88-89) and brush 3
  (= 2 x 3, rows 28-29, cols 78-80); saved and diffed EngineTerrain byte 16 against the original (bytes 19 / 22 / 23
  change on every tile at save - runtime). Copy kept outside the repo: ~/rct3-work/tmp/game21/paint_test_CosmicCraggs.dat.
- Measured across the lone green tile: a flat plateau over the tile, fading linearly to nothing one tile out each
  side; the 2 x 2 block peaks at its shared middle corner. = each tile corner takes the mean of its 4 tiles' textures,
  linear across the tile: a lone tile is a 25% plateau, 3 tiles wide in all. The viewer (texture at full strength at
  each tile centre, smoothstep to the next centre) made every speckled tile a strong round blob - the tester's
  "texture glitching" (pink on Cosmic Craggs, white / grey on Broom Lake).
- parks.js terrain shader: weights over the 3 x 3 tiles round the fragment, separable: x (1 - f) / 2, 1 / 2, f / 2
  (f = position in the tile), same for z; repeated layers merged, one triplanar lookup per distinct layer.
- tests/terrain_blend.py: finds a lone tile on flat ground, looks straight down, renders twice (only that tile's layer
  flat grey vs every layer grey; grey 90 so nothing clips once lit) and divides in linear light: weight per 1/8 tile.
  Box Office tile (37, 31): 0.250 plateau, 0.031 steps, 0 at 1.5 tiles - worst 0.002 off the game model.
- Camera keys in the game: wheel and numpad +/- do nothing here; PageDown / PageUp move the camera down / up (not a
  zoom). The Map window jumps the camera. Opening hours run into the night quickly - pause (331, 11) first.
- Loading a park: Neon Nights front screen - RIDE badge (492, 97) -> Custom scenario badge (495, 410) -> Load game
  (455, 200): lists My Documents\RCT3\Parks (ZZ copies). Saving from there wrote to My Documents\RCT3\Scenarios (+ .bak).
  The front-screen buttons only react on their round badges, not the bars. um win drive has no 'wait' command - one
  call per hover / click (tmp/hc21.sh).

## 2026-10-21: in-park buttons checked in the game (Broom Lake copy)
- Rides > Track import: a list window (x 84-370, y 185-500), its header a drive picker ("C:\"), "No items meet current
  filter criteria"; tooltip "Import Track Designs from previous RollerCoaster Tycoon titles". Rides > Animals: list
  "Purchase Animals" (Camel (Wooden Fence), Chimp (Chain Fence), ...) at y 265-582 and the ground turns to the
  enclosure tint. Lists are centred on their button (344 -> 342.5, 424 -> 423.5), kept on screen (RollerCoasters at 0).
- Rides > Pools: tool panel bottom left (to x 368) with a pool-shape brush on the ground. Rides > Enclosures: tool panel
  (to x 332): fence types + delete. Scenery > MixMaster: tool panel (to x 457) with tabs (fireworks, red, folder),
  two side buttons and a list.
- texgui.js: Track import 'picker' (was dialog), MixMaster 'tool' (was dialog); pickers centred on their button;
  TOOL_RIGHT per tool. tests/ui_hud_sim.py checks track import / animals list tops and the MixMaster panel width.
- Session cleanup: ZZ copies removed from My Documents\RCT3\Parks and \Scenarios; game closed from its menu.
- Still open: fireworks frame by frame vs the game (needs recording the game's editor preview and the viewer).

## 2026-10-21: fireworks vs the game, frame by frame (MixMaster picker preview, recorded)
- Route (scripted, ~/rct3-work/tmp/topicker21.sh): RIDE badge 492,97 > Sandbox 455,310 > Start game 492,97 (~50 s) >
  Scenery 28,473 > MixMaster 68,454 > Add display 185,683 > a track 400,640 > Fireworks + 79,328 (wheel scrolls the
  list). Preview pane 503-726 x 319-542 (crop x 503 y 319, 224 px; the pane's own border is the crop's first column).
  um win record --exe RCT3plus.exe --seconds N --fps 30 --no-audio; tmp/fwrec/frames.py crops the pane (imageio-ffmpeg).
- The preview loops the effect about every 2.3 s, cycles overlapping. Green Peony (2 shells): launches 0.47-0.50 s
  apart (base life 1 s, N 2 -> 0 and 0.5), bursts 1.16-1.20 s after launch (shell life 1.2 x StartTime 0.99) - the
  viewer gives 0.50 and 1.19. Test file ZZPeonyOne.frw (Green Peony with 1 shell, built by build_frw) copied into
  both game folders' Fireworks\ for this, removed after; a new .frw needs a game restart to be listed.
- The preview camera (no zoom: the horizon stays at y 142 all cycle): fitted to the shell's climb (38.55 m/s; on
  screen it seems to slow - a wide lens close by), the horizon and the mortar (y 157): 117 deg vertical lens, 12.1 m
  back, 2 m up, tilted up 23.8 deg, 1.6 px rms. Checked against the scatter of 15 bursts (rows 10/50/90 % 8/59/80,
  model 16/57/73; ~40 % leave the pane, model 38 %); a far 45 deg camera puts them all at rows 84-100. Scale can't be
  told from the video (camera distance and speeds scale together), so everything is in units of the shell's rise.
- Found and fixed, both from RCT3plus.exe:
  1. Sprite size: 0x9cf3b7 puts the corners at (cos - sin) x size along the camera's unit axes (normalised just
     before, 0x9cf13b / 0x9cf198): the sprite is 2 x size across. The viewer drew it size across. Firework particles
     now drawn at 2 x size (the viewer's own water-jet drops keep theirs). Burst flash (glow off) went from half
     brightness at ~10 px to ~18 px (game ~22-24 px); the rising shell is now plainly visible, as in the game.
  2. Emitter randomness (0x9cc5c4-0x9cc8f9; offsets from the field registration 0x9ccec3...: 0x6c PositionRandom,
     0x70 PositionRandomCircle, 0x74 ParticleSpeed, 0x78 SpeedRandom, 0x7c SpeedRandomCircle): velocity +=
     SpeedRandom x a normalised point of the cube [-0.5, 0.5]^3 (full length; the viewer used 0.85-1.0 x on a sphere),
     + SpeedRandomCircle x a ring direction; position += PositionRandom x a point inside a ball of radius 1/2
     (rejection, |p|^2 <= 0.25) and PositionRandomCircle x a point inside a disk of radius 1/2 (the viewer used up to
     the full value / exactly the full value). Random numbers: 0x475180, 23-bit LCG.
- Measured with the fitted camera through one pipeline (tests/fw_frames.py renders the viewer from that camera,
  stepping 1/120 s by hand; tmp/fwrec/rmsm.py): light-weighted RMS radius of the green light round the burst, in
  metres, at 0.2 / 0.4 / 0.6 / 0.8 / 1.0 s - game (11 bursts) 2.9 / 5.7 / 8.9 / 12.2 / 13.7 (sd 0.4-2.4); viewer
  before 2.0 / 4.5 / 6.9 / 9.5 / 12.5, after both fixes 2.2 / 5.0 / 7.7 / 10.5 / 13.7 (glow off, 5 runs).
- Still open: brightness - the game's green light per m2 is ~3x the viewer's at 0.2 s and fades over the second
  (13.7 -> 4.0), the viewer's stays ~2; the flash's centre is 245 in the game (texture max 229). The colour is packed
  in the update, not scaled in the sprite builder - perhaps a MODULATE2X-like render state. The viewer's Glow (bloom,
  on by default) adds a haze over the whole pane at each burst flash (corners 20-60; game 0.1) - not in the game.
- All 30 fireworks run 6 s without NaN (sweep in the page), fw_fan and fw_game_made pass.
- __fwdebug gained stop / drawNow / scene / labels for frame-by-frame captures.

## 2026-10-21: firework brightness (colour space) and Glow off by default
- rct3.dgf (game folder, plain text) defines every render style. ParticlePreMultipliedAlpha: SrcBlend One, DestBlend
  InvSrcAlpha, stage ModulateAlphaClamp = Colour Modulate(Texture, Current), Alpha Modulate(Texture, Current) - plain
  1x, no MODULATE2X; ParticleBurnTrail One / One, ZFunc Always. The game works in gamma space: sheet x colour,
  blended straight into the screen.
- Viewer bug: particle sheets were loaded as sRGB (decoded to linear on sampling) and the custom shaders wrote that
  linear value straight to the canvas (no encode without the composer): everything dark, dim parts far darker (the
  flash's centre 202 for a 229 texel). Now: pages NoColorSpace (raw), particle + burn-trail shaders output the
  gamma value; with Glow on (composer renders linear, OutputPass encodes) a shared uniform linOut turns it linear first.
- Glow (bloom) off by default and remembered (rct3fw.glow); the game has none. tests/fw_frames.py: [glow] to turn it
  on, [native] to draw at the pane's 224 px with device_scale_factor (as the game: no supersampling).
- Result vs the game (one-shell peony, green light per m2 at 0.2 / 0.4 / 0.6 / 0.8 / 1.0 s): game 13.7 / 9.0 / 7.3 /
  6.8 / 4.0; viewer before 3.9 / 2.2 / 2.0 / 2.0 / 2.2; now at 224 px 13.5 / 7.7 / 7.2 / 6.8 / 6.4 (2 runs in view);
  rendered at 800 px and scaled down 16.6 ... 10.9 - the game's fade is partly its 224 px preview dropping sub-pixel
  trail sparks. RMS spread 2.3 / 5.3 / 8.7 / 12.0 / 15.0 m (game 2.9 / 5.7 / 8.9 / 12.2 / 13.7). Flash centre ~235.
- Test file ZZPeonyOne.frw removed again from the Desktop copy's Fireworks. fw_fan, fw_game_made pass.

## 2026-10-21: Mod Loader tab (in progress)
- Test downloads (Downloads, 2026-10-21 21:01-21:02): FlatStations.zip, Old-Spice's Custom Paths Vol 1.rar, DasMatzes CTRs 2.zip,
  [SpinningSteel]Wild Mouse.trk, Dumaan's Water Effects Pack V2 1.1.zip, v2.7 Liquid Firewrokss Pack.zip,
  stationjimjrGardening.rar, Matterhorn Bobsleds.zip. Installed into the viewer's game folder (Desktop copy) and the
  user folders; backup of My Documents\RCT3 before: ~\.universal-modder\backups\rct3-userdir\ (latest).
- Built: rct3ovl/mods.py (plan / install / disable / enable / uninstall, stock-file list data/stock_files.txt.gz from the
  Steam install, archives via zipfile or 7-Zip, content told by OVL resources: Style.ovl / ptd / trr / rit-ric /
  PlatformHeight; .dat by Park object; needs() = custom OVLs a design / park uses that the game lacks), static/mods.js
  (9th tab), /api/mods*. Store: ~/.rct3ovl/mods/<root>/ (packages.json, backups, disabled, removed).
- Ride Designs tab also lists My Documents\RCT3\Coasters ('yours/' keys); missing custom ride -> clear 404 message.
- Bug found and fixed: uninstall pruned empty game user folders (Coasters, FireworkEffects, Structures) - recreated;
  now only folders an install created are removed.
- tests/ui_mods.py with all 8 downloads: problems none. All 8 left installed (game parts in the Desktop copy; user-
  folder parts in My Documents\RCT3, Pictures\RCT3, Music\RCT3, shared with the Steam game).
- Not done: in-game check of the installed content; uninstall-all clean-state check was done (game folder identical).
- 2026-10-22: the same 8 installed into the Steam game (Mod Loader code, root = Steam folder; nothing replaced; store
  ~/.rct3ovl/mods/<steam root>/): stations 16, paths 288, CTRs 38, DumaansWW 60, stationjimjrGardening 846 files.
  User-folder parts were already there ('same'). Uninstall from the Mod Loader pointed at that folder.
- 2026-10-22 checked in the game (Steam, sandbox, not saved): game starts with everything installed; Scenery > Trees
  lists the "Station Jim's Gardening" group (its own picture, expands to its items) and Babys' Breath ETC placed and
  drawn; Paths shows 16 path types (10 stock + Spice's Wooden Dirt / Mossy Timber / Timber ...); Rides > Roller
  coasters lists DasMatze's Wooden Coaster ($9,000); MixMaster picker lists the Liquid Fireworks pack (001 WW LT ...)
  from My Documents\RCT3\FireworkEffects. Not checked: building a CTR, the station platforms, the Matterhorn scenario
  (needs CTR_Matterhorn and 54 sets that aren't installed).

## 2026-10-22: Parks tab shows your own scenarios and saved parks
- Viewing the 8 downloads (viewer API sweep): 441/441 new scenery items build with textures; 6/6 DasMatze track sets;
  CTR car models + textures; 114 Old-Spice path pieces + 36 textures; 669 fireworks (640 installed) simulate 10 s
  without NaN or page errors; Wild Mouse design builds. Not viewable: Matterhorn designs (CTR_Matterhorn missing),
  structures (.dat SavedSelection, no tab), billboards / music (Mod Loader file list only).
- parks.USER_GROUPS: My Documents\RCT3\Start New Scenarios / Scenarios / Parks listed as 'Your scenarios' / 'Your
  scenario editor saves' / 'Your saved parks' (file key 'yours\<folder>\<name>.dat'; park_path maps to the user
  folder; no campaign texts for them, title = file name). Matterhorn DLC scenario opens: 128 x 128, 6,704 items,
  267 guests; its 54 custom sets and 4 CTR_Matterhorn tracks are left out.
- A park's / design's coaster of a missing custom ride: OvlError -> 404 with a readable message (do_GET handler), was 500.
- ui_parks_all: 43 parks (42 game + the scenario), only problems listed are the scenario's missing custom content.
