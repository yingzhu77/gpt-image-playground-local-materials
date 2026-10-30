import { calculateApiCost } from '@/lib/cost-utils';
import type { DetectedImageFormat } from '@/lib/image-dimensions';
import type {
    GptImageModel,
    ImageBackground,
    ImageModeration,
    ImageOutputFormat,
    ImageQuality
} from '@/lib/models';
import type OpenAI from 'openai';

export const IMAGE_METADATA_SCHEMA_VERSION = 1;

export type ArchivedOutputImage = {
    filename: string;
    output_format: ImageOutputFormat;
    width: number | null;
    height: number | null;
    bytes: number;
    detected_format: DetectedImageFormat | null;
};

export type ArchivedReferenceImage = {
    index: number;
    filename: string;
    mime_type: string;
    size_bytes: number;
};

export type ImageRequestMetadata = {
    schema_version: number;
    local_request_id: string;
    created_at: string;
    mode: 'generate' | 'edit';
    prompt: string;
    model: GptImageModel;
    size: string;
    requested_width: number | null;
    requested_height: number | null;
    quality: ImageQuality;
    n: number;
    background: ImageBackground;
    output_format: ImageOutputFormat;
    output_compression: number | null;
    moderation: ImageModeration;
    reference_image_count: number;
    reference_images: ArchivedReferenceImage[];
    has_mask: boolean;
    mask_filename: string | null;
    mask_size_bytes: number | null;
    output_filename: string | null;
    outputs: ArchivedOutputImage[];
    actual_width: number | null;
    actual_height: number | null;
    size_matches_request: boolean | null;
    usage: OpenAI.Images.ImagesResponse['usage'] | null;
    usage_missing: boolean;
    estimated_cost_usd: number | null;
    cost_note: 'usage_token_estimate' | 'unknown_missing_usage';
    openai_request_id: string | null;
    local_duration_ms: number;
    storage_mode: 'fs' | 'indexeddb';
    is_mock: boolean;
    warnings: string[];
};

type BuildMetadataInput = {
    localRequestId: string;
    createdAt: string;
    mode: 'generate' | 'edit';
    prompt: string;
    model: GptImageModel;
    size: string;
    quality: ImageQuality;
    n: number;
    background: ImageBackground;
    outputFormat: ImageOutputFormat;
    outputCompression?: number;
    moderation: ImageModeration;
    referenceImages: ArchivedReferenceImage[];
    mask: { filename: string; sizeBytes: number } | null;
    images: ArchivedOutputImage[];
    usage: OpenAI.Images.ImagesResponse['usage'] | null;
    openaiRequestId: string | null;
    durationMs: number;
    storageMode: 'fs' | 'indexeddb';
    mock: boolean;
    warnings: string[];
};

export function buildImageMetadata(input: BuildMetadataInput): ImageRequestMetadata {
    const requested = parseSize(input.size);
    const first = input.images[0];
    const hasDimensions = !!first && first.width !== null && first.height !== null;
    const sizeMatchesRequest =
        requested && hasDimensions ? requested.width === first.width && requested.height === first.height : null;
    const cost = calculateApiCost(input.usage, input.model);

    return {
        schema_version: IMAGE_METADATA_SCHEMA_VERSION,
        local_request_id: input.localRequestId,
        created_at: input.createdAt,
        mode: input.mode,
        prompt: input.prompt,
        model: input.model,
        size: input.size,
        requested_width: requested?.width ?? null,
        requested_height: requested?.height ?? null,
        quality: input.quality,
        n: input.n,
        background: input.background,
        output_format: input.outputFormat,
        output_compression: input.outputCompression ?? null,
        moderation: input.moderation,
        reference_image_count: input.referenceImages.length,
        reference_images: input.referenceImages,
        has_mask: !!input.mask,
        mask_filename: input.mask?.filename ?? null,
        mask_size_bytes: input.mask?.sizeBytes ?? null,
        output_filename: first?.filename ?? null,
        outputs: input.images,
        actual_width: first?.width ?? null,
        actual_height: first?.height ?? null,
        size_matches_request: sizeMatchesRequest,
        usage: input.usage,
        usage_missing: !input.usage,
        estimated_cost_usd: cost?.estimated_cost_usd ?? null,
        cost_note: cost ? 'usage_token_estimate' : 'unknown_missing_usage',
        openai_request_id: input.openaiRequestId,
        local_duration_ms: input.durationMs,
        storage_mode: input.storageMode,
        is_mock: input.mock,
        warnings: input.warnings
    };
}

export function serializeImageMetadata(metadata: ImageRequestMetadata): string {
    return `${JSON.stringify(metadata, null, 2)}\n`;
}

export function parseSize(size: string): { width: number; height: number } | null {
    const match = /^(\d+)x(\d+)$/.exec(size);
    if (!match) return null;

    const width = Number(match[1]);
    const height = Number(match[2]);
    return Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0 ? { width, height } : null;
}
