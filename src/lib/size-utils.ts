export type SizeValidation = { valid: true } | { valid: false; reason: string };

export const CUSTOM_SIZE_MIN_PIXELS = 655_360;
export const CUSTOM_SIZE_MAX_PIXELS = 8_294_400;
export const CUSTOM_SIZE_MAX_EDGE = 3840;
export const CUSTOM_SIZE_EDGE_MULTIPLE = 16;
export const CUSTOM_SIZE_MAX_ASPECT = 3;

export function validateCustomSize(width: number, height: number): SizeValidation {
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
        return { valid: false, reason: 'Width and height must be positive numbers.' };
    }
    if (!Number.isInteger(width) || !Number.isInteger(height)) {
        return { valid: false, reason: 'Width and height must be whole numbers.' };
    }
    if (width % CUSTOM_SIZE_EDGE_MULTIPLE !== 0 || height % CUSTOM_SIZE_EDGE_MULTIPLE !== 0) {
        return { valid: false, reason: `Both edges must be multiples of ${CUSTOM_SIZE_EDGE_MULTIPLE}.` };
    }
    if (width > CUSTOM_SIZE_MAX_EDGE || height > CUSTOM_SIZE_MAX_EDGE) {
        return { valid: false, reason: `Maximum edge is ${CUSTOM_SIZE_MAX_EDGE}px.` };
    }
    const long = Math.max(width, height);
    const short = Math.min(width, height);
    if (long / short > CUSTOM_SIZE_MAX_ASPECT) {
        return { valid: false, reason: `Aspect ratio (long:short) must be ≤ ${CUSTOM_SIZE_MAX_ASPECT}:1.` };
    }
    const pixels = width * height;
    if (pixels < CUSTOM_SIZE_MIN_PIXELS) {
        return { valid: false, reason: `Total pixels must be at least ${CUSTOM_SIZE_MIN_PIXELS.toLocaleString()}.` };
    }
    if (pixels > CUSTOM_SIZE_MAX_PIXELS) {
        return {
            valid: false,
            reason: `Total pixels must be no more than ${CUSTOM_SIZE_MAX_PIXELS.toLocaleString()}.`
        };
    }
    return { valid: true };
}

export type SizePreset = 'auto' | 'custom' | 'square-1k' | 'widescreen-draft' | 'widescreen-2k';

export const DEFAULT_SIZE_PRESET: SizePreset = 'square-1k';

const PRESET_DIMENSIONS: Record<Exclude<SizePreset, 'auto' | 'custom'>, string> = {
    'square-1k': '1024x1024',
    'widescreen-draft': '1536x864',
    'widescreen-2k': '2048x1152'
};

/**
 * Returns the concrete WxH string for a preset.
 * Returns null for 'auto' (let the API pick) and 'custom' (caller provides WxH).
 */
export function getPresetDimensions(preset: SizePreset): string | null {
    if (preset === 'auto' || preset === 'custom') return null;
    return PRESET_DIMENSIONS[preset];
}

/**
 * Human-readable dimension info for tooltips.
 */
export function getPresetTooltip(preset: SizePreset): string | null {
    const dims = getPresetDimensions(preset);
    if (!dims) return null;
    const [w, h] = dims.split('x').map(Number);
    const mp = ((w * h) / 1_000_000).toFixed(1);
    return `${w} × ${h} · ${aspectRatio(w, h)} · ${mp} MP`;
}

function aspectRatio(width: number, height: number): string {
    const divisor = greatestCommonDivisor(width, height);
    return `${width / divisor}:${height / divisor}`;
}

function greatestCommonDivisor(a: number, b: number): number {
    return b === 0 ? a : greatestCommonDivisor(b, a % b);
}
