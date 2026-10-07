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
