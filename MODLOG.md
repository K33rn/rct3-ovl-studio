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
