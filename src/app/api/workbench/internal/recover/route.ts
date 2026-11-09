import { errorResponse, requireWorkerToken, workbenchJson } from '@/lib/workbench/http';
import { recoverAllSendingOnWorkerStart } from '@/lib/workbench/store';
import { NextRequest } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
    try {
        requireWorkerToken(request);
        const recovered = recoverAllSendingOnWorkerStart();
        return workbenchJson({ ok: true, recovered });
    } catch (error) {
        return errorResponse(error);
    }
}
