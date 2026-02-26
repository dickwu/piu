---
alwaysApply: true
description: Ant Design v6 breaking changes, deprecated APIs, and correct patterns
---
# Antd V6 Reference

## Deprecated Props

### Layout & Container

| Component | Deprecated | Replacement | Notes |
|-----------|-----------|-------------|-------|
| Space | `direction` | `orientation` | |
| Space | `split` | `separator` | |
| Space.Compact | `direction` | `orientation` | |
| Splitter | `layout` | `orientation` | `'horizontal' \| 'vertical'` |
| Divider | `type` | `orientation` | |
| Divider | `orientationMargin` | `styles.content.margin` | |

### Data Entry

| Component | Deprecated | Replacement | Notes |
|-----------|-----------|-------------|-------|
| Input | `bordered` | `variant` | `variant="outlined"` replaces `bordered={true}` |
| Input | `addonBefore` | `Space.Compact` | Wrap Input in `Space.Compact` with a preceding element |
| Input | `addonAfter` | `Space.Compact` | Wrap Input in `Space.Compact` with a following element |
| Input.Group | Entire component | `Space.Compact` | |
| Input.TextArea | `bordered` | `variant` | |
| InputNumber | `bordered` | `variant` | |
| InputNumber | `addonBefore` | `Space.Compact` | Same as Input |
| InputNumber | `addonAfter` | `Space.Compact` | Same as Input |
| Select | `bordered` | `variant` | |
| Select | `dropdownMatchSelectWidth` | `popupMatchSelectWidth` | |
| Select | `dropdownStyle` | `styles.popup.root` | |
| Select | `dropdownClassName` | `classNames.popup.root` | |
| Select | `popupClassName` | `classNames.popup.root` | |
| Select | `dropdownRender` | `popupRender` | |
| Select | `onDropdownVisibleChange` | `onOpenChange` | |
| Select | `clearIcon` | `allowClear={{ clearIcon }}` | |
| Select | `showArrow` | removed | Default behavior; hide via `suffixIcon={null}` |
| Cascader | `bordered` | `variant` | |
| Cascader | `dropdownClassName` | `classNames.popup.root` | |
| Cascader | `dropdownStyle` | `styles.popup.root` | |
| Cascader | `dropdownRender` | `popupRender` | |
| Cascader | `dropdownMenuColumnStyle` | `popupMenuColumnStyle` | |
| Cascader | `onDropdownVisibleChange` | `onOpenChange` | |
| Cascader | `onPopupVisibleChange` | `onOpenChange` | |
| TreeSelect | `bordered` | `variant` | |
| TreeSelect | `dropdownMatchSelectWidth` | `popupMatchSelectWidth` | |
| TreeSelect | `dropdownStyle` | `styles.popup.root` | |
| TreeSelect | `dropdownClassName` | `classNames.popup.root` | |
| TreeSelect | `popupClassName` | `classNames.popup.root` | |
| TreeSelect | `dropdownRender` | `popupRender` | |
| TreeSelect | `onDropdownVisibleChange` | `onOpenChange` | |
| AutoComplete | `dropdownMatchSelectWidth` | `popupMatchSelectWidth` | |
| AutoComplete | `dropdownStyle` | `styles.popup.root` | |
| AutoComplete | `dropdownClassName` | `classNames.popup.root` | |
| AutoComplete | `popupClassName` | `classNames.popup.root` | |
| AutoComplete | `dropdownRender` | `popupRender` | |
| AutoComplete | `onDropdownVisibleChange` | `onOpenChange` | |
| AutoComplete | `dataSource` | `options` | |
| DatePicker | `dropdownClassName` | `classNames.popup.root` | |
| DatePicker | `popupClassName` | `classNames.popup.root` | |
| DatePicker | `popupStyle` | `styles.popup.root` | |
| DatePicker | `bordered` | `variant` | |
| DatePicker | `onSelect` | `onCalendarChange` | |
| RangePicker | `dropdownClassName` | `classNames.popup.root` | |
| RangePicker | `popupClassName` | `classNames.popup.root` | |
| RangePicker | `popupStyle` | `styles.popup.root` | |
| RangePicker | `bordered` | `variant` | |
| RangePicker | `onSelect` | `onCalendarChange` | |
| TimePicker | `addon` | `renderExtraFooter` | |
| Slider | `tooltipPrefixCls` | `tooltip.prefixCls` | |
| Slider | `getTooltipPopupContainer` | `tooltip.getPopupContainer` | |
| Slider | `tipFormatter` | `tooltip.formatter` | |
| Slider | `tooltipPlacement` | `tooltip.placement` | |
| Slider | `tooltipVisible` | `tooltip.open` | |
| Mentions | `<Mentions.Option>` children | `options` prop | |

