import type { ImageModeration } from '@/lib/models';
import { auditImageRequest, type ImageRequestMetadata } from '@/lib/server/image-request-diagnostics';
import {
    getApiKeySource,
    getEffectiveApiKey,
    hasOpenAiApiKey as hasRuntimeOpenAiApiKey,
    isImageApiEnabled as isRuntimeImageApiEnabled
} from '@/lib/server/runtime-config';
import { isWorkbenchFixtureTest } from '@/lib/workbench/config';
import fs from 'fs/promises';
import crypto from 'node:crypto';
import OpenAI from 'openai';
import path from 'path';

export type ImageEditParams = OpenAI.Images.ImageEditParamsNonStreaming & {
    moderation?: ImageModeration;
    markup?: File;
};

// Long edit requests can outlive idle network limits; partial images keep the SSE response active.
const STREAM_PARTIAL_IMAGES = 2;

export type ImageApiCallResult = {
    result: OpenAI.Images.ImagesResponse;
    openaiRequestId: string | null;
    mock: boolean;
};

export interface ImageApiClient {
    readonly mock: boolean;
    generate(params: OpenAI.Images.ImageGenerateParamsNonStreaming): Promise<ImageApiCallResult>;
    edit(params: ImageEditParams): Promise<ImageApiCallResult>;
}

export class ConfigurationError extends Error {
    readonly code: string;

    constructor(code: string, message: string) {
        super(message);
        this.name = 'ConfigurationError';
        this.code = code;
    }
}

export class FixtureConfigurationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'FixtureConfigurationError';
    }
}

export class ImageStreamError extends Error {
    readonly request_id: string | null;
    readonly partialImageCount: number;
    readonly lastEventType: string | null;

    constructor(
        message: string,
        options: {
            cause?: unknown;
            requestId: string | null;
            partialImageCount: number;
            lastEventType: string | null;
        }
    ) {
        super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
        this.name = 'ImageStreamError';
        this.request_id = options.requestId;
        this.partialImageCount = options.partialImageCount;
        this.lastEventType = options.lastEventType;
    }
}

export function isImageApiEnabled(): boolean {
    return isRuntimeImageApiEnabled();
}

export function hasOpenAiApiKey(): boolean {
    return hasRuntimeOpenAiApiKey();
}

/**
 * Test-only fixture provider. It replaces the SDK client entirely and can never fall back
 * to the real network. Production builds refuse to activate it.
 */
export function isImageApiFixtureTest(): boolean {
    if (process.env.IMAGE_API_MOCK_FIXTURE_DIR?.trim()) {
        throw new FixtureConfigurationError(
            '旧模拟运行配置已移除，请删除 IMAGE_API_MOCK_FIXTURE_DIR；未发送真实请求。'
        );
    }
    if (!process.env.IMAGE_API_TEST_FIXTURE_DIR?.trim()) return false;
    if (!isWorkbenchFixtureTest()) {
        throw new FixtureConfigurationError('图片夹具只允许隔离自动化测试使用；未发送真实请求。');
    }
    return true;
}

export function getImageApiConfiguration() {
    return {
        enabled: isImageApiEnabled(),
        apiKeyConfigured: hasOpenAiApiKey(),
        apiKeySource: getApiKeySource(),
        testFixture: isImageApiFixtureTest()
    };
}

export function getImageApiDiagnostics() {
    return {
        timeoutMs: openAiClient?.timeout ?? OpenAI.DEFAULT_TIMEOUT,
        maxRetries: 0,
        testFixture: isImageApiFixtureTest(),
        nodeUseEnvProxy: process.env.NODE_USE_ENV_PROXY === '1',
        proxy: describeProxyForLogs()
    };
}

function describeProxyForLogs() {
    const raw = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.ALL_PROXY;
    if (!raw) return { configured: false };

    try {
        const parsed = new URL(raw);
        return {
            configured: true,
            protocol: parsed.protocol,
            host: parsed.hostname,
            port: parsed.port || null
        };
    } catch {
        return { configured: true, protocol: 'unknown', host: 'unparseable', port: null };
    }
}

let openAiClient: OpenAI | null = null;
let openAiClientApiKey: string | null = null;
let fixtureClient: FixtureImageApiClient | null = null;

export type ImageRequestContext = Pick<ImageRequestMetadata, 'localRequestId' | 'runId' | 'itemId'>;

