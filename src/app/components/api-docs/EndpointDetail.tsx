'use client';

import { Tag, Table, Flex, Divider, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import Markdown from 'react-markdown';
import { useMemo } from 'react';
import {
  getParameters,
  getRequestBody,
  getResponseBody,
  type ParameterEntry,
} from './openapi-utils';
import { SchemaViewer } from './SchemaViewer';
import { TryItPanel } from './TryItPanel';

const { Title, Text } = Typography;

const METHOD_COLORS: Record<string, string> = {
  GET: '#52c41a',
  POST: '#1677ff',
  PUT: '#fa8c16',
  DELETE: '#ff4d4f',
  PATCH: '#722ed1',
};

function methodColor(method: string): string {
  return METHOD_COLORS[method.toUpperCase()] ?? '#8c8c8c';
}

const PARAM_COLUMNS: ColumnsType<ParameterEntry> = [
  {
    title: 'Name',
    dataIndex: 'name',
    key: 'name',
    render: (v: string) => (
      <Text code style={{ fontSize: 12 }}>
        {v}
      </Text>
    ),
  },
  {
    title: 'In',
    dataIndex: 'in',
    key: 'in',
    render: (v: string) => <Tag style={{ marginInlineEnd: 0 }}>{v}</Tag>,
  },
  {
    title: 'Type',
    dataIndex: 'type',
    key: 'type',
    render: (v: string) => (
      <span style={{ fontFamily: 'monospace', fontSize: 12 }}>{v}</span>
    ),
  },
  {
    title: 'Required',
    dataIndex: 'required',
    key: 'required',
    render: (v: boolean) =>
      v ? (
        <Tag color="red" style={{ marginInlineEnd: 0 }}>
          required
        </Tag>
      ) : (
        <span style={{ color: 'var(--ant-color-text-tertiary)', fontSize: 12 }}>
          optional
        </span>
      ),
  },
];

interface Props {
  spec: Record<string, unknown>;
  path: string;
  method: string;
}

export function EndpointDetail({ spec, path, method }: Props) {
  const operation = useMemo(() => {
    const paths = spec.paths as Record<string, Record<string, Record<string, unknown>>> | undefined;
    return paths?.[path]?.[method.toLowerCase()] ?? null;
  }, [spec, path, method]);

  const parameters = useMemo(
    () => (operation ? getParameters(operation) : []),
    [operation],
  );

  const requestBody = useMemo(
    () => (operation ? getRequestBody(operation, spec) : null),
    [operation, spec],
  );

  const responseBody = useMemo(
    () => (operation ? getResponseBody(operation, spec) : null),
    [operation, spec],
  );

  const serverUrl = useMemo(
    () => (spec?.servers as { url: string }[] | undefined)?.[0]?.url ?? '',
    [spec],
  );

  const requestId = useMemo(
    () =>
      operation
        ? ((operation['x-piu-request-id'] as string) ?? null)
        : null,
    [operation],
  );

  const tags = useMemo(
    () => (operation?.tags as string[] | undefined) ?? [],
    [operation],
  );

  const summary = (operation?.summary as string | undefined) ?? '';
  const description = (operation?.description as string | undefined) ?? '';

  if (!operation) {
    return (
      <Flex
        justify="center"
        align="center"
        style={{ height: '100%', color: 'var(--ant-color-text-tertiary)' }}
      >
        Operation not found
      </Flex>
    );
  }

  return (
    <div style={{ padding: '20px 24px', overflowY: 'auto', height: '100%' }}>
      {/* Header */}
      <Flex align="center" gap={12} style={{ marginBottom: 12 }}>
        <Tag
          style={{
            color: '#fff',
            background: methodColor(method),
            border: 'none',
            fontWeight: 700,
            fontSize: 13,
            padding: '2px 10px',
            marginInlineEnd: 0,
          }}
        >
          {method.toUpperCase()}
        </Tag>
        <Text
          code
          style={{ fontSize: 16, color: 'var(--ant-color-text)' }}
        >
          {path}
        </Text>
      </Flex>

      {/* Tags */}
      {tags.length > 0 && (
        <Flex gap={4} wrap="wrap" style={{ marginBottom: 12 }}>
          {tags.map((t) => (
            <Tag key={t} style={{ marginInlineEnd: 0 }}>
              {t}
            </Tag>
          ))}
        </Flex>
      )}

      {/* Summary */}
      {summary && (
        <Title level={4} style={{ marginBottom: 8, marginTop: 0 }}>
          {summary}
        </Title>
      )}

      {/* Description */}
      {description && (
        <div
          style={{
            color: 'var(--ant-color-text-secondary)',
            marginBottom: 16,
            fontSize: 14,
            lineHeight: 1.6,
          }}
        >
          <Markdown>{description}</Markdown>
        </div>
      )}

      {/* Parameters */}
      {parameters.length > 0 && (
        <>
          <Divider titlePlacement="start" style={{ marginTop: 8 }}>
            Parameters
          </Divider>
          <Table<ParameterEntry>
            size="small"
            dataSource={parameters}
            columns={PARAM_COLUMNS}
            rowKey="name"
            pagination={false}
            style={{ marginBottom: 16 }}
          />
        </>
      )}

      {/* Request body */}
      {requestBody && (
        <>
          <Divider titlePlacement="start" style={{ marginTop: 8 }}>
            Request Body
          </Divider>
          <div style={{ marginBottom: 16 }}>
            <SchemaViewer schema={requestBody} spec={spec} />
          </div>
        </>
      )}

      {/* Response */}
      {responseBody && (
        <>
          <Divider titlePlacement="start" style={{ marginTop: 8 }}>
            Response (200)
          </Divider>
          <div style={{ marginBottom: 16 }}>
            <SchemaViewer schema={responseBody} spec={spec} />
          </div>
        </>
      )}

      {/* Try it */}
      <Divider titlePlacement="start" style={{ marginTop: 8 }}>
        Try It
      </Divider>
      <TryItPanel requestId={requestId} serverUrl={serverUrl} path={path} />
    </div>
  );
}
