import { errorResponse, requireLoopbackHost, workbenchJson } from '@/lib/workbench/http';
import { getWorkbenchStatus } from '@/lib/workbench/service';
import { NextRequest } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
    try {
        requireLoopbackHost(request);
        return workbenchJson({ status: getWorkbenchStatus() });
    } catch (error) {
        return errorResponse(error);
    }
}