export function getImageApiClient(context?: ImageRequestContext): ImageApiClient {
    if (isImageApiFixtureTest()) {
        fixtureClient ??= new FixtureImageApiClient(process.env.IMAGE_API_TEST_FIXTURE_DIR!.trim());
        return fixtureClient;
    }

    const apiKey = getEffectiveApiKey();
    if (!apiKey) {
        throw new ConfigurationError('OPENAI_API_KEY_MISSING', '服务端未配置 OPENAI_API_KEY。');
    }

    if (!openAiClient || openAiClientApiKey !== apiKey) {
        openAiClient = new OpenAI({
            apiKey,
            maxRetries: 0
        });
        openAiClientApiKey = apiKey;
    }

    return new OpenAiImageApiClient(openAiClient, context);
}

class OpenAiImageApiClient implements ImageApiClient {
    readonly mock = false;

    constructor(
        private readonly client: OpenAI,
        private readonly context?: ImageRequestContext
    ) {}

    private metadata(
        operation: 'generate' | 'edit',
        params: OpenAI.Images.ImageGenerateParamsNonStreaming | ImageEditParams
    ): ImageRequestMetadata {
        return {
            localRequestId: this.context?.localRequestId ?? crypto.randomUUID(),
            runId: this.context?.runId,
            itemId: this.context?.itemId,
            operation,
            model: String(params.model ?? ''),
            size: params.size,
            quality: params.quality,
            n: params.n,
            sdkTimeoutMs: this.client.timeout,
            maxRetries: 0
        };
    }

    async generate(params: OpenAI.Images.ImageGenerateParamsNonStreaming): Promise<ImageApiCallResult> {
        let httpStatus: number | undefined;
        return auditImageRequest(
            this.metadata('generate', params),
            async () => {
                const { data, request_id, response } = await this.client.images.generate(params).withResponse();
                httpStatus = response.status;
                return { result: data, openaiRequestId: request_id, mock: false };
            },
            (value) => ({ httpStatus, upstreamRequestId: value.openaiRequestId })
        );
    }

    async edit(params: ImageEditParams): Promise<ImageApiCallResult> {
        let httpStatus: number | undefined;
        let upstreamRequestId: string | null = null;
        return auditImageRequest(
            this.metadata('edit', params),
            async () => {
                const {
                    data: stream,
                    request_id,
                    response
                } = await this.client.images
                    .edit({ ...params, stream: true, partial_images: STREAM_PARTIAL_IMAGES })
                    .withResponse();
                httpStatus = response.status;
                upstreamRequestId = request_id;

                let completed: OpenAI.Images.ImageEditCompletedEvent | null = null;
                let partialImageCount = 0;
                let lastEventType: string | null = null;

                try {
                    for await (const event of stream) {
                        lastEventType = event.type;
                        if (event.type === 'image_edit.partial_image') {
                            partialImageCount++;
                        }
                        if (event.type === 'image_edit.completed') {
                            completed = event;
                        }
                    }
                } catch (error) {
                    const status =
                        typeof error === 'object' &&
                        error !== null &&
                        'status' in error &&
                        typeof error.status === 'number'
                            ? error.status
                            : undefined;
                    if (status !== undefined) {
                        throw error;
                    }

                    throw new ImageStreamError(`OpenAI 流式编辑连接中断（已收到 ${partialImageCount} 个部分图）。`, {
                        cause: error,
                        requestId: request_id,
                        partialImageCount,
                        lastEventType
                    });
                }

                if (!completed) {
                    throw new ImageStreamError(
                        `OpenAI 流式编辑响应结束，但没有返回最终图片（已收到 ${partialImageCount} 个部分图）。`,
                        {
                            requestId: request_id,
                            partialImageCount,
                            lastEventType
                        }
                    );
                }

                const result = {
                    created: completed.created_at,
                    data: [{ b64_json: completed.b64_json }],
                    background: completed.background,
                    output_format: completed.output_format,
                    quality: completed.quality,
                    size: completed.size,
                    usage: completed.usage
                } as OpenAI.Images.ImagesResponse;

                return { result, openaiRequestId: request_id, mock: false };
            },
            (value) => ({ httpStatus, upstreamRequestId: value.openaiRequestId }),
            () => ({ httpStatus, upstreamRequestId })
        );
    }
}

