// a minimalistic, generic, zero-dependency wrapper around a midi in/out
// feel free to nab it if you find it useful!
// MIT License, Tom Striker 2023

export function toMLSB(val) {
    let msb = Math.trunc(val / 128);
    let lsb = val % 128;
    return [msb, lsb];
}

export class MIDIEvent extends Event {
    constructor(eventType, details) {
        super(eventType, {bubbles: true, cancelable: true});
        Object.entries(details).forEach(([key, val]) => {
            if (key != "type") {
                this[key] = val;
            }
        });
    }
}

export class MIDIControl {
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

    constructor(
        options = {
            sysex: false,
            manufacturerID: 0x00,
            deviceID: 0x00,
            modelID: 0x00,
            deviceCheck: () => true,
            onMessage: () => null,
            onStateChange: () => null,
        }
    ) {
        this.interface = null;
        this.in = null;
        this.out = null;
        this.connected = false;
        this.options = options;

        this._onMidiMessage = this._onMidiMessage.bind(this);
        this._onStateChange = this._onStateChange.bind(this);

        // create the send functions so we don't repeat ourselves all the time
        Object.entries(this.messages).forEach(([address, messageName]) => {
            if (messageName != "sysex") {
                this[messageName] = async (key, value, channel = 0) => {
                    this.send(parseInt(address), key, value, channel);
                };
            }
        });
    }

    async connect() {
        this.interface = await navigator.requestMIDIAccess({sysex: this.options.sysex}); // we are not using sysex rn
        this.interface.addEventListener("statechange", this._onStateChange);

        let findPort = entries => {
            for (let entry of entries) {
                let port = entry[1];
                if (this.options.deviceCheck(port)) {
                    return port;
                }
            }
        };

        this.in = findPort(this.interface.inputs);
        this.out = findPort(this.interface.outputs);

        if (!this.in || !this.out) {
            // this one's bit vague as right now the deviceCheck thing is a function with no device description
            throw Error("Tried to connect to the MIDI device but didn't find one matching the criteria");
        }

        // connect to midimessage events
        await this.in.open();
        await this.out.open();
        await this.in.addEventListener("midimessage", this._onMidiMessage);
    }

    _onStateChange(evt) {
        // proxy for now; will do cleanup/reconnect later
        // note - state events don't seem to be working on disconnect on Firefox rn.
        this.connected = evt.port.state == "connected";
        this.options.onStateChange(evt);
    }

    _onMidiMessage(midiMessage) {
        let [message, ...remaining] = midiMessage.data;

        let channel = message % 16;
        message = message - channel;

        let messageName = this.messages[message];
        if (!messageName) {
            console.log("unknown message", data);
        } else if (messageName == "sysex") {
            this._handleSysexMessage(midiMessage.data);
        } else {
            this.options.onMessage({
                type: messageName.toLowerCase(),
                channel,
                note: remaining[0],
                value: remaining[1] / 127, // most of the time working in 0..1 range makes most sense
                valueMIDI: remaining[1], // actual, non-divided value
            });
        }
    }

    _handleSysexMessage(messageData) {
        // remove chaff (end/start/length/device) from the sysex and forward just the message ID and actual data
        // console.log("Full sysex message:", messageData);
        let [_start, _manufacturerID, _deviceID, _modelId, messageTypeId, _lenMSB, _lenLSB, ...data] = messageData;

        // all sysex messages end with the terminator (f7) that we don't need
        data.splice(data.length - 1, 1);

        // console.log("sysex message received:", messageTypeId, data.join(","));
        this.options.onMessage({type: "sysex", messageTypeId, data});
    }

    async sendSysex(messageTypeID, ...data) {
        // just pass in the messageTypeID and data, and the function will handle the rest
        if (data.length == 1) {
            data = data[0];
        }

        let msb = Math.trunc(data.length / 128);
        let lsb = data.length % 128;

        let head = [
            0xf0,
            this.options.manufacturerID,
            this.options.deviceID,
            this.options.modelID,
            messageTypeID,
            msb,
            lsb,
        ];
        let tail = [0xf7];
        let message = [...head, ...data, ...tail];
        return this._sendData(message);
    }

    send(messageType, data1, data2, channel = 0) {
        // instead of using this func, consider using the explicit .noteOn, .noteOff, etc.
        // All but sysex support format of [messageType, data1, data2]
        // the channel in MIDI protocol is essentially emulated by appending it to messageType
        // so if note-on is 144, sending note-on just on channel 6 is 144+6 = 150
        return this._sendData([messageType + channel, data1, data2]);
    }

    async _sendData(message) {
        if (this.connected && this.out) {
            // console.log("Sending:", message.map(num => "0x" + num.toString(16)).join(", "));
            try {
                this.out.send(message);
            } catch (error) {
                console.error(error, message.map(num => "0x" + num.toString(16)).join(", "));
            }
        }
    }

    async disconnect() {
        this.connected = false;

        if (this.interface) {
            this.interface.removeEventListener("statechange", this._onStateChange);
            this.interface = null;
        }

        if (this.in) {
            this.in.removeEventListener("midimessage", this._onMidiMessage);
            this.in.close();
            this.in = null;
        }
        if (this.out) {
            this.out.close();
            this.out = null;
        }
    }
}
