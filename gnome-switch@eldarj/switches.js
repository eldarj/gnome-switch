/*
 * switches.js — SwitchController and all switch/slider definitions
 *
 * SwitchController owns every GSettings object and D-Bus proxy used by the
 * panel.  Create one instance on extension enable, pass it to the panel, and
 * call destroy() on disable.
 */

import GObject from 'gi://GObject';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gvc from 'gi://Gvc';

// ─── D-Bus proxy interfaces ───────────────────────────────────────────────────

const RfkillProxy = Gio.DBusProxy.makeProxyWrapper(`
<node>
  <interface name="org.gnome.SettingsDaemon.Rfkill">
    <property name="AirplaneMode"                  type="b" access="readwrite"/>
    <property name="HardwareAirplaneMode"           type="b" access="read"/>
    <property name="BluetoothAirplaneMode"         type="b" access="readwrite"/>
    <property name="BluetoothHardwareAirplaneMode" type="b" access="read"/>
  </interface>
</node>`);

const NMProxy = Gio.DBusProxy.makeProxyWrapper(`
<node>
  <interface name="org.freedesktop.NetworkManager">
    <property name="WirelessEnabled"         type="b"  access="readwrite"/>
    <property name="WirelessHardwareEnabled" type="b"  access="read"/>
    <property name="ActiveConnections"       type="ao" access="read"/>
  </interface>
</node>`);

const NMActiveConnProxy = Gio.DBusProxy.makeProxyWrapper(`
<node>
  <interface name="org.freedesktop.NetworkManager.Connection.Active">
    <property name="Type"       type="s" access="read"/>
    <property name="Connection" type="o" access="read"/>
  </interface>
</node>`);

const NMSettingsProxy = Gio.DBusProxy.makeProxyWrapper(`
<node>
  <interface name="org.freedesktop.NetworkManager.Settings">
    <method name="ListConnections">
      <arg name="connections" type="ao" direction="out"/>
    </method>
  </interface>
</node>`);

const NMConnSettingsProxy = Gio.DBusProxy.makeProxyWrapper(`
<node>
  <interface name="org.freedesktop.NetworkManager.Settings.Connection">
    <method name="GetSettings">
      <arg name="settings" type="a{sa{sv}}" direction="out"/>
    </method>
  </interface>
</node>`);

const BrightnessProxy = Gio.DBusProxy.makeProxyWrapper(`
<node>
  <interface name="org.gnome.SettingsDaemon.Power.Screen">
    <property name="Brightness" type="i" access="readwrite"/>
  </interface>
</node>`);

const PowerProfilesProxy = Gio.DBusProxy.makeProxyWrapper(`
<node>
  <interface name="net.hadess.PowerProfiles">
    <property name="ActiveProfile" type="s"     access="readwrite"/>
    <property name="Profiles"      type="aa{sv}" access="read"/>
  </interface>
</node>`);

const KbdBacklightProxy = Gio.DBusProxy.makeProxyWrapper(`
<node>
  <interface name="org.freedesktop.UPower.KbdBacklight">
    <method name="GetBrightness">
      <arg name="value" type="i" direction="out"/>
    </method>
    <method name="GetMaxBrightness">
      <arg name="value" type="i" direction="out"/>
    </method>
    <method name="SetBrightness">
      <arg name="value" type="i" direction="in"/>
    </method>
    <signal name="BrightnessChanged">
      <arg name="value" type="i"/>
    </signal>
  </interface>
</node>`);

// ─── SwitchController ─────────────────────────────────────────────────────────

