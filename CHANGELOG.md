# Voronoi Studio Changelog

## 1.2.0 2026-11-08

- **Exports follow the view.** Laser SVG and DXF now hold what the Sites, Edges or Holes, and Delaunay buttons show, as the artwork SVG and PNG already did. Sites are green circles (layer `SITES` in DXF) and Delaunay lines are magenta (layer `DELAUNAY`), ahead of the red cuts, so laser software can score, engrave or skip them. Hiding Holes or Edges leaves the cells out of the cut file. Sites are shown by default, so turn them off for a file with only cuts.
- The File tab lists what a cut file will hold, and Laser SVG and DXF say why they're unavailable when nothing is shown.
- Delaunay lines in an imported shape are clipped to it, so none crosses a notch or one of its holes.

## 1.1.0 2026-11-07

- **Your own sheet shape.** Press **Import SVG shape…** on the Sheet tab, or drop an SVG on the window, and the pattern fills that outline. Outlines inside it become holes, with the border kept round them too. It works with Lines and Holes, gradients, relaxation, hand edits and every export.
- Sizes come from the file. When a file doesn't say how big it is, it's read at 96 units per inch, or 72 for Illustrator files, and the Sheet tab says so. Width and height keep the shape's proportions.
- Cut files put an imported shape's own holes with the inner cuts, ahead of its outside edge.
- Where a cell wraps right round a hole in the shape, a bridge of web keeps the frame round that hole attached.
- Project files are now version 2, to hold the shape. Version 1 files still open; Voronoi Studio 1.0 can't open version 2 files.
- Fixed: a number field could keep showing what you'd typed after the value changed some other way, such as Undo or the linked height, and write it back when you left the field. Tabbing through a field no longer rounds its value.
- Fixed: a message could vanish the moment a new pattern finished.

## 1.0.0 2026-11-07

First release of Voronoi Studio, rebuilt from Gil's Voronoi Lab. Everything the old app did is still here, and:

- **Real sizes.** Sheets are sized in mm, inches, pixels or picas, and switching units converts the numbers instead of resizing the sheet. SVG and DXF files open at the right physical size.
- **Cut files.** Laser SVG (red hairlines, holes first) and AutoCAD R12 DXF, with every edge once, so a laser never cuts a line twice. The old SVG drew 43 % of edges twice.
- **Holes style.** Cut each cell out with a set web width, rounded corners as true arcs, a smallest-hole limit and a solid frame.
- **Placements.** Random, Even (Poisson-disk), Hex and Square grids with jitter, Auto spacing or a spacing you type, and a seed so a pattern can be made again.
- **Density gradients.** Linear or radial, up to 20× smaller cells, kept through relaxation.
- **Ellipse sheets** for coasters and round panels, and presets for laser sheets, A4, A3, US Letter and social images.
- **Relaxation.** Relax runs the set number of Lloyd steps; Auto-relax stops by itself when the points settle.
- **Hand edits are protected.** After you move, add or erase points, pattern settings wait for Apply settings. Undo and Redo cover every change.
- **Projects.** Save and open `.voronoi.json` files with every point. The current design also comes back after a reload.
- **Measurements.** Cell count, average size, evenness, narrowest hole or shortest edge, and total cut length.
- **Help in the app.** Every control describes itself on hover or keyboard focus, unavailable controls say why, a quick start greets first visits, and **?** lists every shortcut.
- **Touch.** One finger edits, two fingers pan and zoom.
- New look in the style of Apple's Liquid Glass, following light and dark mode, Reduce transparency and Increase contrast. Works at desktop, tablet and phone sizes.
- Exports always show the whole sheet, whatever the zoom; the PNG is exactly the sheet's pixel size.
