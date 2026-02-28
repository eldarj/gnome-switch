# AGENT.md — gnome-switch developer context

This file is loaded automatically by Claude Code at the start of every session
in this repository.  It captures architecture decisions, conventions, and
gotchas so the agent can work on this codebase without re-reading every file.


## Project summary

`gnome-switch` is a GNOME Shell extension (UUID `gnome-switch@eldarj`) that
adds a One Switch–style quick-toggle panel button to the GNOME top bar.
Target: GNOME 46–49.  Language: GJS ESM (ES modules via `import/export`).


## Key files

| File | Role |
|---|---|
| `extension.js` | `Extension` subclass — `enable()` creates controller + MPRIS + indicator; `disable()` destroys them |
| `switches.js` | `SwitchController` (GObject) owns all GSettings + D-Bus proxies; exports `getSwitchDefs(ctrl)` and `getSliderDefs(ctrl)` |
| `mpris.js` | `MprisController` (GObject) — watches `NameOwnerChanged`, tracks best player, emits `'changed'` |
| `panel.js` | `SwitchIndicator` extends `PanelMenu.Button` — builds tile grid, sliders, power chips, MPRIS strip |
| `prefs.js` | `ExtensionPreferences` subclass — GTK4 + Adwaita prefs window |
| `stylesheet.css` | All St CSS.  GNOME 46: no `var(--accent-bg-color)`; active tiles use hardcoded `#3584e4` |
| `schemas/` | GSettings schema id `org.gnome.shell.extensions.gnome-switch` |


## Architecture

```
Extension
 ├─ SwitchController   (switches.js)
 │   ├─ GSettings objects (one per relevant schema)
 │   ├─ D-Bus proxies: rfkill, NM, brightness, power-profiles, UPower kbd
 │   ├─ Gvc.MixerControl (volume + mic)
 │   └─ Keep-awake inhibit cookie (SessionManager)
 │
 ├─ MprisController    (mpris.js)
 │   └─ Watches org.mpris.MediaPlayer2.* on session bus
 │
 └─ SwitchIndicator    (panel.js)
     ├─ Tile grid  — SwitchTile widgets (Clutter.GridLayout)
     ├─ Slider rows — SliderRow widgets (Slider.Slider)
     ├─ PowerModeRow — chip buttons (net.hadess.PowerProfiles)
     └─ MprisStrip  — shown only when MprisController.hasPlayer()
```


## Switch and slider definitions

`getSwitchDefs(ctrl)` returns an array of plain objects:

```js
{
  id:          String,           // used in visible-switches GSettings key
  label:       String,
  icon:        String,           // symbolic icon name
  section:     String,
  type:        'toggle'|'action',
  isActive:    () => Boolean,
  toggle:      () => void,
  watch:       (cb) => unsubFn,  // connects to settings/signal; returns disconnector
  isAvailable: () => Boolean,    // optional; tile is hidden when false
}
```

`getSliderDefs(ctrl)` returns:

```js
{
  id, label, icon,
  getValue:    () => Number,     // 0–1
  setValue:    (v) => void,
  watch:       (cb) => unsubFn,
  isAvailable: () => Boolean,
  min, max,                      // always 0, 1
  isMuted:     () => Boolean,    // volume slider only
  iconMuted:   String,           // volume slider only
}
```


## GSettings keys (extension schema)

| Key | Type | Default | Purpose |
|---|---|---|---|
| `visible-switches` | `as` | all 21 IDs | Ordered list of tile IDs shown in the panel |
| `columns` | `i` (2–4) | `3` | Grid column count |
| `show-value-labels` | `b` | `true` | Percentage labels next to sliders |


## D-Bus services used

| Service | Bus | Purpose |
|---|---|---|
| `org.gnome.SettingsDaemon.Rfkill` | session | Bluetooth + Airplane mode |
| `org.freedesktop.NetworkManager` | system | Wi-Fi + VPN |
| `org.gnome.SettingsDaemon.Power` | session | Screen brightness |
| `net.hadess.PowerProfiles` | system | Power mode (conditional) |
| `org.freedesktop.UPower` `/KbdBacklight` | system | Keyboard backlight (conditional) |
| `org.gnome.SessionManager` | session | Keep-awake inhibit |
| `org.gnome.ScreenSaver` | session | Lock Now |
| `org.mpris.MediaPlayer2.*` | session | Media player control |


## Conditional features

Tiles/sliders are hidden (not just disabled) when their service is unavailable:
- Brightness slider → `ctrl.hasBrightness()` (laptop only)
- Keyboard backlight slider → `ctrl.hasKbdBacklight()`
- Power mode chips → `ctrl.hasPowerProfiles()`
- MPRIS strip → `mpris.hasPlayer()` (toggled live, not on rebuild)

The panel rebuilds itself when extension GSettings change
(`SwitchIndicator._rebuildMenu`).


## CSS conventions

- All class names prefixed `gs-` to avoid collisions.
- Active tile: `.gs-tile.active` → `background-color: #3584e4` (GNOME blue).
  When targeting GNOME 47+, replace with `var(--accent-bg-color)`.
- Do not use `flex` — use `St.BoxLayout` + `Clutter.GridLayout`.


## Install / test workflow

```bash
# After editing source files:
cp -r gnome-switch@eldarj ~/.local/share/gnome-shell/extensions/
glib-compile-schemas ~/.local/share/gnome-shell/extensions/gnome-switch@eldarj/schemas/

# First-time load (Wayland): log out and back in, then:
gnome-extensions enable gnome-switch@eldarj

# Watch for errors:
journalctl -f -o cat /usr/bin/gnome-shell | grep -i "switch\|error\|exception"

# For iterative changes after first enable, disable/re-enable suffices:
gnome-extensions disable gnome-switch@eldarj
# copy files again
gnome-extensions enable gnome-switch@eldarj
```


## Known limitations / next steps

- VPN toggle connects the *first* VPN profile found in NM; no profile picker yet.
- `visible-switches` order in prefs is checkbox-only (no drag-to-reorder) — v1 simplification.
- `var(--accent-bg-color)` not used; hardcoded blue for GNOME 46 compatibility.
- Night-light temperature slider range is 1700–4700 K (practical range); GSettings stores 1000–10000.
