/*
 * mpris.js — MPRIS media player monitor
 *
 * Watches D-Bus for any org.mpris.MediaPlayer2.* service, tracks the active
 * (playing or paused) player, and emits 'changed' when metadata or playback
 * status updates.
 */

import GObject from 'gi://GObject';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const MPRIS_PREFIX = 'org.mpris.MediaPlayer2.';
const MPRIS_PATH   = '/org/mpris/MediaPlayer2';

const MprisPlayerProxy = Gio.DBusProxy.makeProxyWrapper(`
<node>
  <interface name="org.mpris.MediaPlayer2.Player">
    <property name="PlaybackStatus" type="s"    access="read"/>
    <property name="Metadata"       type="a{sv}" access="read"/>
    <property name="CanPlay"        type="b"    access="read"/>
    <property name="CanGoNext"      type="b"    access="read"/>
    <property name="CanGoPrevious"  type="b"    access="read"/>
    <method name="PlayPause"/>
    <method name="Next"/>
    <method name="Previous"/>
  </interface>
</node>`);

export const MprisController = GObject.registerClass({
    Signals: { 'changed': {} },
}, class MprisController extends GObject.Object {

    _init() {
        super._init();
        this._players = new Map(); // busName → proxy
        this._active  = null;
        this._watchId = 0;

        // Watch NameOwnerChanged for MPRIS services appearing / disappearing
        this._watchId = Gio.DBus.session.signal_subscribe(
            null,
            'org.freedesktop.DBus',
            'NameOwnerChanged',
            '/org/freedesktop/DBus',
            null,
            Gio.DBusSignalFlags.NONE,
            this._onNameOwnerChanged.bind(this));

        // Discover already-running players
        Gio.DBus.session.call(
            'org.freedesktop.DBus', '/org/freedesktop/DBus',
            'org.freedesktop.DBus', 'ListNames',
            null, GLib.VariantType.new('(as)'),
            Gio.DBusCallFlags.NONE, -1, null,
            (conn, res) => {
                try {
                    const names = conn.call_finish(res).get_child_value(0).deep_unpack();
                    names.filter(n => n.startsWith(MPRIS_PREFIX))
                         .forEach(n => this._addPlayer(n));
                } catch (_) {}
            });
    }

    _onNameOwnerChanged(_conn, _sender, _path, _iface, _signal, params) {
        const [name, , newOwner] = params.deep_unpack();
        if (!name.startsWith(MPRIS_PREFIX)) return;
        if (newOwner) this._addPlayer(name);
        else          this._removePlayer(name);
    }

    _addPlayer(busName) {
        if (this._players.has(busName)) return;
        new MprisPlayerProxy(Gio.DBus.session, busName, MPRIS_PATH,
            (proxy, err) => {
                if (err) return;
                this._players.set(busName, proxy);
                proxy.connect('g-properties-changed', () => this._update());
                this._update();
            });
    }

    _removePlayer(busName) {
        this._players.delete(busName);
        this._update();
    }

    _update() {
        // Prefer Playing > Paused > any
        let best = null;
        for (const p of this._players.values()) {
            const status = p.PlaybackStatus;
            if (status === 'Playing')              { best = p; break; }
            if (status === 'Paused' && !best)        best = p;
            if (!best)                               best = p;
        }
        this._active = best;
        this.emit('changed');
    }

    // ── Public API ────────────────────────────────────────────────────────────

    hasPlayer()     { return this._active !== null; }
    isPlaying()     { return this._active?.PlaybackStatus === 'Playing'; }
    canPlayPause()  { return this._active?.CanPlay ?? false; }
    canGoNext()     { return this._active?.CanGoNext ?? false; }
    canGoPrevious() { return this._active?.CanGoPrevious ?? false; }

    getTitle() {
        const meta = this._active?.Metadata;
        return meta?.['xesam:title']?.unpack() ?? '';
    }

    getArtist() {
        const meta = this._active?.Metadata;
        if (!meta) return '';
        try {
            const arr = meta['xesam:artist']?.deep_unpack();
            if (!arr) return '';
            return Array.isArray(arr) ? arr.join(', ') : String(arr);
        } catch (_) { return ''; }
    }

    playPause() { this._active?.PlayPauseRemote(() => {}); }
    next()      { this._active?.NextRemote(() => {}); }
    previous()  { this._active?.PreviousRemote(() => {}); }

    destroy() {
        if (this._watchId) {
            Gio.DBus.session.signal_unsubscribe(this._watchId);
            this._watchId = 0;
        }
        this._players.clear();
        this._active = null;
    }
});
