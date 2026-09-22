# gsb-vgrid

一万行成交明细的原生虚拟滚动表格。项目没有业务 npm 包、没有 React、没有 webpack，也不需要安装依赖。

## 唯一页面入口

页面入口固定为仓库根目录的 `index.html`。在仓库根目录运行：

```sh
python3 -m http.server 8000 --directory .
```

然后打开 `http://127.0.0.1:8000/index.html`。

页面资源全部使用相对路径，因此把整个仓库挂到子路径（例如 `/demo/vgrid/`）时，脚本和样式仍从同一子路径加载。

## 纯逻辑测试

本地和 CI 都运行同一条命令：

```sh
node scripts/test.mjs
```

要求 Node.js 18 或更新版本。脚本使用 Node 自带的 `node:test`，不会执行 `npm install`，仓库也没有业务依赖。Node 版本过低或必要文件缺失时会直接打印可读错误。

## 目录约定

- `index.html`：唯一页面入口。
- `src/core/grid-core.js`：无 DOM 的数据层，包含虚拟窗口、冻列坐标、数据坐标选区、TSV、IME 按键状态、筛选和分组布局。
- `src/ui/`：只由浏览器页面加载的 DOM、样式和事件接线。
- `test/logic/`：无浏览器 Node 测试，CI 只运行这里的纯逻辑测试。
- `test/manual/`：可选浏览器回归脚本，不会被页面加载，也不会进入 CI 命令。
- `scripts/test.mjs`：本地与 CI 共用的测试入口和环境检查。

## 覆盖范围

`test/logic/grid-core.test.js` 在纯 Node 环境覆盖：

- 总行数 0、1、10000 的窗口起点、终点、像素偏移和总高度。
- 快速滚动到底部时的偏移钳制。
- 筛选、分组和虚拟行回收后仍以原始数据行 ID 保存选区。
- IME 组字期间 Enter、Tab、Esc、方向键不提交或移动。
- 冻列、表头和编辑器共用的横向坐标计算。
- TSV 复制、列宽、分组高度和数据生成的既有语义。

`test/logic/page-contract.test.js` 校验页面只通过相对 URL 加载 `src/` 运行时资源，不加载 `test/` 文件、绝对本机路径或 `node_modules`。

浏览器交互的手工检查和可选 CDP 回归见 [docs/manual-testing.md](docs/manual-testing.md)。这些检查不是 CI 的替代品。