### Data Display

| Component | Deprecated | Replacement | Notes |
|-----------|-----------|-------------|-------|
| List | Entire component | `Flex vertical` + `.map()` | Use `Flex vertical` with manual item rendering; use `Spin` for loading state |
| List.Item | Entire component | `<div>` with border styling | |
| List.Item.Meta | Entire component | Manual `Flex` + `Tag` + `<div>` layout | |
| Card | `headStyle` | `styles.header` | |
| Card | `bodyStyle` | `styles.body` | |
| Card | `bordered` | `variant` | `variant="outlined"` |
| Collapse | `destroyInactivePanel` | `destroyOnHidden` | |
| Collapse | `expandIconPosition` | `expandIconPlacement` | |
| Collapse.Panel | `disabled` | `collapsible="disabled"` | Use in `items` array |
| Descriptions | `labelStyle` | `styles.label` | |
| Descriptions | `contentStyle` | `styles.content` | |
| Empty | `imageStyle` | `styles.image` | |
| Image | `wrapperStyle` | `styles.root` | |
| Image (preview) | `visible` | `open` | |
| Image (preview) | `onVisibleChange` | `onOpenChange` | |
| Image (preview) | `maskClassName` | `classNames.cover` | |
| Image (preview) | `rootClassName` | `classNames.root` | |
| Image (preview) | `toolbarRender` | `actionsRender` | |
| Statistic | `valueStyle` | `styles.content` | |
| Statistic.Countdown | Entire component | `<Statistic.Timer type="countdown" />` | |
| Table (column) | `filterDropdownOpen` | `filterDropdownProps.open` | |
| Table (column) | `onFilterDropdownOpenChange` | `filterDropdownProps.onOpenChange` | |
| Table (locale) | `filterCheckall` | `locale.filterCheckAll` | Case change |
| Table | `pagination.position` | `pagination.placement` | |
| Table | `onSelectInvert` | `onChange` | |
| Tag | `bordered={false}` | `variant="filled"` | |
| Tag | `color="xxx-inverse"` | `variant="solid"` | |
| Tabs | `popupClassName` | `classNames.popup` | |
| Tabs | `tabPosition` | `tabPlacement` | |
| Tabs | `destroyInactiveTabPane` | `destroyOnHidden` | On Tabs or individual items |
| Timeline | `<Timeline.Item>` children | `items` prop | |
| Timeline | `pending` | use `items` array | |
| Timeline | `pendingDot` | use `items` array | |
| Timeline | `mode="left"\|"right"` | `mode="start"\|"end"` | |
| Timeline (item) | `label` | `title` | |
| Timeline (item) | `children` | `content` | |
| Timeline (item) | `dot` | `icon` | |
| Timeline (item) | `position` | `placement` | |
| Tooltip | `overlayStyle` | `styles.root` | |
| Tooltip | `overlayInnerStyle` | `styles.container` | |
| Tooltip | `overlayClassName` | `classNames.root` | |
| Tooltip | `destroyTooltipOnHide` | `destroyOnHidden` | |
| Carousel | `dotPosition` | `dotPlacement` | |
| Calendar | `dateFullCellRender` | `fullCellRender` | |
| Calendar | `dateCellRender` | `cellRender` | |
| Calendar | `monthFullCellRender` | `fullCellRender` | |
| Calendar | `monthCellRender` | `cellRender` | |

### Feedback

