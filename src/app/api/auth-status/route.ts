import { getImageApiConfiguration } from '@/lib/server/image-api';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
    const appPasswordSet = !!process.env.APP_PASSWORD;
    const imageApi = getImageApiConfiguration();
    return NextResponse.json(
        {
            passwordRequired: appPasswordSet,
            imageApiEnabled: imageApi.enabled,
            apiKeyConfigured: imageApi.apiKeyConfigured,
            apiKeySource: imageApi.apiKeySource,
            imageApiMock: imageApi.mock
        },
        {
            headers: {
                'Cache-Control': 'no-store'
            }
        }
    );
}