export const SwitchController = GObject.registerClass({
    Signals: {
        'rfkill-changed':    {},
        'wifi-changed':      {},
        'volume-changed':    {},
        'mic-changed':       {},
        'brightness-changed': {},
        'power-profile-changed': {},
        'kbd-backlight-changed': {},
        'vpn-changed':       {},
    },
}, class SwitchController extends GObject.Object {

    _init() {
        super._init();

        // ── GSettings ──────────────────────────────────────────────────────
        this._iface     = new Gio.Settings({ schema_id: 'org.gnome.desktop.interface' });
        this._nlSettings = new Gio.Settings({ schema_id: 'org.gnome.settings-daemon.plugins.color' });
        this._a11yApps  = new Gio.Settings({ schema_id: 'org.gnome.desktop.a11y.applications' });
        this._a11yIface = new Gio.Settings({ schema_id: 'org.gnome.desktop.a11y.interface' });
        this._notifs    = new Gio.Settings({ schema_id: 'org.gnome.desktop.notifications' });
        this._screensaver = new Gio.Settings({ schema_id: 'org.gnome.desktop.screensaver' });
        this._touchpad  = new Gio.Settings({ schema_id: 'org.gnome.desktop.peripherals.touchpad' });
        this._location  = new Gio.Settings({ schema_id: 'org.gnome.system.location' });
        this._power     = new Gio.Settings({ schema_id: 'org.gnome.settings-daemon.plugins.power' });

        // ── D-Bus proxies (async) ──────────────────────────────────────────
        this._rfkill       = null;
        this._nm           = null;
        this._brightness   = null;
        this._powerProfiles = null;
        this._kbdBacklight = null;
        this._kbdMax       = 1;
        this._kbdBacklightSignal = null;

        // ── Keep-awake state ───────────────────────────────────────────────
        this._inhibitCookie = null;

        // ── VPN state cache ────────────────────────────────────────────────
        this._vpnActive     = false;
        this._vpnConnPath   = null; // first VPN connection profile path
        this._vpnActiveConn = null; // active VPN connection object path

        // ── Gvc mixer ─────────────────────────────────────────────────────
        this._mixer      = new Gvc.MixerControl({ name: 'gnome-switch' });
        this._mixerReady = false;
        this._mixer.connect('state-changed', (_m, state) => {
            if (state === Gvc.MixerControlState.READY) {
                this._mixerReady = true;
                this._mixer.connect('default-sink-changed',   () => this.emit('volume-changed'));
                this._mixer.connect('default-source-changed', () => this.emit('mic-changed'));
                this._mixer.connect('stream-added',           () => this.emit('volume-changed'));
                this.emit('volume-changed');
            }
        });
        this._mixer.open();

        this._initProxies();
    }

    _initProxies() {
        // Rfkill (Bluetooth + Airplane mode)
        new RfkillProxy(Gio.DBus.session,
            'org.gnome.SettingsDaemon.Rfkill',
            '/org/gnome/SettingsDaemon/Rfkill',
            (proxy, err) => {
                if (err) { console.log('gnome-switch: rfkill unavailable:', err.message); return; }
                this._rfkill = proxy;
                this._rfkill.connect('g-properties-changed', () => this.emit('rfkill-changed'));
                this.emit('rfkill-changed');
            });

        // NetworkManager
        new NMProxy(Gio.DBus.system,
            'org.freedesktop.NetworkManager',
            '/org/freedesktop/NetworkManager',
            (proxy, err) => {
                if (err) { console.log('gnome-switch: NM unavailable:', err.message); return; }
                this._nm = proxy;
                this._nm.connect('g-properties-changed', (_p, changed) => {
                    const ch = changed.deep_unpack();
                    if ('WirelessEnabled' in ch)    this.emit('wifi-changed');
                    if ('ActiveConnections' in ch)  this._refreshVpn();
                });
                this._refreshVpn();
                this.emit('wifi-changed');
            });

        // Brightness (only on laptops with backlight)
        new BrightnessProxy(Gio.DBus.session,
            'org.gnome.SettingsDaemon.Power',
            '/org/gnome/SettingsDaemon/Power',
            (proxy, err) => {
                if (err) return;
                this._brightness = proxy;
                this._brightness.connect('g-properties-changed', () => this.emit('brightness-changed'));
                this.emit('brightness-changed');
            });

        // Power profiles daemon
        new PowerProfilesProxy(Gio.DBus.system,
            'net.hadess.PowerProfiles',
            '/net/hadess/PowerProfiles',
            (proxy, err) => {
                if (err) { console.log('gnome-switch: power-profiles unavailable'); return; }
                this._powerProfiles = proxy;
                this._powerProfiles.connect('g-properties-changed', () => this.emit('power-profile-changed'));
                this.emit('power-profile-changed');
            });

        // Keyboard backlight
        new KbdBacklightProxy(Gio.DBus.system,
            'org.freedesktop.UPower',
            '/org/freedesktop/UPower/KbdBacklight',
            (proxy, err) => {
                if (err) return;
                this._kbdBacklight = proxy;
                try {
                    this._kbdMax = this._kbdBacklight.GetMaxBrightnessSync()[0] || 1;
                } catch (_) { this._kbdMax = 1; }
                this._kbdBacklightSignal = this._kbdBacklight.connectSignal('BrightnessChanged',
                    () => this.emit('kbd-backlight-changed'));
                this.emit('kbd-backlight-changed');
            });
    }

    // ── VPN helpers ───────────────────────────────────────────────────────────

    _refreshVpn() {
        if (!this._nm) return;
        const activeConns = this._nm.ActiveConnections;
        if (!activeConns || !activeConns.length) {
            this._vpnActive = false;
            this._vpnActiveConn = null;
            this.emit('vpn-changed');
            return;
        }
        let found = false;
        let pending = activeConns.length;
        const done = () => { if (--pending === 0) this.emit('vpn-changed'); };
        for (const path of activeConns) {
            new NMActiveConnProxy(Gio.DBus.system,
                'org.freedesktop.NetworkManager', path,
                (proxy, err) => {
                    if (!err && proxy.Type === 'vpn') {
                        this._vpnActive    = true;
                        this._vpnActiveConn = path;
                        found = true;
                    }
                    done();
                });
        }
        if (!found) {
            this._vpnActive    = false;
            this._vpnActiveConn = null;
        }
    }

    _findFirstVpnConnection(callback) {
        new NMSettingsProxy(Gio.DBus.system,
            'org.freedesktop.NetworkManager',
            '/org/freedesktop/NetworkManager/Settings',
            (proxy, err) => {
                if (err) { callback(null); return; }
                proxy.ListConnectionsRemote((result, _err) => {
                    if (_err || !result[0]?.length) { callback(null); return; }
                    const paths = result[0];
                    let i = 0;
                    const tryNext = () => {
                        if (i >= paths.length) { callback(null); return; }
                        const p = paths[i++];
                        new NMConnSettingsProxy(Gio.DBus.system,
                            'org.freedesktop.NetworkManager', p,
                            (cp, cerr) => {
                                if (cerr) { tryNext(); return; }
                                cp.GetSettingsRemote((s, serr) => {
                                    if (!serr && s[0]?.connection?.type?.unpack() === 'vpn')
                                        callback(p);
                                    else
                                        tryNext();
                                });
                            });
                    };
                    tryNext();
                });
            });
    }

    // ── Dark mode ─────────────────────────────────────────────────────────────
    isDarkMode()     { return this._iface.get_string('color-scheme') === 'prefer-dark'; }
    toggleDarkMode() {
        this._iface.set_string('color-scheme', this.isDarkMode() ? 'default' : 'prefer-dark');
    }
    watchDarkMode(cb) {
        const id = this._iface.connect('changed::color-scheme', cb);
        return () => this._iface.disconnect(id);
    }

    // ── Night light ───────────────────────────────────────────────────────────
    isNightLight()     { return this._nlSettings.get_boolean('night-light-enabled'); }
    toggleNightLight() { this._nlSettings.set_boolean('night-light-enabled', !this.isNightLight()); }
    watchNightLight(cb) {
        const id = this._nlSettings.connect('changed::night-light-enabled', cb);
        return () => this._nlSettings.disconnect(id);
    }

    // ── Night light temperature (slider 1700–4700 K, stored 1000–10000) ───────
    getNightLightTemp()      { return this._nlSettings.get_uint('night-light-temperature'); }
    setNightLightTemp(value) { this._nlSettings.set_uint('night-light-temperature', value); }
    watchNightLightTemp(cb) {
        const id = this._nlSettings.connect('changed::night-light-temperature', cb);
        return () => this._nlSettings.disconnect(id);
    }

    // ── High contrast ─────────────────────────────────────────────────────────
    isHighContrast()     { return this._a11yIface.get_boolean('high-contrast'); }
    toggleHighContrast() { this._a11yIface.set_boolean('high-contrast', !this.isHighContrast()); }
    watchHighContrast(cb) {
        const id = this._a11yIface.connect('changed::high-contrast', cb);
        return () => this._a11yIface.disconnect(id);
    }

    // ── Reduce animations ─────────────────────────────────────────────────────
    isReduceAnimations()     { return !this._iface.get_boolean('enable-animations'); }
    toggleReduceAnimations() { this._iface.set_boolean('enable-animations', !this._iface.get_boolean('enable-animations')); }
    watchReduceAnimations(cb) {
        const id = this._iface.connect('changed::enable-animations', cb);
        return () => this._iface.disconnect(id);
    }

    // ── Hot corners ───────────────────────────────────────────────────────────
    isHotCorners()     { return this._iface.get_boolean('enable-hot-corners'); }
    toggleHotCorners() { this._iface.set_boolean('enable-hot-corners', !this.isHotCorners()); }
    watchHotCorners(cb) {
        const id = this._iface.connect('changed::enable-hot-corners', cb);
        return () => this._iface.disconnect(id);
    }

    // ── Output mute ───────────────────────────────────────────────────────────
    isOutputMuted() {
        if (!this._mixerReady) return false;
        return this._mixer.get_default_sink()?.get_is_muted() ?? false;
    }
    toggleOutputMute() {
        if (!this._mixerReady) return;
        const sink = this._mixer.get_default_sink();
        if (sink) sink.change_is_muted(!sink.get_is_muted());
    }

    // ── Mic mute ──────────────────────────────────────────────────────────────
    isMicMuted() {
        if (!this._mixerReady) return false;
        return this._mixer.get_default_source()?.get_is_muted() ?? false;
    }
    toggleMicMute() {
        if (!this._mixerReady) return;
        const src = this._mixer.get_default_source();
        if (src) src.change_is_muted(!src.get_is_muted());
    }

    // ── Volume (0–1) ──────────────────────────────────────────────────────────
    getVolume() {
        if (!this._mixerReady) return 0;
        const sink = this._mixer.get_default_sink();
        if (!sink) return 0;
        return sink.get_volume() / this._mixer.get_vol_max_norm();
    }
    setVolume(v) {
        if (!this._mixerReady) return;
        const sink = this._mixer.get_default_sink();
        if (!sink) return;
        sink.set_volume(v * this._mixer.get_vol_max_norm());
        sink.push_volume();
    }

    // ── WiFi ──────────────────────────────────────────────────────────────────
    isWifi()     { return this._nm?.WirelessEnabled ?? false; }
    isWifiHardwareEnabled() { return this._nm?.WirelessHardwareEnabled ?? true; }
    toggleWifi() {
        if (!this._nm || !this.isWifiHardwareEnabled()) return;
        this._nm.WirelessEnabled = !this._nm.WirelessEnabled;
    }

    // ── Bluetooth ─────────────────────────────────────────────────────────────
    isBluetooth() { return !(this._rfkill?.BluetoothAirplaneMode ?? true); }
    isBluetoothHardwareEnabled() { return !(this._rfkill?.BluetoothHardwareAirplaneMode ?? false); }
    toggleBluetooth() {
        if (!this._rfkill || !this.isBluetoothHardwareEnabled()) return;
        this._rfkill.BluetoothAirplaneMode = this.isBluetooth();
    }

    // ── Airplane mode ─────────────────────────────────────────────────────────
    isAirplaneMode()     { return this._rfkill?.AirplaneMode ?? false; }
    isAirplaneHardware() { return this._rfkill?.HardwareAirplaneMode ?? false; }
    toggleAirplaneMode() {
        if (!this._rfkill || this.isAirplaneHardware()) return;
        this._rfkill.AirplaneMode = !this._rfkill.AirplaneMode;
    }

    // ── VPN ───────────────────────────────────────────────────────────────────
    isVpn() { return this._vpnActive; }
    toggleVpn() {
        if (!this._nm) return;
        if (this._vpnActive && this._vpnActiveConn) {
            this._nm.DeactivateConnectionRemote(this._vpnActiveConn, () => this._refreshVpn());
        } else {
            this._findFirstVpnConnection(path => {
                if (!path) return;
                this._nm.ActivateConnectionRemote(path, '/', '/',
                    () => { GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1500, () => { this._refreshVpn(); return GLib.SOURCE_REMOVE; }); });
            });
        }
    }

    // ── Location ──────────────────────────────────────────────────────────────
    isLocation()     { return this._location.get_boolean('enabled'); }
    toggleLocation() { this._location.set_boolean('enabled', !this.isLocation()); }
    watchLocation(cb) {
        const id = this._location.connect('changed::enabled', cb);
        return () => this._location.disconnect(id);
    }

    // ── Keep awake ────────────────────────────────────────────────────────────
    isKeepAwake() { return this._inhibitCookie !== null; }
    toggleKeepAwake() {
        if (this.isKeepAwake()) {
            Gio.DBus.session.call(
                'org.gnome.SessionManager', '/org/gnome/SessionManager',
                'org.gnome.SessionManager', 'Uninhibit',
                new GLib.Variant('(u)', [this._inhibitCookie]),
                null, Gio.DBusCallFlags.NONE, -1, null, null);
            this._inhibitCookie = null;
        } else {
            Gio.DBus.session.call(
                'org.gnome.SessionManager', '/org/gnome/SessionManager',
                'org.gnome.SessionManager', 'Inhibit',
                new GLib.Variant('(susu)', ['gnome-switch@eldarj', 0, 'Keep Awake', 12]),
                GLib.VariantType.new('(u)'),
                Gio.DBusCallFlags.NONE, -1, null,
                (conn, res) => {
                    try {
                        const reply = Gio.DBus.session.call_finish(res);
                        this._inhibitCookie = reply.get_child_value(0).get_uint32();
                    } catch (e) {
                        console.log('gnome-switch: inhibit failed:', e.message);
                    }
                });
        }
    }

    // ── Auto suspend ──────────────────────────────────────────────────────────
    isAutoSuspend() { return this._power.get_string('sleep-inactive-ac-type') === 'suspend'; }
    toggleAutoSuspend() {
        const next = this.isAutoSuspend() ? 'nothing' : 'suspend';
        this._power.set_string('sleep-inactive-ac-type', next);
        this._power.set_string('sleep-inactive-battery-type', next);
    }
    watchAutoSuspend(cb) {
        const id = this._power.connect('changed::sleep-inactive-ac-type', cb);
        return () => this._power.disconnect(id);
    }

    // ── DND ───────────────────────────────────────────────────────────────────
    isDnd()     { return !this._notifs.get_boolean('show-banners'); }
    toggleDnd() { this._notifs.set_boolean('show-banners', !this._notifs.get_boolean('show-banners')); }
    watchDnd(cb) {
        const id = this._notifs.connect('changed::show-banners', cb);
        return () => this._notifs.disconnect(id);
    }

    // ── Screen lock ───────────────────────────────────────────────────────────
    isScreenLock()     { return this._screensaver.get_boolean('lock-enabled'); }
    toggleScreenLock() { this._screensaver.set_boolean('lock-enabled', !this.isScreenLock()); }
    watchScreenLock(cb) {
        const id = this._screensaver.connect('changed::lock-enabled', cb);
        return () => this._screensaver.disconnect(id);
    }

    // ── Lock now ──────────────────────────────────────────────────────────────
    lockNow() {
        Gio.DBus.session.call(
            'org.gnome.ScreenSaver', '/org/gnome/ScreenSaver',
            'org.gnome.ScreenSaver', 'Lock',
            null, null, Gio.DBusCallFlags.NONE, -1, null, null);
    }

    // ── Touchpad ──────────────────────────────────────────────────────────────
    isTouchpad()     { return this._touchpad.get_string('send-events') === 'enabled'; }
    toggleTouchpad() {
        this._touchpad.set_string('send-events',
            this.isTouchpad() ? 'disabled' : 'enabled');
    }
    watchTouchpad(cb) {
        const id = this._touchpad.connect('changed::send-events', cb);
        return () => this._touchpad.disconnect(id);
    }

    // ── Magnifier ─────────────────────────────────────────────────────────────
    isMagnifier()     { return this._a11yApps.get_boolean('screen-magnifier-enabled'); }
    toggleMagnifier() { this._a11yApps.set_boolean('screen-magnifier-enabled', !this.isMagnifier()); }
    watchMagnifier(cb) {
        const id = this._a11yApps.connect('changed::screen-magnifier-enabled', cb);
        return () => this._a11yApps.disconnect(id);
    }

    // ── Large text ────────────────────────────────────────────────────────────
    isLargeText()     { return this._iface.get_double('text-scaling-factor') >= 1.25; }
    toggleLargeText() {
        this._iface.set_double('text-scaling-factor', this.isLargeText() ? 1.0 : 1.25);
    }
    watchLargeText(cb) {
        const id = this._iface.connect('changed::text-scaling-factor', cb);
        return () => this._iface.disconnect(id);
    }

    // ── Brightness (0–1, -1 if unavailable) ──────────────────────────────────
    hasBrightness()  { return this._brightness !== null; }
    getBrightness()  { return this._brightness ? this._brightness.Brightness / 100 : -1; }
    setBrightness(v) {
        if (!this._brightness) return;
        const val = Math.round(v * 100);
        this._brightness.g_connection.call(
            'org.gnome.SettingsDaemon.Power',
            '/org/gnome/SettingsDaemon/Power',
            'org.freedesktop.DBus.Properties', 'Set',
            new GLib.Variant('(ssv)', [
                'org.gnome.SettingsDaemon.Power.Screen',
                'Brightness',
                new GLib.Variant('i', val),
            ]),
            null, Gio.DBusCallFlags.NONE, -1, null, null);
    }

    // ── Keyboard backlight (0–1, -1 if unavailable) ───────────────────────────
    hasKbdBacklight() { return this._kbdBacklight !== null; }
    getKbdBacklight() {
        if (!this._kbdBacklight) return -1;
        try {
            return this._kbdBacklight.GetBrightnessSync()[0] / this._kbdMax;
        } catch (_) { return -1; }
    }
    setKbdBacklight(v) {
        if (!this._kbdBacklight) return;
        try {
            this._kbdBacklight.SetBrightnessSync(Math.round(v * this._kbdMax));
        } catch (e) {
            console.log('gnome-switch: kbd backlight set failed:', e.message);
        }
    }

    // ── Power profile ─────────────────────────────────────────────────────────
    hasPowerProfiles()  { return this._powerProfiles !== null; }
    getPowerProfile()   { return this._powerProfiles?.ActiveProfile ?? 'balanced'; }
    setPowerProfile(p)  { if (this._powerProfiles) this._powerProfiles.ActiveProfile = p; }
    getPowerProfiles()  {
        if (!this._powerProfiles) return ['balanced'];
        const raw = this._powerProfiles.Profiles;
        if (!raw) return ['balanced'];
        return raw.map(p => p['Profile']?.unpack() ?? '').filter(Boolean);
    }

    // ── Cleanup ───────────────────────────────────────────────────────────────
    destroy() {
        if (this._inhibitCookie !== null) {
            Gio.DBus.session.call(
                'org.gnome.SessionManager', '/org/gnome/SessionManager',
                'org.gnome.SessionManager', 'Uninhibit',
                new GLib.Variant('(u)', [this._inhibitCookie]),
                null, Gio.DBusCallFlags.NONE, -1, null, null);
            this._inhibitCookie = null;
        }
        if (this._kbdBacklightSignal && this._kbdBacklight) {
            this._kbdBacklight.disconnectSignal(this._kbdBacklightSignal);
            this._kbdBacklightSignal = null;
        }
        this._mixer.close();
    }
});