| Component | Deprecated | Replacement | Notes |
|-----------|-----------|-------------|-------|
| Modal | `bodyStyle` | `styles.body` | |
| Modal | `maskStyle` | `styles.mask` | |
| Modal | `destroyOnClose` | `destroyOnHidden` | |
| Modal | `autoFocusButton` | `focusable.autoFocusButton` | |
| Modal | `focusTriggerAfterClose` | `focusable.focusTriggerAfterClose` | |
| Modal | `maskClosable` | `mask.closable` | `mask={{ closable: true }}` |
| Modal.confirm | `bodyStyle` | `styles.body` | |
| Modal.confirm | `maskStyle` | `styles.mask` | |
| Drawer | `width` | `size` | Accepts `'default'` (378px), `'large'` (736px), or number |
| Drawer | `height` | `size` | For `placement="top"` or `"bottom"` |
| Drawer | `headerStyle` | `styles.header` | |
| Drawer | `bodyStyle` | `styles.body` | |
| Drawer | `footerStyle` | `styles.footer` | |
| Drawer | `contentWrapperStyle` | `styles.wrapper` | |
| Drawer | `maskStyle` | `styles.mask` | |
| Drawer | `drawerStyle` | `styles.section` | |
| Drawer | `destroyInactivePanel` | `destroyOnHidden` | |
| Drawer | `destroyOnClose` | `destroyOnHidden` | |
| Drawer | `maskClosable` | `mask.closable` | `mask={{ closable: true }}` |
| Drawer | `classNames.content` | `classNames.section` | |
| Drawer | `styles.content` | `styles.section` | |
| Alert | `closeText` | `closable.closeIcon` | |
| Alert | `message` | `title` | |
| Notification | `btn` | `actions` | |
| Notification | `message` | `title` | |
| Spin | `tip` | `description` | |
| Spin | `wrapperClassName` | `classNames.root` | |
| Spin | `classNames.tip` | `classNames.description` | |
| Spin | `styles.tip` | `styles.description` | |
| Spin | `classNames.mask` | `classNames.root` | |
| Spin | `styles.mask` | `styles.root` | |
| Progress | `width` | `size` | |
| Progress | `trailColor` | `railColor` | |
| Progress | `gapPosition` | `gapPlacement` | |
| Progress (Line) | `strokeWidth` | `size` | |
| Dropdown | `dropdownRender` | `popupRender` | |
| Dropdown | `destroyPopupOnHide` | `destroyOnHidden` | |
| Dropdown | `overlayClassName` | `classNames.root` | |
| Dropdown | `overlayStyle` | `styles.root` | |
| Dropdown | `placement: *Center` | Remove `Center` suffix | e.g. `bottomCenter` → `bottom` |
| Dropdown.Button | Entire component | `Space.Compact + Dropdown + Button` | |

### Navigation

| Component | Deprecated | Replacement | Notes |
|-----------|-----------|-------------|-------|
| Breadcrumb | `routes` | `items` | |
| Breadcrumb | `<Breadcrumb.Item>` children | `items` prop | |
| Steps | `labelPlacement` | `titlePlacement` | |
| Steps | `progressDot` | `type="dot"` | |
| Steps | `direction` | `orientation` | |
| Steps (item) | `description` | `content` | |
| Menu | `children` | `items` prop | |
| Anchor | `<Anchor.Link>` children | `items` prop | |

### Other

| Component | Deprecated | Replacement | Notes |
|-----------|-----------|-------------|-------|
| Avatar.Group | `maxCount` | `max={{ count: number }}` | |
| Avatar.Group | `maxStyle` | `max={{ style: CSSProperties }}` | |
| Avatar.Group | `maxPopoverPlacement` | `max={{ popover: PopoverProps }}` | |
| Avatar.Group | `maxPopoverTrigger` | `max={{ popover: PopoverProps }}` | |
| BackTop | Entire component | `FloatButton.BackTop` | |
| Button | `iconPosition` | `iconPlacement` | |
| Button.Group | Entire component | `Space.Compact` | |
| FloatButton | `description` | `content` | |
| ConfigProvider | `dropdownMatchSelectWidth` | `popupMatchSelectWidth` | |
| Transfer | `listStyle` | `styles.section` | |
| Transfer | `operationStyle` | `styles.actions` | |
| Transfer | `operations` | `actions` | |

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

