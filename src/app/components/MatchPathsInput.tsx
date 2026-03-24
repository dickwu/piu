'use client';

import { Tag, AutoComplete, Badge, Flex } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { useState, useMemo, useCallback } from 'react';
import { useCollectionStore } from '../stores/collectionStore';
import { parseConfig } from '../types';
import type { ApiRequest, Collection } from '../types';

interface MatchPathsInputProps {
  value: string;
  onChange: (value: string) => void;
}

function parseMatchPaths(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.filter((s): s is string => typeof s === 'string');
  } catch {
    // ignore
  }
  return ['*'];
}

function globToRegex(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  const globbed = escaped.replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${globbed}$`, 'i');
}

interface RequestPathInfo {
  path: string;
  method: string;
  collectionName: string;
  requestName: string;
}

function buildAllPaths(
  collections: Collection[],
  requestsMap: Map<string, ApiRequest[]>,
): RequestPathInfo[] {
  const results: RequestPathInfo[] = [];

  for (const [collectionId, requests] of requestsMap.entries()) {
    if (collectionId === '__root__') {
      for (const req of requests) {
        const config = parseConfig(req.config);
        const url = config.url.replace(/^\//, '');
        if (url) {
          results.push({
            path: url,
            method: config.method,
            collectionName: '(root)',
            requestName: req.name,
          });
        }
      }
      continue;
    }
    const collection = collections.find((c) => c.id === collectionId);
    const prefix = collection?.path_prefix?.replace(/^\/|\/$/g, '') ?? '';

    for (const req of requests) {
      const config = parseConfig(req.config);
      const url = config.url.replace(/^\//, '');
      const fullPath = prefix ? `${prefix}/${url}` : url;
      if (fullPath) {
        results.push({
          path: fullPath,
          method: config.method,
          collectionName: collection?.name ?? '(unknown)',
          requestName: req.name,
        });
      }
    }
  }

  return results;
}

function countMatches(pattern: string, allPaths: RequestPathInfo[]): number {
  try {
    const re = globToRegex(pattern);
    return allPaths.filter((p) => re.test(p.path)).length;
  } catch {
    return 0;
  }
}

export function MatchPathsInput({ value, onChange }: MatchPathsInputProps) {
  const [inputValue, setInputValue] = useState('');
  const [inputVisible, setInputVisible] = useState(false);

  const collections = useCollectionStore((s) => s.collections);
  const requestsMap = useCollectionStore((s) => s.requests);

  const allPaths = useMemo(
    () => buildAllPaths(collections, requestsMap),
    [collections, requestsMap],
  );

  const paths = useMemo(() => parseMatchPaths(value), [value]);

  const matchedPaths = useMemo(() => {
    if (!inputValue.trim()) return [];
    try {
      const re = globToRegex(inputValue);
      return allPaths.filter((p) => re.test(p.path));
    } catch {
      return [];
    }
  }, [inputValue, allPaths]);

  const autocompleteOptions = useMemo(() => {
    const uniquePaths = [...new Set(allPaths.map((p) => p.path))];
    const filtered = inputValue.trim()
      ? uniquePaths.filter((p) => p.toLowerCase().includes(inputValue.toLowerCase()))
      : uniquePaths;

    const options = filtered.slice(0, 20).map((p) => ({
      value: p,
      label: (
        <span style={{ fontFamily: 'var(--font-code)', fontSize: 11 }}>{p}</span>
      ),
    }));

    if (inputValue.includes('*') || inputValue.includes('?')) {
      options.unshift({
        value: inputValue,
        label: (
          <Flex align="center" gap={6}>
            <span style={{ fontFamily: 'var(--font-code)', fontSize: 11 }}>{inputValue}</span>
            <Badge
              count={matchedPaths.length}
              size="small"
              color={matchedPaths.length > 0 ? '#52c41a' : '#ff4d4f'}
              style={{ fontSize: 10 }}
            />
          </Flex>
        ),
      });
    }

    return options;
  }, [allPaths, inputValue, matchedPaths.length]);

  const addPattern = useCallback(
    (pattern: string) => {
      const trimmed = pattern.trim();
      if (!trimmed) return;
      if (paths.includes(trimmed)) return;

      const next = [...paths, trimmed];
      onChange(JSON.stringify(next));
      setInputValue('');
      setInputVisible(false);
    },
    [paths, onChange],
  );

  const removePattern = useCallback(
    (index: number) => {
      const next = paths.filter((_, i) => i !== index);
      onChange(JSON.stringify(next.length > 0 ? next : ['*']));
    },
    [paths, onChange],
  );

  return (
    <Flex wrap gap={4} align="center" style={{ minHeight: 22 }}>
      {paths.map((pattern, idx) => {
        const matches = countMatches(pattern, allPaths);
        return (
          <Tag
            key={`${pattern}-${idx}`}
            closable
            onClose={(e) => {
              e.preventDefault();
              removePattern(idx);
            }}
            color={matches === 0 && pattern !== '*' ? 'error' : undefined}
            style={{ fontFamily: 'var(--font-code)', fontSize: 10, margin: 0 }}
          >
            {pattern}
            {pattern !== '*' && (
              <Badge
                count={matches}
                size="small"
                style={{ marginLeft: 4, fontSize: 9 }}
                color={matches > 0 ? '#52c41a' : '#ff4d4f'}
              />
            )}
          </Tag>
        );
      })}
      {inputVisible ? (
        <AutoComplete
          size="small"
          style={{ width: 160 }}
          value={inputValue}
          options={autocompleteOptions}
          onChange={setInputValue}
          onSelect={addPattern}
          onBlur={() => {
            if (inputValue.trim()) {
              addPattern(inputValue);
            } else {
              setInputVisible(false);
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              addPattern(inputValue);
            }
            if (e.key === 'Escape') {
              setInputValue('');
              setInputVisible(false);
            }
          }}
          placeholder="path or glob *"
          autoFocus
        />
      ) : (
        <Tag
          onClick={() => setInputVisible(true)}
          style={{ borderStyle: 'dashed', cursor: 'pointer', margin: 0 }}
        >
          <PlusOutlined style={{ fontSize: 10 }} />
        </Tag>
      )}
    </Flex>
  );
}
