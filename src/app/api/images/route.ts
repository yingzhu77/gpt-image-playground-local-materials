import crypto from 'crypto';
import { readImageDimensions } from '@/lib/image-dimensions';
import {
    DEFAULT_GPT_IMAGE_MODEL,
    EXTENDED_QUALITIES,
    IMAGE_OUTPUT_FORMATS,
    isGptImageModel,
    supportsExtendedQuality,
    type GptImageModel,
    type ImageBackground,
    type ImageModeration,
    type ImageOutputFormat,
    type ImageQuality
} from '@/lib/models';
import {
    ConfigurationError,
    getImageApiClient,
    getImageApiDiagnostics,
    hasOpenAiApiKey,
    isImageApiEnabled,
    isImageApiMockMode,
    MockConfigurationError,
    type ImageEditParams
} from '@/lib/server/image-api';
import {
    buildImageMetadata,
    parseSize,
    serializeImageMetadata,
    type ArchivedOutputImage,
    type ArchivedReferenceImage
} from '@/lib/server/metadata';
import {
    ensureDir,
    getMetadataDir,
    getOutputDir,
    writeImageFile,
    writeMetadataFile
} from '@/lib/server/storage';
import { validateCustomSize } from '@/lib/size-utils';
import { NextRequest, NextResponse } from 'next/server';
import type OpenAI from 'openai';

export const runtime = 'nodejs';

// Single-process only. This prevents accidental overlapping submissions in one local server;
// it is not a cross-process or cross-restart exactly-once guarantee.
let imageRequestInFlight = false;

class RequestValidationError extends Error {
    readonly code: string;

    constructor(code: string, message: string) {
        super(message);
        this.name = 'RequestValidationError';
        this.code = code;
    }
}

class UpstreamResponseError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'UpstreamResponseError';
    }
}

type ParsedImageRequest = {
    mode: 'generate' | 'edit';
    prompt: string;
    model: GptImageModel;
    size: string;
    quality: ImageQuality;
    background: ImageBackground;
    outputFormat: ImageOutputFormat;
    outputCompression?: number;
    moderation: ImageModeration;
    imageFiles: File[];
    maskFile: File | null;
};

const IMAGE_BACKGROUNDS: readonly ImageBackground[] = ['auto', 'opaque', 'transparent'];
const IMAGE_MODERATIONS: readonly ImageModeration[] = ['auto', 'low'];
const IMAGE_QUALITIES: readonly ImageQuality[] = ['auto', 'low', 'medium', 'high', 'xhigh', 'max'];
const MAX_EDIT_IMAGES = 16;

