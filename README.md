# Web-MIDI wrapper for AKAI APC Mini Mk2

This package makes it simple to access your AKAI APC Mini Mk2's state in browser, using the web-midi API.
In essence:

1. Get your hands on an AKAI APC Mini Mk2
2. Plug it in your device through USB (works on smartphones too!)
3. Open up a web browser running your website with the library's code (note: chromium on linux currently broken)
4. Profit!

# Install

`npm install akai-apc-mini-mk2`

# Initialization

```javascript
import APCMiniMk2 from "akai-apc-mini-mk2";

let mk2 = new APCMiniMk2();
mk2.connect({sysex: true}).then(() => {
    // run some commands right on startup (e.g. turning on the LEDs)
    console.log("Midi connected!");

    // light up the pad at cordinates [3,3].
    mk2.pad33 = "#ff00ff";

    // light up the volume button
    mk2.volume = 1;

    // and you can access fader values via `.fader[0-8]`
    console.log("Current value of the lef-most fader:", mk2.fader0);
});

midi.addEventListener("cc", data => {
    console.log("CC fader changed", data);
});

midi.addEventListener("noteon", data => {
    console.log("Button press", data);
});

midi.addEventListener("noteoff", data => {
    console.log("Button release", data);
});
```

# Cleanup

Call `midi.destroy()` in your cleanup routines - it will remove all system-level event listeners as well
as any listeners you might have attached.
This is especially useful if you are using hot-reload in your project, as otherwise the event listeners will
just keep piling up.

# Reading dial/slider states and toggling the LEDs

Note: There doesn't seem to be any way to find out the initial state of the knobs when you connect to it.

With the caveat above in mind, to get the dial state, simply go `midi.c1` and so on.

All the buttons, with the exception of "Send All" and "Solo" have an LED that you can turn on.
Simply set the value to true/false accordingly to the button: `midi.bank_left = true`.

# Events

Use midi instance's `addEventListener(eventType, callback)` and `removeEventListener(eventType, callback)` to
subscribe to the events. Events:

-   `cc` - fired on slider/dial turn. The event data is `{code, keyCode, val, prevVal}`
-   `noteon` / `noteoff` - fired when any of the buttons are pressed and released.
-   `sysex` - when the device sends a sysex message, you can trigger one by pressing Shift+Drum on the APC Mk2.
