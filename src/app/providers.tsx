'use client';

import { ConfigProvider, App, theme } from 'antd';
import type { ReactNode } from 'react';

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ConfigProvider
      theme={{
        algorithm: theme.darkAlgorithm,
        token: {
          colorPrimary: '#f97316',
          colorBgContainer: '#1a1a24',
          colorBgElevated: '#1e1e2a',
          colorBgLayout: '#0a0a0f',
          colorBorder: '#1e1e28',
          colorBorderSecondary: '#2a2a38',
          colorText: '#e2e2e8',
          colorTextSecondary: '#8b8b99',
          colorTextTertiary: '#7a7a8e',
          colorSuccess: '#10b981',
          colorWarning: '#f59e0b',
          colorError: '#ef4444',
          colorInfo: '#3b82f6',
          borderRadius: 6,
          borderRadiusLG: 10,
          borderRadiusSM: 4,
          fontFamily: 'var(--font-ui)',
          fontFamilyCode: 'var(--font-code)',
          fontSize: 13,
          controlHeight: 32,
          controlHeightSM: 26,
        },
        components: {
          Button: {
            primaryShadow: 'none',
            defaultBg: '#1a1a24',
            defaultBorderColor: '#1e1e28',
          },
          Input: {
            activeBorderColor: '#f97316',
            hoverBorderColor: '#2a2a38',
            addonBg: '#16161f',
          },
          Select: {
            optionActiveBg: '#22222e',
            optionSelectedBg: 'rgba(249, 115, 22, 0.12)',
          },
          Tree: {
            nodeHoverBg: '#22222e',
            nodeSelectedBg: 'rgba(249, 115, 22, 0.12)',
          },
          Tabs: {
            inkBarColor: '#f97316',
            itemActiveColor: '#f97316',
            itemHoverColor: '#e2e2e8',
            itemSelectedColor: '#f97316',
          },
          Modal: {
            contentBg: '#1a1a24',
            headerBg: '#1a1a24',
          },
          Drawer: {
            colorBgElevated: '#1a1a24',
          },
          Table: {
            headerBg: '#16161f',
            rowHoverBg: '#22222e',
          },
        },
      }}
    >
      <App>{children}</App>
    </ConfigProvider>
  );
}
