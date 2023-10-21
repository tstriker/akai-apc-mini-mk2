import {MIDIControl, toMLSB} from "./midicontrol.js";
import colors from "./colors.js";

// a mere proxy - to the 128 colors spelled out in the basic mode
export const Colors = colors;

class APCMiniMk2 {
    constructor() {
        this.connected = false;
        this.control = null;

        this._initDone = false;
        this._sysexEnabled = false;

        this._listeners = [];

        // wrap toggles so that when the value is set, we send the signal to the MIDI light
        this._states = {};

        // makes all buttons accessible by note as well as by key name
        this._defineButtons();
    }

    _defineButtons() {
        // pad keys and all buttons
        Object.values(MidiButtons).forEach(button => {
            if (button.key == "shift") {
                // solo doesn't have a light
                return;
            }

            let property = {
                get() {
                    return this._states[button.key];
                },
                set: val => {
                    if (JSON.stringify(val) == JSON.stringify(this._states[button.key])) {
                        return;
                    }

                    if (button.color == "rgb" && typeof val == "string") {
                        return this.fill([[button.note, button.note, val]]);
                    }

                    let [color, brightness] = [val, val ? 6 : 0];
                    if (Array.isArray(val)) {
                        [color, brightness] = val;
                    }

                    this._states[button.key] = val;

                    if (!this.connected) {
                        // we're not connected but we're not gonna shout about it as we already yelled on connect
                        return;
                    }

                    if (button.color == "rgb") {
                        this.control.noteOn(button.note, color, brightness);
                    } else if (button.color == "single") {
                        this.control.noteOn(button.note, val ? 127 : 0);
                    }
                },
            };

            Object.defineProperty(this, button.note, property);
            Object.defineProperty(this, button.key, property);
        });

        // faders (read-only ofc)
        Object.values(MidiCC).forEach(fader => {
            Object.defineProperty(this, fader.key, {
                get() {
                    return this._states[fader.key];
                },
            });
        });
    }

    async connect(
        options = {
            sysex: false, // set to true if you want to paint with RGB colors
        }
    ) {
        this._sysexEnabled = options.sysex;

        this.control = new MIDIControl({
            sysex: this._sysexEnabled,
            manufacturerID: 0x47,
            deviceID: 0x7f,
            modelID: 0x4f,
            deviceCheck: port => {
                return port.name.indexOf("APC mini mk2 Contr") != -1;
            },
            onMessage: message => {
                if (message.type == "sysex") {
                    if (message.messageTypeId == 0x61) {
                        message.data.forEach((fader, idx) => {
                            this._states[`fader${idx}`] = fader;
                        });
                    } else {
                        this._dispatchEvent("sysex", message);
                    }
                    return;
                }

                let button = message.type == "cc" ? MidiCC[message.note] : MidiButtons[message.note];

                if (message.type == "cc") {
                    // normalize the value and round to the 6th digit as that's far enough
                    let prev = this._states[button.key];
                    this._states[button.key] = message.value;
                    this._dispatchEvent("cc", {...message, ...button, prevVal: prev});
                } else {
                    // button press
                    this._dispatchEvent(message.type, {...message, ...button});
                }
            },
            onStateChange: event => {
                this.connected = event.port.state == "connected";
            },
        });
        await this.control.connect();

        if (options.sysex) {
            // if we have sysex enabled, sniff out the current slider states
            // this.device.out.send([0xf0, 0x47, 0x7f, 0x4f, 0x60, 0x00, 0x04, 0x41, 0x09, 0x01, 0x04, 0xf7]);
            this.control.sendSysex(0x60, [0x41, 0x09, 0x01, 0x04]);
        }

        this.reset();
    }

    reset() {
        // turn all pads off
        Object.values(MidiButtons).forEach(button => {
            this[button.key] = 0;
        });
    }

    async fill(padColors) {
        // fill

        let colorHex = (color, idx) => parseInt(color.slice(idx, idx + 2), 16);

        if (!this._sysexEnabled) {
            throw Error(
                "Setting RGB colors for pads works only when sysex is enabled. construct with `new APCMiniMK2({sysex: true})`"
            );
        }

        let batchSize = 32;
        for (let batch = 0; batch < padColors.length; batch += batchSize) {
            let message = [];
            padColors.slice(batch, batch + batchSize).forEach(([padFrom, padTo, color]) => {
                let [r, g, b] = [colorHex(color, 1), colorHex(color, 3), colorHex(color, 5)];
                message.push(padFrom, padTo, ...toMLSB(r), ...toMLSB(g), ...toMLSB(b));

                for (let j = padFrom; j <= padTo; j++) {
                    if (Array.isArray(this._states[j]) && this._states[j][1] > 6) {
                        // if the previous state has a blinker have to reset it back to zero
                        // or else the sysex message won't take effect
                        this[j] = 0;
                    }
                    this._states[j] = color;
                }
            });
            // if you blast the sysex with lotsa messages all at once it will start dropping frames
            // discussion here: https://github.com/WebAudio/web-midi-api/issues/158
            // the best you can do is not blast, but if you do blast, use setInterval/setTimeout and manage the
            // buffer yourself
            this.control.sendSysex(0x24, message);
        }
    }

    addEventListener(eventType, listener) {
        this._listeners.push([eventType, listener]);
    }

    removeEventListener(eventType, listener) {
        let idx = -1;
        this._listeners.forEach(([lType, lFunc], idx) => {
            if (lType == eventType && lFunc == listener) {
                idx = idx;
            }
        });
        if (idx != -1) {
            this._listeners.splice(idx, 1);
        }
    }

    _dispatchEvent(eventType, data) {
        /* emits a custom event with cc data */
        this._listeners.forEach(([listenerType, listener]) => {
            if (listenerType == eventType) {
                listener({...data, type: eventType});
            }
        });
    }

    async disconnect() {
        await this.reset();
        this.control.disconnect();
        Object.keys(MidiButtons).forEach(button => {
            // clean up after ourselves and reset the buttons on unload
            this[button] = false;
        });
        this.connected = false;
        this._listeners = [];
    }
}

let MidiButtons = {};

// horiz simple buttons
["volume", "pan", "send", "device", "up", "down", "left", "right"].forEach((key, idx) => {
    let note = 100 + idx;
    MidiButtons[note] = {
        note,
        color: "single",
        key,
        col: idx,
        row: 9,
    };
});

// vert simple buttons
["clipStop", "solo", "mute", "recArm", "select", "drum", "note", "stopAllClips"].forEach((key, idx) => {
    let note = 112 + idx;
    MidiButtons[note] = {
        note,
        color: "single",
        key,
        col: 9,
        row: idx,
    };
});

MidiButtons[122] = {
    note: 122,
    color: false,
    key: "shift",
    col: 9,
    row: 9,
};

for (let i = 0; i < 64; i++) {
    let x = i % 8;
    let y = 7 - (i - x) / 8;
    MidiButtons[i] = {
        note: i,
        color: "rgb",
        key: `pad${x}${y}`,
        col: x,
        row: y,
    };
}

// sliders
let MidiCC = Object.fromEntries(
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((slider, idx) => {
        return [48 + idx, {key: `fader${slider}`, type: "cc"}];
    })
);

export default APCMiniMk2;
