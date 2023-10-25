import {MIDIControl, toMLSB} from "./midicontrol.js";
import colors from "./colors.js";

// a mere proxy - to the 128 colors spelled out in the basic mode
export const Colors = colors;

let colorHex = (color, idx) => parseInt(color.slice(idx, idx + 2), 16);

class Knob {
    write = true;

    constructor(note, key, x, y) {
        this.note = note;
        this.key = key;
        this.x = x;
        this.y = y;
        this._val = null;
        this._changed = false;
    }
}

class Fader extends Knob {
    type = "fader";
    write = false;
}

class Button extends Knob {
    type = "toggle";
}

class Pad extends Knob {
    type = "rgb";
}

class APCMiniMk2 {
    constructor() {
        this.connected = false;
        this.control = null;

        this._initDone = false;
        this._sysexEnabled = false;

        this._listeners = [];
        this._paintLoop = false;

        // wrap toggles so that when the value is set, we send the signal to the MIDI light
        this._states = {};

        // buttons by note
        this.buttons = {};
        for (let i = 0; i < 64; i++) {
            let x = i % 8;
            let y = 7 - (i - x) / 8;
            this.buttons[i] = new Pad(i, `pad${x}${y}`, x, y);
        }

        // horiz simple buttons
        ["volume", "pan", "send", "device", "up", "down", "left", "right"].forEach((key, idx) => {
            let note = 100 + idx;
            this.buttons[note] = new Button(note, `${key}Button`, idx, 9);
        });
        // vert simple buttons
        ["clipStop", "solo", "mute", "recArm", "select", "drum", "note", "stopAllClips"].forEach((key, idx) => {
            let note = 112 + idx;
            this.buttons[note] = new Button(note, `${key}Button`, 9, idx);
        });
        this.buttons[122] = new Button(122, "shiftButton", 9, 9);

        // faders by note
        this.faders = Object.fromEntries(
            [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(idx => {
                return [48 + idx, new Fader(48 + idx, `fader${idx}`)];
            })
        );

        this.allControls = [...Object.values(this.buttons), ...Object.values(this.faders)];
        this.allControls.forEach(control => {
            // add properties by key name so that we can reference buttons by simply going `mk2.pad33` etc
            this[control.key] = control;
        });
    }

    async connect(
        options = {
            sysex: false, // set to true if you want to paint with RGB colors
            reset: true,
            // if paintLoop is set to true, we will start a lazy ~60fps loop that continuously sends colors to midi
            // this is preferable when you are painting with rgb colors as sending colors in batch is way more effective
            paintLoop: false,
        }
    ) {
        this._sysexEnabled = options.sysex;
        this._paintLoop = options.paintLoop;

        this.control = new MIDIControl({
            sysex: this._sysexEnabled,
            manufacturerID: 0x47,
            deviceID: 0x7f,
            modelID: 0x4f,
            deviceCheck: port => {
                return port.name.indexOf("APC mini mk2 Contr") != -1;
            },
            onMessage: evt => {
                if (evt.type == "sysex") {
                    if (evt.messageTypeId == 0x61) {
                        evt.data.forEach((faderVal, idx) => {
                            this[`fader${idx}`]._val = faderVal;
                        });
                    } else {
                        this._dispatchEvent("sysex", evt);
                    }
                    return;
                }

                let button = evt.type == "cc" ? this.faders[evt.note] : this.buttons[evt.note];

                if (evt.type == "cc") {
                    // normalize the value and round to the 6th digit as that's far enough
                    let prev = this._states[button.key];
                    this[button.key]._val = evt.value;
                    this._dispatchEvent("cc", {...evt, ...button, prevVal: prev});
                } else {
                    // button press
                    this._dispatchEvent(evt.type, {...evt, ...button});
                }
            },
            onStateChange: event => {
                this.connected = event.port.state == "connected";
            },
        });
        await this.control.connect();

        // link all the buttons
        let propertyNames = {rgb: "color", toggle: "on", fader: "value"};
        this.allControls.forEach(control => {
            if (propertyNames[control.type]) {
                Object.defineProperty(control, propertyNames[control.type], {
                    get: () => this._getValue(control),
                    set: value => this._setValue(control, value),
                });
            }
        });

        if (options.sysex) {
            // if we have sysex enabled, sniff out the current slider states
            // the 0x61 response will come to to onMessage, so check the code above
            this.control.sendSysex(0x60, [0x41, 0x09, 0x01, 0x04]);
        }

        if (options.reset !== false) {
            this.reset();
        }

        if (options.paintLoop) {
            this.startPaintLoop();
        }
    }

    _getValue(control) {
        return control._val;
    }

    _setValue(control, val) {
        if (!control.write || JSON.stringify(val) == JSON.stringify(control._val)) {
            return;
        }
        control._val = val;

        if (control.type == "toggle") {
            // toggles are simple enough
            this.control.noteOn(control.note, val ? 127 : 0);
        } else if (control.type == "rgb" && typeof val == "string" && val.length == 7) {
            if (this._paintLoop) {
                control._changed = true;
            } else {
                let [r, g, b] = [colorHex(val, 1), colorHex(val, 3), colorHex(val, 5)];
                this.control.sendSysex(0x24, control.note, control.note, ...toMLSB(r), ...toMLSB(g), ...toMLSB(b));
            }
        } else {
            let [color, brightness] = [val, val ? 6 : 0];
            if (Array.isArray(val)) {
                [color, brightness] = val;
            }
            this.control.noteOn(this.note, color, brightness);
        }
    }

    startPaintLoop() {
        let x = 0;
        let inner = () => {
            let fills = [];

            let curColor = null;
            let from = null;
            let to = null;

            for (let i = 0; i < 64; i++) {
                let button = this.buttons[i];
                let color = button._val;

                if (color === curColor) {
                    // if we are same as the previous, we are happy to keep going
                    to = i;
                } else if (curColor) {
                    // reset
                    fills.push([from, to, curColor]);
                    if (button._changed) {
                        curColor = color;
                        from = i;
                        to = i;
                    } else {
                        curColor = null;
                    }
                } else if (button._changed) {
                    curColor = button._val;
                    from = i;
                    to = i;
                }

                if (button._changed) {
                    button._changed = false;
                }
            }
            if (curColor) {
                fills.push([from, to, curColor]);
            }

            if (fills.length) {
                //console.log(fills.length, "fill instructions", fills);
                this.fill(fills);
            }

            if (this._paintLoop) {
                //requestAnimationFrame(inner);
                requestAnimationFrame(inner);
            }
        };
        inner();
    }

    select(x1, y1, x2, y2) {
        // return a list of buttons in the selected range; goes left-to-right, top-to-bottom
        let buttons = [];
        for (let y = y1; y <= y2; y++) {
            for (let x = x1; x <= x2; x++) {
                buttons.push(this[`pad${x}${y}`]);
            }
        }
        return buttons;
    }

    reset() {
        // turn all pads off
        Object.values(this.buttons).forEach(button => {
            this._setValue(button, 0);
        });
    }

    fill(padColors) {
        // fill

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
            this.control.sendSysex(0x24, ...message);
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
        this._paintLoop = false;
        this.reset();
        this.control.disconnect();
        this._listeners = [];
        this.connected = false;
    }
}

export default APCMiniMk2;