// ─── Switch definitions ───────────────────────────────────────────────────────
//
// Each entry describes one tile in the grid.
// type: 'toggle' | 'action'
// watchSettings: optional — returns an unsubscribe function for external changes.
// isAvailable: optional — if returns false the tile is hidden.

export function getSwitchDefs(ctrl) {
    return [
        {
            id: 'dark-mode', label: 'Dark Mode', subtitle: 'Color scheme preference',
            icon: 'weather-clear-night-symbolic',
            section: 'display', type: 'toggle',
            isActive: () => ctrl.isDarkMode(),
            toggle:   () => ctrl.toggleDarkMode(),
            watch:    cb  => ctrl.watchDarkMode(cb),
        },
        {
            id: 'night-light', label: 'Night Light', subtitle: 'Warmer colors in the evening',
            icon: 'night-light-symbolic',
            section: 'display', type: 'toggle',
            isActive: () => ctrl.isNightLight(),
            toggle:   () => ctrl.toggleNightLight(),
            watch:    cb  => ctrl.watchNightLight(cb),
        },
        {
            id: 'high-contrast', label: 'High Contrast', subtitle: 'Accessibility display mode',
            icon: 'display-brightness-symbolic',
            section: 'display', type: 'toggle',
            isActive: () => ctrl.isHighContrast(),
            toggle:   () => ctrl.toggleHighContrast(),
            watch:    cb  => ctrl.watchHighContrast(cb),
        },
        {
            id: 'reduce-animations', label: 'No Animations', subtitle: 'Disable motion effects',
            icon: 'media-skip-forward-symbolic',
            section: 'display', type: 'toggle',
            isActive: () => ctrl.isReduceAnimations(),
            toggle:   () => ctrl.toggleReduceAnimations(),
            watch:    cb  => ctrl.watchReduceAnimations(cb),
        },
        {
            id: 'hot-corners', label: 'Hot Corners', subtitle: 'Gesture to open overview',
            icon: 'zoom-in-symbolic',
            section: 'display', type: 'toggle',
            isActive: () => ctrl.isHotCorners(),
            toggle:   () => ctrl.toggleHotCorners(),
            watch:    cb  => ctrl.watchHotCorners(cb),
        },
        {
            id: 'output-mute', label: 'Mute', subtitle: 'System audio output',
            icon: 'audio-volume-muted-symbolic',
            section: 'sound', type: 'toggle',
            isActive: () => ctrl.isOutputMuted(),
            toggle:   () => ctrl.toggleOutputMute(),
            watch:    cb  => { const id = ctrl.connect('volume-changed', cb); return () => ctrl.disconnect(id); },
        },
        {
            id: 'mic-mute', label: 'Mic Off', subtitle: 'Microphone input',
            icon: 'microphone-sensitivity-muted-symbolic',
            section: 'sound', type: 'toggle',
            isActive: () => ctrl.isMicMuted(),
            toggle:   () => ctrl.toggleMicMute(),
            watch:    cb  => { const id = ctrl.connect('mic-changed', cb); return () => ctrl.disconnect(id); },
        },
        {
            id: 'wifi', label: 'Wi-Fi', subtitle: 'Wireless networking',
            icon: 'network-wireless-symbolic',
            section: 'connectivity', type: 'toggle',
            isActive:    () => ctrl.isWifi(),
            toggle:      () => ctrl.toggleWifi(),
            watch:       cb  => { const id = ctrl.connect('wifi-changed', cb); return () => ctrl.disconnect(id); },
            isAvailable: () => ctrl._nm !== null,
        },
        {
            id: 'bluetooth', label: 'Bluetooth', subtitle: 'Nearby devices',
            icon: 'bluetooth-active-symbolic',
            section: 'connectivity', type: 'toggle',
            isActive:    () => ctrl.isBluetooth(),
            toggle:      () => ctrl.toggleBluetooth(),
            watch:       cb  => { const id = ctrl.connect('rfkill-changed', cb); return () => ctrl.disconnect(id); },
            isAvailable: () => ctrl._rfkill !== null,
        },
        {
            id: 'airplane-mode', label: 'Airplane Mode', subtitle: 'Disable all radios',
            icon: 'airplane-mode-symbolic',
            section: 'connectivity', type: 'toggle',
            isActive:    () => ctrl.isAirplaneMode(),
            toggle:      () => ctrl.toggleAirplaneMode(),
            watch:       cb  => { const id = ctrl.connect('rfkill-changed', cb); return () => ctrl.disconnect(id); },
            isAvailable: () => ctrl._rfkill !== null,
        },
        {
            id: 'vpn', label: 'VPN', subtitle: 'Virtual private network',
            icon: 'network-vpn-symbolic',
            section: 'connectivity', type: 'toggle',
            isActive: () => ctrl.isVpn(),
            toggle:   () => ctrl.toggleVpn(),
            watch:    cb  => { const id = ctrl.connect('vpn-changed', cb); return () => ctrl.disconnect(id); },
        },
        {
            id: 'location', label: 'Location', subtitle: 'Location services',
            icon: 'find-location-symbolic',
            section: 'connectivity', type: 'toggle',
            isActive: () => ctrl.isLocation(),
            toggle:   () => ctrl.toggleLocation(),
            watch:    cb  => ctrl.watchLocation(cb),
        },
        {
            id: 'keep-awake', label: 'Keep Awake', subtitle: 'Prevent screen sleep',
            icon: 'my-computer-symbolic',
            section: 'power', type: 'toggle',
            isActive: () => ctrl.isKeepAwake(),
            toggle:   () => { ctrl.toggleKeepAwake(); },
            watch:    _cb => () => {},
        },
        {
            id: 'auto-suspend', label: 'Auto Sleep', subtitle: 'Automatic suspend',
            icon: 'system-suspend-symbolic',
            section: 'power', type: 'toggle',
            isActive: () => ctrl.isAutoSuspend(),
            toggle:   () => ctrl.toggleAutoSuspend(),
            watch:    cb  => ctrl.watchAutoSuspend(cb),
        },
        {
            id: 'keyboard-backlight', label: 'Kbd Light', subtitle: 'Keyboard illumination',
            icon: 'input-keyboard-symbolic',
            section: 'power', type: 'toggle',
            isActive:    () => ctrl.getKbdBacklight() > 0,
            toggle:      () => ctrl.setKbdBacklight(ctrl.getKbdBacklight() > 0 ? 0 : 1),
            watch:       cb  => { const id = ctrl.connect('kbd-backlight-changed', cb); return () => ctrl.disconnect(id); },
            isAvailable: () => ctrl.hasKbdBacklight(),
        },
        {
            id: 'dnd', label: 'Do Not Disturb', subtitle: 'Mute all notifications',
            icon: 'notifications-disabled-symbolic',
            section: 'privacy', type: 'toggle',
            isActive: () => ctrl.isDnd(),
            toggle:   () => ctrl.toggleDnd(),
            watch:    cb  => ctrl.watchDnd(cb),
        },
        {
            id: 'screen-lock', label: 'Screen Lock', subtitle: 'Automatic screen lock',
            icon: 'changes-prevent-symbolic',
            section: 'privacy', type: 'toggle',
            isActive: () => ctrl.isScreenLock(),
            toggle:   () => ctrl.toggleScreenLock(),
            watch:    cb  => ctrl.watchScreenLock(cb),
        },
        {
            id: 'lock-now', label: 'Lock Now', subtitle: 'Lock screen immediately',
            icon: 'system-lock-screen-symbolic',
            section: 'privacy', type: 'action',
            isActive: () => false,
            toggle:   () => ctrl.lockNow(),
            watch:    _cb => () => {},
        },
        {
            id: 'touchpad', label: 'Touchpad', subtitle: 'Built-in trackpad',
            icon: 'input-touchpad-symbolic',
            section: 'system', type: 'toggle',
            isActive: () => ctrl.isTouchpad(),
            toggle:   () => ctrl.toggleTouchpad(),
            watch:    cb  => ctrl.watchTouchpad(cb),
        },
        {
            id: 'magnifier', label: 'Magnifier', subtitle: 'Screen magnification',
            icon: 'zoom-fit-best-symbolic',
            section: 'accessibility', type: 'toggle',
            isActive: () => ctrl.isMagnifier(),
            toggle:   () => ctrl.toggleMagnifier(),
            watch:    cb  => ctrl.watchMagnifier(cb),
        },
        {
            id: 'large-text', label: 'Large Text', subtitle: 'Increase text scaling',
            icon: 'format-text-larger-symbolic',
            section: 'accessibility', type: 'toggle',
            isActive: () => ctrl.isLargeText(),
            toggle:   () => ctrl.toggleLargeText(),
            watch:    cb  => ctrl.watchLargeText(cb),
        },
    ];
}

