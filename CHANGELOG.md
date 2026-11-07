# Voronoi Studio Changelog

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