type MockScenario = {
    error?: 'rate_limit' | 'unauthorized' | 'forbidden' | 'timeout' | 'server' | 'connection';
    usage?: 'present' | 'missing';
    requestId?: string | null;
    delayMs?: number;
    fixture?: string;
};

class MockUpstreamError extends Error {
    readonly status: number;

    constructor(name: string, message: string, status: number) {
        super(message);
        this.name = name;
        this.status = status;
    }
}

const MOCK_USAGE: OpenAI.Images.ImagesResponse['usage'] = {
    input_tokens: 12,
    output_tokens: 272,
    total_tokens: 284,
    input_tokens_details: { text_tokens: 12, image_tokens: 0 },
    output_tokens_details: { image_tokens: 272, text_tokens: 0 }
};

class FixtureImageApiClient implements ImageApiClient {
    readonly mock = true;
    private readonly fixtureDir: string;

    constructor(fixtureDir: string) {
        this.fixtureDir = path.resolve(/*turbopackIgnore: true*/ process.cwd(), fixtureDir);
    }

    generate(params: OpenAI.Images.ImageGenerateParamsNonStreaming): Promise<ImageApiCallResult> {
        return this.respond('generate', params);
    }

    edit(params: ImageEditParams): Promise<ImageApiCallResult> {
        return this.respond('edit', params);
    }

    private async respond(
        operation: 'generate' | 'edit',
        params: OpenAI.Images.ImageGenerateParamsNonStreaming | ImageEditParams
    ): Promise<ImageApiCallResult> {
        const scenario = await this.readScenario();
        await this.writeLog(operation, params, scenario);

        if (scenario.delayMs) {
            await new Promise((resolve) => setTimeout(resolve, scenario.delayMs));
        }

        if (scenario.error) {
            throw this.createError(scenario.error);
        }

        const size = typeof params.size === 'string' ? params.size : 'auto';
        const background = params.background ?? 'auto';
        const format = params.output_format ?? 'png';
        let bytes = await this.readFixture(size, background, format, scenario.fixture);
        if (process.env.IMAGE_API_TEST_UNIQUE === '1') {
            bytes = injectPngText(bytes, 'MockNonce', crypto.randomUUID());
        }
        const usage = scenario.usage === 'missing' ? undefined : MOCK_USAGE;

        const result = {
            created: Math.floor(Date.now() / 1000),
            data: [{ b64_json: bytes.toString('base64') }],
            background,
            output_format: format,
            quality: params.quality,
            size,
            usage
        } as OpenAI.Images.ImagesResponse;

        return {
            result,
            openaiRequestId: scenario.requestId ?? null,
            mock: true
        };
    }

    private async readScenario(): Promise<MockScenario> {
        const scenarioFile = process.env.IMAGE_API_TEST_SCENARIO_FILE?.trim();
        if (!scenarioFile) return {};

        try {
            const content = await fs.readFile(
                path.resolve(/*turbopackIgnore: true*/ process.cwd(), scenarioFile),
                'utf8'
            );
            return JSON.parse(content) as MockScenario;
        } catch (error) {
            throw new FixtureConfigurationError(
                `无法读取 mock 场景文件：${error instanceof Error ? error.message : String(error)}`
            );
        }
    }

    private async readFixture(
        size: string,
        background: string,
        format: string,
        forcedFixture?: string
    ): Promise<Buffer> {
        if (forcedFixture) {
            const filename = path.basename(forcedFixture);
            try {
                return await fs.readFile(path.join(/*turbopackIgnore: true*/ this.fixtureDir, filename));
            } catch (error) {
                throw new FixtureConfigurationError(
                    `无法读取指定的 mock fixture ${filename}：${error instanceof Error ? error.message : String(error)}`
                );
            }
        }

        const safeSize = size.replace(/[^0-9a-zA-Z_-]/g, '_');
        const safeBackground = background.replace(/[^0-9a-zA-Z_-]/g, '_');
        const safeFormat = format.replace(/[^0-9a-zA-Z_-]/g, '_');
        const candidates = [
            `${safeSize}_${safeBackground}.${safeFormat}`,
            `${safeSize}.${safeFormat}`,
            `default_${safeBackground}.${safeFormat}`,
            `default.${safeFormat}`
        ];

        for (const filename of candidates) {
            try {
                return await fs.readFile(path.join(/*turbopackIgnore: true*/ this.fixtureDir, filename));
            } catch (error) {
                if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') {
                    continue;
                }
                throw new FixtureConfigurationError(
                    `读取 mock 图片失败 ${filename}：${error instanceof Error ? error.message : String(error)}`
                );
            }
        }

