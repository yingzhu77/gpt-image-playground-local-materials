import { errorResponse, requireWorkerToken, workbenchJson } from '@/lib/workbench/http';
import { tick } from '@/lib/workbench/runner';
import { NextRequest } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 900;

export async function POST(request: NextRequest) {
    try {
        requireWorkerToken(request);
        const result = await tick();
        return workbenchJson({ ok: true, ...result });
    } catch (error) {
        return errorResponse(error);
    }
}
