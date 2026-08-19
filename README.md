# dsh-message-fold

**中文** | [English](docs/README_EN.md)

为 DeepSeek Harness 提供 Codex 风格的会话消息折叠。

> 插件只改变展示效果，不修改任何数据。

## 展示规则

- 连续两个及以上工具调用合并为一条可展开摘要；单个工具继续使用 DSH 原 renderer。
- turn 有可信最终回答后，中间 assistant、上下文、命令、压缩、重试、工具及 workflow 默认收进“耗时 {duration}”。
- 最终回答、错误、turn 收尾节点、失败的 workflow，以及最终回答后的内容始终可见。
- 最终回答前的失败工具仍属于中间活动；展开 turn 后可从工具组摘要查看失败数量与详情。
- 运行中的工具或 workflow 会让 turn 默认保持展开，用户仍可手动折叠。
- 未知节点、缺失历史或无法确认的结构全部 fail-open，直接交给 DSH 原 renderer。
- 最终回答中的非空 reasoning 只在折叠态通过临时浅拷贝隐藏；空 reasoning
  始终从展示投影中过滤，原节点引用和值不会改变。

turn 折叠与工具组折叠相互独立。展开被隐藏的内容会重新挂载原 renderer，因此 renderer 自己的临时 UI 状态会重建，但会话数据不受影响。

## 安装

构建后把当前目录加入 Web profile：

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

当前版本锁定 DSH `0.1.0-rc.7`、Cordis `4.0.1` 和 React 18。DSH 暂无正式的 renderer decorator API，因此唯一的临时兼容点集中在 `src/client/adapter/dsh-slot-renderer-decorator.ts`：业务组件只依赖 `RendererDecoratorPort`，将来可直接替换适配器。

适配器采用可撤销 lease，并在不兼容时整体 fail-open。外部装饰器后来包在本插件外层时，插件卸载不会覆盖它；内部 wrapper 会立即退化为原 renderer 的透明透传。

折叠选择只保存在插件的页面内存中，不写入 `localStorage`。会话删除及插件卸载都会清理对应状态。

## 开发验证

```sh
pnpm verify
npm pack --dry-run
```

`verify` 会依次执行类型检查、单元与 React 测试、Node/Web 双入口构建，以及 lazy-CJS handoff 检查。
