# Voronoi Studio Changelog

## 1.13.2 2026-11-14

- **A click on a point doesn't count as an edit.** A press now becomes a drag only once the pointer has moved 4 px, or 8 px with a finger, so clicking a point, or the small wobble of a hand or mouse while clicking, moves nothing. Before, a click on a point that moved it by nothing at all still marked the design as edited and unsaved and added an Undo step. This was Codex's retest finding R1: right after opening its project, the File tab showed unsaved changes and the status said "edited". Opening itself was always clean; the click was what counted. The Move picture tool works the same way.
- **Choosing what's already chosen changes nothing.** Clicking the option already selected, or setting a value a setting already has, no longer marks the design as unsaved or adds an Undo step.
- A fixed test project, `test-fixtures/zero-holes.voronoi.json` (200 × 200 mm, 300 cells, Holes with a 20 mm web, points saved), always leaves no hole, so Laser SVG and DXF are off with the reason. Codex's retest found that a 20 mm web on its own pattern left one hole. Tests now also check the DXF header's extents: they're the sheet's, even when the lines stop short of it.

## 1.13.1 2026-11-14

- **Leaf veins follow Vein ends all the way to 60.** With **Join into loops** off, Leaf veins now have exactly as many ends as **Vein ends** says, and turning it up adds veins a few at a time. Before, the count moved in jumps. On a tall leaf-shaped sheet (363.8 × 630.1 mm, started from the bottom), 25 to 34 all gave 34 ends, and every setting from 35 up gave over 500, a mesh of tiny twigs that cut the pattern into 688 regions. Now 60 ends cut it into 46.
- **Veins no longer cross.** A vein's last stretch to the edge used to steer straight for the nearest point of the edge, so it could cut across its neighbours: 3 crossings at 20 ends on that leaf, and more at higher counts. Now it ends on the first vein in its way, as veins join in a real leaf. Across five sheets and every count from 2 to 60, open or with loops, no vein crosses another.
- Designs saved with open Leaf veins get the new veins where the old ones had more ends than asked for, or crossed. The rest are unchanged: of 295 open Leaf setups tested (five sheets, 2 to 60 ends), the 87 whose count was already right and had no crossings are identical. With loops, 205 of 295 are identical, including every count up to 22 and the default design.

## 1.13.0 2026-11-14

- **Ready to cut?** A new section on the File tab, above Laser SVG and DXF, checks the design against your machine before you cut: your laser's **Kerf** (0.15 mm to start) and your material's **Smallest web** (1 mm) and **Smallest feature** (0.5 mm). They're saved with the project, shown in the sheet's unit, and kept when you press New. Before, the only check was for Holes with no hole left at all.
- **In Holes style** it counts cells left solid, webs the laser burns away (no wider than the kerf), webs under the smallest web, and holes under the smallest feature. Webs are measured between the hole outlines themselves, so rounded corners, walls that follow cell size, veins and imported outlines all count exactly, and so does the frame along the sheet outline when the outline is cut.
- **In Lines style,** where every cell is cut out as a piece, it counts cuts shorter than the smallest feature, and cells, a border and veins narrower than the smallest web.
- **In both,** it lists hole outlines that cross themselves or are too small to write, if there are any, and notes when sites or Delaunay lines are in the cut files, so you can set their layers to score or off.
- **See where each problem is.** Point at a row and its problems light up in orange on the sheet, each with a ring round it, so even a 0.1 mm web shows at full view. Click the row to keep them shown while you change settings on other tabs, and press Esc to clear it. Each row's tooltip says why it would fail and what to change.
- **It only warns.** Every export stays available, except that Laser SVG and DXF are still off when Holes leaves no hole, as in 1.12.1.
- On 7 real designs (Holes with thick, thin and walls-follow webs, Leaf loops in both styles, an imported pill with a hole, and an imported outline) every count matched measuring each pair of outlines one by one, 27 of 27. Checking takes about 2 ms at 300 cells, 11 ms at 2,000 and 50 ms at 10,000 holes. While Auto-relax runs it's redone at most every 250 ms, or every eight times its own time, so Auto-relax with the File tab open ran 3 % slower at 2,000 cells and 9 % slower at 10,000 (best of three runs).
- Projects stay version 6. Older versions of the app open 1.13 projects as the same design and leave out the three machine values; older projects open with the defaults.
- The app now loads as three files, the app, React and the geometry libraries, instead of one, so the build no longer warns about a 506 kB file. Nothing else changes: the cut and artwork files are the same as 1.12.2's for every design checked.

## 1.12.2 2026-11-14

- **The README shows every variation side by side.** The Features section opens with a table of 31 patterns in six families, each the same round 200 mm panel made in the app with one setting changed. Its vector PDF and full-size PNG are on this release.

## 1.12.1 2026-11-14

