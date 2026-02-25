'use client';

import { useEffect, useRef, useCallback } from 'react';
import { App, Progress, Button, Typography } from 'antd';
import { check } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';

const { Text } = Typography;

const UPDATE_CHECK_DELAY_MS = 3000;
const NOTIFICATION_KEY = 'app-update';

export function UpdateChecker() {
  const { notification } = App.useApp();
  const checkedRef = useRef(false);

  const performUpdate = useCallback(
    async (update: Awaited<ReturnType<typeof check>>) => {
      if (!update) return;

      notification.open({
        key: NOTIFICATION_KEY,
        message: 'Downloading Update',
        description: (
          <div>
            <Text style={{ color: 'var(--text-secondary)' }}>
              Downloading v{update.version}...
            </Text>
            <Progress percent={0} size="small" status="active" />
          </div>
        ),
        duration: 0,
        placement: 'bottomRight',
      });

      try {
        let contentLength = 0;
        let downloaded = 0;

        await update.downloadAndInstall((event) => {
          switch (event.event) {
            case 'Started':
              contentLength = event.data.contentLength ?? 0;
              break;
            case 'Progress':
              downloaded += event.data.chunkLength;
              if (contentLength > 0) {
                const pct = Math.round((downloaded / contentLength) * 100);
                notification.open({
                  key: NOTIFICATION_KEY,
                  message: 'Downloading Update',
                  description: (
                    <div>
                      <Text style={{ color: 'var(--text-secondary)' }}>
                        Downloading v{update.version}...
                      </Text>
                      <Progress percent={pct} size="small" status="active" />
                    </div>
                  ),
                  duration: 0,
                  placement: 'bottomRight',
                });
              }
              break;
            case 'Finished':
              break;
          }
        });

        notification.open({
          key: NOTIFICATION_KEY,
          message: 'Update Ready',
          description: (
            <div>
              <Text style={{ color: 'var(--text-secondary)' }}>
                v{update.version} has been installed. Restart to apply.
              </Text>
              <div style={{ marginTop: 8 }}>
                <Button
                  type="primary"
                  size="small"
                  onClick={() => relaunch()}
                >
                  Restart Now
                </Button>
              </div>
            </div>
          ),
          duration: 0,
          placement: 'bottomRight',
        });
      } catch {
        notification.error({
          key: NOTIFICATION_KEY,
          message: 'Update Failed',
          description: 'Failed to download the update. Please try again later.',
          placement: 'bottomRight',
        });
      }
    },
    [notification],
  );

  const checkForUpdate = useCallback(async () => {
    try {
      const update = await check();
      if (!update) return;

      notification.info({
        key: NOTIFICATION_KEY,
        message: 'Update Available',
        description: (
          <div>
            <Text style={{ color: 'var(--text-secondary)' }}>
              Version {update.version} is available.
            </Text>
            <div style={{ marginTop: 8 }}>
              <Button
                type="primary"
                size="small"
                onClick={() => performUpdate(update)}
              >
                Update Now
              </Button>
            </div>
          </div>
        ),
        duration: 0,
        placement: 'bottomRight',
      });
    } catch {
      // Silently ignore update check failures (network issues, dev mode, etc.)
    }
  }, [notification, performUpdate]);

  useEffect(() => {
    if (checkedRef.current) return;
    checkedRef.current = true;

    const timer = setTimeout(checkForUpdate, UPDATE_CHECK_DELAY_MS);
    return () => clearTimeout(timer);
  }, [checkForUpdate]);

  return null;
}
