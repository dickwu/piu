---
alwaysApply: true
description: Ant Design v6 breaking changes, deprecated APIs, and correct patterns
---
# Antd V6 Reference

## Deprecated Props

| Component | Deprecated | Replacement | Notes |
|-----------|-----------|-------------|-------|
| Drawer | `width` | `size` | Accepts `'default'` (378px), `'large'` (736px), or custom number |
| Drawer | `height` | `size` | For `placement="top"` or `"bottom"` |
| Drawer | `headerStyle` | `styles.header` | Use semantic `styles` object |
| Drawer | `destroyOnClose` | `destroyOnHidden` | Renamed |
| Drawer | `maskClosable` | `mask.closable` | `mask={{ closable: true }}` |
| Modal | `destroyOnClose` | `destroyOnHidden` | Renamed |
| Splitter | `layout` | `orientation` | `'horizontal' \| 'vertical'` |

## New Defaults in v6

| Feature | v5 Default | v6 Default | Opt-out |
|---------|-----------|-----------|---------|
| Modal/Drawer mask blur | off | on | `ConfigProvider` `modal.mask.blur: false` |
| Tag margin-inline-end | 8px | 0 | Restore via `ConfigProvider` `tag.styles` |
| React 19 support | needs patch | native | Remove `@ant-design/v5-patch-for-react-19` |

## Static Methods — MUST Use App.useApp()

```tsx
// WRONG — breaks theming
import { message, Modal } from 'antd';
Modal.confirm({ title: 'Delete?' });
message.success('Saved');

// CORRECT — inherits theme
import { App } from 'antd';
function MyComponent() {
  const { message, modal, notification } = App.useApp();
  modal.confirm({ title: 'Delete?' });
  message.success('Saved');
}
```

## Modern Component Patterns

### Drawer

```tsx
<Drawer
  open={isOpen}
  onClose={handleClose}
  size={520}              // replaces width={520}
  destroyOnHidden={true}  // replaces destroyOnClose
  styles={{ header: { background: '#111' } }}  // replaces headerStyle
  mask={{ closable: true, blur: false }}        // replaces maskClosable
  extra={<Button type="primary">Save</Button>}
>
```

### Modal

```tsx
<Modal
  open={isOpen}
  onCancel={handleClose}
  onOk={handleOk}
  destroyOnHidden={true}  // replaces destroyOnClose
  footer={null}           // for custom footer
>
```

### Tabs — use `items` array (not children)

```tsx
<Tabs
  activeKey={activeTab}
  onChange={setActiveTab}
  items={[
    { key: 'tab1', label: 'Tab 1', children: <Content1 /> },
    { key: 'tab2', label: 'Tab 2', children: <Content2 /> },
  ]}
/>
// WRONG: <Tabs><Tabs.TabPane tab="Tab 1" key="1">...</Tabs.TabPane></Tabs>
```

### Select — use `options` array (not children)

```tsx
<Select
  options={[
    { label: 'Option A', value: 'a' },
    { label: 'Option B', value: 'b' },
  ]}
/>
// WRONG: <Select><Select.Option value="a">Option A</Select.Option></Select>
```

### Dropdown — use `menu` prop (not `overlay`)

```tsx
<Dropdown
  trigger={['click']}
  menu={{
    items: [
      { key: 'edit', icon: <EditOutlined />, label: 'Edit', onClick: handleEdit },
      { key: 'delete', label: 'Delete', danger: true, onClick: handleDelete },
    ],
  }}
>
  <Button>Actions</Button>
</Dropdown>
// WRONG: <Dropdown overlay={<Menu>...</Menu>}>
```

### Collapse — use `items` array (not children)

```tsx
<Collapse
  accordion
  items={data.map((item) => ({
    key: item.id,
    label: item.title,
    children: <div>{item.content}</div>,
  }))}
/>
// WRONG: <Collapse><Collapse.Panel header="Title" key="1">...</Collapse.Panel></Collapse>
```

## ConfigProvider — Prefer Design Tokens

```tsx
<ConfigProvider
  theme={{
    algorithm: theme.darkAlgorithm,
    components: {
      Modal: { contentBg: '#1a1a1a', headerBg: '#1a1a1a' },
      Drawer: { colorBgElevated: '#1a1a1a' },
      Table: { headerBg: '#1a1a1a' },
    },
  }}
>
```

Avoid `.ant-modal-content { background: #1a1a1a !important; }` — class names may change between versions.

### v6 CSS Variable Overrides

```css
.ant-btn-outlined.my-btn {
  --ant-color-solid: #f00;
  --ant-color-solid-hover: #e00;
}
```

### Suppress Deprecation Warnings During Migration

```tsx
<ConfigProvider warning={{ strict: false }} />
```

## Audit Checklist

1. **Deprecated props** — `width=`/`height=` on Drawer; `destroyOnClose`; `visible=`; `overlay=` on Dropdown; `maskClosable` on Drawer
2. **Static methods** — `message.success`, `Modal.confirm`, `notification.open` must use `App.useApp()`
3. **Children patterns** — `<Tabs.TabPane`, `<Select.Option`, `<Collapse.Panel` must use `items` array
4. **CSS overrides** — `.ant-*` overrides that duplicate ConfigProvider tokens
5. **Import style** — No `antd/lib/` deep imports
6. **React 19 patch** — Remove `@ant-design/v5-patch-for-react-19` if present
7. **Mask blur** — New v6 default; disable via ConfigProvider if unwanted
