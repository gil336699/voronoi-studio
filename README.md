# Voronoi Studio

Voronoi Studio is a browser app for designing Voronoi patterns to make things with. Pick a sheet size and shape, choose how many cells and how they're placed, shape them with gradients and relaxation, and drag, add or erase cells by hand. Then export them at real size: a laser-ready SVG or a DXF for cutting, or an SVG or PNG for artwork. It rebuilds and extends Gil's Voronoi Lab.

**Use it online:** https://gil336699.github.io/voronoi-studio/

Everything runs in your browser. Your designs and files stay on your computer.

## Run

Requirements: Node.js 22 or newer and a current desktop browser.

```bash
npm install
npm run dev
```

Open the address Vite prints, normally `http://localhost:5173`.

To build static files you can host anywhere, run `npm run build`. The site is written to `dist/`. Preview it with `npm run preview`.

## Publish

Each push to `main` builds the app and publishes it to GitHub Pages through `.github/workflows/pages.yml`. The site is live about a minute later. The build uses relative paths, so `dist/` also works on any other static host, in a subfolder, or on a custom domain.

## Layout

The sheet fills the window, and the controls float above it on translucent glass, in the style of Apple's Liquid Glass. The look follows the system's light or dark appearance, and its Reduce transparency and Increase contrast settings.

- **Top left.** The app name and the **?** button for shortcuts and the quick start.
- **Left panel.** Four tabs: **Pattern** (cells, placement, gradient, relaxation), **Sheet** (size, units, shape, border), **Style** (Lines or Holes, colours) and **File** (project and exports). A dot on Pattern means hand edits are holding back new settings; a dot on File means unsaved changes.
- **Above the sheet.** Tools (Move, Add, Erase, Pan) on the left. Sites, Edges or Holes, Delaunay, and zoom on the right. A caption explains the current tool.
- **Below the sheet.** The action dock: **Generate**, **Relax**, **Auto-relax**, the status, and Undo and Redo.
- **Right panel.** **Measurements**: sheet size, cells, holes, average cell size, evenness, the narrowest hole or shortest edge, and total cut length.

Narrower windows show tool and action buttons as symbols only. On tablets the sheet sits on top with both panels below it. On phones everything is in one column, and pinching zooms.

## Help in the app

- **Hover any control**, or move to it with Tab, to see a one-sentence description and its keyboard shortcut. Unavailable controls say why, for example why the cell count is locked when you set the spacing yourself.
- **Measurements with a dotted underline** explain themselves on hover.
- **Quick start** shows three steps on the first visit. Reopen it from the **?** button, which also lists every shortcut.

## Workflow

1. **Sheet.** Choose a preset such as a 200 mm tile, A4, a 12 × 12 in laser sheet or a Ø 100 mm coaster, or type a size. Choose Rectangle or Ellipse and a border.
2. **Pattern.** Set the number of cells and the placement. Add a density gradient for cells that get smaller toward one side, the centre or the edge.
3. **Relax.** New patterns get a few relaxation steps. Press **Relax** for more, or **Auto-relax** to keep going until the points settle.
4. **Edit by hand.** Drag points to move cells, Alt-click (or the Add tool) to add one, Shift-click (or the Erase tool) to remove one. Once points are edited by hand, pattern settings wait for **Apply settings…** so your edits aren't lost by accident.
5. **Style.** **Lines** draws each edge once. **Holes** cuts each cell out, leaving a web of material, with rounded corners and a smallest-hole limit.
6. **Save and export.** **Save** writes an editable `.voronoi.json` project with every point. **Laser SVG** and **DXF** are for cutting; **SVG** and **PNG** are for artwork.

The app asks before New, Open, Generate or Apply settings would replace unsaved work or hand edits, and Undo can bring the previous design back. The current design is also kept in the browser, so it comes back after a reload.

## Features

### Placement

| Placement | What it does |
| --- | --- |
| Random | Points land anywhere. Cells vary in size and can clump. |
| Even | Poisson-disk sampling: points keep a minimum distance, so cells are even but organic. |
| Hex | A honeycomb grid. Jitter loosens it. |
| Square | A square grid. Jitter loosens it. |

With **Auto spacing** on, the spacing follows the cell count. Turn it off to set the spacing yourself; the count then follows the spacing.

### Density gradient

| Gradient | What it does |
| --- | --- |
| None | Cells are about the same size everywhere. |
| Linear | Cells get smaller toward a direction (0° is right, 90° is up). |
| Radial | Cells get smaller toward the centre, or toward the edge. |

**Strength** is how many times smaller in area the smallest cells are than the largest. Relaxation keeps the gradient.

### Exports

| Export | Contents | Units |
| --- | --- | --- |
| Laser SVG | Cut paths only, as 0.025 mm red hairlines with no fill. Holes in group `cut-inner`, the sheet outline in `cut-outer`, inner cuts first. | mm, or in for inch sheets |
| DXF | AutoCAD R12 text. Holes as closed polylines whose rounded corners are true arcs, lines as LINE, round sheets as CIRCLE. Layers `CUT_INNER` and `CUT_OUTER`. | mm, or in for inch sheets |
| SVG | The design as shown: colours, line width, fill, background, sites and Delaunay lines if visible. | mm, in, or px for pixel sheets |
| PNG | The design at the sheet's pixels per inch, optionally with a transparent background. | px |
| Project | Settings and every point, as `.voronoi.json` (schema `voronoi-studio/project`, version 1). | mm |

