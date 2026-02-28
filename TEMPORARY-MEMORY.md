# Temporary Session Memory — gnome-switch

**Date:** 2026-02-28
**Status:** Accent color fix done. Extension working. GitHub repo not yet created.

---

## Current state

Extension is **State: ACTIVE**. Three bugs have been fixed and committed (`5e19fbb`).
No re-login needed for the accent color fix — disable/enable suffices.

---

## What has been fixed

### 1. Large-text bug — switches.js
`large-text` key does not exist in `org.gnome.desktop.a11y.interface`.

**Fix:**
```js
isLargeText()     { return this._iface.get_double('text-scaling-factor') >= 1.25; }
toggleLargeText() {
    this._iface.set_double('text-scaling-factor', this.isLargeText() ? 1.0 : 1.25);
}
watchLargeText(cb) {
    const id = this._iface.connect('changed::text-scaling-factor', cb);
    return () => this._iface.disconnect(id);
}
```

### 2. Opaque popup background — panel.js / stylesheet.css

`_buildMenu()` was doing `this.menu.box.style_class = 'popup-menu-box gs-menu-box'`
which replaced the GNOME theme's `popup-menu-content` class.

**Fix:** Removed that line entirely. Theme handles popup background.

### 3. Accent color — panel.js / stylesheet.css

Active tiles were hardcoded `#3584e4` (GNOME blue). Ubuntu's Yaru themes don't
expose CSS variables — accent is baked into per-variant SVGs. Fix:

- `YARU_ACCENT` map (all 10 Yaru variants → hex) in `panel.js`
- `_accentColorFor(iface)` reads `gtk-theme` key
- `SwitchTile._syncState()` and `PowerModeRow._syncChips()` set inline
  `widget.style = 'background-color: <hex>;'` on active state
- `SwitchIndicator` watches `changed::gtk-theme` → `_rebuildMenu()`
- `Yaru-dark` (user's theme) = `#E95420` (Ubuntu orange)

---

## Git / GitHub state

- Branch: `master`
- Latest commit: `5e19fbb` — Fix large-text bug and use standard GNOME popup background
- Accent color fix deployed (disable/enable done), NOT YET committed
- **No remote configured** — GitHub repo `eldarj/gnome-switch` does not exist yet
- Next: create repo on GitHub, commit accent color fix, push

---

## What was built

| File | Summary |
|---|---|
| `extension.js` | Entry point |
| `switches.js` | All toggle/slider logic + D-Bus proxies |
| `mpris.js` | Media player MPRIS monitor |
| `panel.js` | Full dropdown UI (tiles, sliders, power chips, MPRIS strip) |
| `prefs.js` | GTK4 preferences window |
| `stylesheet.css` | All styling |
| `schemas/` | GSettings schema |

**21 toggle tiles** across Display / Sound / Connectivity / Power / Privacy /
System / Accessibility sections.

**4 sliders:** Volume, Brightness (laptop only), Night-light warmth, Kbd backlight (if hardware present).

**Power mode chips:** Saver / Balanced / Performance — only shown if
`power-profiles-daemon` is running.

**MPRIS strip:** only visible when something is playing/paused.

---

## Repo location

```
/home/ejahijagic/projects/gnome/gnome-switch/
```

---

## Remaining / future work

1. Commit accent color fix
2. Create GitHub repo and push master → main
3. Active tile hover color not themed (inline style blocks CSS `:hover`) — minor
4. VPN tile: connects first NM profile; no profile picker
5. Prefs: checkbox-only tile visibility; no drag-to-reorder