export async function POST(request: NextRequest) {
    const startedAt = Date.now();
    const requestId = crypto.randomUUID();
    let mode: ParsedImageRequest['mode'] | null = null;
    let dispatched = false;
    let openaiRequestId: string | null = null;
    let storageMode: 'fs' | 'indexeddb' = 'fs';
    let phase = 'preflight';

    if (!isImageApiEnabled()) {
        return errorResponse(503, 'IMAGE_API_DISABLED', '生成服务未启用：请在 .env.local 设置 ENABLE_IMAGE_API=true 后重启服务。', {
            requestId
        });
    }

    if (!isImageApiMockMode() && !hasOpenAiApiKey()) {
        return errorResponse(
            503,
            'OPENAI_API_KEY_MISSING',
            '生成服务已启用，但服务端未配置 OPENAI_API_KEY。请在 .env.local 填写后重启服务。',
            { requestId }
        );
    }

    if (imageRequestInFlight) {
        return errorResponse(429, 'IMAGE_REQUEST_IN_FLIGHT', '已有生成或编辑请求正在处理，请等待当前请求结束。', {
            requestId
        });
    }
    imageRequestInFlight = true;

    try {
        phase = 'request-body';
        const formData = await request.formData();
        verifyAppPassword(formData);

        phase = 'validate';
        const parsed = await parseImageRequest(formData);
        mode = parsed.mode;
        storageMode = resolveStorageMode();

        if (parsed.mode === 'edit' && parsed.imageFiles.length === 0) {
            throw new RequestValidationError('EDIT_IMAGE_REQUIRED', '编辑模式至少需要一张参考图。');
        }

        phase = 'storage';
        if (storageMode === 'fs') {
            await ensureDir(getOutputDir());
            await ensureDir(getMetadataDir());
        }

        phase = 'dispatch';
        const client = getImageApiClient();
        const imageParams = {
            n: 1,
            size: parsed.size,
            quality: parsed.quality,
            background: parsed.background,
            output_format: parsed.outputFormat,
            moderation: parsed.moderation,
            ...(parsed.outputCompression !== undefined ? { output_compression: parsed.outputCompression } : {})
        };

        dispatched = true;
        const apiResult =
            parsed.mode === 'generate'
                ? await client.generate({ model: parsed.model, prompt: parsed.prompt, ...imageParams })
                : await client.edit({
                      model: parsed.model,
                      prompt: parsed.prompt,
                      image: parsed.imageFiles,
                      ...imageParams,
                      ...(parsed.maskFile ? { mask: parsed.maskFile } : {})
                  } satisfies ImageEditParams);

        openaiRequestId = apiResult.openaiRequestId;

        if (!Array.isArray(apiResult.result.data) || apiResult.result.data.length === 0) {
            throw new UpstreamResponseError('上游响应中没有图片数据。');
        }

        phase = 'save-image';
        const warnings: string[] = [];
        const timestamp = Date.now();
        const outputs: ArchivedOutputImage[] = [];
        const responseImages: Array<{
            filename: string;
            b64_json: string;
            output_format: ImageOutputFormat;
            path?: string;
            width: number | null;
            height: number | null;
            bytes: number;
        }> = [];

        if (apiResult.result.data.length !== 1) {
            warnings.push(`请求为 n=1，但上游返回了 ${apiResult.result.data.length} 张图片；已按原样保存。`);
        }

        for (let index = 0; index < apiResult.result.data.length; index++) {
            const imageData = apiResult.result.data[index];
            if (!imageData.b64_json) {
                throw new UpstreamResponseError(`上游返回的第 ${index + 1} 张图片缺少 base64 数据。`);
            }

            const bytes = Buffer.from(imageData.b64_json, 'base64');
            const filename = `${timestamp}-${index}.${parsed.outputFormat}`;
            if (storageMode === 'fs') {
                await writeImageFile(filename, bytes);
            }

            const detected = readImageDimensions(bytes);
            if (!detected) {
                warnings.push(`无法从第 ${index + 1} 张图片的字节解析实际像素尺寸；原图已保留。`);
            } else if (detected.format !== parsed.outputFormat) {
                warnings.push(
                    `第 ${index + 1} 张图片请求格式为 ${parsed.outputFormat}，字节实际为 ${detected.format}；原图已保留。`
                );
            }

            outputs.push({
                filename,
                output_format: parsed.outputFormat,
                width: detected?.width ?? null,
                height: detected?.height ?? null,
                bytes: bytes.length,
                detected_format: detected?.format ?? null
            });
            responseImages.push({
                filename,
                b64_json: imageData.b64_json,
                output_format: parsed.outputFormat,
                ...(storageMode === 'fs' ? { path: `/api/image/${filename}` } : {}),
                width: detected?.width ?? null,
                height: detected?.height ?? null,
                bytes: bytes.length
            });
        }

        const requestedDimensions = parseSize(parsed.size);
        const first = outputs[0];
        const sizeMismatch =
            !!requestedDimensions &&
            first.width !== null &&
            first.height !== null &&
            (requestedDimensions.width !== first.width || requestedDimensions.height !== first.height);

        if (sizeMismatch && requestedDimensions && first.width !== null && first.height !== null) {
            warnings.push(
                `请求尺寸为 ${parsed.size}，但图片字节的实际尺寸为 ${first.width}x${first.height}；已保留原图，未缩放或重新编码。`
            );
        }

        const usage = apiResult.result.usage ?? null;
        if (!usage) {
            warnings.push('上游响应未包含 usage；费用无法估算，历史记录将显示“未知”。');
        }

        let metadataFile: string | null = null;
        let metadataError: string | null = null;

        phase = 'metadata';
        if (storageMode === 'fs') {
            try {
                const metadata = buildImageMetadata({
                    localRequestId: requestId,
                    createdAt: new Date().toISOString(),
                    mode: parsed.mode,
                    prompt: parsed.prompt,
                    model: parsed.model,
                    size: parsed.size,
                    quality: parsed.quality,
                    n: 1,
                    background: parsed.background,
                    outputFormat: parsed.outputFormat,
                    outputCompression: parsed.outputCompression,
                    moderation: parsed.moderation,
                    referenceImages: toArchivedReferences(parsed.imageFiles),
                    mask: parsed.maskFile
                        ? { filename: parsed.maskFile.name, sizeBytes: parsed.maskFile.size }
                        : null,
                    images: outputs,
                    usage,
                    openaiRequestId,
                    durationMs: Date.now() - startedAt,
                    storageMode,
                    mock: apiResult.mock,
                    warnings
                });
                metadataFile = await writeMetadataFile(requestId, serializeImageMetadata(metadata));
            } catch (error) {
                metadataError = safeMessage(error);
                warnings.push(`原图已保存，但 JSON 元数据归档失败：${metadataError}。未重新生成图片。`);
            }
        }

        console.log('[image-api] completed', {
            requestId,
            openaiRequestId,
            mode: parsed.mode,
            phase: 'complete',
            model: parsed.model,
            size: parsed.size,
            quality: parsed.quality,
            background: parsed.background,
            outputFormat: parsed.outputFormat,
            imageCount: outputs.length,
            mock: apiResult.mock,
            metadataFile,
            durationMs: Date.now() - startedAt
        });

        return NextResponse.json({
            images: responseImages,
            usage,
            usage_missing: !usage,
            request_id: requestId,
            openai_request_id: openaiRequestId,
            metadata_file: metadataFile,
            metadata_error: metadataError,
            warnings,
            size_mismatch: sizeMismatch,
            mock: apiResult.mock
        });
    } catch (error: unknown) {
        const mapped = mapError(error, dispatched);
        const durationMs = Date.now() - startedAt;
        const errorRequestId = extractRequestId(error) ?? openaiRequestId;

        console.error('[image-api] request failed', {
            requestId,
            openaiRequestId: errorRequestId,
            mode,
            phase,
            code: mapped.code,
            status: mapped.status,
            errorName: error instanceof Error ? error.name : typeof error,
            errorMessage: safeMessage(error).slice(0, 300),
            causeChain: collectErrorCauseChain(error),
            dispatched,
            durationMs,
            sdk: getImageApiDiagnostics()
        });

        return errorResponse(mapped.status, mapped.code, mapped.message, {
            requestId,
            openaiRequestId: errorRequestId,
            billableUnknown: dispatched,
            mock: isImageApiMockMode(),
            durationMs,
            extra: mapped.extra
        });
    } finally {
        imageRequestInFlight = false;
    }
}

