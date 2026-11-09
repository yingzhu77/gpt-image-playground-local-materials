'use client';

import * as React from 'react';

export function ThemeArtwork({ compact = false }: { compact?: boolean }) {
    const [failed, setFailed] = React.useState(false);
    return (
        <figure className={compact ? 'wb-theme-artwork' : 'wb-home-artwork'}>
            {failed ? (
                <div className='border-wb-border bg-wb-subtle text-wb-muted flex aspect-video items-center justify-center rounded-lg border text-sm'>
                    主题图未载入
                </div>
            ) : (
                <img
                    src='/local-theme/min-arknights-6th-laterano.webp'
                    width={1920}
                    height={1080}
                    alt='min 绘制的明日方舟六周年拉特兰贺图：街道、红色巴士、白鸽与水面倒影'
                    className='aspect-video w-full rounded-lg object-contain'
                    onError={() => setFailed(true)}
                />
            )}
            <figcaption className='text-wb-muted mt-2 flex flex-wrap justify-between gap-1 text-xs leading-relaxed'>
                <span>明日方舟六周年 · 拉特兰</span>
                <a
                    href='https://weibo.com/2828274924/5161281230737624'
                    target='_blank'
                    rel='noreferrer'
                    className='underline underline-offset-4'>
                    画师 min · 来源
                </a>
            </figcaption>
        </figure>
    );
}
