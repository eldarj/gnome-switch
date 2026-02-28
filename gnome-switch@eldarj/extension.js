/*
 * extension.js — entry point
 */

import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { SwitchController } from './switches.js';
import { MprisController }  from './mpris.js';
import { SwitchIndicator }  from './panel.js';

export default class GnomeSwitchExtension extends Extension {
    enable() {
        this._ctrl  = new SwitchController();
        this._mpris = new MprisController();
        this._indicator = new SwitchIndicator(
            this.path,
            this.getSettings(),
            this._ctrl,
            this._mpris,
            this);
        Main.panel.addToStatusArea('gnome-switch', this._indicator);
    }

    disable() {
        this._indicator?.destroy();
        this._indicator = null;

        this._mpris?.destroy();
        this._mpris = null;

        this._ctrl?.destroy();
        this._ctrl = null;
    }
}
