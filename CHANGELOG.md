# Voronoi Studio Changelog

## 1.6.0 2026-11-13

- **Stretch.** A new Stretch section on the Pattern tab makes cells longer in one direction, like wood grain or a dragonfly wing. Set how many times longer than wide (up to 5×) and the direction. Each point measures distance with the same ellipse instead of a circle, so edges stay straight, and holes, rounded corners and cut files work as before. In testing, 3× along 30° gave relaxed cells 3.03 times as long as wide, along 30.0°.
- Stretch works with every placement (Hex makes a stretched honeycomb), every gradient including Picture, Auto-relax and imported shapes. Erasing picks the cell under the pointer, measured with the same ellipse.
- Fixed: ⌘Z, ⌘S and the other shortcuts did nothing straight after moving a slider or a switch, until you clicked somewhere else. Sliders and switches no longer count as typing.
- Projects are now version 4; older projects open as before, without a stretch. Patterns without a stretch are unchanged: 270 of 270 test configurations give the same points as 1.5.0.

## 1.5.0 2026-11-13

- **Picture gradient.** Choose **Picture** under Density gradient, or drop a picture on the window, and the cells follow it: small where it's dark, large where it's white, or the other way round. JPG, PNG, HEIC and HEIF from iPhones, TIFF (8 or 16 bit, LZW or Deflate), WebP, AVIF, GIF, BMP, ICO and SVG all open. Chrome, Edge and Firefox can't read HEIC or TIFF, so the app loads a decoder the first time you open one: a 12-megapixel iPhone photo takes about 1.5 s. Phone photos are turned upright. Photoshop files and PDFs get a message saying to export a JPG or PNG.
- **Contrast**, **Softness** and **Fit** or **Fill** tune how the picture is read. Softness also turns a line drawing into cells that shrink near its lines.
- **Exact centres.** Relaxing weighs each cell exactly over the picture's pixels, as in Secord's weighted Voronoi stippling, so sharp edges stay sharp and the points settle. On a white-to-black ramp at 9×, 2,000 relaxed cells were within 3 % of the expected count across the whole width.
- **Picture guide.** A faint copy of the picture shows behind the cells. The new **Picture** button above the sheet, or key 4, hides it. It goes into the PNG and the artwork SVG, never into Laser SVG or DXF.
- **Saved with the design.** Projects keep the picture, in grey at up to 512 pixels a side (about 260 kB), so they reopen with the same pattern. They're now version 3; older projects open as before.
- Dropping an SVG now asks whether it's the sheet shape or the density picture. Before, it always became the sheet shape.
- Other patterns are unchanged: 270 of 270 test configurations give the same points as 1.4.1.

## 1.4.1 2026-11-10

- Fixed: while Auto-relax ran, the copy of the design kept in the browser wasn't updated, so a reload or a crash brought back the design from before Auto-relax started. In testing, a reload lost a new cell count and an added cell. The copy is now updated at least every 2 seconds while the points move, and when the tab closes or is hidden.
- Fixed: screen readers were sent every Auto-relax step, about 50 updates a second at 1,500 cells. They now hear "Relaxing…" once and then "Settled after N steps". The step count still shows on screen.
- Fixed: Even placement could hang and fail with "Maximum call stack size exceeded" on an imported shape whose parts, after the border, were thinner than about a millimetre. An example is Line Growth's output with a 1 mm border, or lettering strokes 2.1 mm wide with a 1 mm border. The spacing estimate missed such thin strips and came out as zero. These shapes now get the full count. Every other pattern is unchanged: 270 of 270 test configurations give the same points.
- When the border leaves no room at all, the status says "No cells fit inside the border." and the Sheet tab explains why. Before, the sheet just showed 0 cells. This happens, for example, with Line Growth's output and the default 5 mm border. Lowering the border then makes a pattern, even with Keep points on. Before, it stayed at 0 cells until you pressed Generate.
- Windows contrast themes: pressed buttons, the chosen tab and option, switches and slider tracks used to vanish. They're now drawn in the theme's colours.

## 1.4.0 2026-11-10

- **Auto-relax keeps running while you edit points by hand.** Drag a point and the cells around it relax as it moves. The point stays under the pointer until you let go, then it relaxes too. Adding or erasing cells keeps it running as well, and a settled pattern starts relaxing again when you edit it. Only Stop, Undo, Redo, New and Open turn it off now.
- The status under the sheet is shorter so it fits at 1280 px wide: "1,500 cells · seed 634238 · edited", or "1,500 cells · Auto-relax on" while Auto-relax runs. With a six-digit seed and hand edits it used to be cut off.

## 1.3.0 2026-11-10

- **Auto-relax stays on until you stop it.** Change the cell count, placement, gradient, seed or sheet while it runs, or press Generate, and the new pattern keeps relaxing, so you can watch each change settle. Once the points settle it waits, still on, for your next change, and the status ends "· Auto-relax on". Stop, Undo, Redo, New, Open or editing points by hand turns it off.
- **Every piece of an imported shape fills.** Even placement grows outwards from one point, so it couldn't reach separate pieces: Gil's JHU ICE logo got cells in 1 of its 46 pieces. Now each piece gets its share, including strokes thinner than the spacing. Patterns made with few tries per point or with a gradient sometimes left gaps more than twice the spacing wide; those now fill too, so the same seed can give a slightly different pattern than in 1.2. Saved projects keep their points and open unchanged.
- Fixed: with Tries per point at 1, Even placement made a few dozen cells instead of the count.
- Fixed: a setting changed while a Relax press was still running was lost. The panel showed the new value while the sheet kept the old pattern.
- Fixed: changing the sheet while a new pattern was being made could keep the old pattern, or leave points outside the new border. The same could happen to a Relax press.
- Fixed: Undo, Redo, New or Open straight after a setting change could bring back the pattern for the setting you had just undone or left.
- Fixed: after Undo or a hand edit stopped Auto-relax, the status kept saying "Relaxing · step …" for a few seconds. Warnings, such as the 20,000-point limit or an imported picture, now stay while Auto-relax runs.
- Fixed: cut files could hold cuts a few microns long or shorter, where points lie almost on one circle or a cell is clipped right at an imported outline. A laser could fire a dot there. Cut files now leave out anything under 5 µm.
- Dark mode: panels are denser and secondary text is brighter, so text keeps 4.5:1 contrast when you zoom in and the white sheet slides under a panel.
- On touch screens, the dock and tool buttons, Shuffle, Swap and the switch rows are at least 36 px.

## 1.2.1 2026-11-08

- **Pictures trimmed by a clipping mask import.** When Illustrator can't write a shape's look as SVG, it saves a picture of the shape clipped to its outline, so the file has no paths, and Voronoi Studio said "This SVG has no closed outlines to use as a shape." Files with no closed outlines of their own now use the clipping mask's outline as the sheet, placed where the mask is used, whether a style, a class in the style sheet or an attribute applies it. The status says the file is a picture.
- A file that is only a picture now says so and how to fix it in Illustrator.

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