- **Exports always end in a file or a message.** Where a browser has the save dialog's API but can't show the dialog, as some embedded and in-app browsers do, Laser SVG, DXF, SVG, PNG and Save now download instead. Before, the dialog's instant refusal looked like a cancel, so those exports made no file and said nothing.
- **A cancelled save says so:** "Cancelled: … wasn't saved." Before, the status kept its old message, so a cancelled PNG looked as if it was still being made.
- **"Saved" stays up during Auto-relax.** A save's or export's message now stays for its few seconds while Auto-relax runs. Before, the next relax step replaced it at once, so it was never seen.
- **No cut files with nothing to cut.** With Holes and no cell big enough for a hole, Laser SVG and DXF are off, and the File tab says why and what to change. Before, they made a file with only the outline in it.
- **A number past a field's limit says what happened.** It's still set to the nearest value allowed, and the field now says so for a few seconds, such as "Width can't be under 0.197 in, so it's 0.197 in." Before, the value changed without a word.
- **Esc leaves a number box,** so the keyboard shortcuts work again without the mouse.
- **Cleaner files for cutting and artwork.** Hole outlines have no pieces shorter than 10 µm (a Leaf loops design had 174 of them in its laser file, 6 of zero length), and every stroke in Laser SVG and SVG has round caps and joins, so ends and corners look the same in every program. Before, the laser file's lines used SVG's defaults, flat ends and pointed corners.
- **Imported drawings keep their exact size and their curves.** An imported outline now keeps its points to 0.1 µm. Before, it was rounded to 0.01 mm: a 39.711 × 10.246 mm drawing came in at 39.71 × 10.24, so at 300 mm wide it was 77.36 mm tall instead of 77.40. Curves are also flattened to within 1/20,000 of the drawing's size when that's finer than 0.02 mm, and keep their leftmost, rightmost, top and bottom points, so a small drawing stays smooth when it's made bigger. A 40 mm lacewing wing enlarged to 300 mm now follows its curves to within 0.015 mm, where 1.12.0 strayed by 0.12 mm, and all 228 of its veins come in (1.12.0 dropped one under 0.08 mm long).
- Saved designs open as before, with the shape they were saved with. Patterns are unchanged: the fixes are in saving, exporting, messages and importing.

## 1.12.0 2026-11-14

- **Imported veins taper along the veins.** With **Taper** on, imported veins now narrow with distance along the veins from **Start from**, as Wing veins do. A branch begins as wide as the vein it leaves, and the finest veins out at the margin are the thinnest, so a traced insect wing looks like one. Before, each line narrowed on its own from its first point: a branch started as wide as the veins at the base, wider than the vein it left, and a line drawn from the margin inward was widest at the margin.
- **Start from works for imported veins.** It sets where they're widest. With Taper at 0 it's unavailable, and says why.
- Designs with imported veins and a taper open with the new widths. Everything else is unchanged: 288 of 288 whole-pipeline setups, 270 of 270 seeding setups and 288 of 288 field setups match 1.11.0, and so do all 12 imported-vein setups at Taper 0.

## 1.11.0 2026-11-14

- **Along the veins reaches the whole sheet.** Cells now run along every vein and turn smoothly from one vein to the next, the way wood grain bends between knots, so they follow the veins right across each region, not just beside them. Only patches where veins meet at a steep angle stay round, since a cell there can't line up with both. Before, each place took the direction of the nearest vein, which jumped where two veins were equally near, so between veins and inside Leaf loops cells stayed round. With eight Leaf loops and 1,200 cells, 60 % of the sheet followed the veins; now 89 %, and 89 % of the relaxed cells are at least twice as long as wide (was 64 %). With Wing or open Leaf veins it's 99–100 % (was 91–98 %).
- Designs saved with **Along the veins** open with the new field and keep their points. Every other pattern is unchanged: 264 of 264 whole-pipeline setups that don't follow veins, 288 of 288 without a field and 270 of 270 seeding setups match 1.10.1.
- The repository no longer holds the stray `node_modules` link that 1.10.1 added by mistake.

## 1.10.1 2026-11-14

- **Centre X and Centre Y share their row evenly.** When Stretch follows **Around a centre** or **Saddle**, the two centre sliders now take half the row each, with each label on one line. Before, Centre X was squeezed into a narrow column and its label wrapped onto two lines.
- **The Follows label stays dark while the list can be used.** It used to turn grey whenever one of its choices was unavailable, such as **Along the veins** before there are veins, so the whole list looked switched off.

## 1.10.0 2026-11-14

- **Smoother, more leaf-like Leaf veins.** Leaf veins are rebuilt on the set-up of Jason Webb's space colonization experiments: a dense tree grown in short steps. Veins are now smooth curves that fan out from the start and branch, thickest at the start and tapering along their whole length. Each main vein runs on along its own branch to the edge. Before, tips were carried on in straight lines that crossed regions, and veins were made of long straight steps, which looked sketchy.
- **Loops like a leaf's finer veins.** With **Join into loops**, the main veins stay, and thinner veins grow between them and join where they meet. From the centre they make rings of loops round radiating ribs. Before, every vein was part of one even network of polygons.
- Changing **Vein ends** keeps the same tree and adds or removes its branches, instead of growing a new one.
- Leaf patterns saved by earlier versions open with the new veins, keeping their points. Patterns without Leaf veins are unchanged: 192 of 192 other whole-pipeline setups and 270 of 270 seeding setups match 1.9.0.

