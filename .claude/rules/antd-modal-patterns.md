---
alwaysApply: true
description: Correct patterns for Modal, Drawer, message, notification, and confirmation dialogs in antd v6
---
# Antd Modal & Drawer Patterns

## Decision Tree

```
Need feedback to user?
  ├── Inline in page → Modal (controlled)
  ├── Side panel / settings → Drawer (controlled)
  ├── Toast notification → App.useApp() → message
  ├── Rich notification → App.useApp() → notification
  └── Confirmation before action → App.useApp() → modal.confirm
```

## Controlled Modal

Always use `open` prop with state. Never use deprecated `visible`.

```tsx
import { Modal, Button } from 'antd';
import { useState, useCallback } from 'react';

export function MyModal() {
  const [open, setOpen] = useState(false);
  const handleClose = useCallback(() => setOpen(false), []);
  const handleOk = useCallback(() => {
    // do work...
    setOpen(false);
  }, []);

  return (
    <>
      <Button onClick={() => setOpen(true)}>Open</Button>
      <Modal
        title="My Modal"
        open={open}
        onCancel={handleClose}
        onOk={handleOk}
        destroyOnHidden={true}  // v6: replaces destroyOnClose
      >
        <p>Content here</p>
      </Modal>
    </>
  );
}
```

### Custom Footer

```tsx
<Modal open={open} onCancel={handleClose} footer={null}>
  <div>Content</div>
  <div style={{ textAlign: 'right', marginTop: 16 }}>
    <Space>
      <Button onClick={handleClose}>Cancel</Button>
      <Button type="primary" onClick={handleOk}>Save</Button>
    </Space>
  </div>
</Modal>
```

## Controlled Drawer

Use `size` instead of deprecated `width`/`height`.

```tsx
<Drawer
  title="Settings"
  open={open}
  onClose={onClose}
  size={520}        // v6: replaces width={520}
  destroyOnHidden   // v6: replaces destroyOnClose
  extra={<Button type="primary" onClick={handleSave}>Save</Button>}
>
  {/* content */}
</Drawer>
```

### Drawer Size Options

| Value | Width | Use case |
|-------|-------|----------|
| `'default'` | 378px | Simple forms, quick views |
| `'large'` | 736px | Complex settings, tables |
| `{number}` | custom px | Any specific width: `size={520}` |

## Confirmation Dialogs — App.useApp()

Never use `Modal.confirm()` directly.

```tsx
import { App, Button } from 'antd';

export function DeleteButton({ onDelete }: { onDelete: () => void }) {
  const { modal } = App.useApp();

  const handleClick = () => {
    modal.confirm({
      title: 'Delete Item',
      content: 'This cannot be undone. Are you sure?',
      okText: 'Delete',
      okButtonProps: { danger: true },
      onOk: onDelete,
    });
  };

  return <Button danger onClick={handleClick}>Delete</Button>;
}
```

## Toast Messages — App.useApp()

Never import `message` from `'antd'` and call it directly.

```tsx
// WRONG
import { message } from 'antd';
message.success('Done');

// CORRECT
import { App } from 'antd';
function MyComponent() {
  const { message } = App.useApp();
  message.success('Done');
}
```

## Modal with Form

Reset form state when modal opens/closes:

```tsx
import { Modal, Form, Input, App } from 'antd';

export function CreateItemModal({ open, onClose, onCreate }) {
  const [form] = Form.useForm();
  const { message } = App.useApp();

  const handleOk = async () => {
    try {
      const values = await form.validateFields();
      onCreate(values);
      form.resetFields();
      onClose();
      message.success('Created');
    } catch {
      // validation failed — form shows errors
    }
  };

  return (
    <Modal
      title="Create Item"
      open={open}
      onCancel={() => { form.resetFields(); onClose(); }}
      onOk={handleOk}
      destroyOnHidden
    >
      <Form form={form} layout="vertical">
        <Form.Item name="name" label="Name" rules={[{ required: true }]}>
          <Input />
        </Form.Item>
      </Form>
    </Modal>
  );
}
```

## Common Mistakes

| Mistake | Fix |
|---------|-----|
| `import { message } from 'antd'` then `message.success()` | Use `const { message } = App.useApp()` |
| `Modal.confirm({...})` | Use `const { modal } = App.useApp()` then `modal.confirm()` |
| `<Drawer width={500}>` | Use `<Drawer size={500}>` |
| `<Modal visible={true}>` | Use `<Modal open={true}>` |
| `<Modal destroyOnClose>` | Use `<Modal destroyOnHidden>` |
| `<Drawer headerStyle={{...}}>` | Use `<Drawer styles={{ header: {...} }}>` |
