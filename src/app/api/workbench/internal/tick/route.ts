import { errorResponse, requireLocalRequestSlot, requireWorkerToken, workbenchJson } from '@/lib/workbench/http';
import { tick } from '@/lib/workbench/runner';
import { NextRequest } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 900;

export async function POST(request: NextRequest) {
    let release: (() => void) | undefined;
    try {
        requireWorkerToken(request);
        release = requireLocalRequestSlot();
        const result = await tick();
        return workbenchJson({ ok: true, ...result });
    } catch (error) {
        return errorResponse(error);
    } finally {
        release?.();
    }
}
