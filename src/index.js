import {MIDIControl, MIDIEvent, toMLSB} from "./midicontrol.js";
import colors from "./colors.js";

export {State} from "./state.js";
export * as graphics from "./graphics.js";

// a mere proxy - to the 128 colors spelled out in the basic mode
export const Colors = colors;

export function isRGB(val) {
    // we will brain it up later
    return typeof val == "string" && val.length == 7;
}

let colorHex = (color, idx) => parseInt(color.slice(idx, idx + 2), 16);
function toRGB(color) {
    return [colorHex(color, 1), colorHex(color, 3), colorHex(color, 5)];
}

function toHex(...components) {
    return "#" + components.map(comp => comp.toString(16).padStart(2, "0")).join("");
}

class Knob {
    write = true;

    constructor(note, key, x, y, onSetVal) {
        this.note = note;
        this.key = key;
        this.name = key;
        this.x = x;
        this.y = y;
        this._val = null;
        this._onSetVal = onSetVal;
    }

    _setVal(val) {
        if (val != this._val) {
            this._val = val;
            this._onSetVal(this, val);
        }
    }
}

class Fader extends Knob {
    type = "fader";
    write = false;

    set value(val) {
        super._setVal(val);
    }

    get value() {
        return this._val;
    }
}

class Toggle extends Knob {
    type = "toggle";

    constructor(note, key, x, y, onSetVal, label) {
        super(note, key, x, y, onSetVal);
        this._changed = false;
        this._pressed = false;
        this._animate = null;
        this.label = label;
        this.name = `${key}Button`;
    }

    get pressed() {
        return this._pressed;
    }

    set toggled(val) {
        super._setVal(val);
    }

    get toggled() {
        return this._val;
    }

    blink(speed = 1, pattern, delay = 0) {
        this._animate = {mode: "blink", speed, pattern, delay};
    }
}

class Pad extends Knob {
    type = "rgb";

    constructor(note, key, x, y, onSetVal) {
        super(note, key, x, y, onSetVal);
        this._changed = false;
        this._pressed = false;
        this._animate = null;
    }

    set color(val) {
        super._setVal(val);
    }

    get color() {
        return this._val;
    }

    pulse(speed = 1, pattern, delay = 0) {
        this._animate = {mode: "pulse", speed, pattern, delay};
    }

    blink(speed = 1, pattern, delay = 0) {
        this._animate = {mode: "blink", speed, pattern, delay};
    }
}

function _dispatchEvent(mk2, eventType, detail) {
    // we interpret midi controller events similar to how you would handle keyboard events - they can work on
    // the currently focused element that can intercept the event, as well as bubble up
    let event = new MIDIEvent(eventType, {...detail, controller: mk2});
    document.activeElement.dispatchEvent(event);
}

function toWords(camelCase) {
    return camelCase.replace(/[A-Z]/g, letter => ` ${letter.toLowerCase()}`);
}

export class APCMiniMk2 {
    constructor() {
        this.connected = false;
        this.control = null;

        this._initDone = false;
        this._sysexEnabled = false;

        this._paintLoop = false;
        this._paintCallback = null;

        this._pads = [];

        this._setControlValue = this._setControlValue.bind(this);

        for (let i = 0; i < 64; i++) {
            let x = i % 8;
            let y = 7 - (i - x) / 8;
            this._pads.push(new Pad(i, `pad${x}${y}`, x, y, this._setControlValue));
        }

        // vert simple buttons
        this.vertButtons = ["clipStop", "solo", "mute", "recArm", "select", "drum", "note", "stopAllClips"].map(
            (key, idx) => {
                return new Toggle(112 + idx, key, 9, idx, this._setControlValue, toWords(key));
            }
        );

        // horiz simple buttons
        this.horizButtons = ["volume", "pan", "send", "device", "arrowUp", "arrowDown", "arrowLeft", "arrowRight"].map(
            (key, idx) => {
                return new Toggle(100 + idx, key, idx, 9, this._setControlValue, toWords(key));
            }
        );
        this.horizButtons.push(new Toggle(122, "shift", 9, 9, this._setControlValue, "shift"));

        // faders by note
        this.faders = Object.fromEntries(
            [0, 1, 2, 3, 4, 5, 6, 7, 8].map(idx => {
                return [48 + idx, new Fader(48 + idx, `fader${idx}`, this._setControlValue)];
            })
        );

        // all buttons by note for easy access
        this.buttons = Object.fromEntries(
            [...this._pads, ...this.horizButtons, ...this.vertButtons].map(button => [button.note, button])
        );

        // list of all controls for search/filter/etc
        this.allControls = [...Object.values(this.buttons), ...Object.values(this.faders)];

        // add properties by key name so that we can reference buttons by simply going `mk2.pad33` etc
        this.allControls.forEach(control => {
            this[control.name] = control;
        });
    }