function errorResponse(
    status: number,
    code: string,
    error: string,
    options: {
        requestId: string;
        openaiRequestId?: string | null;
        billableUnknown?: boolean;
        mock?: boolean;
        durationMs?: number;
        extra?: Record<string, unknown>;
    }
) {
    return NextResponse.json(
        {
            error,
            code,
            request_id: options.requestId,
            openai_request_id: options.openaiRequestId ?? null,
            billable_unknown: options.billableUnknown ?? false,
            mock: options.mock ?? false,
            ...(options.durationMs !== undefined ? { duration_ms: options.durationMs } : {}),
            ...(options.extra ?? {})
        },
        { status }
    );
}

async function parseImageRequest(formData: FormData): Promise<ParsedImageRequest> {
    const modeRaw = formData.get('mode');
    if (modeRaw !== 'generate' && modeRaw !== 'edit') {
        throw new RequestValidationError('INVALID_MODE', '请求模式必须是 generate 或 edit。');
    }
    const mode = modeRaw;

    const promptRaw = formData.get('prompt');
    if (typeof promptRaw !== 'string' || promptRaw.trim().length === 0) {
        throw new RequestValidationError('PROMPT_REQUIRED', '提示词不能为空。');
    }

    const modelRaw = formData.get('model') ?? DEFAULT_GPT_IMAGE_MODEL;
    if (!isGptImageModel(modelRaw)) {
        throw new RequestValidationError('UNSUPPORTED_MODEL', `不支持的模型：${String(modelRaw)}。`);
    }
    const model = modelRaw;

    const nRaw = formData.get('n');
    const n = nRaw === null ? 1 : Number(nRaw);
    if (!Number.isInteger(n) || n !== 1) {
        throw new RequestValidationError('N_MUST_BE_ONE', '本轮固定单次生成一张，n 必须为 1；服务端不会静默改写参数。');
    }

    const sizeRaw = formData.get('size') ?? 'auto';
    if (typeof sizeRaw !== 'string') {
        throw new RequestValidationError('INVALID_SIZE', '尺寸参数格式不正确。');
    }
    if (sizeRaw !== 'auto') {
        const dimensions = parseSize(sizeRaw);
        if (!dimensions) {
            throw new RequestValidationError('INVALID_SIZE', '尺寸必须是 auto 或 WIDTHxHEIGHT 格式。');
        }
        const sizeValidation = validateCustomSize(dimensions.width, dimensions.height);
        if (!sizeValidation.valid) {
            throw new RequestValidationError('INVALID_SIZE', `尺寸不合法：${sizeValidation.reason}`);
        }
    }

    const qualityRaw = (formData.get('quality') as ImageQuality | null) ?? 'auto';
    if (!IMAGE_QUALITIES.includes(qualityRaw)) {
        throw new RequestValidationError('INVALID_QUALITY', `不支持的质量档位：${String(qualityRaw)}。`);
    }
    if (EXTENDED_QUALITIES.includes(qualityRaw) && !supportsExtendedQuality(model)) {
        throw new RequestValidationError('INVALID_QUALITY', `${model} 不支持 ${qualityRaw} 质量档位。`);
    }

    const backgroundRaw = (formData.get('background') as ImageBackground | null) ?? 'auto';
    if (!IMAGE_BACKGROUNDS.includes(backgroundRaw)) {
        throw new RequestValidationError('INVALID_BACKGROUND', `不支持的背景参数：${String(backgroundRaw)}。`);
    }

    const outputFormat = normalizeOutputFormat(formData.get('output_format'));
    if (backgroundRaw === 'transparent' && outputFormat !== 'png') {
        throw new RequestValidationError(
            'TRANSPARENT_REQUIRES_PNG',
            '透明背景只能输出 PNG，服务端已拒绝该组合；请改为 PNG 或非透明背景。'
        );
    }

    const moderationRaw = (formData.get('moderation') as ImageModeration | null) ?? 'auto';
    if (!IMAGE_MODERATIONS.includes(moderationRaw)) {
        throw new RequestValidationError('INVALID_MODERATION', `不支持的审核档位：${String(moderationRaw)}。`);
    }

    let outputCompression: number | undefined;
    if (outputFormat === 'jpeg' || outputFormat === 'webp') {
        const compressionRaw = formData.get('output_compression');
        if (compressionRaw !== null) {
            const compression = Number(compressionRaw);
            if (!Number.isInteger(compression) || compression < 0 || compression > 100) {
                throw new RequestValidationError('INVALID_COMPRESSION', '压缩质量必须是 0 到 100 的整数。');
            }
            outputCompression = compression;
        }
    }

    if (formData.get('stream') === 'true') {
        throw new RequestValidationError('STREAM_NOT_SUPPORTED', '本轮流式预览已关闭；服务端不会自动改写该参数。');
    }

    const imageFiles =
        mode === 'edit'
            ? [...formData.entries()]
                  .filter(([key, value]) => /^image_\d+$/.test(key) && value instanceof File)
                  .sort(([keyA], [keyB]) => imageIndex(keyA) - imageIndex(keyB))
                  .map(([, value]) => value as File)
            : [];

    if (imageFiles.length > MAX_EDIT_IMAGES) {
        throw new RequestValidationError('TOO_MANY_IMAGES', `参考图最多 ${MAX_EDIT_IMAGES} 张。`);
    }
    if (mode === 'edit' && imageFiles.length === 0) {
        throw new RequestValidationError('EDIT_IMAGE_REQUIRED', '编辑模式至少需要一张参考图。');
    }

    const maskValue = formData.get('mask');
    if (maskValue instanceof File && mode === 'generate') {
        throw new RequestValidationError('MASK_NOT_ALLOWED', '生成模式不能携带遮罩。');
    }
    const maskFile = mode === 'edit' && maskValue instanceof File ? maskValue : null;
    if (maskFile) {
        await validateMask(maskFile, imageFiles[0]);
    }

    return {
        mode,
        prompt: promptRaw,
        model,
        size: sizeRaw,
        quality: qualityRaw,
        background: backgroundRaw,
        outputFormat,
        outputCompression,
        moderation: moderationRaw,
        imageFiles,
        maskFile
    };
}

