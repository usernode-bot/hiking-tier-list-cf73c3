# App icon

The Hiking Tier List mark: a black hiking boot stepping onto three rounded
tier bars shaped like a hill (low, tallest, middle). One bold, flat mark on
a tile, following the Homeroom brand framework
(https://baked.design/brand/homeroom/) — cream and black only, no text, no
gradients, readable at 32 pt.

Colours: Cream `#FFFEEA` (tile), Black `#000000` (mark). The featured
pictures also use Yellow `#FFEE6F` (sun) and Green `#A9CF97` (ground strip).

## Files

- `icon.svg` — source, 512×512 viewBox, full-bleed cream square (the tile
  rounds the corners).
- `icon.png` — rendered 1024×1024, declared as `icon.image` in `dapp.json`.
  The boot emoji in `dapp.json` stays the fallback if the image ever fails
  validation.
- `featured-light.svg` / `featured-light.png` — 1600×900, black mark on
  cream, with sun and ground strip.
- `featured-dark.svg` / `featured-dark.png` — 1600×900, cream mark on black,
  same sun and strip. Same mark, same layout.

The featured PNGs are not declared in `dapp.json`: the platform manifest has
no featured-picture field yet, so they are kept here ready to attach to the
Homeroom directory.

## Re-render

```sh
npx --yes @resvg/resvg-js-cli --no-system-font --fit-zoom 2 brand/icon.svg brand/icon.png
npx --yes @resvg/resvg-js-cli --no-system-font --fit-zoom 1 brand/featured-light.svg brand/featured-light.png
npx --yes @resvg/resvg-js-cli --no-system-font --fit-zoom 1 brand/featured-dark.svg brand/featured-dark.png
```

## Palette check

Every `#hex` in these SVGs must be a Homeroom brand colour: FFFEEA, FFEE6F,
3090E1, A9CF97, FFFFFF, FCFAB3, 000000, B9B9B9. `test/brand.test.js`
asserts this, along with the PNG sizes and the manifest entry.