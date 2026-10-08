# Hiking Tier List — notes for Claude Code

This app runs on **Homeroom**. If you're Claude Code
editing this repo, read the platform conventions before making
changes:

**Platform conventions (authoritative, always current):**
https://app.onhomeroom.com/claude.md

Fetch that URL at the start of each session — it's the single source
of truth for platform-wide behavior (auth model, `USERNODE_ENV`,
public/private tables, "don't `git push`", etc.). The hosted copy is
updated in place when platform rules change, so fetching it gives you
today's rules, not a stale snapshot.

When running inside Homeroom's dev-chat, those same conventions are
already injected into your system prompt, so the fetch is a no-op in
that path — but it's the right reflex when someone runs Claude Code
against this repo locally or from another harness.

## Connector permission prompts

This repo ships `.claude/settings.json`, which allows the **read-only**
Homeroom connector calls (`mcp__homeroom__get_*`,
`…__list_*`, `…__whoami`) so they stop prompting one at a time. Everything
that acts — filing a request, opening or advancing a proposal — still asks.
Claude Code applies those rules only after you accept the
workspace trust dialog, which lists them for review. See `.claude/README.md`
for the whole story, including what to do if you are still being prompted
(usually: your connector is registered under a different name than the rules
assume).

## Check that this checkout is current

You may be working in a fork of this app whose `main` is behind the app's
canonical repository, and nothing in the checkout says so: `git fetch origin`
compares the fork with itself. This matters before you **read** code to answer
a question about how the app behaves now, not only before you edit it.

The canonical repository is named in `.claude/homeroom-canonical-repo`. Check against
it, not against `origin`:

```sh
git fetch "$(cat .claude/homeroom-canonical-repo)" main
git merge-base --is-ancestor FETCH_HEAD HEAD && echo current || echo behind
```

`behind` means this checkout does not contain the canonical `main`. To answer
a question, read the canonical code instead (`git show FETCH_HEAD:<path>`,
`git grep <pattern> FETCH_HEAD`). To change code, start from the exact base
commit your Homeroom work order gives, and never merge or rebase onto the
canonical `main` yourself: which commit a change is diffed against decides
what the group votes on. With the Homeroom connector, `get_checkout_status`
answers the same question.

A session-start hook (`.claude/hooks/homeroom-freshness.sh`, see `.claude/README.md`) runs
this check for you and tells you when you are behind. It is silent offline, so
its silence is not proof the checkout is current. Inside Homeroom's dev-chat
the platform fixes the base commit, and none of this applies.

If a rule below this line conflicts with the hosted conventions, the
hosted conventions win. This file is **app-specific** — write down
things about *this* app that belong in the repo: product intent,
data-model quirks, style preferences, opt-in policies (e.g. which
tables you've marked private), etc.

---

## About Hiking Tier List

A shared tier list for a group's hikes. Anyone adds a hike (name plus an
optional note); each person sorts hikes into S/A/B/C/D; the Everyone view
places each hike in the tier most people picked, ties going to the higher
tier. The first version was built from issue #1 (views, add/sort sheets,
drag or tap placement, group vote bars, staging demo).

## Design

This app's look. Every change follows it, and updates it when a request
changes the look on purpose.

- **Palette:** accent forest green (`accent` 31/94/60 light, 120/196/150
  dark); neutrals are warm greens ("ground", "surface", "raised", muted
  sage text). Tier colours follow trail-blaze conventions: `tier-s`
  blaze red, `tier-a` orange, `tier-b` yellow, `tier-c` leaf green,
  `tier-d` lake blue, shared across both looks.
- **Signature element:** tier-band labels and the vote/tier markers are
  small rounded "trail blaze" rectangles (`blaze`, `blaze-mini` in
  `styles/tailwind-input.css`) carrying the tier letter in the rounded
  font — a tier list drawn as trail markers.
- **Type scale:** `text-title`, `text-heading`, `text-body`, `text-small`
  as shipped in `tailwind.config.js`; `font-round` (ui-rounded) is used
  for the title and tier letters only.
- The app follows the viewer's Homeroom theme (light and dark); there is
  no theme picker.

The kit is in `styles/tailwind-input.css`: colour tokens with a light and
a dark value (named in `tailwind.config.js`), and a few components
(`btn-primary`, `btn-secondary`, `field`, `list` and `list-row`,
`card`, `section-label`, `skeleton`, `state-empty`, `state-error`).
Re-theme by changing the token values there, keeping every text pair at
4.5:1 or more in both looks.

- Colour comes only from the tokens (`bg-ground`, `bg-surface`,
  `text-fg`, `text-muted`, `border-line`, `bg-accent` with
  `text-on-accent`, ...): never a raw hex value or a stock palette class.
- Tap targets are at least 44 px; the buttons and fields already are.
- A field's label says what it is; its placeholder, if any, is an example
  that says so ("e.g. 5.0"), never a bare value that could pass for one
  already entered.
- Every screen that loads data has honest loading, empty and error states.
  Never show the empty state while loading or after a failure; an error says
  what failed, what still works, and offers Retry.
- Seed obviously fake staging demo data so the populated screen can be seen
  ("Staging mock data" in the platform conventions).
- No cards in cards, no uppercase eyebrows, no emoji as icons.

## App-specific conventions

- One tier vote per person per hike (`tier_votes` keyed on
  `(hike_id, user_id)`); changing a tier updates the row, clearing it
  deletes it.
- The group placement rule lives in `lib/tiers.js` (`groupTier`): most
  votes wins, ties go to the higher tier, no votes means unsorted. The
  same logic is mirrored in `public/app.js` for optimistic updates —
  keep the two in sync when changing it.
- Hike names are unique per data space (a case-insensitive unique index
  on `(demo, lower(name))`), max 80 chars; notes max 200. Duplicates
  return HTTP 409 `{error:'duplicate', name}`.
- Staging demo rows carry `demo = true` and live in the same tables as
  real rows; every query filters on the demo flag, and a viewer's
  one-time demo picks are tracked in `demo_viewers`.
