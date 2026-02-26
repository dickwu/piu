'use client';

import { Select, Button } from 'antd';
import { HistoryOutlined } from '@ant-design/icons';
import { useState, useEffect } from 'react';
import { useEnvironmentStore } from '../stores/environmentStore';
import { useProjectStore } from '../stores/projectStore';
import { ChangelogModal } from './ChangelogModal';

export function EnvironmentBar() {
  const {
    environments,
    activeEnvironment,
    setActiveEnvironment,
    loadVariables,
  } = useEnvironmentStore();

  const activeProjectId = useProjectStore((s) => s.activeProjectId);
  const [showChangelog, setShowChangelog] = useState(false);

  useEffect(() => {
    if (activeEnvironment) {
      loadVariables(activeEnvironment.id);
    }
  }, [activeEnvironment, loadVariables]);

  return (
    <>
      <div
        className="flex items-center justify-between border-b px-4 py-1.5"
        style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg-secondary)' }}
      >
        <div className="flex items-center gap-2">
          <span
            className="text-xs font-semibold uppercase tracking-wider"
            style={{ color: 'var(--text-tertiary)', fontFamily: 'var(--font-ui)' }}
          >
            Env
          </span>
          <Select
            size="small"
            style={{ width: 220 }}
            placeholder="No Environment"
            value={activeEnvironment?.id}
            onChange={(id) => {
              if (activeProjectId) {
                setActiveEnvironment(id, activeProjectId);
              }
            }}
            options={environments.map((env) => ({
              label: (
                <span>
                  {env.name}
                  {env.host && (
                    <span
                      style={{
                        color: 'var(--text-tertiary)',
                        fontSize: 10,
                        marginLeft: 4,
                        fontFamily: 'var(--font-code)',
                      }}
                    >
                      {env.host}
                    </span>
                  )}
                </span>
              ),
              value: env.id,
            }))}
          />
        </div>
        <Button
          size="small"
          icon={<HistoryOutlined />}
          onClick={() => setShowChangelog(true)}
        >
          Changelog
        </Button>
      </div>

      <ChangelogModal
        open={showChangelog}
        onClose={() => setShowChangelog(false)}
      />
    </>
  );
}
