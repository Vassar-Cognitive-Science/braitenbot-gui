# 3MF → GLB converter

The 3D Models docs page previews each printable part with `<model-viewer>`,
which only renders **glTF/GLB** — not 3MF. This script converts the print-ready
`.3mf` sources in [`/3mf`](../../3mf) into web-viewable `.glb` files and places
both the GLB (preview) and a copy of the 3MF (download) in
`docs/static/models/`.

The generated GLBs are **committed to the repo**, so the docs build itself needs
no Python. You only run this when a 3MF source changes or you add a new part.

## Usage

```bash
python -m venv .venv
. .venv/bin/activate            # Windows: .venv\Scripts\activate
pip install -r scripts/3mf-to-glb/requirements.txt
python scripts/3mf-to-glb/convert.py
```

It processes every `*.3mf` in `/3mf`, writing `docs/static/models/<slug>.glb`
and `docs/static/models/<slug>.3mf` (e.g. `00 - wheel.3mf` → `00-wheel.glb`).

## Adding a part to the page

After converting, add a viewer block in `docs/docs/hardware/3d-models.mdx`:

```mdx
<ModelViewer
  src="/models/<slug>.glb"
  alt="Description of the part"
  caption="Part name · dimensions"
  downloads={[{label: '3MF (print)', href: '/models/<slug>.3mf'}]}
/>
```

## How the conversion is tuned

- **Flat shading** — vertices are unmerged so each face uses its own normal.
  Flat printed surfaces render flat instead of being smooth-shaded across the
  part's hard edges (the same look a slicer gives).
- **Neutral grey material** — a medium blue-grey PBR material so light/white
  prints stay visible against the viewer's grey backdrop.
- **Centered** — each mesh is translated to its centroid so it orbits cleanly.
