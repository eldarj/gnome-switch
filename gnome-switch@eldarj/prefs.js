/*
 * prefs.js — Preferences window
 *
 * Page 1 "Switches" — toggle visibility of each switch, grouped by section.
 * Page 2 "Appearance" — columns, value labels toggle.
 */

import { ExtensionPreferences, gettext as _ } from
    'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';
import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import Gio from 'gi://Gio';

// Mirror of getSwitchDefs without needing a live controller —
// just the metadata we need for prefs.
const ALL_SWITCHES = [
    // Display
    { id: 'dark-mode',         label: 'Dark Mode',        section: 'Display' },
    { id: 'night-light',       label: 'Night Light',      section: 'Display' },
    { id: 'high-contrast',     label: 'High Contrast',    section: 'Display' },
    { id: 'reduce-animations', label: 'No Animations',    section: 'Display' },
    { id: 'hot-corners',       label: 'Hot Corners',      section: 'Display' },
    // Sound
    { id: 'output-mute',       label: 'Mute',             section: 'Sound' },
    { id: 'mic-mute',          label: 'Mic Off',          section: 'Sound' },
    // Connectivity
    { id: 'wifi',              label: 'Wi-Fi',            section: 'Connectivity' },
    { id: 'bluetooth',         label: 'Bluetooth',        section: 'Connectivity' },
    { id: 'airplane-mode',     label: 'Airplane Mode',    section: 'Connectivity' },
    { id: 'vpn',               label: 'VPN',              section: 'Connectivity' },
    { id: 'location',          label: 'Location',         section: 'Connectivity' },
    // Power
    { id: 'keep-awake',        label: 'Keep Awake',       section: 'Power' },
    { id: 'auto-suspend',      label: 'Auto Sleep',       section: 'Power' },
    { id: 'keyboard-backlight', label: 'Keyboard Light',  section: 'Power' },
    // Privacy
    { id: 'dnd',               label: 'Do Not Disturb',   section: 'Privacy' },
    { id: 'screen-lock',       label: 'Screen Lock',      section: 'Privacy' },
    { id: 'lock-now',          label: 'Lock Now',         section: 'Privacy' },
    // System
    { id: 'touchpad',          label: 'Touchpad',         section: 'System' },
    // Accessibility
    { id: 'magnifier',         label: 'Magnifier',        section: 'Accessibility' },
    { id: 'large-text',        label: 'Large Text',       section: 'Accessibility' },
];

export default class GnomeSwitchPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();

        // ── Page 1: Switches ─────────────────────────────────────────────────
        const switchPage = new Adw.PreferencesPage({
            title: _('Switches'),
            icon_name: 'view-grid-symbolic',
        });
        window.add(switchPage);

        // Group switches by section
        const sections = [...new Set(ALL_SWITCHES.map(s => s.section))];
        for (const section of sections) {
            const group = new Adw.PreferencesGroup({ title: _(section) });
            switchPage.add(group);

            const switches = ALL_SWITCHES.filter(s => s.section === section);
            for (const sw of switches) {
                const row = new Adw.ActionRow({ title: _(sw.label) });
                const toggle = new Gtk.Switch({
                    active: settings.get_strv('visible-switches').includes(sw.id),
                    valign: Gtk.Align.CENTER,
                });
                toggle.connect('notify::active', () => {
                    const current = settings.get_strv('visible-switches');
                    if (toggle.active) {
                        if (!current.includes(sw.id))
                            settings.set_strv('visible-switches', [...current, sw.id]);
                    } else {
                        settings.set_strv('visible-switches',
                            current.filter(id => id !== sw.id));
                    }
                });
                // Keep toggle in sync if settings change from outside
                settings.connect('changed::visible-switches', () => {
                    toggle.active = settings.get_strv('visible-switches').includes(sw.id);
                });
                row.add_suffix(toggle);
                row.activatable_widget = toggle;
                group.add(row);
            }
        }

        // ── Page 2: Appearance ───────────────────────────────────────────────
        const appearPage = new Adw.PreferencesPage({
            title: _('Appearance'),
            icon_name: 'preferences-other-symbolic',
        });
        window.add(appearPage);

        const appearGroup = new Adw.PreferencesGroup({ title: _('Layout') });
        appearPage.add(appearGroup);

        // Columns spinner
        const colRow = new Adw.ActionRow({ title: _('Grid columns') });
        const colSpin = new Gtk.SpinButton({
            adjustment: new Gtk.Adjustment({ lower: 2, upper: 4, step_increment: 1 }),
            numeric: true,
            valign: Gtk.Align.CENTER,
        });
        colSpin.set_value(settings.get_int('columns'));
        colSpin.connect('value-changed', () => settings.set_int('columns', colSpin.get_value_as_int()));
        settings.connect('changed::columns', () => colSpin.set_value(settings.get_int('columns')));
        colRow.add_suffix(colSpin);
        colRow.activatable_widget = colSpin;
        appearGroup.add(colRow);

        // Show value labels
        const labelsRow = new Adw.ActionRow({
            title: _('Show value labels on sliders'),
        });
        const labelsSw = new Gtk.Switch({
            active: settings.get_boolean('show-value-labels'),
            valign: Gtk.Align.CENTER,
        });
        settings.bind('show-value-labels', labelsSw, 'active', Gio.SettingsBindFlags.DEFAULT);
        labelsRow.add_suffix(labelsSw);
        labelsRow.activatable_widget = labelsSw;
        appearGroup.add(labelsRow);
    }
}
