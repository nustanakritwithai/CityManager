# Original ground presentation

The ground remains flat and fully buildable. `src/terrain.ts` creates original textures at startup with a fixed integer hash, smooth value noise and fine grain. It does not read or advance simulation RNG, load a heightmap, add blocked cells or change road access, picking coordinates, economic rules or saves.

| Texture | Resolution | Use |
|---|---|---|
| Grass | 512×512 | One full-map UV surface; broad low-contrast grass/soil variation, no per-cell tiling |
| Lawn | 128×128 | Shared residential plot material |
| Soil | 128×128 | Shared industrial plot material |

Three RGBA8 textures use about **1.5 MiB including mipmaps**. They are generated in memory; no texture files, new downloads or additional dependencies are required. Materials use the existing PlayCanvas standard shader, with no displacement, normal maps, animated noise or expensive custom shader. A plain-color fallback remains if Canvas 2D is unavailable.

Road and occupied-plot transitions are combined into one reusable vertex-color mesh. Its narrow soil-colored bands fade into surrounding grass. Geometry updates only when roads or building occupancy changes. Plot pads retain a thin R/C/I color cue, so the quieter ground does not hide land use.

The construction grid is a separate thin mesh, hidden in Select/Pan and visible for Road, R, C, I and Bulldoze. Hover, selected-parcel outlines and road previews remain distinct. All picking still intersects the original y=0 plane. Portrait framing moves modestly closer to the starter town; the gateway and selected homes must remain unobstructed in mobile acceptance checks.

These procedural surfaces are original CityManager code. The separately licensed Kenney building and GUI packages retain their own manifests and original license texts. This presentation is not a terrain simulation, performance benchmark or real-device mobile QA claim.