async function validateMask(maskFile: File, firstSource: File | undefined) {
    if (maskFile.type && maskFile.type !== 'image/png') {
        throw new RequestValidationError('INVALID_MASK', '遮罩必须是 PNG 文件。');
    }

    const maskBytes = new Uint8Array(await maskFile.arrayBuffer());
    const maskDimensions = readImageDimensions(maskBytes);
    if (!maskDimensions || maskDimensions.format !== 'png') {
        throw new RequestValidationError('INVALID_MASK', '无法从遮罩字节确认其为 PNG 图片。');
    }

    if (!firstSource) return;

    const sourceBytes = new Uint8Array(await firstSource.arrayBuffer());
    const sourceDimensions = readImageDimensions(sourceBytes);
    if (
        sourceDimensions &&
        (sourceDimensions.width !== maskDimensions.width || sourceDimensions.height !== maskDimensions.height)
    ) {
        throw new RequestValidationError(
            'MASK_SIZE_MISMATCH',
            `遮罩尺寸 ${maskDimensions.width}x${maskDimensions.height} 与第一张参考图 ${sourceDimensions.width}x${sourceDimensions.height} 不一致。`
        );
    }
}

function verifyAppPassword(formData: FormData) {
    if (!process.env.APP_PASSWORD) return;

    const clientPasswordHash = formData.get('passwordHash');
    if (typeof clientPasswordHash !== 'string' || !clientPasswordHash) {
        throw new RequestValidationError('APP_AUTH_REQUIRED', 'Unauthorized: Missing password hash.');
    }

    const serverPasswordHash = crypto.createHash('sha256').update(process.env.APP_PASSWORD).digest('hex');
    if (clientPasswordHash !== serverPasswordHash) {
        throw new RequestValidationError('APP_AUTH_FAILED', 'Unauthorized: Invalid password.');
    }
}

