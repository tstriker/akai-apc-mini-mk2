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
                this[messageName] = async (key, value, channel = 0) => {
                    await this.send(parseInt(address), key, value, channel);
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
            this._handleSysexMessage(midiMessage.data);
        } else {
            this.onMessage({type: messageName.toLowerCase(), channel, note: remaining[0], value: remaining[1]});
        }
    }

    toMLSB(val) {
        let msb = Math.trunc(val / 128);
        let lsb = val % 128;
        return [msb, lsb];
    }

    async sendSysexData(messageTypeID, data) {
        let msb = Math.trunc(data.length / 128);
        let lsb = data.length % 128;
        let head = [0xf0, 0x47, 0x7f, 0x4f, messageTypeID, msb, lsb];
        let tail = [0xf7];
        let message = [...head, ...data, ...tail];

        // console.log("Sending:", message.map(num => "0x" + num.toString(16)).join(", "));
        await this.out.send(message);
    }

    _handleSysexMessage(messageData) {
        // remove chaff (end/start/length/device) from the sysex and forward just the message ID and actual data
        // console.log("Full sysex message:", messageData);
        let [_start, _manufacturerID, _deviceID, _modelId, messageTypeId, _lenMSB, _lenLSB, ...data] = messageData;

        // all sysex messages end with the terminator (f7) that we don't need
        data.splice(data.length - 1, 1);

        // console.log("sysex message received:", messageTypeId, data.join(","));
        this.onMessage({type: "sysex", messageTypeId, data});
    }

    _onStateChange(event) {
        this.connected = event.port.state == "connected";
    }

    async send(message, data1, data2, channel = 0) {
        // raw send
        // normally you would use the explicit functions
        //console.log("ffff", this.out, message + channel, data1, data2);
        await this.out.send([message + channel, data1, data2]);
    }

    disconnect() {
        if (this.in) {
            this.in.removeEventListener("midimessage", this._onMessage);
            this.in.removeEventListener("statechange", this._onStateChange);
            this.in = null;
            this.in.close();
        }
        if (this.out) {
            this.out.close();
            this.out = null;
        }
    }
}
