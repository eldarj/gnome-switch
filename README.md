# gnome-switch

A One Switch–style quick-toggle panel for GNOME 46–49.

Click the toggle icon in the top bar to open a dropdown with:

- **Tile grid** — 21 toggles/actions: Dark Mode, Night Light, High Contrast,
  No Animations, Hot Corners, Mute, Mic Off, Wi-Fi, Bluetooth, Airplane Mode,
  VPN, Location, Keep Awake, Auto Sleep, Keyboard Backlight, Do Not Disturb,
  Screen Lock, Lock Now, Touchpad, Magnifier, Large Text
- **Slider rows** — Volume, Brightness, Night-light warmth, Keyboard backlight
- **Power mode chips** — Saver / Balanced / Performance (requires `power-profiles-daemon`)
- **MPRIS strip** — now-playing info + prev/play-pause/next
  (only shown when a media player is active)

Settings changes take effect immediately — no shell restart needed.

Active toggle tiles and power chips automatically use the system accent color
(Yaru theme variants on Ubuntu; falls back to GNOME blue on other themes).


## Supported GNOME versions

| Branch  | GNOME Shell    |
|---------|----------------|
| `master`| **46, 47, 48, 49** |


## Installation

```bash
git clone https://github.com/eldarj/gnome-switch.git
cd gnome-switch

# Copy extension files
cp -r gnome-switch@eldarj ~/.local/share/gnome-shell/extensions/

# Compile the GSettings schema (required)
glib-compile-schemas \
  ~/.local/share/gnome-shell/extensions/gnome-switch@eldarj/schemas/
```

**Then log out and back in** (Wayland requires a full session restart for GNOME
Shell to discover newly installed extensions).

```bash
# Enable the extension after logging back in
gnome-extensions enable gnome-switch@eldarj
```


## Updating

```bash
cd gnome-switch
git pull
cp -r gnome-switch@eldarj ~/.local/share/gnome-shell/extensions/
glib-compile-schemas \
  ~/.local/share/gnome-shell/extensions/gnome-switch@eldarj/schemas/
```

Log out and back in, then re-enable if needed.


## Verifying / debugging

```bash
# Confirm extension is enabled
gnome-extensions list --enabled | grep gnome-switch

# Show extension status
gnome-extensions info gnome-switch@eldarj

# Follow live shell log for load errors
journalctl -f -o cat /usr/bin/gnome-shell | grep -i "switch\|error\|exception"

# Check logs from current boot only
journalctl -b -o cat /usr/bin/gnome-shell | grep -i "switch\|error\|exception"
```


## Configuration

Open **Settings → Extensions → Switch** (or click the panel icon → Preferences).

| Setting | Description |
|---|---|
| Per-section switch toggles | Show or hide individual tiles in the dropdown |
| Grid columns | 2, 3, or 4 tiles per row (default: 3) |
| Show value labels | Show percentage labels next to sliders |


## Conditional features

Some features only appear when the relevant hardware or service is available:

| Feature | Requires |
|---|---|
| Brightness slider | Laptop with hardware backlight (via gnome-settings-daemon) |
| Keyboard backlight slider | UPower `KbdBacklight` interface |
| Power mode chips | `power-profiles-daemon` running on the system |
| MPRIS strip | A media player exposing the MPRIS D-Bus interface |
| VPN tile | At least one VPN connection profile in NetworkManager |


## File structure

```
gnome-switch@eldarj/
├── extension.js      Entry point — creates controller, MPRIS, panel button
├── switches.js       SwitchController + all toggle/slider definitions
├── mpris.js          MPRIS D-Bus media player monitor
├── panel.js          SwitchIndicator — tile grid, sliders, chips, MPRIS strip
├── prefs.js          GTK4/Adwaita preferences window
├── stylesheet.css    All visual styling
├── metadata.json
├── icons/
│   └── switch-symbolic.svg
└── schemas/
    └── org.gnome.shell.extensions.gnome-switch.gschema.xml
```


## License

GNU General Public License v2 or later.
