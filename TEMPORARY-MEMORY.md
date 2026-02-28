# Temporary Session Memory — gnome-switch

**Date:** 2026-02-28
**Status:** Extension built, installed, awaiting first test after re-login.

---

## Where we left off

The full `gnome-switch@eldarj` extension was just written and committed
(commit `4ef8231`).  It is already installed to:

```
~/.local/share/gnome-shell/extensions/gnome-switch@eldarj/
```

**The schema is compiled.**  The extension is NOT yet enabled because GNOME
Shell on Wayland does not discover new extensions until the session restarts.

---

## Steps to do after re-login

```bash
# 1. Enable the extension
gnome-extensions enable gnome-switch@eldarj

# 2. Watch for load errors in real time
journalctl -f -o cat /usr/bin/gnome-shell | grep -i "switch\|error\|exception"

# 3. Verify it is enabled
gnome-extensions list --enabled | grep gnome-switch
```

If there are JS errors in the journal, fix them in the source and re-deploy:

```bash
cp -r ~/projects/gnome/gnome-switch/gnome-switch@eldarj \
      ~/.local/share/gnome-shell/extensions/
glib-compile-schemas \
  ~/.local/share/gnome-shell/extensions/gnome-switch@eldarj/schemas/
gnome-extensions disable gnome-switch@eldarj
gnome-extensions enable  gnome-switch@eldarj
```

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

## Likely first issues to fix after testing

1. Any JS runtime errors → check journal, fix in source, redeploy.
2. Tile icons that don't exist in the current icon theme → replace icon names.
3. Layout / spacing tweaks → edit `stylesheet.css`.
4. VPN tile may be grayed out if no VPN profiles configured in NM — expected.
5. Brightness + kbd backlight sliders may not appear on desktop — expected.
