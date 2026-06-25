#!/usr/bin/env python3
"""Convert the print-ready 3MF sources into web-viewable GLB files.

The docs site previews each printable part with <model-viewer>, which only
loads glTF/GLB — not 3MF. This script regenerates a GLB companion for every
`.3mf` in `3mf/` and drops both files into `docs/static/models/` so the site
can serve the preview (GLB) and the download (3MF).

The GLBs are committed to the repo, so the docs build needs no Python. Re-run
this only when a 3MF source changes or a new part is added:

    python -m venv .venv && . .venv/bin/activate
    pip install -r scripts/3mf-to-glb/requirements.txt
    python scripts/3mf-to-glb/convert.py

Design choices that matter for how the part looks:
  * Flat shading — each face gets its own normals (vertices are unmerged) so
    flat printed surfaces render flat instead of being smooth-shaded across the
    part's hard edges. This matches a slicer/CAD preview.
  * A neutral grey PBR material so light/white prints stay visible against the
    viewer's grey backdrop.
"""

import glob
import os
import re
import shutil
import sys

import numpy as np
import trimesh

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
SRC_DIR = os.path.join(ROOT, "3mf")
OUT_DIR = os.path.join(ROOT, "docs", "static", "models")

# Baked print material (medium blue-grey, slightly glossy plastic).
MATERIAL = dict(baseColorFactor=[120, 124, 134, 255], metallicFactor=0.0, roughnessFactor=0.55)


def slugify(path: str) -> str:
    base = os.path.splitext(os.path.basename(path))[0]
    return re.sub(r"[^a-z0-9]+", "-", base.lower()).strip("-")


def to_mesh(loaded) -> trimesh.Trimesh:
    if isinstance(loaded, trimesh.Scene):
        return loaded.to_geometry()
    return loaded


def convert(src: str) -> str:
    mesh = to_mesh(trimesh.load(src))
    mesh.apply_translation(-mesh.centroid)
    # Flat shading: unique vertices per face, normals = face normals.
    mesh.unmerge_vertices()
    mesh.vertex_normals = np.repeat(mesh.face_normals, 3, axis=0)
    mesh.visual = trimesh.visual.TextureVisuals(
        material=trimesh.visual.material.PBRMaterial(name="print", **MATERIAL)
    )
    slug = slugify(src)
    glb = os.path.join(OUT_DIR, slug + ".glb")
    mesh.export(glb)
    shutil.copyfile(src, os.path.join(OUT_DIR, slug + ".3mf"))
    return f"{os.path.basename(src)} -> {slug}.glb ({len(mesh.faces)} faces, {os.path.getsize(glb) // 1024} KB)"


def main() -> int:
    os.makedirs(OUT_DIR, exist_ok=True)
    sources = sorted(glob.glob(os.path.join(SRC_DIR, "*.3mf")))
    if not sources:
        print(f"No .3mf files found in {SRC_DIR}", file=sys.stderr)
        return 1
    for src in sources:
        print(convert(src))
    print(f"Done: {len(sources)} part(s) -> {os.path.relpath(OUT_DIR, ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
