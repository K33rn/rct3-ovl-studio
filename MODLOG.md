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
