'use client';

import { ConfigProvider, theme } from 'antd';
import type { ReactNode } from 'react';

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ConfigProvider
      theme={{
        algorithm: theme.darkAlgorithm,
        token: {
          colorPrimary: '#6366f1',
          borderRadius: 6,
        },
      }}
    >
      {children}
    </ConfigProvider>
  );
}