// ─── Slider definitions ───────────────────────────────────────────────────────

export function getSliderDefs(ctrl) {
    return [
        {
            id: 'volume',
            label: 'Volume',
            subtitle: 'Audio output',
            icon: 'audio-volume-high-symbolic',
            iconMuted: 'audio-volume-muted-symbolic',
            getValue:    () => ctrl.getVolume(),
            setValue:    v  => ctrl.setVolume(v),
            isMuted:     () => ctrl.isOutputMuted(),
            watch:       cb  => { const id = ctrl.connect('volume-changed', cb); return () => ctrl.disconnect(id); },
            isAvailable: () => ctrl._mixerReady,
            min: 0, max: 1,
        },
        {
            id: 'brightness',
            label: 'Brightness',
            subtitle: 'Display backlight',
            icon: 'display-brightness-symbolic',
            getValue:    () => ctrl.getBrightness(),
            setValue:    v  => ctrl.setBrightness(v),
            watch:       cb  => { const id = ctrl.connect('brightness-changed', cb); return () => ctrl.disconnect(id); },
            isAvailable: () => ctrl.hasBrightness(),
            min: 0, max: 1,
        },
        {
            id: 'night-light-temp',
            label: 'Warmth',
            subtitle: 'Night light temperature',
            icon: 'night-light-symbolic',
            // Stored value 1700–4700 K (we use that range for UI; GSettings range is 1000–10000)
            getValue:    () => (ctrl.getNightLightTemp() - 1700) / 3000,
            setValue:    v  => ctrl.setNightLightTemp(Math.round(1700 + v * 3000)),
            watch:       cb  => ctrl.watchNightLightTemp(cb),
            isAvailable:     () => ctrl.isNightLight(),
            watchAvailability: cb => ctrl.watchNightLight(cb),
            min: 0, max: 1,
        },
        {
            id: 'kbd-backlight',
            label: 'Kbd Light',
            subtitle: 'Keyboard backlight',
            icon: 'input-keyboard-symbolic',
            getValue:    () => ctrl.getKbdBacklight(),
            setValue:    v  => ctrl.setKbdBacklight(v),
            watch:       cb  => { const id = ctrl.connect('kbd-backlight-changed', cb); return () => ctrl.disconnect(id); },
            isAvailable: () => ctrl.hasKbdBacklight(),
            min: 0, max: 1,
        },
    ];
}