### Input — use `Space.Compact` (not `addonBefore`/`addonAfter`)

```tsx
// WRONG: deprecated addonBefore
<Input addonBefore={<span>https://</span>} value={path} />

// CORRECT: Space.Compact composition
<Space.Compact>
  <Button style={{ pointerEvents: 'none' }}>https://</Button>
  <Input value={path} />
</Space.Compact>
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

### List — use `Flex` + `.map()` (not `List`)

```tsx
// WRONG: deprecated List component
import { List } from 'antd';
<List
  loading={loading}
  dataSource={items}
  renderItem={(item) => (
    <List.Item>
      <List.Item.Meta title={item.name} description={item.desc} />
    </List.Item>
  )}
/>

// CORRECT: Flex + Spin + map
import { Flex, Spin, Empty } from 'antd';
{loading ? (
  <Flex justify="center" style={{ padding: 40 }}>
    <Spin />
  </Flex>
) : items.length === 0 ? (
  <Empty description="No items" />
) : (
  <Flex vertical style={{ maxHeight: 500, overflow: 'auto' }}>
    {items.map((item) => (
      <div key={item.id} style={{ padding: '12px 0', borderBottom: '1px solid var(--border)' }}>
        <div>{item.name}</div>
        <div style={{ color: 'var(--text-tertiary)' }}>{item.desc}</div>
      </div>
    ))}
  </Flex>
)}
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

1. **Style props** — `headerStyle`, `bodyStyle`, `footerStyle`, `maskStyle`, `contentWrapperStyle`, `drawerStyle`, `overlayStyle`, `overlayInnerStyle`, `wrapperStyle`, `valueStyle`, `labelStyle`, `contentStyle`, `listStyle`, `operationStyle`, `imageStyle` → use `styles` object
2. **Deprecated props** — `width`/`height` on Drawer; `destroyOnClose`/`destroyInactivePanel`/`destroyInactiveTabPane`/`destroyTooltipOnHide`/`destroyPopupOnHide` → `destroyOnHidden`; `visible` → `open`; `maskClosable` → `mask.closable`; `addonBefore`/`addonAfter` → `Space.Compact`; `bordered` → `variant`
3. **Dropdown/Popup renames** — `dropdownClassName` → `classNames.popup.root`; `dropdownStyle` → `styles.popup.root`; `dropdownRender` → `popupRender`; `onDropdownVisibleChange` → `onOpenChange`; `dropdownMatchSelectWidth` → `popupMatchSelectWidth`; `overlayClassName` → `classNames.root`; `overlayStyle` → `styles.root`
4. **Position → Placement** — `tabPosition` → `tabPlacement`; `expandIconPosition` → `expandIconPlacement`; `dotPosition` → `dotPlacement`; `gapPosition` → `gapPlacement`; `iconPosition` → `iconPlacement`; `labelPlacement` → `titlePlacement`; `direction` → `orientation` (Space, Steps, Collapse)
5. **Static methods** — `message.success`, `Modal.confirm`, `notification.open` must use `App.useApp()`
6. **Children patterns** — `<Tabs.TabPane`, `<Select.Option`, `<Collapse.Panel`, `<Breadcrumb.Item>`, `<Timeline.Item>`, `<Anchor.Link>`, `<Mentions.Option>`, `<Menu.Item>` → use `items` array
7. **Removed components** — `List` / `List.Item` / `List.Item.Meta` → `Flex vertical` + `.map()`; `BackTop` → `FloatButton.BackTop`; `Button.Group` → `Space.Compact`; `Dropdown.Button` → `Space.Compact + Dropdown + Button`; `Input.Group` → `Space.Compact`; `Statistic.Countdown` → `Statistic.Timer`
8. **CSS overrides** — `.ant-*` overrides that duplicate ConfigProvider tokens
9. **Import style** — No `antd/lib/` deep imports
10. **React 19 patch** — Remove `@ant-design/v5-patch-for-react-19` if present
11. **Mask blur** — New v6 default; disable via ConfigProvider if unwanted
