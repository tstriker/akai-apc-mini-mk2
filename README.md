# Web-MIDI wrapper for AKAI APC Mini Mk2

This package makes it simple to access your AKAI APC Mini Mk2's state in browser, using the web-midi API.
In essence:

1. Get your hands on an AKAI APC Mini Mk2
2. Plug it in your device through USB (works on smartphones too!)
3. Open up a web browser running your website with the library's code (note: chromium on linux currently broken)
4. Profit!


# Install

```npm install akai-midimix```

Alternatively, you can just copy the index.js from the repository into your project and import that.

# Initialization
```javascript
import {MidiMix} from "akai-midimix";

const midi = new MidiMix();

midi.connect().then(() => {
    // run some commands right on startup (e.g. turning on the LEDs)
    console.log("Midi connected!");
    midi.m1 = true; // will light up the m1 button - see below for layout
});

midi.addEventListener("cc", data => {
    console.log("CC dial/slider turned", data);
});

midi.addEventListener("keydown", data => {
    console.log("Button press", data);
});
```

# Cleanup

Call `midi.destroy()` in your cleanup routines - it will remove all system-level event listeners as well
as any listeners you might have attached.
This is especially useful if you are using hot-reload in your project, as otherwise the event listeners will
just keep piling up.



# Reading dial/slider states and toggling the LEDs

Note: There doesn't seem to be any way to find out the initial state of the knobs when you connect to it. Luckily, that's what
the "Send All" hardware button is there for - once connected, hit Send All, and the midimix will send an event per knob,
and the library will have their state, too.
Alternatively, the state for individual controls will be set when you physically poke them.

With the caveat above in mind, to get the dial state, simply go `midi.c1` and so on.

All the buttons, with the exception of "Send All" and "Solo" have an LED that you can turn on.
Simply set the value to true/false accordingly to the button: `midi.bank_left = true`.


# Events

Use midi instance's `addEventListener(eventType, callback)` and `removeEventListener(eventType, callback)` to
subscribe to the events. Events:

* `cc` - fired on slider/dial turn. The event data is `{code, keyCode, val, prevVal}`
* `keydown` / `keyup` - fired when any of the buttons are pressed and released (with the exception of "send all").
   The event data is `{key, code, keyCode}`, where key is the symbolic name, code is the hardware code, and keyCode
   is key again, but in PascalCase. The event data is intentionally set so that you can have single handler for, both,
   midi, and the keyboard.


# Licence & Thanks

This code is licenced under the MIT license,  so you can do with it whatever you want for whatever purpose.