function normalizeOutputFormat(value: FormDataEntryValue | null): ImageOutputFormat {
    const normalized = String(value || 'png')
        .toLowerCase()
        .replace(/^jpg$/, 'jpeg');
    if ((IMAGE_OUTPUT_FORMATS as readonly string[]).includes(normalized)) {
        return normalized as ImageOutputFormat;
    }
    throw new RequestValidationError('INVALID_OUTPUT_FORMAT', `不支持的输出格式：${String(value)}。`);
}

function resolveStorageMode(): 'fs' | 'indexeddb' {
    const explicitMode = process.env.NEXT_PUBLIC_IMAGE_STORAGE_MODE;
    if (explicitMode === 'fs' || explicitMode === 'indexeddb') return explicitMode;
    return process.env.VERCEL === '1' ? 'indexeddb' : 'fs';
}

function toArchivedReferences(files: File[]): ArchivedReferenceImage[] {
    return files.map((file, index) => ({
        index,
        filename: file.name,
        mime_type: file.type || 'application/octet-stream',
        size_bytes: file.size
    }));
}

function imageIndex(key: string): number {
    return Number(key.slice('image_'.length));
}

function mapError(error: unknown, dispatched: boolean) {
    if (error instanceof RequestValidationError) {
        const status = error.code.startsWith('APP_AUTH') ? 401 : 400;
        return { status, code: error.code, message: error.message, extra: undefined as Record<string, unknown> | undefined };
    }
    if (error instanceof ConfigurationError) {
        return { status: 503, code: error.code, message: error.message, extra: undefined };
    }
    if (error instanceof MockConfigurationError) {
        return {
            status: 500,
            code: 'MOCK_CONFIGURATION_ERROR',
            message: `Mock 测试配置错误：${error.message} 未发送任何真实 OpenAI 请求。`,
            extra: undefined
        };
    }
    if (error instanceof UpstreamResponseError) {
        return { status: 502, code: 'UPSTREAM_INVALID_RESPONSE', message: error.message, extra: undefined };
    }

    const status = getErrorStatus(error);
    const message = safeMessage(error);
    const isTimeout = isTimeoutError(error) && (status === undefined || status === 408 || status === 504);

    if (isTimeout) {
        const timeoutCode = findCauseCode(error);
        const message =
            timeoutCode === 'UND_ERR_CONNECT_TIMEOUT'
                ? '连接 OpenAI 超时：Node 在超时前未能建立网络连接。请检查 Node 代理（HTTP_PROXY/HTTPS_PROXY/NODE_USE_ENV_PROXY）、DNS 或网络。本地不会自动重试；是否到达上游及计费请以 OpenAI 账单为准。'
                : timeoutCode === 'UND_ERR_HEADERS_TIMEOUT'
                  ? '等待 OpenAI 响应头超时：传输层先于 SDK 超时。请检查代理/undici 的 headersTimeout 是否与 SDK timeout 匹配。本地不会自动重试；是否计费请以 OpenAI 账单为准。'
                  : 'OpenAI 请求超时，本地不会自动重试或换模型。请求可能已到达上游，是否计费请以 OpenAI 账单为准。';
        return {
            status: 504,
            code: 'UPSTREAM_TIMEOUT',
            message,
            extra: undefined
        };
    }
    if (status === 401) {
        return {
            status: 401,
            code: 'UPSTREAM_AUTH_ERROR',
            message: 'OpenAI 鉴权失败（401）：请检查服务端 OPENAI_API_KEY 是否有效。是否计费请以 OpenAI 账单为准。',
            extra: undefined
        };
    }
    if (status === 403) {
        return {
            status: 403,
            code: 'UPSTREAM_PERMISSION_ERROR',
            message: 'OpenAI 权限不足（403）：请检查组织验证、模型权限或项目访问权限。',
            extra: undefined
        };
    }
    if (status === 429) {
        return {
            status: 429,
            code: 'UPSTREAM_RATE_LIMIT',
            message: 'OpenAI 限流（429）：请稍后手动重试，本地不会自动重发。请求可能已到达上游，是否计费请以账单为准。',
            extra: undefined
        };
    }
    if (status === 400) {
        return {
            status: 400,
            code: 'UPSTREAM_BAD_REQUEST',
            message: `OpenAI 拒绝了请求参数（400）：${message}`,
            extra: undefined
        };
    }
    if (status !== undefined && status >= 500) {
        return {
            status: 502,
            code: 'UPSTREAM_SERVER_ERROR',
            message: `OpenAI 服务端错误（${status}）：${message}。请求可能已到达上游，是否计费请以账单为准。`,
            extra: undefined
        };
    }

    return {
        status: dispatched ? 502 : 500,
        code: dispatched ? 'UPSTREAM_ERROR' : 'LOCAL_ERROR',
        message: dispatched ? `上游请求失败：${message}` : `本地处理失败：${message}`,
        extra: undefined
    };
}