Cut files contain each line once, so a laser never cuts the same edge twice. Exports always show the whole sheet, whatever the zoom.

## Controls

| Control | Effect |
| --- | --- |
| Cells | Number of points, one per cell (2–10,000). Typed or on a log slider. |
| Minimum spacing / Grid spacing | Distance between points when Auto spacing is off. |
| Jitter | How far grid points may wander, as a share of half the spacing. |
| Seed, Shuffle | The same seed and settings always give the same pattern. Shuffle picks a new seed. |
| Tries per point | Poisson-disk attempts per point for Even placement (30 is standard). |
| Steps when generating | Lloyd relaxation steps for each new pattern and each press of Relax (0–50). |
| Preset, Units, Width, Height | Sheet size. Switching units converts the numbers; the sheet keeps its size. |
| Shape | Rectangle, or the ellipse that fits the width and height. |
| Border | Gap between the sheet edge and the pattern. In Holes style, the width of the solid frame. |
| Pixels per inch | Resolution for pixel sizes and PNG. On a pixel sheet, changing it keeps the pixel size. |
| Keep points when the sheet changes | On: points stretch to the new size or shape. Off: a new pattern is made. |
| Cell style | Lines or Holes. |
| Web width, Corner radius, Smallest hole | Holes only: material between holes, corner rounding, and the narrowest hole kept. |
| Line width, colours, fill | Appearance in the preview, PNG and artwork SVG. Laser files always use hairlines. |
| Include the sheet outline | Adds the sheet edge as the outer cut in Laser SVG and DXF. |

## Keyboard shortcuts

| Keys | Action |
| --- | --- |
| G | Generate a new pattern |
| R | Relax |
| P | Auto-relax on or off |
| V, A, E, H | Move, Add, Erase and Pan tools |
| Space + drag | Pan with any tool |
| Alt-click, Shift-click | Add a cell, erase a cell |
| Scroll, pinch | Zoom |
| +, −, F | Zoom in, out, fit |
| 1, 2, 3 | Sites, edges or holes, Delaunay |
| ⌘Z, ⇧⌘Z | Undo, redo |
| ⌘S, ⌘O | Save, open project |
| Esc | Close a dialog, or go back to Move |
| ? | Shortcuts and quick start |

On Windows and Linux, use Ctrl for ⌘. Space pans, as in most design tools, rather than running the main action.

## How it works

- **Cells.** [d3-delaunay](https://github.com/d3/d3-delaunay) builds the Delaunay triangulation and Voronoi cells, clipped to the pattern area. Ellipses are clipped against a 256-sided polygon, so a cell edge on the rim is within 0.008 % of the radius of the true ellipse.
- **Even placement** uses Bridson's Poisson-disk sampling with a spacing that varies with the gradient. For a set count it tightens the spacing until there are enough points, then drops the extra few at random.
- **Relaxation** is Lloyd's method: each point moves to the centre of its cell. With a gradient the centre is weighted by the density squared, which is what keeps the gradient through hundreds of steps. Auto-relax stops when no point moves more than 1/2,000 of the typical spacing in a step.
- **Holes.** Each cell is convex, so it is shrunk by half the web plus the corner radius, then grown back by the radius with arcs. That gives exact round corners with no self-intersections. Small cells get the largest radius that fits.
- **Determinism.** A seeded random generator (mulberry32) makes every pattern repeatable from its seed and settings.
- **Background work.** Making and relaxing points runs in a Web Worker, so the page stays responsive.

**Limits of the method.** The ellipse is a polygon in cut files except for true circles, which DXF writes as CIRCLE. Very short cell edges can remain between nearly square groups of four points; relaxing lengthens them, and Holes style rounds them away. Gradients don't apply to grid placements.

## Known limits

Measured on an Apple-silicon Mac in Node 26 and Chrome (Code tab preview), for a 600 × 400 mm panel with an 8× linear gradient:

| Task | 1,500 cells | 10,000 cells |
| --- | --- | --- |
| Make points (Even) | 25 ms | 170 ms |
| One relaxation step | 3 ms | 12 ms |
| Rebuild holes and measurements | 14 ms | 85 ms |
| Auto-relax in the app | about 20 steps a second | slower; best for a few steps |

- Up to 10,000 cells can be typed; spacing-driven placements stop at 20,000 points.
- PNG export is limited to 16,384 px a side and 120 megapixels, which browsers can draw. Use SVG for larger work.
- Cut files are not reordered to shorten laser travel.
- The live design is kept in the browser's local storage; clearing site data removes it. Save a project file to keep work.

## Development

```bash
npm run dev         # start the app
npm run lint        # ESLint, zero warnings expected
npm test            # Vitest unit tests
npm run test:watch  # tests on change
npm run build       # typecheck and build to dist/
```

```
src/
  App.tsx              layout, files and keyboard shortcuts
  useDesign.ts         the design state: undo, unsaved changes, worker jobs, auto-relax
  components/          panels, bars, stage (canvas and pointer input), tooltip, tabs, modal, icons
  lib/                 settings, units, presets, project files, history, rendering, SVG, DXF, change rules
  voronoi/             the engine, free of React: geometry, regions, seeding, density, diagram, relaxation, holes
  worker/              the Web Worker and its client
  *.test.ts            tests sit next to the code they test
test-fixtures/         a sample project file the tests open
local/                 QA probes and scratch files, not committed
.github/workflows/     ci.yml (lint, test, build) and pages.yml (publish)
```

## License

MIT. See [LICENSE](LICENSE).
