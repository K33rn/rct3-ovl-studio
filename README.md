# rct3ovl — RollerCoaster Tycoon 3 OVL extractor and 3D model viewer

Reads RCT3's `.common.ovl` / `.unique.ovl` pairs (base game v1, Soaked! v4, Wild! v5) and turns them into
normal files: textures to PNG, 3D models to glTF (`.glb`, textures embedded, skeletons included). Includes a
browser-based viewer for the whole game folder.

Compared with GameExtractor's `Plugin_OVL_FGRK` (which only cuts v1 files into numbered raw blobs named
`0001.unk`): reads all three OVL versions, resolves the common+unique address space, relocations and symbol
names, and decodes the content instead of dumping bytes.

## Use

Needs Python 3.10+ with `numpy` and `pillow` (or `uv`, which fetches them):

```
uv run --no-project --with numpy --with pillow python -m rct3ovl <command> ...
```

| Command | What it does |
|---|---|
| `view "<game data folder>"` | Opens the viewer at http://127.0.0.1:8765 (or double-click `rct3ovl-viewer.bat`) |
| `extract "<folder or .ovl>" -o out` | Textures to PNG and models to GLB, plus a `manifest.json` per OVL. `--type shs,tex` limits types; `--raw` also dumps extra-data blobs |
| `info <ovl>` / `list <ovl> [--type shs]` | Header, loaders, resources |
| `index "<game data folder>"` | Rebuild the name index (cached in `~/.rct3ovl`) |

Textures are often shared between OVLs (a model in one file uses a texture from another), so extraction and the
viewer look textures up across the whole game folder via the index.

## What is decoded

| Tag | Content | Output |
|---|---|---|
| `shs` | Static shape (scenery, ride parts) | GLB, with attachment points as named nodes |
| `bsh` | Bone shape (skinned models: rides, cars, animated scenery) | GLB with skin + skeleton |
| `tex` + `flic` / `btbl` | Textures: DXT1, DXT3, DXT5, 32-bit | PNG |
| `ftx` | FlexiTexture (8-bit paletted, recolourable) | PNG |

Materials follow the mesh's texture style (`SIOpaque*`, `SIAlphaMask*` cut-out, `SIAlpha*`/`SIGlass`/`SIWater`
blended, `*Unlit`, `SIFillZ` occluders dropped).

Verified on a full install (3,011 OVL pairs): every pair opens, every model loads (4,909 static, 1,853 skinned,
1.24 M triangles), every texture with pixel data decodes (18 engine placeholders have none). Full extraction takes
about 95 s.

## Not yet decoded
Animations (`ban`, `san`, `mms` morph meshes), people parts (`prt`/`ppg`/`phd`), track sections (`trr`/`tks`),
sounds (`snd`), text strings (`txt`), scenery definitions (`sid`/`svd`). They are listed in the viewer and in
manifests. Recolourable FlexiTextures show their default (often magenta) recolour areas.

## Credits
OVL format knowledge comes from OVL Extractor 2.0 (gamemodderz) and the RCT3 Importer / libOVL
(Jonathan Wilson, belgabor et al.), both GPL-2; GameExtractor (wattostudios) for the starting point. This code is
a fresh implementation. Built with Claude (AI). Personal use: never share game files or extracted assets.