function getErrorStatus(error: unknown): number | undefined {
    if (typeof error !== 'object' || error === null) return undefined;
    if ('status' in error && typeof error.status === 'number') return error.status;
    return undefined;
}

const TIMEOUT_CODES = new Set([
    'ETIMEDOUT',
    'APIConnectionTimeoutError',
    'UND_ERR_CONNECT_TIMEOUT',
    'UND_ERR_HEADERS_TIMEOUT',
    'UND_ERR_BODY_TIMEOUT'
]);

function isTimeoutError(error: unknown): boolean {
    let current: unknown = error;
    const seen = new Set<unknown>();
    let depth = 0;

    while (current !== null && current !== undefined && depth < 6 && !seen.has(current)) {
        seen.add(current);
        if (typeof current === 'object') {
            const item = current as Record<string, unknown>;
            if (typeof item.name === 'string' && /timeout/i.test(item.name)) return true;
            if (typeof item.code === 'string' && TIMEOUT_CODES.has(item.code)) return true;
            if (typeof item.message === 'string' && /timed? ?out/i.test(item.message)) return true;
            current = 'cause' in item ? item.cause : undefined;
        } else {
            break;
        }
        depth++;
    }

    return false;
}

function findCauseCode(error: unknown): string | undefined {
    let current: unknown = error;
    const seen = new Set<unknown>();
    let depth = 0;

    while (current !== null && current !== undefined && depth < 6 && !seen.has(current)) {
        seen.add(current);
        if (typeof current === 'object') {
            const item = current as Record<string, unknown>;
            if (typeof item.code === 'string') return item.code;
            current = 'cause' in item ? item.cause : undefined;
        } else {
            break;
        }
        depth++;
    }

    return undefined;
}

