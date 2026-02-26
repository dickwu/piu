---
alwaysApply: true
description: Rules for using Ant Design message API correctly
---
# Ant Design Message API 使用规范

## 核心原则：Never Use Static Methods

> "Static functions can not consume context like dynamic theme." - Ant Design 官方警告

Ant Design v5+ 要求所有静态方法通过 App component 的 context 来使用，否则无法访问 ConfigProvider 的主题配置。

## 错误做法 - 绝对禁止

```typescript
// 错误：静态方法调用
import { message } from 'antd'

function MyComponent() {
  const handleClick = () => {
    message.success('Done!')  // 错误：静态方法调用
  }
  return <button onClick={handleClick}>Click</button>
}
```

```typescript
// 错误：在工具函数中直接使用静态方法
import { message } from 'antd'

export const handleApiResponse = (response) => {
  if (response.code === 1) {
    message.error('Failed!')  // 错误：无法访问 context
  }
}
```

## 正确做法 - 使用 App.useApp()

### 1. 在 React 组件中使用

```typescript
// 正确：使用 hook 获取实例
import { App } from 'antd'

function MyComponent() {
  const { message } = App.useApp()  // 正确：通过 hook 获取

  const handleClick = () => {
    message.success('Done!')  // 正确：实例方法调用
  }
  return <button onClick={handleClick}>Click</button>
}
```

### 2. 在已有组件中修复

如果组件已经导入了 `message`：

```typescript
// Before
import { Button, message } from 'antd'

// After
import { Button, App } from 'antd'

function MyComponent() {
  const { message } = App.useApp()  // 添加这一行
  // ... rest of code
}
```

### 3. 支持的所有静态 API

以下 API 都必须通过 `App.useApp()` 使用：

```typescript
const { message, notification, modal } = App.useApp()

// Message API
message.success('Success!')
message.error('Error!')
message.warning('Warning!')
message.info('Info!')
message.loading('Loading...')

// Notification API
notification.success({ message: 'Success!' })
notification.error({ message: 'Error!' })

// Modal API
modal.confirm({ title: 'Confirm?' })
modal.warning({ title: 'Warning!' })
```

## 工具函数处理方案

如果需要在工具函数中使用，将 message 实例作为参数传入：

```typescript
// 错误：直接导入使用
import { message } from 'antd'
export const handleError = (error: string) => {
  message.error(error)  // 无法访问 context
}

// 正确：接受实例作为参数
import { MessageInstance } from 'antd/es/message/interface'

export const handleError = (
  error: string,
  messageApi: MessageInstance
) => {
  messageApi.error(error)  // 使用传入的实例
}

// 在组件中使用
function MyComponent() {
  const { message } = App.useApp()

  const onError = (error: string) => {
    handleError(error, message)  // 传入实例
  }
}
```

## 项目结构要求

确保 layout.tsx 正确配置：

```typescript
import { App } from 'antd'

<ConfigProvider theme={...}>
  <App>  {/* 必须：提供 context */}
    <YourApp />
  </App>
</ConfigProvider>
```

## 修复检查清单

修复现有代码时，按以下顺序检查：

1. 是否在 layout.tsx 中添加了 `<App>` 组件？
2. 是否将 `import { message }` 改为 `import { App }`？
3. 是否在组件中添加了 `const { message } = App.useApp()`？
4. 是否所有 `message.xxx()` 调用都在组件内部？
5. 工具函数是否接受 message 实例作为参数？

## 常见错误

### 错误 1：在组件外使用

```typescript
// 错误：在组件外调用 hook
const { message } = App.useApp()  // Hook 必须在组件内

export default function MyComponent() {
  // ...
}
```

```typescript
// 正确：在组件内调用
export default function MyComponent() {
  const { message } = App.useApp()  // Hook 在组件内
  // ...
}
```

### 错误 2：在 contextHolder 时代的遗留代码

```typescript
// 旧的 v4 风格 - 也能用，但不推荐
const [messageApi, contextHolder] = message.useMessage()
return (
  <>
    {contextHolder}
    <Button onClick={() => messageApi.success('OK')} />
  </>
)

// 新的 v5 风格 - 推荐（依赖 App 组件）
const { message } = App.useApp()
return <Button onClick={() => message.success('OK')} />
```

## 数据流

```
ConfigProvider (主题配置)
    ↓
App (context provider)
    ↓
useApp() (consumer hook)
    ↓
message.xxx() (使用主题的方法)
```
