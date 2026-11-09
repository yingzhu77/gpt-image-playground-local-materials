import { ConfigurationError, hasOpenAiApiKey } from '@/lib/server/image-api';
import { getEffectiveApiKey } from '@/lib/server/runtime-config';
import { StructuredOutputError } from '@/lib/workbench/schema';
import OpenAI from 'openai';

export type TextUsage = {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
    input_tokens_details?: { text_tokens?: number; image_tokens?: number };
};

export type StructuredCallResult = {
    json: unknown;
    usage: TextUsage | null;
    responseId: string | null;
    model: string;
};

let client: OpenAI | null = null;
let clientKey: string | null = null;

export function getTextClient(): OpenAI {
    if (!hasOpenAiApiKey()) {
        throw new ConfigurationError('OPENAI_API_KEY_MISSING', '服务端未配置 OPENAI_API_KEY。');
    }
    const apiKey = getEffectiveApiKey()!;
    if (!client || clientKey !== apiKey) {
        client = new OpenAI({ apiKey, maxRetries: 0, timeout: 180_000 });
        clientKey = apiKey;
    }
    return client;
}

function stripFences(text: string): string {
    const trimmed = text.trim();
    if (trimmed.startsWith('```')) {
        return trimmed.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
    }
    return trimmed;
}

export async function callStructuredJson(input: {
    model: string;
    system: string;
    userText: string;
    images?: { mime: string; base64: string; detail?: 'low' | 'high' | 'auto' }[];
    schema: { name: string; schema: Record<string, unknown> };
    maxOutputTokens?: number;
    reasoningEffort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
}): Promise<StructuredCallResult> {
    const openai = getTextClient();
    const content: OpenAI.Responses.ResponseInputContent[] = [
        { type: 'input_text', text: input.userText },
        ...(input.images ?? []).map((image) => ({
            type: 'input_image' as const,
            image_url: `data:${image.mime};base64,${image.base64}`,
            detail: image.detail ?? 'high'
        }))
    ];

    const { data, response } = await openai.responses
        .create({
            model: input.model,
            instructions: input.system,
            input: [{ role: 'user', content }],
            text: {
                format: {
                    type: 'json_schema',
                    name: input.schema.name,
                    schema: input.schema.schema,
                    strict: true
                }
            },
            store: false,
            max_output_tokens: input.maxOutputTokens ?? 4096,
            ...(input.reasoningEffort ? { reasoning: { effort: input.reasoningEffort } } : {})
        })
        .withResponse();

    const text = typeof data.output_text === 'string' ? data.output_text.trim() : '';
    if (!text) {
        throw new StructuredOutputError('模型没有返回可解析的结构化文本。');
    }

    let json: unknown;
    try {
        json = JSON.parse(stripFences(text));
    } catch (error) {
        throw new StructuredOutputError(
            `结构化输出不是有效 JSON：${error instanceof Error ? error.message : String(error)}`
        );
    }

    return {
        json,
        usage: (data.usage as TextUsage | null) ?? null,
        responseId: data.id ?? response.headers.get('x-request-id'),
        model: input.model
    };
}

export async function callResponsesRaw<T>(body: Record<string, unknown>): Promise<{ data: T; requestId: string | null }> {
    const openai = getTextClient();
    const { data, response } = await openai.post<T>('/responses', { body }).withResponse();
    return { data, requestId: response.headers.get('x-request-id') };
}
