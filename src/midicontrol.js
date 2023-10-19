// a minimalistic wrapper around a midi in/out
//

export class Midi {
    messages = {
        0x80: "noteOff", // 128
        0x90: "noteOn", // 144
        0xa0: "aftertouchPoly", // 160
        0xb0: "cc", // 176
        0xc0: "programChange", // 192
        0xd0: "aftertouchChannel", // 208
        0xe0: "pitchWheel", // 224
        0xf0: "sysex", // 240
    };

    constructor(midiIn, midiOut, onMessage) {
        this.in = midiIn;
        this.out = midiOut;
        this.onMessage = onMessage;

        this._onMidiMessage = this._onMidiMessage.bind(this);
        this.in.addEventListener("midimessage", this._onMidiMessage);

        // create the send functions so we don't repeat ourselves all the time
        Object.entries(this.messages).forEach(([address, messageName]) => {
            if (messageName != "sysex") {
                this[messageName] = (key, value, channel = 0) => {
                    this.send(parseInt(address), key, value, channel);
                };
            }
        });
    }

    _onMidiMessage(midiMessage) {
        let [message, ...remaining] = midiMessage.data;

        let channel = message % 16;
        message = message - channel;

        let messageName = this.messages[message];
        if (!messageName) {
            console.log("unknown message", data);
        } else if (messageName == "sysex") {
            this.onMessage({type: "sysex", data: remaining});
        } else {
            this.onMessage({type: messageName.toLowerCase(), channel, note: remaining[0], value: remaining[1]});
        }
    }

    sysex(data) {
        this.out.send(data);
    }

    send(message, data1, data2, channel = 0) {
        // raw send
        // normally you would use the explicit functions
        //console.log("ffff", this.out, message + channel, data1, data2);
        this.out.send([message + channel, data1, data2]);
    }

    disconnect() {
        if (this.in) {
            this.in.removeEventListener("midimessage", this._onMessage);
            this.in.removeEventListener("statechange", this._onStateChange);
            this.in = null;
        }
        this._output = null;
    }
}
