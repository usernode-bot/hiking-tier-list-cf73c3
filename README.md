# Hiking Tier List

A shared tier list for a group's hikes. Anyone adds a hike (name plus an
optional note), each person sorts the hikes into S / A / B / C / D tiers,
and the **Everyone** view shows where the group landed: each hike sits in
the tier most people picked, with a tie going to the higher tier.

## How it works

- **Everyone** (default) — five tier bands. Each hike is placed by the
  group: the tier with the most votes wins, ties go higher. Rows show
  who added the hike, its note, per-tier vote bars, and your own pick.
  Hikes nobody has sorted yet sit under "Nobody has sorted these yet".
- **Your tiers** — the same five bands plus a "To sort" box. Drag a hike
  into a tier (press and hold on a phone) or tap it to pick a tier in a
  sheet. You can change or clear your tier any time; one tier per person
  per hike.
- **Add a hike** — a name (up to 80 characters, duplicates rejected) and
  an optional note (up to 200 characters). You can give it your tier
  right in the same sheet.
- Votes save optimistically; the list refreshes every 30 seconds and
  whenever the tab becomes visible. People who are not signed in can
  look, but sorting and adding ask them to sign up first.

## Design

Forest-green accents; tier colours follow trail-blaze conventions
(S red, A orange, B yellow/green, C green, D blue) on warm neutrals,
in both a light and a dark look that follow the viewer's Homeroom theme.
Tier letters and the title use a rounded font.

## Staging demo

On staging, `?demo=1` seeds 14 made-up hikes and 6 fake hikers with a
fixed spread of votes so the populated screens can be seen, and gives
the viewer their own picks for 10 of the hikes (once per viewer). Demo
rows are separate from real data and labelled "Staging demo".