function collectErrorCauseChain(error: unknown) {
    const chain: Array<{ name: string; message: string; code?: string; status?: number }> = [];
    const seen = new Set<unknown>();
    let current: unknown = error;
    let depth = 0;

    while (current !== null && current !== undefined && depth < 6 && !seen.has(current)) {
        seen.add(current);

        if (typeof current === 'object') {
            const item = current as Record<string, unknown>;
            const entry: { name: string; message: string; code?: string; status?: number } = {
                name: typeof item.name === 'string' ? item.name : 'Error',
                message:
                    typeof item.message === 'string'
                        ? item.message.slice(0, 300)
                        : String(current).slice(0, 300)
            };
            if (typeof item.code === 'string') entry.code = item.code;
            if (typeof item.status === 'number') entry.status = item.status;
            chain.push(entry);
            current = 'cause' in item ? item.cause : undefined;
        } else {
            chain.push({ name: typeof current, message: String(current).slice(0, 300) });
            current = undefined;
        }
        depth++;
    }

    return chain;
}

function extractRequestId(error: unknown): string | null {
    if (typeof error !== 'object' || error === null) return null;
    if ('request_id' in error && typeof error.request_id === 'string') return error.request_id;
    if ('requestID' in error && typeof error.requestID === 'string') return error.requestID;
    return null;
}

function safeMessage(error: unknown): string {
    if (error instanceof Error) return error.message;
    if (typeof error === 'string') return error;
    return '未知错误';
}
