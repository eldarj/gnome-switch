/*
 * panel.js — SwitchIndicator (panel button + dropdown)
 *
 * Builds the tile grid, slider rows, power-mode chip row, and MPRIS strip
 * inside a standard PanelMenu.Button popup.
 */

import GObject from 'gi://GObject';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as Slider from 'resource:///org/gnome/shell/ui/slider.js';

import { getSwitchDefs, getSliderDefs } from './switches.js';

// ─── Accent color (Yaru theme → hex) ─────────────────────────────────────────

const YARU_ACCENT = {
    'Yaru':                    '#E95420',
    'Yaru-dark':               '#E95420',
    'Yaru-bark':               '#787859',
    'Yaru-bark-dark':          '#787859',
    'Yaru-blue':               '#0073E5',
    'Yaru-blue-dark':          '#0073E5',
    'Yaru-magenta':            '#B34CB3',
    'Yaru-magenta-dark':       '#B34CB3',
    'Yaru-olive':              '#4B8501',
    'Yaru-olive-dark':         '#4B8501',
    'Yaru-prussiangreen':      '#308280',
    'Yaru-prussiangreen-dark': '#308280',
    'Yaru-purple':             '#7764D8',
    'Yaru-purple-dark':        '#7764D8',
    'Yaru-red':                '#DA3450',
    'Yaru-red-dark':           '#DA3450',
    'Yaru-sage':               '#657B69',
    'Yaru-sage-dark':          '#657B69',
    'Yaru-viridian':           '#03875B',
    'Yaru-viridian-dark':      '#03875B',
};

function _accentColorFor(iface) {
    const theme = iface.get_string('gtk-theme');
    return YARU_ACCENT[theme] ?? '#3584e4';
}

// ─── Dynamic accent stylesheet ────────────────────────────────────────────────
// In GNOME Shell's St toolkit, CSS class rules beat actor.style inline styles.
// We write a tiny CSS file to /tmp and load it via St.ThemeContext so our
// accent color always wins over the base stylesheet rules.

const ACCENT_CSS_PATH = GLib.build_filenamev([GLib.get_tmp_dir(), 'gnome-switch-accent.css']);
let _accentFile = null;

function _applyAccentCss(color) {
    const theme = St.ThemeContext.get_for_stage(global.stage).get_theme();

    if (_accentFile) {
        try { theme.unload_stylesheet(_accentFile); } catch (_) {}
        _accentFile = null;
    }

    const css = [
        `.gs-tile.active { background-color: ${color}; }`,
        `.gs-chip.active { background-color: ${color}; }`,
    ].join('\n');

    GLib.file_set_contents(ACCENT_CSS_PATH, css);
    _accentFile = Gio.File.new_for_path(ACCENT_CSS_PATH);
    theme.load_stylesheet(_accentFile);
}

function _clearAccentCss() {
    if (!_accentFile) return;
    try {
        St.ThemeContext.get_for_stage(global.stage).get_theme()
            .unload_stylesheet(_accentFile);
    } catch (_) {}
    _accentFile = null;
}

// ─── SwitchTile ───────────────────────────────────────────────────────────────

const SwitchTile = GObject.registerClass(
class SwitchTile extends St.Button {
    _init(def) {
        super._init({
            style_class: 'gs-tile',
            reactive: true,
            can_focus: true,
            track_hover: true,
            x_expand: true,
        });

        const box = new St.BoxLayout({
            vertical: true,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'gs-tile-inner',
        });
        this.set_child(box);

        this._icon = new St.Icon({
            icon_name: def.icon,
            icon_size: 20,
            style_class: 'gs-tile-icon',
        });
        box.add_child(this._icon);

        this._label = new St.Label({
            text: def.label,
            style_class: 'gs-tile-label',
            x_align: Clutter.ActorAlign.CENTER,
        });
        box.add_child(this._label);

        this._def           = def;
        this._disconnectors = [];

        if (def.watch) {
            const unsub = def.watch(() => this._syncState());
            this._disconnectors.push(unsub);
        }

        this.connect('clicked', () => {
            def.toggle();
            this._syncState();
        });

        this.connect('destroy', () => {
            this._disconnectors.forEach(d => d());
            this._disconnectors = [];
        });

        this._syncState();
    }

    _syncState() {
        if (this._def.type === 'action') return;
        if (this._def.isActive())
            this.add_style_class_name('active');
        else
            this.remove_style_class_name('active');
    }
});

// ─── SliderRow ────────────────────────────────────────────────────────────────

