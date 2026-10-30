export type DetectedImageFormat = 'png' | 'jpeg' | 'webp';

export type ImageDimensions = {
    format: DetectedImageFormat;
    width: number;
    height: number;
};

/**
 * Reads intrinsic pixel dimensions from the encoded bytes (not from request parameters).
 * Supports the three output formats accepted by the Images API.
 */
export function readImageDimensions(bytes: Uint8Array): ImageDimensions | null {
    if (isPng(bytes)) {
        return readPng(bytes);
    }
    if (isJpeg(bytes)) {
        return readJpeg(bytes);
    }
    if (isWebp(bytes)) {
        return readWebp(bytes);
    }
    return null;
}

function isPng(bytes: Uint8Array): boolean {
    return (
        bytes.length >= 24 &&
        bytes[0] === 0x89 &&
        bytes[1] === 0x50 &&
        bytes[2] === 0x4e &&
        bytes[3] === 0x47 &&
        bytes[4] === 0x0d &&
        bytes[5] === 0x0a &&
        bytes[6] === 0x1a &&
        bytes[7] === 0x0a
    );
}

function readPng(bytes: Uint8Array): ImageDimensions | null {
    const isIhdr = bytes[12] === 0x49 && bytes[13] === 0x48 && bytes[14] === 0x44 && bytes[15] === 0x52;
    if (!isIhdr) return null;

    const width = readUInt32BE(bytes, 16);
    const height = readUInt32BE(bytes, 20);
    return width > 0 && height > 0 ? { format: 'png', width, height } : null;
}

function isJpeg(bytes: Uint8Array): boolean {
    return bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8;
}

function readJpeg(bytes: Uint8Array): ImageDimensions | null {
    let offset = 2;

    while (offset + 9 < bytes.length) {
        if (bytes[offset] !== 0xff) {
            offset++;
            continue;
        }

        let marker = bytes[offset + 1];
        while (marker === 0xff) {
            offset++;
            marker = bytes[offset + 1];
        }

        if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
            offset += 2;
            continue;
        }
        if (marker === 0xd9 || marker === 0xda) return null;

        const segmentLength = readUInt16BE(bytes, offset + 2);
        if (segmentLength < 2) return null;

        if (isStartOfFrame(marker)) {
            if (offset + 9 > bytes.length) return null;
            const height = readUInt16BE(bytes, offset + 5);
            const width = readUInt16BE(bytes, offset + 7);
            return width > 0 && height > 0 ? { format: 'jpeg', width, height } : null;
        }

        offset += 2 + segmentLength;
    }

    return null;
}

function isStartOfFrame(marker: number): boolean {
    return (
        marker === 0xc0 ||
        marker === 0xc1 ||
        marker === 0xc2 ||
        marker === 0xc3 ||
        marker === 0xc5 ||
        marker === 0xc6 ||
        marker === 0xc7 ||
        marker === 0xc9 ||
        marker === 0xca ||
        marker === 0xcb ||
        marker === 0xcd ||
        marker === 0xce ||
        marker === 0xcf
    );
}

function isWebp(bytes: Uint8Array): boolean {
    return (
        bytes.length >= 30 &&
        bytes[0] === 0x52 &&
        bytes[1] === 0x49 &&
        bytes[2] === 0x46 &&
        bytes[3] === 0x46 &&
        bytes[8] === 0x57 &&
        bytes[9] === 0x45 &&
        bytes[10] === 0x42 &&
        bytes[11] === 0x50
    );
}

function readWebp(bytes: Uint8Array): ImageDimensions | null {
    const chunk = String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15]);

    if (chunk === 'VP8X') {
        const width = 1 + readUInt24LE(bytes, 24);
        const height = 1 + readUInt24LE(bytes, 27);
        return width > 0 && height > 0 ? { format: 'webp', width, height } : null;
    }

    if (chunk === 'VP8L') {
        if (bytes[20] !== 0x2f) return null;
        const bits = readUInt32LE(bytes, 21);
        const width = 1 + (bits & 0x3fff);
        const height = 1 + ((bits >>> 14) & 0x3fff);
        return width > 0 && height > 0 ? { format: 'webp', width, height } : null;
    }

    if (chunk === 'VP8 ') {
        const hasStartCode = bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a;
        if (!hasStartCode) return null;
        const width = readUInt16LE(bytes, 26) & 0x3fff;
        const height = readUInt16LE(bytes, 28) & 0x3fff;
        return width > 0 && height > 0 ? { format: 'webp', width, height } : null;
    }

    return null;
}

function readUInt16BE(bytes: Uint8Array, offset: number): number {
    return (bytes[offset] << 8) | bytes[offset + 1];
}

function readUInt16LE(bytes: Uint8Array, offset: number): number {
    return bytes[offset] | (bytes[offset + 1] << 8);
}

function readUInt24LE(bytes: Uint8Array, offset: number): number {
    return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
}

function readUInt32BE(bytes: Uint8Array, offset: number): number {
    return (
        bytes[offset] * 0x1000000 + ((bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3])
    );
}

function readUInt32LE(bytes: Uint8Array, offset: number): number {
    return (
        bytes[offset] |
        (bytes[offset + 1] << 8) |
        (bytes[offset + 2] << 16) |
        (bytes[offset + 3] << 24)
    ) >>> 0;
}
