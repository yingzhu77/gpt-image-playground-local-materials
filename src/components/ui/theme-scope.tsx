'use client';

import * as React from 'react';

// React context crosses Radix portals; the class explicitly carries the local theme.
export const ThemeScopeContext = React.createContext('');
export function useThemeScope() {
    return React.useContext(ThemeScopeContext);
}
