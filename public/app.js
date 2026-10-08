/* Hiking Tier List — the app's single page.
 *
 * Two views, switched at the top: Everyone (the group's result, shown first)
 * and Your tiers (your own sort, dragged or tapped into S–D). One state
 * payload (/api/state) feeds both; votes are optimistic, with the server's
 * answer replacing the local guess. Refreshes every 30s while visible and on
 * return to the tab, so other people's hikes and votes show up without a
 * reload.
 */
(function () {
  'use strict';

  var TIERS = ['S', 'A', 'B', 'C', 'D'];
  // Whole literals, so the Tailwind build sees every class name.
  var BLAZE = {
    S: 'blaze-tier-s', A: 'blaze-tier-a', B: 'blaze-tier-b',
    C: 'blaze-tier-c', D: 'blaze-tier-d',
  };
  var BAND = {
    S: 'tier-s', A: 'tier-a', B: 'tier-b', C: 'tier-c', D: 'tier-d',
  };
  var BAR = {
    S: 'bar-s', A: 'bar-a', B: 'bar-b', C: 'bar-c', D: 'bar-d',
  };

  var TOKEN = new URLSearchParams(location.search).get('token');
  var DEMO = new URLSearchParams(location.search).get('demo') === '1';

  var state = null; // { me, hikes, voters, demo }
  var view = 'everyone'; // 'everyone' | 'yours'
  var loadFailed = false;
  var sheetOpen = false; // hold polls while a sheet is up
  var dragging = false; // hold polls while a drag is active
  var pollTimer = null;
  var grid = null; // attachGridPlacement handle

  var main = document.getElementById('app');

  // ── API ────────────────────────────────────────────────────────────────
  function api(path, options) {
    options = options || {};
    var headers = { 'Content-Type': 'application/json' };
    if (TOKEN) headers['x-usernode-token'] = TOKEN;
    if (window.usernode && window.usernode.now) {
      headers['x-usernode-now'] = window.usernode.now().toISOString();
    }
    var url = path + (DEMO ? (path.indexOf('?') < 0 ? '?' : '&') + 'demo=1' : '');
    return fetch(url, Object.assign({ headers: headers }, options)).then(function (res) {
      return res.json().then(function (body) {
        return { status: res.status, ok: res.ok, body: body };
      }, function () {
        return { status: res.status, ok: res.ok, body: null };
      });
    });
  }

  // ── Helpers ────────────────────────────────────────────────────────────
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function el(html) {
    var t = document.createElement('template');
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  }

  function groupTier(hike) {
    var best = null;
    var bestCount = 0;
    for (var i = 0; i < TIERS.length; i++) {
      var n = hike.counts[TIERS[i]] || 0;
      if (n > bestCount) { best = TIERS[i]; bestCount = n; }
    }
    return best;
  }

  var TIER_POS = { S: 0, A: 1, B: 2, C: 3, D: 4 };
  function compareHikes(a, b) {
    var ta = a.groupTier, tb = b.groupTier;
    var pa = ta == null ? 5 : TIER_POS[ta];
    var pb = tb == null ? 5 : TIER_POS[tb];
    if (pa !== pb) return pa - pb;
    var wa = ta ? a.counts[ta] : 0;
    var wb = tb ? b.counts[tb] : 0;
    if (wa !== wb) return wb - wa;
    if (a.total !== b.total) return b.total - a.total;
    return a.name.localeCompare(b.name);
  }

  function toSortCount() {
    var n = 0;
    for (var i = 0; i < state.hikes.length; i++) {
      if (state.hikes[i].mine == null) n++;
    }
    return n;
  }

  // The five-bar chart's HTML: heights relative to the hike's biggest bar,
  // a thin grey stub for zero.
  function barsHtml(hike) {
    var max = 0;
    for (var i = 0; i < TIERS.length; i++) max = Math.max(max, hike.counts[TIERS[i]] || 0);
    var out = '';
    for (var t = 0; t < TIERS.length; t++) {
      var tier = TIERS[t];
      var v = hike.counts[tier] || 0;
      var h;
      if (v === 0 || max === 0) {
        out += '<i class="bar-zero" style="height:2px"></i>';
      } else {
        h = Math.max(4, Math.round(20 * v / max));
        out += '<i class="' + BAR[tier] + '" style="height:' + h + 'px"></i>';
      }
    }
    var label = TIERS.map(function (tier) {
      return tier + ' ' + (hike.counts[tier] || 0);
    }).join(', ');
    return '<span class="vote-bars" role="img" aria-label="' + esc(label) + '">' + out + '</span>';
  }

  var MOUNTAIN = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" aria-hidden="true"><path d="M2 20 9 8l4 6 3-4 6 10Z"/><path d="M9 8V3l4 1.5L9 6"/></svg>';
  var PLUS = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';

  // ── Render ─────────────────────────────────────────────────────────────
  function render() {
    if (loadFailed || !state) { renderStates(); return; }
    var parts = [];
    if (state.demo) {
      parts.push('<p class="mb-1 rounded-lg bg-raised px-3 py-2 text-small text-muted">Staging demo: made-up hikes and hikers</p>');
    }
    parts.push(
      '<header class="flex items-center justify-between gap-2 py-3">' +
        '<span class="flex items-center gap-2 text-accent">' + MOUNTAIN +
          '<h1 class="font-round text-title font-bold text-fg">Hiking Tier List</h1></span>' +
        '<button id="add-hike" class="btn-primary">' + PLUS + 'Add a hike</button>' +
      '</header>' +
      '<div class="seg" role="tablist" aria-label="Which tier list to show">' +
        '<button id="tab-everyone" role="tab" aria-selected="' + (view === 'everyone') + '">Everyone</button>' +
        (state.me
          ? '<button id="tab-yours" role="tab" aria-selected="' + (view === 'yours') + '">Your tiers' +
              (toSortCount() ? '<span class="ml-1 inline-flex min-w-6 items-center justify-center rounded-full bg-accent px-1.5 text-small text-on-accent">' + toSortCount() + '</span>' : '') +
            '</button>'
          : '') +
      '</div>'
    );
    if (view === 'everyone') parts.push(renderEveryone());
    else parts.push(renderYours());
    main.innerHTML = parts.join('');
    wireHeader();
    if (view === 'yours') attachDrag();
  }

  function renderStates() {
    if (loadFailed) {
      main.innerHTML =
        '<header class="flex items-center justify-between gap-2 py-3">' +
          '<span class="flex items-center gap-2 text-accent">' + MOUNTAIN +
            '<h1 class="font-round text-title font-bold text-fg">Hiking Tier List</h1></span>' +
        '</header>' +
        '<div class="state-error">' +
          '<p class="text-body font-medium text-fg">Couldn\'t load the tier list.</p>' +
          '<p class="text-small text-muted">Your tiers are saved. Check your connection and try again.</p>' +
          '<button id="retry" class="btn-secondary mt-2">Retry</button>' +
        '</div>';
      var retry = document.getElementById('retry');
      if (retry) retry.addEventListener('click', load);
      return;
    }
    // Loading: grey placeholder bands where the tiers will be.
    var bands = '';
    for (var i = 0; i < 5; i++) {
      bands +=
        '<div class="tier-band"><div class="band-label"><span class="skeleton h-10 w-7 rounded"></span></div>' +
        '<div class="flex-1 p-3"><span class="skeleton block h-11 w-40"></span></div></div>';
    }
    main.innerHTML =
      '<header class="flex items-center justify-between gap-2 py-3">' +
        '<span class="flex items-center gap-2 text-accent">' + MOUNTAIN +
          '<h1 class="font-round text-title font-bold text-fg">Hiking Tier List</h1></span>' +
      '</header>' + bands;
  }

  function renderEmpty() {
    main.innerHTML =
      '<header class="flex items-center justify-between gap-2 py-3">' +
        '<span class="flex items-center gap-2 text-accent">' + MOUNTAIN +
          '<h1 class="font-round text-title font-bold text-fg">Hiking Tier List</h1></span>' +
      '</header>' +
      '<div class="state-empty">' +
        '<p class="text-heading text-fg">No hikes yet</p>' +
        '<p class="text-small text-muted">Add the first hike and everyone can start sorting.</p>' +
        '<button id="add-hike" class="btn-primary mt-2">' + PLUS + 'Add a hike</button>' +
      '</div>';
    wireHeader();
  }

  // Everyone: each hike in the tier most people picked, full rows with the
  // vote chart.
  function renderEveryone() {
    var sorted = state.hikes.slice().sort(compareHikes);
    var out = '<p class="px-1 pb-2 text-small text-muted">' +
      state.hikes.length + ' hike' + (state.hikes.length === 1 ? '' : 's') +
      ', sorted by ' + state.voters + ' people</p>';
    for (var i = 0; i < TIERS.length; i++) {
      var tier = TIERS[i];
      var rows = sorted.filter(function (h) { return h.groupTier === tier; });
      out += bandHtml(tier, rows);
    }
    var unsorted = sorted.filter(function (h) { return h.groupTier == null; });
    if (unsorted.length) {
      out += '<p class="section-label mt-4">Nobody has sorted these yet</p>' +
        '<ul class="list">' + unsorted.map(rowHtml).join('') + '</ul>';
    }
    return out;
  }

  function bandHtml(tier, rows) {
    return '<section class="tier-band ' + BAND[tier] + '" data-tier="' + tier + '">' +
      '<div class="band-label"><span class="blaze" role="img" aria-label="Tier ' + tier + '">' + tier + '</span></div>' +
      (rows.length
        ? '<ul class="min-w-0 flex-1 divide-y divide-line">' + rows.map(rowHtml).join('') + '</ul>'
        : '<p class="flex-1 px-4 py-6 text-small text-muted">No hikes here yet</p>') +
      '</section>';
  }

  function rowHtml(hike) {
    var you = hike.mine
      ? '<span class="blaze-mini ' + BLAZE[hike.mine] + '" role="img" aria-label="Your tier ' + hike.mine + '">' + hike.mine + '</span>'
      : '<span class="text-small text-muted">To sort</span>';
    return '<li><button class="hike-row list-row w-full text-left" data-id="' + hike.id + '">' +
      '<span class="min-w-0 flex-1">' +
        '<span class="block text-body font-semibold leading-5">' + esc(hike.name) + '</span>' +
        (hike.note
          ? '<span class="block truncate text-small text-muted">' + esc(hike.note) + '</span>'
          : '') +
      '</span>' +
      '<span class="flex flex-col items-end gap-0.5">' +
        barsHtml(hike) +
        '<span class="text-small text-muted">' + (hike.total ? hike.total + ' vote' + (hike.total === 1 ? '' : 's') : 'No votes') + '</span>' +
      '</span>' +
      '<span class="flex w-[52px] flex-none flex-col items-center gap-0.5 text-center text-small leading-tight text-muted">' +
        '<span class="whitespace-nowrap">' + (hike.mine ? 'You' : 'To sort') + '</span>' + (hike.mine ? you : '') +
      '</span>' +
    '</button></li>';
  }

  // Your tiers: the classic tier-list bands of tiles, plus To sort.
  function renderYours() {
    var out = '<p class="px-1 pb-2 text-small text-muted">Drag a hike into a tier, or tap it to choose one.</p>' +
      '<div data-drop="tosort" class="mb-2.5 rounded-xl border-2 border-dashed border-line p-2">' +
        '<p class="section-label">To sort</p>' +
        '<div class="flex flex-wrap gap-1.5" data-chips="tosort">' +
          (myHikes(null).map(chipHtml).join('') || '<span class="px-2 pb-1 text-small text-muted">Nothing waiting</span>') +
        '</div>' +
      '</div>';
    for (var i = 0; i < TIERS.length; i++) {
      var tier = TIERS[i];
      out += '<section class="tier-band ' + BAND[tier] + '" data-drop="' + tier + '">' +
        '<div class="band-label"><span class="blaze" role="img" aria-label="Tier ' + tier + '">' + tier + '</span></div>' +
        '<div class="flex min-w-0 flex-1 flex-wrap items-start gap-1.5 p-2" data-chips="' + tier + '">' +
          (myHikes(tier).map(chipHtml).join('') ||
            '<span class="px-2 py-2 text-small text-muted">No hikes here yet</span>') +
        '</div>' +
      '</section>';
    }
    return out;
  }

  function myHikes(tier) {
    return state.hikes.filter(function (h) {
      return tier === null ? h.mine == null : h.mine === tier;
    });
  }

  function chipHtml(hike) {
    return '<button class="hike-chip" data-id="' + hike.id + '">' + esc(hike.name) + '</button>';
  }

  // ── Wiring ─────────────────────────────────────────────────────────────
  function wireHeader() {
    var add = document.getElementById('add-hike');
    if (add) add.addEventListener('click', openAddSheet);
    var tabE = document.getElementById('tab-everyone');
    var tabY = document.getElementById('tab-yours');
    if (tabE) tabE.addEventListener('click', function () { switchView('everyone'); });
    if (tabY) tabY.addEventListener('click', function () { switchView('yours'); });
    document.querySelectorAll('.hike-row').forEach(function (row) {
      row.addEventListener('click', function () {
        var hike = byId(row.getAttribute('data-id'));
        if (hike) openHikeSheet(hike);
      });
    });
    document.querySelectorAll('.hike-chip').forEach(function (chip) {
      chip.addEventListener('click', function () {
        var hike = byId(chip.getAttribute('data-id'));
        if (hike) openHikeSheet(hike);
      });
    });
  }

  function switchView(next) {
    if (view === next) return;
    view = next;
    render();
  }

  function byId(id) {
    id = Number(id);
    for (var i = 0; i < state.hikes.length; i++) {
      if (state.hikes[i].id === id) return state.hikes[i];
    }
    return null;
  }

  function replaceHike(hike) {
    for (var i = 0; i < state.hikes.length; i++) {
      if (state.hikes[i].id === hike.id) { state.hikes[i] = hike; return; }
    }
    state.hikes.push(hike);
  }

  // ── Voting ─────────────────────────────────────────────────────────────
  // Optimistic: recompute counts, mine and groupTier locally, re-render,
  // then let the server's answer replace the guess.
  function applyVote(hike, tier) {
    var before = { counts: Object.assign({}, hike.counts), total: hike.total, mine: hike.mine, groupTier: hike.groupTier };
    if (hike.mine) hike.counts[hike.mine] = Math.max(0, hike.counts[hike.mine] - 1);
    if (tier) hike.counts[tier] = (hike.counts[tier] || 0) + 1;
    hike.mine = tier;
    hike.total = (tier && !before.mine) ? hike.total + 1
      : (!tier && before.mine) ? hike.total - 1
      : hike.total;
    hike.groupTier = groupTier(hike);
    return before;
  }

  function setTier(hike, tier) {
    if (!state.me) return; // guests are asked for an account by the bridge
    var before = applyVote(hike, tier);
    render();
    if (sheetOpen && openSheetHike && openSheetHike.id === hike.id) refreshSheet();
    var req = tier
      ? api('/api/hikes/' + hike.id + '/vote', { method: 'PUT', body: JSON.stringify({ tier: tier }) })
      : api('/api/hikes/' + hike.id + '/vote', { method: 'DELETE' });
    req.then(function (r) {
      if (r.status === 404) {
        toast('That hike is no longer on the list.');
        return load();
      }
      if (!r.ok || !r.body) throw new Error('vote failed');
      replaceHike(r.body);
      render();
      if (sheetOpen && openSheetHike && openSheetHike.id === hike.id) { openSheetHike = r.body; refreshSheet(); }
    }).catch(function () {
      hike.counts = before.counts; hike.total = before.total;
      hike.mine = before.mine; hike.groupTier = before.groupTier;
      render();
      if (sheetOpen && openSheetHike && openSheetHike.id === hike.id) { openSheetHike = hike; refreshSheet(); }
      toast('Couldn\'t save your tier for ' + hike.name + '. Try again.');
    });
  }

  function toast(msg) {
    if (window.unNative && unNative.toast) unNative.toast(msg);
  }

  // ── Sheets ─────────────────────────────────────────────────────────────
  var openSheetHike = null;
  var sheetHandle = null;
  var sheetBodyEl = null; // the body node inside the open hike sheet

  function present(content, onDismiss) {
    if (!window.unNative || !unNative.presentSheet) {
      // Outside the kit (plain local run): dump the content in a simple sheet.
      var fallback = el('<div class="fixed inset-x-0 bottom-0 z-50 border-t border-line bg-surface p-4 shadow-2xl"></div>');
      fallback.appendChild(content);
      document.body.appendChild(fallback);
      return { dismiss: function () { fallback.remove(); if (onDismiss) onDismiss(); } };
    }
    return unNative.presentSheet({ contentEl: content, onDismiss: onDismiss });
  }

  function wireSheetBody(body) {
    body.querySelectorAll('[data-tier]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var tier = btn.getAttribute('data-tier');
        if (openSheetHike) setTier(openSheetHike, openSheetHike.mine === tier ? null : tier);
      });
    });
    var clear = body.querySelector('[data-clear]');
    if (clear) clear.addEventListener('click', function () {
      if (openSheetHike) setTier(openSheetHike, null);
    });
  }

  function openHikeSheet(hike) {
    if (!state.me) { askForAccount(); return; }
    openSheetHike = hike;
    sheetOpen = true;
    var content = el('<div class="flex flex-col gap-3"></div>');
    sheetBodyEl = sheetBody(hike);
    content.appendChild(sheetBodyEl);
    sheetHandle = present(content, function () {
      sheetOpen = false;
      openSheetHike = null;
      sheetHandle = null;
      sheetBodyEl = null;
    });
  }

  function sheetBody(hike) {
    var wrap = el('<div></div>');
    var total = hike.total;
    wrap.innerHTML =
      '<div class="mx-auto mb-3 h-1 w-9 rounded-full bg-line"></div>' +
      '<h2 class="font-round text-title text-fg">' + esc(hike.name) + '</h2>' +
      (hike.note ? '<p class="text-body text-muted">' + esc(hike.note) + '</p>' : '') +
      '<p class="text-small text-muted">Added by ' + esc(hike.addedBy) + '</p>' +
      '<p class="section-label mt-2">Your tier</p>' +
      '<div class="grid grid-cols-5 gap-2" data-pick>' +
        TIERS.map(function (tier) {
          var on = hike.mine === tier;
          return '<button class="flex h-14 items-center justify-center rounded-md font-round text-title font-extrabold leading-none text-on-tier ' + BLAZE[tier] +
            (on ? ' ring-2 ring-offset-2 ring-offset-surface ring-focus' : '') +
            '" data-tier="' + tier + '" aria-label="Tier ' + tier + '" aria-pressed="' + on + '">' + tier + '</button>';
        }).join('') +
      '</div>' +
      (hike.mine ? '<button class="btn-secondary" data-clear>Clear my tier</button>' : '') +
      '<p class="section-label mt-2">Everyone so far: ' + total + ' vote' + (total === 1 ? '' : 's') + '</p>' +
      distributionHtml(hike);
    wireSheetBody(wrap);
    return wrap;
  }

  function distributionHtml(hike) {
    var max = 0;
    for (var i = 0; i < TIERS.length; i++) max = Math.max(max, hike.counts[TIERS[i]] || 0);
    return '<ul class="flex flex-col gap-1.5">' + TIERS.map(function (tier) {
      var v = hike.counts[tier] || 0;
      var w = max ? Math.round(100 * v / max) : 0;
      return '<li class="flex items-center gap-2.5 text-small">' +
        '<span class="blaze-mini ' + BLAZE[tier] + '" role="img" aria-label="Tier ' + tier + '">' + tier + '</span>' +
        '<span class="h-3 flex-1 rounded-full bg-raised"><span class="block h-3 rounded-full ' + BAR[tier] + '" style="width:' + w + '%"></span></span>' +
        '<span class="w-5 text-right text-muted">' + v + '</span>' +
      '</li>';
    }).join('') + '</ul>';
  }

  function refreshSheet() {
    if (!sheetBodyEl || !openSheetHike) return;
    var fresh = byId(openSheetHike.id);
    if (fresh) openSheetHike = fresh;
    var next = sheetBody(openSheetHike);
    sheetBodyEl.innerHTML = next.innerHTML;
    wireSheetBody(sheetBodyEl);
  }

  function askForAccount() {
    // A guest tapping sort or add: the write would answer 401
    // account_required, which the bridge turns into its sign-up sheet. Make
    // that happen now with a harmless probe.
    api('/api/hikes', { method: 'POST', body: JSON.stringify({ name: '' }) });
  }

  function openAddSheet() {
    if (!state) return;
    if (!state.me) { askForAccount(); return; }
    sheetOpen = true;
    var content = el(
      '<div class="flex flex-col gap-3">' +
        '<div class="mx-auto mb-1 h-1 w-9 rounded-full bg-line"></div>' +
        '<h2 class="font-round text-title text-fg">Add a hike</h2>' +
        '<div>' +
          '<label class="section-label" for="hike-name">Hike name</label>' +
          '<input id="hike-name" class="field" type="text" maxlength="80" placeholder="e.g. Eagle Rock Loop" autocomplete="off">' +
        '</div>' +
        '<div>' +
          '<label class="section-label" for="hike-note">Note (optional)</label>' +
          '<textarea id="hike-note" class="field" rows="2" maxlength="200" placeholder="e.g. Muddy after rain, great view"></textarea>' +
        '</div>' +
        '<p class="section-label">Your tier (optional)</p>' +
        '<div class="grid grid-cols-5 gap-2" data-new-tier>' +
          TIERS.map(function (tier) {
            return '<button class="flex h-14 items-center justify-center rounded-md font-round text-title font-extrabold leading-none text-on-tier ' + BLAZE[tier] +
              '" data-tier="' + tier + '" aria-label="Tier ' + tier + '" aria-pressed="false">' + tier + '</button>';
          }).join('') +
        '</div>' +
        '<p class="text-small text-danger" data-name-error hidden></p>' +
        '<div class="flex gap-2">' +
          '<button class="btn-primary flex-1" data-save disabled>Add hike</button>' +
          '<button class="btn-secondary" data-cancel>Cancel</button>' +
        '</div>' +
      '</div>'
    );
    var pickedTier = null;
    var nameInput = content.querySelector('#hike-name');
    var saveBtn = content.querySelector('[data-save]');
    var errorEl = content.querySelector('[data-name-error]');
    content.querySelectorAll('[data-new-tier] [data-tier]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        pickedTier = pickedTier === btn.getAttribute('data-tier') ? null : btn.getAttribute('data-tier');
        content.querySelectorAll('[data-new-tier] [data-tier]').forEach(function (b) {
          var on = b.getAttribute('data-tier') === pickedTier;
          b.setAttribute('aria-pressed', on);
          if (on) b.classList.add('ring-2', 'ring-offset-2', 'ring-offset-surface', 'ring-focus');
          else b.classList.remove('ring-2', 'ring-offset-2', 'ring-offset-surface', 'ring-focus');
        });
      });
    });
    function maybeEnable() {
      saveBtn.disabled = !nameInput.value.trim() || saveBtn.getAttribute('data-busy') === '1';
    }
    nameInput.addEventListener('input', maybeEnable);
    saveBtn.addEventListener('click', function () {
      var name = nameInput.value.trim();
      var note = content.querySelector('#hike-note').value.trim();
      if (!name) return;
      saveBtn.setAttribute('data-busy', '1');
      saveBtn.disabled = true;
      api('/api/hikes', {
        method: 'POST',
        body: JSON.stringify({ name: name, note: note, tier: pickedTier }),
      }).then(function (r) {
        if (r.status === 409) {
          saveBtn.removeAttribute('data-busy');
          maybeEnable();
          errorEl.textContent = r.body && r.body.name
            ? r.body.name + ' is already on the list.'
            : 'A hike with that name is already on the list.';
          errorEl.hidden = false;
          return;
        }
        if (r.status === 401) return; // the bridge is showing its sign-up sheet
        if (!r.ok || !r.body) throw new Error('save failed');
        replaceHike(r.body);
        toast('Added ' + r.body.name);
        if (sheetHandle) sheetHandle.dismiss();
        render();
        schedulePoll();
      }).catch(function () {
        saveBtn.removeAttribute('data-busy');
        maybeEnable();
        errorEl.textContent = 'Couldn\'t add the hike. Try again.';
        errorEl.hidden = false;
      });
    });
    sheetHandle = present(content, function () {
      sheetOpen = false;
      sheetHandle = null;
    });
    if (nameInput && nameInput.focus) nameInput.focus({ preventScroll: true });
  }

  // ── Drag (press and hold on a phone, drag on desktop) ──────────────────
  function attachDrag() {
    if (!window.unNative || !unNative.attachGridPlacement) return;
    if (grid) { grid.detach(); grid = null; }
    var container = main.querySelector('[data-drop]');
    if (!container) return;
    var parent = container.parentElement;
    // To sort is row 0, S to D rows 1 to 5.
    function dropFor(cell) {
      if (cell.row === 0) return null; // To sort → clear
      return TIERS[cell.row - 1] || null;
    }
    grid = unNative.attachGridPlacement(parent, {
      itemSelector: '.hike-chip',
      cellFromPoint: function (x, y, info) {
        var px = info ? info.centerX : x;
        var py = info ? info.centerY : y;
        var hit = document.elementFromPoint(px, py);
        var drop = hit && hit.closest('[data-drop]');
        if (!drop) return null;
        return { col: 0, row: drop.getAttribute('data-drop') === 'tosort' ? 0 : TIERS.indexOf(drop.getAttribute('data-drop')) + 1 };
      },
      rectForCell: function (item, cell) {
        var sel = cell.row === 0 ? '[data-drop="tosort"]' : '[data-drop="' + TIERS[cell.row - 1] + '"]';
        var drop = parent.querySelector(sel);
        if (!drop) return null;
        var r = drop.getBoundingClientRect();
        return { left: r.left, top: r.top };
      },
      onHover: function (item, cell) {
        parent.querySelectorAll('[data-drop]').forEach(function (d) { d.classList.remove('drop-hover'); });
        if (!cell) return;
        var sel = cell.row === 0 ? '[data-drop="tosort"]' : '[data-drop="' + TIERS[cell.row - 1] + '"]';
        var drop = parent.querySelector(sel);
        if (drop) drop.classList.add('drop-hover');
      },
      onLift: function () { dragging = true; },
      onPlace: function (item, cell) {
        var hike = byId(item.getAttribute('data-id'));
        if (hike) setTier(hike, dropFor(cell));
      },
      onSettle: function () {
        dragging = false;
        parent.querySelectorAll('[data-drop]').forEach(function (d) { d.classList.remove('drop-hover'); });
      },
    });
  }

  // ── Loading and polling ────────────────────────────────────────────────
  function load() {
    loadFailed = false;
    if (!state) renderStates();
    return api('/api/state').then(function (r) {
      if (!r.ok || !r.body) throw new Error('load failed');
      state = r.body;
      main.setAttribute('data-loaded', 'true');
      loadFailed = false;
      if (!state.hikes.length) renderEmpty();
      else render();
    }).catch(function () {
      loadFailed = true;
      renderStates();
    });
  }

  function schedulePoll() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(function () {
      if (document.visibilityState !== 'visible') return;
      if (sheetOpen || dragging) return;
      refresh();
    }, 30000);
  }

  function refresh() {
    api('/api/state').then(function (r) {
      if (!r.ok || !r.body) return;
      state = r.body;
      if (!state.hikes.length) renderEmpty();
      else render();
    }).catch(function () { /* keep what is on screen */ });
  }

  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && !sheetOpen && !dragging) refresh();
  });

  load().then(schedulePoll);
})();
