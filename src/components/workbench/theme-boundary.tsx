'use client';

import { ThemeScopeContext } from '@/components/ui/theme-scope';
import * as React from 'react';

export function ThemeBoundary({ children }: { children: React.ReactNode }) {
    return (
        <ThemeScopeContext.Provider value='workbench-theme'>
            <div className='workbench-theme' lang='zh-CN'>
                {children}
            </div>
        </ThemeScopeContext.Provider>
    );
}
