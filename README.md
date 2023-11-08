# Web-MIDI wrapper for AKAI APC Mini Mk2

This package makes it simple to access your AKAI APC Mini Mk2's state in browser, using the web-midi API.
In essence:

1. Get your hands on an AKAI APC Mini Mk2
2. Plug it in your device through USB (works on smartphones too!)
3. Open up a web browser running your website with the library's code (note: chromium on linux currently broken - use firefox instead)
4. Profit!

# WIP Disclaimer - unstable API

This package is still very much work in progress, and the API is bound to change.

# Install

`npm install akai-apc-mini-mk2`

# Initialization

```javascript
let mk2 = new APCMiniMk2();
mk2.connect({sysex: true}).then(() => {
    // run some commands right on startup (e.g. turning on the LEDs)
    console.log("Midi connected!");

    // set pad at cordinates [3,3] to blueish (you can use hex)
    mk2.pad33.color = "#123456";

    // set pad at coordinates [1,1] to white and pulse
    mk2.pad11.color = "#ff0000";
    mk2.pad11.pulse();

    // set button color and blink rates using AKAI's values
    mk2.buttons[7].color = [3, 15];

    // light up the volume button
    mk2.volumeButton.toggled = true;

    // access fader values via `.fader[0-8]`
    console.log("Current value of the lef-most fader:", mk2.fader0.value);
});

// the events will be broadcast globally, bubbling from the currently focused element - just like
// they
document.addEventListener("cc", evt => {
    console.log(evt.key, "changed to", evt.value, evt);
});

document.addEventListener("noteon", evt => {
    console.log("Button press", evt);
});

document.addEventListener("noteoff", evt => {
    console.log("Button release", evt);
});
```

# Cleanup

Call `.disconnect()` in your cleanup routines - it will remove all system-level event listeners as well
as any listeners you might have attached. Also, don't forget to call `document.removeEventListener` on any
MIDI events

# Events

Use document's `addEventListener(eventType, callback)` and `removeEventListener(eventType, callback)` to
subscribe to the events. Events:

-   `cc` - fired on slider/dial turn. Extra data in the event: `{note, key, val, prevVal, button}`
-   `noteon` / `noteoff` - fired when any of the buttons are pressed and released. Extra data in the event: `{note, key, button}`
-   `sysex` - when the device sends a sysex message. Generally won't be useful to you, but you can trigger a sysex message
    by pressing Shift+Drum on the APC Mk2.
