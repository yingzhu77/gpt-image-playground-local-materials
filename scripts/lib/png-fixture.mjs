import crypto from 'node:crypto';
import zlib from 'node:zlib';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) {
            c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        }
        table[n] = c >>> 0;
    }
    return table;
})();

function crc32(buffer) {
    let crc = 0xffffffff;
    for (const byte of buffer) {
        crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
    const typeBuffer = Buffer.from(type, 'ascii');
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length, 0);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
    return Buffer.concat([length, typeBuffer, data, crc]);
}

export function createFixturePng(width, height, { alpha = false, pixel } = {}) {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
        throw new Error('Invalid PNG dimensions.');
    }

    const channels = alpha ? 4 : 3;
    const rowSize = width * channels + 1;
    const raw = Buffer.alloc(rowSize * height);

    for (let y = 0; y < height; y++) {
        const rowOffset = y * rowSize;
        raw[rowOffset] = 0;
        for (let x = 0; x < width; x++) {
            let color;
            if (pixel) {
                color = pixel(x, y);
            } else if (alpha) {
                color = ((x >> 5) + (y >> 5)) % 2 === 0 ? [40, 120, 200, 255] : [0, 0, 0, 0];
            } else {
                color = [Math.floor((255 * x) / width), Math.floor((255 * y) / height), 128, 255];
            }
            const [r, g, b, a = 255] = color;
            const offset = rowOffset + 1 + x * channels;
            raw[offset] = r;
            raw[offset + 1] = g;
            raw[offset + 2] = b;
            if (alpha) raw[offset + 3] = a;
        }
    }

    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width, 0);
    ihdr.writeUInt32BE(height, 4);
    ihdr[8] = 8;
    ihdr[9] = alpha ? 6 : 2;
    ihdr[10] = 0;
    ihdr[11] = 0;
    ihdr[12] = 0;

    const idat = zlib.deflateSync(raw, { level: 9 });
    return Buffer.concat([PNG_SIGNATURE, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

export function sha256(buffer) {
    return crypto.createHash('sha256').update(buffer).digest('hex');
}
