# Voronoi Studio

Voronoi Studio is a browser app for designing Voronoi patterns to make things with. Pick a sheet size and shape, or import your own outline from an SVG, choose how many cells and how they're placed, shape them with gradients (including one from your own photo or drawing), stretch them into long cells, split them with veins like an insect wing or a leaf, and relax them, and drag, add or erase cells by hand. Then export them at real size: a laser-ready SVG or a DXF for cutting, or an SVG or PNG for artwork. It rebuilds and extends Gil's Voronoi Lab.

**Use it online:** https://gil336699.github.io/voronoi-studio/

![Voronoi Studio in use: random points relax into even cells, a radial gradient makes cells smaller toward the centre, the cells become holes, a cell is dragged by hand, a leaf-shaped SVG outline with a hanging hole is dropped in and filled, and a laser SVG is exported.](docs/demo.gif)

[Watch the demo as a video](https://github.com/gil336699/voronoi-studio/releases/download/v1.1.0/voronoi-studio-demo.mp4) (MP4, 1920 × 1200, 22 seconds).

Everything runs in your browser. Your designs, files and pictures stay on your computer.

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

The sheet fills the window, and the controls float above it on translucent glass, in the style of Apple's Liquid Glass. The look follows the system's light or dark appearance, and its Reduce transparency and Increase contrast settings. In Windows contrast themes, buttons, switches and sliders are drawn in the theme's own colours.

- **Top left.** The app name and the **?** button for shortcuts and the quick start.
- **Left panel.** Four tabs: **Pattern** (cells, placement, gradient, stretch, veins, relaxation), **Sheet** (size, units, shape or imported outline, border), **Style** (Lines or Holes, colours) and **File** (project and exports). A dot on Pattern means hand edits are holding back new settings; a dot on File means unsaved changes.
- **Above the sheet.** Tools (Move, Add, Erase, Pan, and Move picture with a Picture gradient) on the left. Sites, Edges or Holes, Delaunay, Picture (with a Picture gradient), and zoom on the right. A caption explains the current tool.
- **Below the sheet.** The action dock: **Generate**, **Relax**, **Auto-relax**, the status, and Undo and Redo.
- **Right panel.** **Measurements**: sheet size, cells, holes, average cell size, evenness, the narrowest hole or shortest edge, and total cut length.

Narrower windows show tool and action buttons as symbols only. On tablets the sheet sits on top with both panels below it. On phones everything is in one column, and pinching zooms.

## Help in the app

- **Hover any control**, or move to it with Tab, to see a one-sentence description and its keyboard shortcut. Unavailable controls say why, for example why the cell count is locked when you set the spacing yourself.
- **Measurements with a dotted underline** explain themselves on hover.
- **Quick start** shows three steps on the first visit. Reopen it from the **?** button, which also lists every shortcut.

## Workflow

1. **Sheet.** Choose a preset such as a 200 mm tile, A4, a 12 × 12 in laser sheet or a Ø 100 mm coaster, or type a size. Choose Rectangle or Ellipse and a border. Or press **Import SVG shape…**, or drop an SVG on the window, to fill your own outline; outlines inside it become holes.
2. **Pattern.** Set the number of cells and the placement. Add a density gradient for cells that get smaller toward one side, the centre or the edge, or where a picture of yours is dark: choose **Picture**, or drop a photo on the window. Turn up **Stretch** for cells that grow longer in one direction.
3. **Relax.** New patterns get a few relaxation steps. Press **Relax** for more, or **Auto-relax** to keep going until you stop it. While it's on, change the cell count, placement, gradient or sheet and watch the new pattern relax, or drag a point and watch the cells around it follow; the point stays under the pointer until you let go. Once the points settle it waits for your next change. Stop, Undo, Redo, New and Open turn it off.
4. **Edit by hand.** Drag points to move cells, Alt-click (or the Add tool) to add one, Shift-click (or the Erase tool) to remove one. Once points are edited by hand, pattern settings wait for **Apply settings…** so your edits aren't lost by accident.
5. **Style.** **Lines** draws each edge once. **Holes** cuts each cell out, leaving a web of material, with rounded corners and a smallest-hole limit.
6. **Save and export.** **Save** writes an editable `.voronoi.json` project with every point. **Laser SVG** and **DXF** are for cutting; **SVG** and **PNG** are for artwork.

The app asks before New, Open, Generate or Apply settings would replace unsaved work or hand edits, and Undo can bring the previous design back. The current design is also kept in the browser, so it comes back after a reload or a crash. The copy is updated a moment after each change, at least every 2 seconds while Auto-relax runs, and when the tab closes.

## Features

### Placement

| Placement | What it does |
| --- | --- |
| Random | Points land anywhere. Cells vary in size and can clump. |
| Even | Poisson-disk sampling: points keep a minimum distance, so cells are even but organic. |
| Hex | A honeycomb grid. Jitter loosens it. |
| Square | A square grid. Jitter loosens it. |

With **Auto spacing** on, the spacing follows the cell count. Turn it off to set the spacing yourself; the count then follows the spacing.

### Imported shapes

Any closed outline in an SVG can be the sheet: a logo, a lamp shade, a pill-shaped panel with a mounting hole. The pattern fills it, and the border runs round the outside and round every hole.

| What | How it works |
| --- | --- |
| What's read | Paths, rectangles (rounded too), circles, ellipses and polygons, with their transforms. Curves are flattened to within 0.02 mm. Open lines are left out, and the app says how many. |
| Holes | Outlines inside other outlines are holes, the way laser software reads nested cut lines. Overlapping outlines cancel where they overlap. |
| Separate pieces | Every piece gets its share of cells, such as each letter of a logo. Even placement grows outwards from its points, so it starts again in any piece it can't reach. A border shrinks every piece, so thin letters can disappear; use a small or zero border for lettering. If the border leaves nothing, the status and the Sheet tab say so. |
| Pictures | When Illustrator can't write a shape's look as SVG (a freeform gradient, a mesh or an effect), it saves a picture of the shape trimmed by a clipping mask. A file like that, with no closed outlines of its own, gives the mask's outline instead, placed where the mask is used, and the app says so. A picture with no mask can't be used; the app says how to fix it in Illustrator. |
| Size | Taken from the file's width and height. A file that doesn't give them is read at 96 units per inch, the web standard, or 72 if it looks like it came from Illustrator. The Sheet tab says when it had to assume, so check the size there. |
| Resizing | Width and height keep the shape's proportions. Swap is off, since it would stretch the shape. |
| Cut files | The shape's holes are cut with the other inner cuts, ahead of its outside edge. |

Where a cell wraps right round a hole in the shape, the app leaves a bridge of web through it, so the frame round that hole stays joined to the sheet.

### Density gradient

| Gradient | What it does |
| --- | --- |
| None | Cells are about the same size everywhere. |
| Linear | Cells get smaller toward a direction (0° is right, 90° is up). |
| Radial | Cells get smaller toward the centre, or toward the edge. |
| Picture | Cells get smaller where a picture is dark, or where it's light. |

**Strength** is how many times smaller in area the smallest cells are than the largest. Relaxation keeps the gradient.

### Picture gradient

Choose **Picture**, or drop a picture on the window, and the cells follow it: small where it's dark, large where it's white. A faint copy shows behind the cells; the **Picture** button above the sheet, or key 4, hides it. To place it by hand, choose the **Move picture** tool (M): drag the picture to move it, or drag a corner to resize it while the opposite corner stays put. Each drag is one Undo step.

| File type | How it opens |
| --- | --- |
| JPG, PNG, WebP, AVIF, GIF (first frame), BMP, ICO | The browser decodes it. Phone photos are turned upright from their EXIF orientation. |
| HEIC and HEIF (iPhone photos) | Safari decodes it. Elsewhere the app loads a HEIC decoder (libheif, about 0.8 MB compressed) the first time one is opened. |
| TIFF (8 or 16 bit, uncompressed, LZW or Deflate) | Safari decodes it. Elsewhere the app loads UTIF and its inflater (about 40 kB compressed). A TIFF with several pages uses the largest. |
| SVG | Drawn as a picture. Dropping an SVG asks whether it's the sheet shape or the density picture. |
| JPEG XL | Only where the browser reads it, such as Safari. |

Photoshop files and PDFs aren't read; the app says to export a JPG or PNG. Transparent parts, and the paper around a fitted picture, count as white.

| Control | Effect |
| --- | --- |
| Strength | How many times smaller in area the cells in the darkest part are than in white (1–20×). At 20× cells are about 4.5× narrower. |
| Small cells at | Dark parts get the small cells, like ink, or light parts do. |
| Contrast | Spreads the mid-greys apart (up to +100 %) or brings them together (down to −100 %). The darkest and lightest parts are always stretched to black and white first. |
| Softness | Blurs the picture by about this distance first: softens hard edges, and turns a line drawing into cells that shrink near its lines. |
| Picture size | **Fit** starts from the whole picture, centred; **Fill** starts from the picture covering the sheet, cutting off what doesn't fit. |
| Scale | Resizes the picture about its centre, from 10 to 400 % of the Fit or Fill size. Around a smaller picture counts as white paper. |
| Move right, Move down | Moves the picture's centre from the sheet's centre, in the sheet's units (negative moves it left or up). **Reset size and position** goes back to 100 % and centred. |

The picture is kept in the project at up to 512 × 512 pixels in grey, about 260 kB, so a project opens with the same picture and the same pattern anywhere. Pattern settings, including the picture, wait for **Apply settings…** after hand edits, like the other gradients.

What to expect: a cut sheet has to be covered with cells, so white gets the largest cells, not none, and the picture reads as a soft halftone. Logos, lettering, silhouettes and high-contrast photos read best. Gil's test portrait reads well at 3,000 cells as Holes and at 5,000 as Lines, at 16×.

### Stretch

**Stretch** makes cells longer in one direction, like wood grain, bone or a dragonfly wing. Each point measures distance with the same ellipse instead of a circle, so with **Amount** at 3× relaxed cells are about three times as long as they are wide, along **Direction** (0° is right, 90° is up). Edges stay straight, so holes, rounded corners and cut files work as before. It works with every placement (a stretched honeycomb with Hex), every gradient including Picture, and imported shapes.

Long cells leave long, thin webs between them, so a stretched panel is stiffer along the stretch than across it, and thin webs can break; in Holes style, check the narrowest hole in the measurements. With Stretch on, **Minimum spacing** is the spacing before stretching: points end up farther apart along the stretch and closer across it.

### Veins

**Veins** split the sheet into regions, and each region gets its own cells, as an insect wing's main veins divide it (Hoffmann et al., *A simple developmental model recapitulates complex insect wing venation patterns*, PNAS 2018). No cell reaches across a vein.

| Veins | What it does |
| --- | --- |
| Wing | Veins follow a flow from **Start from** (the middle of a side, or the centre) out to the far edges. They run side by side near the start, join only where they'd touch, and never cross, like a dragonfly's or a grasshopper's wing. |
| Leaf | Veins grow from the start toward the edges and branch as they go (space colonization). The branches that feed the most tips are the thickest. |
| Imported | Open lines from an SVG: lines or paths with a stroke and no fill. **Import veins…** places them by the file's page, or by its outline if it has one. Importing a sheet shape whose file also has open lines makes those lines its veins. |

**Vein ends** sets how many veins reach the edge (Wing) or how many branch ends there are (Leaf). **Vein width** is their width at the start, and **Taper** how much narrower their far ends are. In Holes style a vein is solid, with the web added on each side; in Lines style it's drawn solid, and cut files cut round it.

**Walls follow cell size** (Style tab) thins the web between smaller cells, as a wing's veins thin out where its cells are small: at 100 %, cells half as wide get a web half as thick, down to 15 %. In Lines style it varies the line width in the view, PNG and artwork SVG; laser files keep hairlines.

### Exports

| Export | Contents | Units |
| --- | --- | --- |
| Laser SVG | 0.025 mm hairlines with no fill. Cuts in red: holes or cell edges in group `cut-inner` (with an imported shape's own holes), the sheet outline in `cut-outer`. When shown, sites as green circles in `sites` and Delaunay lines in magenta in `delaunay`. Marks first, then inner cuts, then the outline. | mm, or in for inch sheets |
| DXF | AutoCAD R12 text. Holes as closed polylines whose rounded corners are true arcs, lines as LINE, round sheets as CIRCLE, imported outlines as polylines. Layers `CUT_INNER` (red) and `CUT_OUTER` (blue); when shown, sites as CIRCLE on `SITES` (green) and Delaunay lines as LINE on `DELAUNAY` (magenta). | mm, or in for inch sheets |
| SVG | The design as shown: colours, line width, fill, background, sites and Delaunay lines if visible, and the density picture in group `picture` if shown. | mm, in, or px for pixel sheets |
| PNG | The design at the sheet's pixels per inch, with the density picture if shown, optionally with a transparent background. | px |
| Project | Settings, every point, any imported shape and any density picture, as `.voronoi.json` (schema `voronoi-studio/project`, version 5, with any veins; versions 1 to 4 open too). | mm |

Every export holds what the view shows: the **Sites**, **Edges** or **Holes**, and **Delaunay** buttons above the sheet decide what goes in, so turn Sites off for a file with only cuts. The density picture goes in the SVG and PNG when shown, but never in Laser SVG or DXF, where laser software would engrave it. The File tab lists what a cut file will hold. Cut files contain each line once, so a laser never cuts the same edge twice, and leave out cuts shorter than 5 µm, which a laser would only fire as a dot. Exports always show the whole sheet, whatever the zoom.

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
| Shape | Rectangle, the ellipse that fits the width and height, or Imported. |
| Import SVG shape… | Use a closed outline from an SVG as the sheet. Dropping an SVG on the window does the same. |
| Border | Gap between the sheet edge and the pattern. In Holes style, the width of the solid frame. |
| Pixels per inch | Resolution for pixel sizes and PNG. On a pixel sheet, changing it keeps the pixel size. |
| Keep points when the sheet changes | On: points stretch to the new size or shape. Off: a new pattern is made. |
| Cell style | Lines or Holes. |
| Web width, Corner radius, Smallest hole | Holes only: material between holes, corner rounding, and the narrowest hole kept. |
| Line width, colours, fill | Appearance in the preview, PNG and artwork SVG. Laser files always use hairlines. |
| Include the sheet outline | Adds the sheet edge as the outer cut in Laser SVG and DXF. |
| Gradient, Strength, Direction, Small cells at | The density gradient: None, Linear, Radial or Picture, how strong it is and which way it runs. |
| Choose picture…, Replace…, Contrast, Softness, Picture size, Scale, Move right, Move down | The Picture gradient's picture, how it's read, and its size and place on the sheet (see Picture gradient above). |
| Stretch: Amount, Direction | How many times longer than wide cells are (Off, or 1.1–5×), and which way (0° is right, 90° is up). |
| Veins, Vein ends, Start from, Vein width, Taper, Import veins… | Veins that split the sheet into regions (see Veins above). |
| Walls follow cell size | Thinner web or lines between smaller cells (0–100 %). |
| Sites, Edges or Holes, Delaunay, Picture | Show or hide each part of the design, in the view and in every export (the picture stays out of cut files). |

## Keyboard shortcuts

| Keys | Action |
| --- | --- |
| G | Generate a new pattern |
| R | Relax |
| P | Auto-relax on or off |
| V, A, E, H, M | Move, Add, Erase, Pan and Move picture tools |
| Space + drag | Pan with any tool |
| Alt-click, Shift-click | Add a cell, erase a cell |
| Scroll, pinch | Zoom |
| +, −, F | Zoom in, out, fit |
| 1, 2, 3, 4 | Sites, edges or holes, Delaunay, picture |
| ⌘Z, ⇧⌘Z | Undo, redo |
| ⌘S, ⌘O | Save, open project |
| Esc | Close a dialog, or go back to Move |
| ? | Shortcuts and quick start |

On Windows and Linux, use Ctrl for ⌘. Space pans, as in most design tools, rather than running the main action.

## How it works

- **Cells.** [d3-delaunay](https://github.com/d3/d3-delaunay) builds the Delaunay triangulation and Voronoi cells, clipped to the pattern area. Ellipses are clipped against a 256-sided polygon, so a cell edge on the rim is within 0.008 % of the radius of the true ellipse.
- **Even placement** uses Bridson's Poisson-disk sampling with a spacing that varies with the gradient. For a set count it tightens the spacing until there are enough points, then drops the extra few at random.
- **Relaxation** is Lloyd's method: each point moves to the centre of its cell. With a gradient the centre is weighted by the density squared, which is what keeps the gradient through hundreds of steps. Auto-relax counts the points as settled, and waits, when no point moves more than 1/2,000 of the typical spacing in a step.
- **Picture gradient.** The picture is reduced to at most 512 pixels a side and turned grey by brightness (Rec. 709). Its darkest pixel becomes black and its lightest white, then Contrast, Softness (a three-pass box blur close to a Gaussian) and Small cells at give each pixel a tone from 0 to 1, and its density is Strength to the power of the tone. Relaxing weights each cell's centre by the density squared, as for the other gradients, but integrates it exactly over the picture's pixels instead of sampling it: by Green's theorem, each cell's weight and centre come from running sums along the pixel rows, taken around its outline (Secord, *Weighted Voronoi Stippling*, 2002). So sharp edges in the picture stay sharp and the points settle. On a white-to-black ramp at 9×, 2,000 relaxed cells come within 3 % of the expected count in every tenth of the width.
- **Stretch.** One ellipse for every point (a Mahalanobis distance, as in Feng et al., *Cellular topology optimization on differentiable Voronoi diagrams*, 2022) turns the diagram into an ordinary Voronoi diagram in a squeezed copy of the sheet. The app squeezes the points and the pattern area by 1/√s along the direction and stretches them by √s across it, which keeps areas, builds and clips the cells there, then maps them back. New points are placed evenly in the squeezed copy, so they start stretched, and relaxing still moves each point to its cell's centre, which is what lowers the energy for any fixed ellipse. At 3× along 30°, relaxed cells measure 3.03 times as long as wide, along 30.0°. A different ellipse at each point would curve the edges, which cut files can't hold, so the stretch is the same across the sheet.
- **Veins.** Wing veins are streamlines of a harmonic field: 1 in a small disc at the start, relaxed to Laplace's equation (SOR on a 200-cell grid). The edge nearest the start (30 % of the way out) is a wall the flow runs along, and the rest is where it leaves, so veins run beside the edge near their start and fan out to the far edges. Veins are traced from evenly spaced points on the far edges back toward the start; one that comes within a few grid steps of a vein already drawn joins it, a little nearer the start, so it branches at a shallow angle. Leaf veins use space colonization (Runions et al., 2005): growth toward Poisson-disk targets, pruned to the branches that feed the most tips, with tips carried on to the edge or the nearest vein so they close off regions. Veins become strips (Clipper2 offsets, simplified to 10 µm) taken out of the pattern; each piece left is filled, relaxed and clipped on its own.
- **Holes.** Each cell is convex, so it is shrunk by half the web plus the corner radius, then grown back by the radius with arcs. That gives exact round corners with no self-intersections. Small cells get the largest radius that fits.
- **Imported shapes.** [Clipper2](https://github.com/PolyClipping/Clipper2), through [clipper2-ts](https://github.com/countertype/clipper2-ts), merges the outlines (even-odd), shrinks them by the border with round corners, and clips the cells that cross the outline. A grid of the outline's edges makes "is this point inside?" fast enough for Poisson-disk sampling. Cells wholly inside keep the exact method above; clipped cells can be concave, so their holes come from Clipper's offsets, with rounded corners drawn as short segments within 5 µm.
- **Determinism.** A seeded random generator (mulberry32) makes every pattern repeatable from its seed and settings.
- **Background work.** Making and relaxing points runs in a Web Worker, so the page stays responsive.

**Limits of the method.** The ellipse is a polygon in cut files except for true circles, which DXF writes as CIRCLE. Imported outlines, and the rounded corners of holes clipped by them, are short straight segments rather than true arcs. For those clipped holes, the narrowest-hole reading is measured across the hole's convex outline, so it can read slightly wide for a concave hole; the smallest-hole limit itself is exact. Very short cell edges can remain between nearly square groups of four points; relaxing lengthens them, and Holes style rounds them away. Gradients don't apply to grid placements. A picture keeps at most 512 pixels a side, so detail finer than about a 500th of the sheet is lost.

## Known limits

Measured on an Apple-silicon Mac, in the app (Chrome, Code tab preview, 1280 × 800) and in Node 26 for the engine alone:

| Task | 300 cells | 1,500 cells | 10,000 cells |
| --- | --- | --- | --- |
| Make points, Even, in the worker (Node) | 4 ms | 26 ms | 180 ms |
| One relaxation step (Node) | under 1 ms | 3 ms | 12 ms |
| Rebuild holes and measurements (Node) | 2 ms | 11 ms | 55 ms |
| One update while dragging a point (app, Holes) | 9 ms | 23 ms | 234 ms |
| One update while dragging a point (app, Lines with Delaunay) | — | — | 78 ms |
| Auto-relax speed (app, Holes) | 55 steps/s | 32 steps/s | 3.5 steps/s |
| Auto-relax until settled (app) | 716 steps, 14 s (369 random points) | 1,130 steps, about 60 s (8× gradient) | not measured |
| Imported shape, holes: rebuild (Node, 296 × 160 mm pill with a hole) | 6–9 ms | 12–16 ms | 81–95 ms (5,000 cells) |
| Imported shape, holes: one update while dragging (app) | — | 28.5 ms median, 39 ms at the 90th percentile | — |

Picture gradient, measured on the production build in headless Chrome:

| Task | Result |
| --- | --- |
| Open a picture: JPG, PNG, WebP, AVIF, GIF, BMP, TIFF, SVG | 30–130 ms; a 48-megapixel PNG 0.2 s; an 11 MB BMP 0.1 s |
| Open an iPhone HEIC in Chrome (decoder loads the first time) | 12 megapixels 1.5 s, 24 megapixels 3.1 s; the page keeps responding (longest task 174 ms) |
| Auto-relax speed, Lines, 2,500 cells | no gradient 50.9, Radial 48.2, Picture 43.7 steps/s |
| Auto-relax speed, Lines, 10,000 cells | no gradient 37.1, Radial 32.2, Picture 29.5 steps/s |
| Portrait as a Holes panel, 3,000 holes at 16× | settled after 1,238 steps, 29 s; laser SVG 0.92 MB, DXF 2.34 MB |
| Ramp, white to black, 2,000 cells at 9×, relaxed | every tenth of the width within 3 % of the expected count |
| Two minutes of picture changes while Auto-relaxing | 44.0 → 42.9 steps/s, memory flat, the session copy at most 2 s old |

Stretch, measured the same way:

| Task | Result |
| --- | --- |
| Auto-relax speed, Lines, 2,500 cells | no stretch 50.9, 3× at 0° 50.2, 3× at 30° 46.6 steps/s |
| Auto-relax speed, Lines, 10,000 cells | no stretch 37.7, 3× at 0° 34.4, 3× at 30° 24.0 steps/s |
| Line Growth's 2.5 MB outline, 1,000 cells | a new pattern 1.0–3.3 s after a stretch change; 2.2 steps/s, as without a stretch |
| Relaxed cell shape, 3× at 30° | 3.03 times as long as wide, along 30.0° |

Directions off the axes are slower at high counts because the cells along the border are trimmed as if the sheet were an imported outline.

Veins, measured the same way (Node, one relax step / one rebuild of the drawing; and Auto-relax in the app):

| Task | Result |
| --- | --- |
| Make the veins and split the sheet | Wing 50–230 ms, Leaf 15–55 ms, once per vein setting |
| 300 × 150 mm sheet, 12 wing veins, 1,800 cells | relax step 16 ms (5 ms without veins) |
| Same, 8,000 cells | relax step 39 ms (10 ms without veins); Auto-relax 3.8 steps/s in the app |
| Gil's traced wing, 18 imported veins, thickness picture, 1.5× stretch, 1,800 cells | relax step 28 ms, rebuild 29 ms (Lines) or 68 ms (Holes); Auto-relax about 8.6 steps/s in the app |

Most cells touch a vein and are clipped against it, so veins make relaxing several times slower. Up to a couple of thousand cells it stays usable; beyond that, set the relax steps and press Relax.

Patterns up to a few thousand cells stay smooth. With Auto-relax on while you drag the Cells slider, it kept relaxing at 45 steps/s with nearly 3,900 cells (production build, headless Chrome). At 10,000 cells, editing by hand and auto-relaxing are slow; set the relax steps and press Relax instead.

- Up to 10,000 cells can be typed; spacing-driven placements stop at 20,000 points.
- PNG export is limited to 16,384 px a side and 120 megapixels, which browsers can draw. Use SVG for larger work.
- Cut files are not reordered to shorten laser travel.
- The live design is kept in the browser's local storage; clearing site data removes it. Save a project file to keep work. A density picture adds about 260 kB to it.
- Leaf veins come from a fixed set of targets for each setting, so Shuffle changes the cells but not the veins.
- Photoshop files, PDFs and camera raw files can't be used as pictures; export a JPG or PNG. JPEG XL opens only where the browser reads it.

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
  lib/                 settings, units, presets, project files, history, rendering, SVG import and export, DXF, change rules, picture files
  voronoi/             the engine, free of React: geometry, regions, imported shapes, seeding, density, pictures, diagram, relaxation, holes
  worker/              the Web Worker and its client
  *.test.ts            tests sit next to the code they test
test-fixtures/         a sample project and SVG shapes the tests open
local/                 QA probes and scratch files, not committed
.github/workflows/     ci.yml (lint, test, build) and pages.yml (publish)
```

## License

MIT. See [LICENSE](LICENSE).

Voronoi Studio uses [d3-delaunay](https://github.com/d3/d3-delaunay) (ISC) and [clipper2-ts](https://github.com/countertype/clipper2-ts), a port of Angus Johnson's Clipper2 (Boost Software License 1.0). To open TIFF pictures it uses [UTIF.js](https://github.com/photopea/UTIF.js) (MIT) with [pako](https://github.com/nodeca/pako) (MIT and Zlib).

To open HEIC pictures in browsers that can't, it uses [heic-to](https://github.com/hoppergee/heic-to), which contains [libheif](https://github.com/strukturag/libheif) and [libde265](https://github.com/strukturag/libde265). All three are under the GNU Lesser General Public License 3.0. They are unmodified and ship as their own file (`assets/heic-to-*.js`), loaded only when a HEIC picture is opened, so you can replace that file with your own build. Their source is at the links above. Every third-party licence ships with the app as [`third-party-licenses.txt`](public/third-party-licenses.txt) (also on the [live site](https://gil336699.github.io/voronoi-studio/third-party-licenses.txt)). The rest of Voronoi Studio stays under MIT.