## 1.9.0 2026-11-13

- **Stretch that follows a field.** Stretch has a new **Follows** list. Cells can still all stretch one way, or now follow:
  - rays or rings round a centre, or a spiral in between;
  - a saddle;
  - waves;
  - a grid of swirls;
  - smooth noise, or swirling noise like smoke or marbling;
  - the veins;
  - the density picture's contours.

  Each field has its own controls: Centre X and Y, Turn, Waves and Swing, Swirls, Detail, and New flow for another noise field. Before, the stretch had one direction for the whole sheet.
- Cells tile the sheet exactly and never cross themselves, so holes, rounded corners and cut files work as before. Their walls are straight, bending slightly only where the field turns sharply. In testing, 1,200 relaxed cells at 3× lined up within 1.1–1.8° of the field.
- Where the field turns faster than cells that size can follow, such as a vortex's eye, a swirl's centre or busy noise with few cells, the cells stay round instead of bunching up. The hint says how much of the sheet follows the field, and suggests lowering the detail or adding cells when that's under 60 %.
- Auto-relax keeps field patterns even and settles: 1,200 cells in rings settled after 98 steps (3.0 s), as even in size as at the start.
- Erasing with a field picks the cell under the pointer, measured with the field's ellipse there.
- **Leaf veins join into loops.** Leaf veins now grow out from the start as the leaf's edge grows, and join where they meet (closed venation, Runions et al. 2005). They close off regions inside the leaf, as a leaf's finer veins do, and no vein stops in the middle of a region. **Loops** sets about how many regions there are: asking for 16, 30 and 60 gave 18, 28 and 55. Turn off **Join into loops** for the branching veins of 1.8.0.
- Projects are now version 6. Older projects open as before, with one direction and Leaf veins without loops. Patterns without a field or loops are unchanged: 270 of 270 seeding setups and 288 of 288 whole-pipeline setups give the same result as 1.8.0.

## 1.8.0 2026-11-13

- **Veins.** A new Veins section on the Pattern tab splits the sheet into regions, each filled with its own cells, like an insect wing's main veins (Hoffmann et al. 2018). No cell reaches across a vein. **Wing** veins fan out from the middle of a side, or from the centre, to the far edges, running side by side near the start and branching at shallow angles. They never cross. **Leaf** veins grow and branch toward the edges, thickest where they feed the most branches. **Imported** uses open lines from an SVG.
- Set how many veins reach the edge, where they start, how wide they are and how much they taper. In Holes style veins are solid web; in Lines style they're drawn solid and cut round.
- **Import veins…** reads the open lines in an SVG. Importing a sheet shape whose file also has open lines now makes them its veins. Before, those lines were left out with a warning.
- **Walls follow cell size** (Style tab): thinner web, or thinner lines in the artwork, between smaller cells, as a wing's veins thin out where its cells are small.
- Projects are now version 5. Older projects open as before, without veins. Patterns without veins are unchanged.

## 1.7.0 2026-11-13

- **Move picture tool.** With a Picture gradient on, a new tool (M) in the Tools bar shows the picture's outline with a handle at each corner. Drag the picture to move it, or drag a corner to resize it while the opposite corner stays put. Outside the picture, dragging pans as usual. Each drag is one Undo step, works by touch too, and Auto-relax keeps running through it. Before, the picture could only be placed with the Scale, Move right and Move down fields.
- The Stretch section's sliders now read **Amount** and **Direction**, under the Stretch heading. Screen readers still hear "Stretch amount" and "Stretch direction", so they don't clash with the Linear gradient's Direction.
- With a Picture gradient on, windows from about 1,300 to 1,500 px wide show the tool buttons as symbols, so the tool and view bars stay on one row and the sheet keeps its size.

## 1.6.0 2026-11-13

- **Stretch.** A new Stretch section on the Pattern tab makes cells longer in one direction, like wood grain or a dragonfly wing. Set how many times longer than wide (up to 5×) and the stretch direction. Each point measures distance with the same ellipse instead of a circle, so edges stay straight, and holes, rounded corners and cut files work as before. In testing, 3× along 30° gave relaxed cells 3.03 times as long as wide, along 30.0°.
- Stretch works with every placement (Hex makes a stretched honeycomb), every gradient including Picture, Auto-relax and imported shapes. Erasing picks the cell under the pointer, measured with the same ellipse.
- **Picture size and position.** The Picture gradient's picture can now be scaled from 10 to 400 % of its Fit or Fill size and moved anywhere on the sheet with **Move right** and **Move down**, in the sheet's units. **Reset size and position** puts it back. Before, it could only fit or fill the sheet, centred.
- Fixed: ⌘Z, ⌘S and the other shortcuts did nothing straight after moving a slider or a switch, until you clicked somewhere else. Sliders and switches no longer count as typing.
- Fixed: after scrolling a panel, the control under the pointer showed no tooltip until you moved to another control. Now its tooltip appears once scrolling stops.
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