const SliderRow = GObject.registerClass(
class SliderRow extends St.BoxLayout {
    _init(def, showLabels) {
        super._init({ style_class: 'gs-slider-row', x_expand: true });

        this._def   = def;
        this._dragging = false;

        this._icon = new St.Icon({
            icon_name: def.icon,
            icon_size: 16,
            style_class: 'gs-slider-icon',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this.add_child(this._icon);

        this._slider = new Slider.Slider(def.getValue());
        this._slider.x_expand = true;
        this.add_child(this._slider);

        if (showLabels) {
            this._valueLabel = new St.Label({
                text: this._formatValue(def.getValue()),
                style_class: 'gs-slider-value',
                y_align: Clutter.ActorAlign.CENTER,
            });
            this.add_child(this._valueLabel);
        }

        // Slider drag → set value
        this._sliderId = this._slider.connect('notify::value', () => {
            if (!this._dragging) return;
            def.setValue(this._slider.value);
            this._updateLabel();
        });
        this._slider.connect('drag-begin', () => { this._dragging = true; });
        this._slider.connect('drag-end', () => {
            this._dragging = false;
            def.setValue(this._slider.value);
            this._updateLabel();
        });

        // External changes
        this._disconnectors = [];
        if (def.watch) {
            const unsub = def.watch(() => this._syncFromExternal());
            this._disconnectors.push(unsub);
        }

        this.connect('destroy', () => {
            this._slider.disconnect(this._sliderId);
            this._disconnectors.forEach(d => d());
        });

        this._syncFromExternal();
    }

    _syncFromExternal() {
        if (this._dragging) return;
        const v = this._def.getValue();
        if (v < 0) return; // not available yet
        this._slider.value = Math.max(0, Math.min(1, v));
        this._updateLabel();
        // Update icon for volume mute state
        if (this._def.isMuted) {
            this._icon.icon_name = this._def.isMuted()
                ? this._def.iconMuted
                : this._def.icon;
        }
    }

    _formatValue(v) {
        return `${Math.round(v * 100)}%`;
    }

    _updateLabel() {
        if (this._valueLabel)
            this._valueLabel.text = this._formatValue(this._slider.value);
    }
});

// ─── PowerModeRow ─────────────────────────────────────────────────────────────

const PowerModeRow = GObject.registerClass(
class PowerModeRow extends St.BoxLayout {
    _init(ctrl) {
        super._init({ style_class: 'gs-power-row', x_expand: true });

        this._ctrl = ctrl;
        this._chips = [];

        const lbl = new St.Label({
            text: 'Power',
            style_class: 'gs-power-label',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this.add_child(lbl);

        const chipBox = new St.BoxLayout({ style_class: 'gs-chip-box', x_expand: true });
        this.add_child(chipBox);

        const PROFILES = [
            { id: 'power-saver',  label: 'Saver' },
            { id: 'balanced',     label: 'Balanced' },
            { id: 'performance',  label: 'Performance' },
        ];

        for (const p of PROFILES) {
            const chip = new St.Button({
                label: p.label,
                style_class: 'gs-chip',
                x_expand: true,
                can_focus: true,
            });
            chip.connect('clicked', () => {
                ctrl.setPowerProfile(p.id);
                this._syncChips();
            });
            chipBox.add_child(chip);
            this._chips.push({ btn: chip, id: p.id });
        }

        this._signalId = ctrl.connect('power-profile-changed', () => this._syncChips());
        this.connect('destroy', () => ctrl.disconnect(this._signalId));

        this._syncChips();
    }

    _syncChips() {
        const active = this._ctrl.getPowerProfile();
        for (const { btn, id } of this._chips) {
            if (id === active)
                btn.add_style_class_name('active');
            else
                btn.remove_style_class_name('active');
        }
    }
});

// ─── MprisStrip ───────────────────────────────────────────────────────────────

const MprisStrip = GObject.registerClass(
class MprisStrip extends St.BoxLayout {
    _init(mpris) {
        super._init({ style_class: 'gs-mpris', x_expand: true });

        this._mpris = mpris;

        // Track info
        this._trackBox = new St.BoxLayout({
            vertical: true,
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'gs-mpris-track',
        });
        this.add_child(this._trackBox);

        this._titleLabel = new St.Label({ style_class: 'gs-mpris-title', x_expand: true });
        this._trackBox.add_child(this._titleLabel);
        this._artistLabel = new St.Label({ style_class: 'gs-mpris-artist', x_expand: true });
        this._trackBox.add_child(this._artistLabel);

        // Controls
        const ctrlBox = new St.BoxLayout({ style_class: 'gs-mpris-controls' });
        this.add_child(ctrlBox);

        this._prevBtn = this._makeBtn('media-skip-backward-symbolic',  () => mpris.previous());
        this._playBtn = this._makeBtn('media-playback-start-symbolic', () => { mpris.playPause(); this._sync(); });
        this._nextBtn = this._makeBtn('media-skip-forward-symbolic',   () => mpris.next());

        ctrlBox.add_child(this._prevBtn);
        ctrlBox.add_child(this._playBtn);
        ctrlBox.add_child(this._nextBtn);

        this._signalId = mpris.connect('changed', () => this._sync());
        this.connect('destroy', () => mpris.disconnect(this._signalId));

        this._sync();
    }

    _makeBtn(iconName, cb) {
        const btn = new St.Button({
            style_class: 'gs-mpris-btn',
            can_focus: true,
            child: new St.Icon({ icon_name: iconName, icon_size: 16 }),
        });
        btn.connect('clicked', cb);
        return btn;
    }

    _sync() {
        this._titleLabel.text  = this._mpris.getTitle()  || 'Nothing playing';
        this._artistLabel.text = this._mpris.getArtist() || '';
        this._playBtn.child.icon_name = this._mpris.isPlaying()
            ? 'media-playback-pause-symbolic'
            : 'media-playback-start-symbolic';
        this._prevBtn.reactive = this._mpris.canGoPrevious();
        this._nextBtn.reactive = this._mpris.canGoNext();
    }
});

// ─── Separator ────────────────────────────────────────────────────────────────

function makeSeparator() {
    return new St.Widget({ style_class: 'gs-separator', x_expand: true });
}

// ─── SwitchIndicator ─────────────────────────────────────────────────────────

export const SwitchIndicator = GObject.registerClass(
class SwitchIndicator extends PanelMenu.Button {
    _init(extensionPath, extSettings, ctrl, mpris) {
        super._init(0.0, 'Switch', false);

        this._ctrl        = ctrl;
        this._mpris       = mpris;
        this._extSettings = extSettings;

        // Panel icon
        const gicon = Gio.icon_new_for_string(
            GLib.build_filenamev([extensionPath, 'icons', 'switch-symbolic.svg']));
        this.add_child(new St.Icon({
            gicon,
            style_class: 'system-status-icon',
        }));

        _applyAccentCss(_accentColorFor(ctrl._iface));
        this._buildMenu();

        // Rebuild when settings change
        this._settingsId = extSettings.connect('changed', () => this._rebuildMenu());

        // Re-apply accent + rebuild when GTK theme changes
        this._themeId = ctrl._iface.connect('changed::gtk-theme', () => {
            _applyAccentCss(_accentColorFor(ctrl._iface));
            this._rebuildMenu();
        });

        // Rebuild MPRIS strip visibility when player state changes
        this._mprisId = mpris.connect('changed', () => this._syncMprisVisibility());
    }

    _buildMenu() {
        // Clear existing content
        this.menu.removeAll();

        const item = new PopupMenu.PopupBaseMenuItem({
            reactive: false,
            can_focus: false,
            style_class: 'gs-menu-item',
        });

        const container = new St.BoxLayout({
            vertical: true,
            style_class: 'gs-container',
            x_expand: true,
        });
        item.add_child(container);
        this.menu.addMenuItem(item);

        // ── Tile grid ───────────────────────────────────────────────────────
        const allDefs = getSwitchDefs(this._ctrl);
        const visible = this._extSettings.get_strv('visible-switches');
        const columns = this._extSettings.get_int('columns');

        const defs = visible
            .map(id => allDefs.find(d => d.id === id))
            .filter(d => d && (d.isAvailable ? d.isAvailable() : true));

        if (defs.length > 0) {
            const gridWidget = new St.Widget({
                style_class: 'gs-grid',
                x_expand: true,
                layout_manager: new Clutter.GridLayout({
                    orientation: Clutter.Orientation.HORIZONTAL,
                    column_spacing: 6,
                    row_spacing: 6,
                    column_homogeneous: true,
                }),
            });
            const layout = gridWidget.layout_manager;

            defs.forEach((def, i) => {
                const tile = new SwitchTile(def);
                layout.attach(tile, i % columns, Math.floor(i / columns), 1, 1);
            });

            container.add_child(gridWidget);
        }

        // ── Sliders ─────────────────────────────────────────────────────────
        const showLabels   = this._extSettings.get_boolean('show-value-labels');
        const sliderDefs   = getSliderDefs(this._ctrl)
            .filter(d => d.isAvailable ? d.isAvailable() : true);

        if (sliderDefs.length > 0) {
            container.add_child(makeSeparator());
            const sliderBox = new St.BoxLayout({
                vertical: true,
                style_class: 'gs-sliders',
                x_expand: true,
            });
            for (const def of sliderDefs)
                sliderBox.add_child(new SliderRow(def, showLabels));
            container.add_child(sliderBox);
        }

        // ── Power mode ──────────────────────────────────────────────────────
        if (this._ctrl.hasPowerProfiles()) {
            container.add_child(makeSeparator());
            container.add_child(new PowerModeRow(this._ctrl));
        }

        // ── MPRIS strip ─────────────────────────────────────────────────────
        container.add_child(makeSeparator());
        this._mprisStrip = new MprisStrip(this._mpris);
        container.add_child(this._mprisStrip);
        this._syncMprisVisibility();
    }

    _rebuildMenu() {
        this._buildMenu();
    }

    _syncMprisVisibility() {
        if (this._mprisStrip)
            this._mprisStrip.visible = this._mpris.hasPlayer();
    }

    _onDestroy() {
        if (this._settingsId) {
            this._extSettings.disconnect(this._settingsId);
            this._settingsId = null;
        }
        if (this._themeId) {
            this._ctrl._iface.disconnect(this._themeId);
            this._themeId = null;
        }
        if (this._mprisId) {
            this._mpris.disconnect(this._mprisId);
            this._mprisId = null;
        }
        _clearAccentCss();
        super._onDestroy();
    }
});
