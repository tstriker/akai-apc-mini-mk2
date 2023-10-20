import * as midicontrol from "./midicontrol.js";
import colors from "./colors.js";

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
        Object.entries(MidiButtons).forEach(([note, button]) => {
            if (button.key == "shift") {
                // solo doesn't have a light
                return;
            }

            let property = {
                get() {
                    return this._states[note] || false;
                },
                set: async val => {
                    if (JSON.stringify(val) == JSON.stringify(this._states[note])) {
                        return;
                    }

                    if (button.color == "rgb" && typeof val == "string") {
                        if (this._sysexEnabled) {
                            return this.paint([[note, note, val]]);
                        } else {
                            throw Error(
                                "Setting RGB colors for pads works only when sysex is enabled. Call `.connect({sysex: true})`)"
                            );
                        }
                    }

                    let [color, brightness] = [val, val ? 6 : 0];
                    if (Array.isArray(val)) {
                        [color, brightness] = val;
                    }

                    this._states[note] = val;

                    if (!this.connected) {
                        // we're not connected but we're not gonna shout about it as we already yelled on connect
                        return;
                    }

                    if (button.color == "rgb") {
                        await this.control.noteOn(note, color, brightness);
                    } else if (button.color == "single") {
                        await this.control.noteOn(note, val ? 127 : 0);
                    }
                },
            };

            Object.defineProperty(this, note, property);
            Object.defineProperty(this, button.key, property);
        });

        this._onMessage = this._onMessage.bind(this);
        this._onStateChange = this._onStateChange.bind(this);
    }

    async connect(options = {}) {
        return new Promise(async resolve => {
            //let access = await navigator.requestMIDIAccess({sysex: true});
            this._sysexEnabled = options.sysex;
            let access = await navigator.requestMIDIAccess({sysex: options.sysex}); // we are not using sysex rn
            // MIDI devices that send you data.
            const inputs = access.inputs.values();

            let midiIn;
            for (let input = inputs.next(); input && !input.done; input = inputs.next()) {
                if (input.value.name.indexOf("APC mini mk2 Contr") != -1) {
                    midiIn = input.value;
                }
            }

            if (!midiIn) {
                console.error("Tried to connect to MIDI APC Mini Mk2 but didn't find one.");
                return;
            }
            midiIn.addEventListener("statechange", this._onStateChange);

            const outputs = access.outputs.values();
            let midiOut;
            for (let output = outputs.next(); output && !output.done; output = outputs.next()) {
                if (output.value.name.indexOf("APC mini mk2 Contr") != -1) {
                    midiOut = output.value;
                }
            }

            this.control = new midicontrol.Midi(midiIn, midiOut, this._onMessage);

            let tempListener = evt => {
                if (evt.port.state == "connected") {
                    midiIn.removeEventListener("statechange", tempListener);

                    Object.keys(MidiButtons).forEach(button => {
                        // reset the button lights on load
                        this[button] = false;
                    });
                    this._initDone = true;

                    resolve();
                }
            };
            midiIn.addEventListener("statechange", tempListener);
        });
    }

    async paint(padColors) {
        let colorHex = (color, idx) => parseInt(color.slice(idx, idx + 2), 16);
        let colorSept = n => this.control.toMLSB(n);

        let batchSize = 32;
        for (let batch = 0; batch < padColors.length; batch += batchSize) {
            let message = [];
            padColors.slice(batch, batch + batchSize).forEach(([padFrom, padTo, color]) => {
                let [r, g, b] = [colorHex(color, 1), colorHex(color, 3), colorHex(color, 5)];
                message.push(padFrom, padTo, ...colorSept(r), ...colorSept(g), ...colorSept(b));
            });
            await this.control.sendSysexData(0x24, message);
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

    _onMessage(message) {
        if (message.type == "sysex") {
            this._dispatchEvent("sysex", message);
            return;
        }

        let button = message.type == "cc" ? MidiCC[message.note] : MidiButtons[message.note];

        if (message.type == "cc") {
            // normalize the value and round to the 6th digit as that's far enough
            let prev = this._states[`cc-${button.note}`];
            this._states[`cc-${button.note}`] = message.value;
            this._dispatchEvent("cc", {...message, ...button, prevVal: prev});
        } else {
            // button press

            this._dispatchEvent(message.type == "noteon" ? "keydown" : "keyup", {
                ...message,
                ...button,
            });
        }
    }

    _onStateChange(event) {
        this.connected = event.port.state == "connected";
    }

    disconnect() {
        Object.keys(MidiButtons).forEach(button => {
            // clean up after ourselves and reset the buttons on unload
            this[button] = false;
        });

        this.control.disconnect();
        this.connected = false;
        this._listeners = [];
    }

    destroy() {
        this.disconnect();
    }
}

function round(val, precision = 0) {
    // rounds the number to requested precision. how is this not part of stdlib
    return Math.round(val * Math.pow(10, precision)) / Math.pow(10, precision);
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
    ["s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8", "s9"].map((slider, idx) => {
        return [48 + idx, {key: slider}];
    })
);

export default APCMiniMk2;
