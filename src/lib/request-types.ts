import type {
    GptImageModel,
    ImageBackground,
    ImageModeration,
    ImageOutputFormat,
    ImageQuality
} from '@/lib/models';

export type RequestReferenceImage = {
    name: string;
    file: File;
};

export type RequestSnapshot = {
    mode: 'generate' | 'edit';
    prompt: string;
    model: GptImageModel;
    size: string;
    quality: ImageQuality;
    n: 1;
    background: ImageBackground;
    output_format: ImageOutputFormat;
    output_compression?: number;
    moderation: ImageModeration;
    referenceImages: RequestReferenceImage[];
    mask: RequestReferenceImage | null;
};