    async connect(
        options = {
            sysex: false, // set to true if you want to paint with RGB colors
            reset: true,
            // if paintLoop is set to true, we will start a lazy ~60fps loop that continuously sends colors to midi
            // this is preferable when you are painting with rgb colors as sending colors in batch is way more effective
            paintLoop: true,

            onPaint: null, // when provided will call on each paint cycle
        }
    ) {
        // true by default
        ["reset", "paintLoop"].forEach(trueByDefault => {
            options[trueByDefault] = options[trueByDefault] === undefined ? true : options[trueByDefault];
        });

        this._sysexEnabled = options.sysex;
        this._paintLoop = options.paintLoop;
        this._paintCallback = options.beforePaint;

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
                        _dispatchEvent(this, "sysex", evt);
                    }
                    return;
                }

                let button = evt.type == "cc" ? this.faders[evt.note] : this.buttons[evt.note];
                // remove the `button` suffix from the events. if you wanna full name, you can check button.key
                let key = button.key.replace("Button", "");

                if (evt.type != "cc") {
                    button._pressed = evt.type == "noteon";
                }

                let pressedKeys = Object.values(this.buttons).filter(button => button.pressed);

                let evtDetails = {
                    ...evt,
                    mk2: this,
                    button,
                    key,
                    shiftKey: this.shiftButton.pressed,
                    pressedKeys,
                };

                if (evt.type == "cc") {
                    let prev = this[button.key]._val;
                    this[button.key]._val = evt.value;
                    _dispatchEvent(this, "cc", {
                        ...evtDetails,
                        prevVal: prev,
                        delta: prev - evt.value,
                        shiftKey: this.shiftButton.pressed,
                    });
                } else {
                    // button press
                    _dispatchEvent(this, evt.type, evtDetails);
                }

                if (this.currentState?.handlers) {
                    let noop = () => {};

                    (this.currentState.handlers[evt.type] || noop)(evtDetails);
                    if (evt.type == "noteon") {
                        let keyHandler = this.currentState.handlers[key];
                        let callback = typeof keyHandler == "function" ? keyHandler : keyHandler?.noteon;
                        (callback || keyHandler || noop)(evtDetails);
                    }
                }
            },
            onStateChange: event => {
                this.connected = event.port.state == "connected";
            },
        });
        await this.control.connect();

        if (options.sysex) {
            // if we have sysex enabled, sniff out the current slider states
            // the 0x61 response will come to to onMessage, so check the code above
            this.control.sendSysex(0x60, [0x41, 0x09, 0x01, 0x04]);
        }

        if (options.reset) {
            this.reset();
        }

        if (this._paintLoop) {
            this.paintPads();
        }
    }

    _checkHWBlink(control) {
        if (Array.isArray(control._val) && control._val[1] > 6) {
            // if the previous state has a blinker have to reset it back to zero
            // or else the sysex message won't take effect
            this.control.noteOn(control.note, 0);
        }
    }

    _setControlValue(control, val) {
        if (control.type == "toggle") {
            // toggles are simple enough
            this.control.noteOn(control.note, val ? 127 : 0);
        } else if (control.type == "rgb" && isRGB(val)) {
            this._checkHWBlink(control);
            if (this._paintLoop) {
                control._changed = true;
            } else {
                let [r, g, b] = toRGB(val);
                this.control.sendSysex(0x24, control.note, control.note, ...toMLSB(r), ...toMLSB(g), ...toMLSB(b));
            }
        } else {
            let [color, brightness] = [val, val ? 6 : 0];
            if (Array.isArray(val)) {
                [color, brightness] = val;
            }
            this.control.noteOn(control.note, color, brightness);
        }
        _dispatchEvent(this, "akai-apc-mini-mk2-stateupdate", {note: control.note, value: val});
    }

    pads(x, y) {
        // allows accessing pads via `.pads(x, y)` instead of having to interpolate strings
        if (x < 0 || x > 7 || y < 0 || y > 7) {
            throw new Error(`Coordinates out of bounds: (${x}, ${y})`);
        }
        return this[`pad${x}${y}`];
    }

    paintPads() {
        if (!this._paintLoop) {
            return;
        }

        let fills = [];
        let curColor = null;
        let from = null;
        let to = null;
        let maxMillis = 1160; // tweaked this to be same pace as akai is naturally doing on blink
        let frame = (Date.now() % maxMillis) / maxMillis;

        if (this._paintCallback) {
            this._paintCallback();
        }

        if (this.currentState) {
            // after paint callback we overlay any current state
            for (let pixel of this.currentState.render(this)) {
                if (pixel.idx !== undefined) {
                    this.buttons[pixel.idx].color = pixel.color;
                } else {
                    this.pads(pixel.x, pixel.y).color = pixel.color;
                }
            }

            for (let button of Object.values(this.buttons)) {
                let handler = (this.currentState.handlers || {})[button.key] || {};
                if (button.type == "toggle") {
                    this[button.name].toggled = handler.toggled !== undefined ? handler.toggled : false;
                }
            }
        }

        for (let i = 0; i < 64; i++) {
            let button = this.buttons[i];
            let color = button._val;

            if (!isRGB(color)) {
                // we ignore buttons that have non-rgb colors
                color = null;
            }

            let animate = button._animate;
            if (isRGB(color) && animate) {
                let buttonFrame = ((Date.now() + animate.delay) % maxMillis) / maxMillis;
                if (animate.speed != 1) {
                    let fraction = 1 / animate.speed;
                    buttonFrame = (frame % fraction) / fraction;
                }

                if (animate.mode == "pulse") {
                    buttonFrame = Math.abs(0.1 + Math.sin(buttonFrame * Math.PI) * 0.9);
                } else if (animate.mode == "blink") {
                    buttonFrame = buttonFrame < 0.5 ? 0 : 1;
                }

                let [r, g, b] = toRGB(color).map(component => Math.round(component * buttonFrame));
                color = toHex(r, g, b);
            }

            if (color === curColor) {
                // if we are same as the previous, we are happy to keep going
                to = i;
            } else if (curColor) {
                // reset
                fills.push([from, to, curColor]);
                if (button._changed || animate) {
                    curColor = color;
                    from = i;
                    to = i;
                } else {
                    curColor = null;
                }
            } else if (button._changed || animate) {
                curColor = color;
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
            // push a fill instruction that will do a sysex call if pad colors have changed
            this.fill(fills, false);
        }

        if (this._paintLoop) {
            //requestAnimationFrame(inner);
            requestAnimationFrame(() => this.paintPads());
        }
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
            this._setControlValue(button, 0);
        });
    }

    fill(padColors, updateState = true) {
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
                let [r, g, b] = toRGB(color);
                message.push(padFrom, padTo, ...toMLSB(r), ...toMLSB(g), ...toMLSB(b));

                if (updateState) {
                    for (let j = padFrom; j <= padTo; j++) {
                        this._checkHWBlink(this.buttons[j]);
                        this.buttons[j].color = color;
                    }
                }
            });
            // if you blast the sysex with lotsa messages all at once it will start dropping frames
            // discussion here: https://github.com/WebAudio/web-midi-api/issues/158
            // the best you can do is not blast, but if you do blast, use setInterval/setTimeout and manage the
            // buffer yourself
            this.control.sendSysex(0x24, ...message);
        }
    }

    setState(state) {
        this.currentState = state;
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
