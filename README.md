# dsh-message-fold

**中文** | [English](docs/README_EN.md)

为 DeepSeek Harness 提供 Codex 风格的会话消息折叠。

> 插件只改变展示效果，不修改任何数据。

## 效果

- 连续2个及以上工具调用自动合并，可展开
- 最终回复后，中间过程都会被自动折叠，展示为"耗时 x秒"，可展开

![折叠例子](./docs/images/example.gif "折叠例子")

## 安装

Github安装：
```sh
dsh plugin --profile web add github:RyensX/dsh-message-fold
```

源码安装：

```sh
pnpm install
pnpm build
dsh plugin --profile web add .
```

卸载：

```sh
dsh plugin --profile web remove dsh-message-fold
```

## 兼容边界

当前版本锁定 DSH `0.1.0-rc.8`、Cordis `4.0.1` 和 React 18。DSH 暂无正式的 renderer decorator API，因此唯一的临时兼容点集中在 `src/client/adapter/dsh-slot-renderer-decorator.ts`：业务组件只依赖 `RendererDecoratorPort`，将来可直接替换适配器。

适配器采用可撤销 lease，并在不兼容时整体 fail-open。外部装饰器后来包在本插件外层时，插件卸载不会覆盖它；内部 wrapper 会立即退化为原 renderer 的透明透传。

折叠选择只保存在插件的页面内存中，不写入 `localStorage`。会话删除及插件卸载都会清理对应状态。

## 开发验证

```sh
pnpm verify
npm pack --dry-run
```

`verify` 会依次执行类型检查、单元与 React 测试、Node/Web 双入口构建，以及 lazy-CJS handoff 检查。