        throw new FixtureConfigurationError(
            `缺少 mock 图片 fixture（尝试过：${candidates.join(', ')}），不会回退到真实 OpenAI 请求。`
        );
    }

    private createError(kind: NonNullable<MockScenario['error']>): Error {
        if (kind === 'rate_limit') {
            return new MockUpstreamError('RateLimitError', 'Mock rate limit (429).', 429);
        }
        if (kind === 'unauthorized') {
            return new MockUpstreamError('AuthenticationError', 'Mock unauthorized (401).', 401);
        }
        if (kind === 'forbidden') {
            return new MockUpstreamError('PermissionDeniedError', 'Mock forbidden (403).', 403);
        }
        if (kind === 'timeout') {
            return new MockUpstreamError('APIConnectionTimeoutError', 'Mock request timeout.', 408);
        }
        if (kind === 'connection') {
            return new TypeError('Mock connection reset after dispatch.');
        }
        return new MockUpstreamError('InternalServerError', 'Mock upstream error (500).', 500);
    }

    private async writeLog(
        operation: 'generate' | 'edit',
        params: OpenAI.Images.ImageGenerateParamsNonStreaming | ImageEditParams,
        scenario: MockScenario
    ): Promise<void> {
        const logFile = process.env.IMAGE_API_TEST_LOG?.trim();
        if (!logFile) return;

        const imageFiles = operation === 'edit' ? toFileList((params as ImageEditParams).image) : [];
        const mask = operation === 'edit' ? (params as ImageEditParams).mask : undefined;
        const entry = {
            mock: true,
            timestamp: new Date().toISOString(),
            operation,
            prompt: params.prompt,
            model: params.model,
            size: params.size,
            quality: params.quality,
            complexity: (params as { complexity?: string }).complexity,
            has_markup: operation === 'edit' && !!(params as ImageEditParams).markup,
            n: params.n,
            background: params.background,
            output_format: params.output_format,
            moderation: params.moderation,
            output_compression: params.output_compression,
            image_filenames: imageFiles.map((file) => file.name),
            has_mask: !!mask,
            mask_filename: mask instanceof File ? mask.name : null,
            usage: scenario.usage ?? 'present',
            error: scenario.error ?? null,
            fixture: scenario.fixture ?? null
        };

        try {
            await fs.appendFile(
                path.resolve(/*turbopackIgnore: true*/ process.cwd(), logFile),
                `${JSON.stringify(entry)}\n`,
                'utf8'
            );
        } catch (error) {
            throw new FixtureConfigurationError(
                `无法写入 mock 日志：${error instanceof Error ? error.message : String(error)}`
            );
        }
    }
}

const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let index = 0; index < 256; index++) {
        let value = index;
        for (let bit = 0; bit < 8; bit++) {
            value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
        }
        table[index] = value >>> 0;
    }
    return table;
})();

function crc32(bytes: Buffer): number {
    let crc = 0xffffffff;
    for (const byte of bytes) {
        crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
}

/** Mock-only: give each generated fixture distinct bytes without touching IDAT pixels. */
function injectPngText(bytes: Buffer, keyword: string, value: string): Buffer {
    if (bytes.length < 33 || bytes[0] !== 0x89 || bytes.subarray(1, 4).toString('ascii') !== 'PNG') return bytes;
    const iend = bytes.lastIndexOf(Buffer.from([0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]));
    if (iend < 0) return bytes;
    const data = Buffer.concat([Buffer.from(keyword, 'latin1'), Buffer.from([0]), Buffer.from(value, 'latin1')]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length, 0);
    const type = Buffer.from('tEXt', 'ascii');
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([type, data])), 0);
    const chunk = Buffer.concat([length, type, data, crc]);
    return Buffer.concat([bytes.subarray(0, iend), chunk, bytes.subarray(iend)]);
}

function toFileList(image: ImageEditParams['image']): File[] {
    if (!image) return [];
    return Array.isArray(image) ? image.filter((item): item is File => item instanceof File) : [image as File];
}
