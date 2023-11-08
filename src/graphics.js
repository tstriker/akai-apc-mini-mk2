export class Sprite {
    constructor(x, y) {
        [this.x, this.y] = [x, y];
        this.sprites = [];
    }

    addChild(...sprites) {
        this.sprites.push(...sprites);
    }

    getPixels() {
        // override this func to draw stuff
        return [];
    }

    getAllPixels() {
        let board = Board2D();

        board.pixels = this.getPixels();

        for (let sprite of this.sprites) {
            sprite.getAllPixels().forEach(pixel => {
                let [x, y] = [sprite.x + pixel.x, sprite.y + pixel.y];
                board(x, y).color = pixel.color;
            });
        }
        return board.pixels();
    }

    get bounds() {
        let pixels = this.getAllPixels();
        return {x: Math.max(...pixels.map(p => p.x)), y: Math.max(...pixels.map(p => p.y))};
    }
}

export function Board2D() {
    ` Board2D allows for a cleaner API for accessing x and y, especially when you do it a lot.
        let board = new Pixels2D()
        board(1, 5).color = "orange" // set value coordinates 1,5
        board.pixels = [{x: 2, y: 2, depth: "random"}]
        board.pixels // output: [{x: 1, y: 5, color: "orange"}, {x: 2, y: 2, depth: "random"}]

        the only thing to watch out for is direct assignment:
        board(1, 5) = "red" // will explode
    `;

    let pixels = {};
    let pixelKey = (x, y) => `${x},${y}`;
    let board = (x, y) => {
        let key = pixelKey(x, y);

        pixels[key] = pixels[key] || {x, y};

        return pixels[key];
    };

    Object.defineProperty(board, "pixels", {
        get: () => Object.values(pixels),
        set: newPixels => {
            for (let pixel of newPixels) {
                let key = pixelKey(pixel.x, pixel.y);
                pixels[key] = pixel;
            }
        },
    });
    return board;
}

export function fillRect(x, y, w, h, color) {
    let pixels = [];
    for (let currentY = y; currentY < y + h; currentY++) {
        for (let currentX = x; currentX < x + w; currentX++) {
            pixels.push({x: currentX, y: currentY, color});
        }
    }
    return pixels;
}

export class PixelBoard extends Sprite {
    constructor(x = 0, y = 0) {
        super(x, y);
        this.pixels = Object.fromEntries(fillRect(0, 0, 8, 8, 0).map(p => [`${p.x},${p.y}`, p]));
    }

    getPixels() {
        return Object.values(this.pixels);
    }

    color(x, y) {
        return this.pixels[`${x},${y}`]?.color;
    }

    fill(x, y, color) {
        this.pixels[`${x},${y}`] = {x, y, color};
    }
}

export class Scene extends Sprite {
    constructor({x = 0, y = 0, width = 8, height = 8, bg = 0}) {
        super(x, y);
        this.width = width;
        this.height = height;
        this.bg = bg;
    }

    getPixels() {
        // fill the whole area with background so that we don't have to
        // worry about previous frame artifacts
        return this.fillRect(0, 0, this.width, this.height, this.bg);
    }

    getAllPixels() {
        // clip all pixels to canvas
        let pixels = super.getAllPixels().map(pixel => ({
            x: Math.round(pixel.x),
            y: Math.round(pixel.y),
            color: pixel.color,
        }));
        pixels = pixels.filter(p => p.x >= 0 && p.x < this.width && p.y >= 0 && p.y < this.height);
        return pixels;
    }
}

export class View extends Scene {
    // while View behaves exactly like Scene right now, they might diverge in the future.
    // semantically, Scene is the whole external screen, while View is a clipped fragment of that screen
}

// letters, vertical line by line in base 36
// `parseInt("01110", 2).toString(36)` --> 'e'
let letters = {
    A: "fkf",
    B: "vla",
    C: "vhh",
    D: "vhe",
    E: "vl",
    F: "vkg",
    G: "vhl7",
    H: "v4v",
    I: "v",
    J: "3hv",
    K: "v4r",
    L: "v1",
    M: "v848v",
    N: "vgf",
    O: "ehe",
    P: "vkks",
    Q: "uiju",
    R: "vkb",
    S: "tln",
    T: "gvg",
    U: "v1v",
    V: "u1u",
    W: "s343s",
    X: "r4r",
    Y: "o7o",
    Z: "jip",
    0: "ehe",
    1: "8v",
    2: "nt",
    3: "lv",
    4: "s4v",
    5: "tn",
    6: "vln",
    7: "gno",
    8: "vlv",
    9: "tlv",
    "!": "t",
    "?": "gl8",
    "\\": "o43",
    '"': "o0o",
    "#": "lvlvl",
    "&": "",
    "(": "eh",
    ")": "he",
    "[": "vh",
    "]": "hv",
    "-": "44",
    "+": "4e4",
    "*": "a4a",
    ":": "a",
    "'": "o",
};

export class Text extends Sprite {
    constructor(x, y, text, color = "#ffffff") {
        super(x, y);
        [this.text, this.color] = [text, color];

        this.height = 5;
        this._redraw();
    }

    _redraw() {
        let [x, y] = [0, 0];
        let pixels = [];
        for (let letter of this.text.toUpperCase()) {
            let lines = letters[letter] || [];
            for (let line of lines) {
                let bytes = parseInt(line, 36).toString(2).padStart(5, "0");
                for (let byte of bytes) {
                    if (byte != "0") {
                        pixels.push({x, y, color: this.color});
                    }
                    y += 1;
                }
                x += 1;
                y = 0;
            }

            // add whitespace after each letter because we are polite
            x += 1;
        }
        this._pixels = pixels;
    }

    getPixels() {
        return this._pixels;
    }
}
