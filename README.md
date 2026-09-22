# gsb-vgrid

一万行成交明细虚拟滚动表格。原生 HTML / CSS / JavaScript，无业务 npm 包、无 React、无 webpack、无打包产物。

## 唯一命令

启动本地静态页，在仓库根目录执行：

```sh
python3 -m http.server 8000
```

然后打开 `http://localhost:8000/index.html`。

运行纯逻辑测试，在仓库根目录执行：

```sh
node scripts/test.mjs
```

本地和 GitHub Actions 都使用这一条测试命令。它只使用 Node 自带 test runner，不执行 `npm install`，也不需要 `node_modules`。需要 Node.js 20 或更新版本；版本过低、关键文件缺失或页面运行时引用缺失时会直接输出可读错误。

## 页面状态

在静态服务下使用这些 URL 复现边界状态：

- `index.html`：默认 10,000 行
- `index.html?rows=0`：空表
- `index.html?rows=1`：单行

工具栏可以按列分组、折叠组、按列筛选；输入无匹配关键字可复现零行状态。

## 手测补充

纯逻辑测试覆盖窗口计算、数据坐标选区、TSV、IME 按键状态、过滤分组和冻列几何。页面交互另提供本机 Chrome / Chromium 回归脚本，不进 CI，也不会被纯逻辑测试加载：

```sh
node tests/manual/browser-regression.manual.js
```

该脚本使用 Chrome DevTools Protocol，不安装任何包；没有本机 Chrome / Chromium 时会报出找不到浏览器。

## 目录

- `index.html`：唯一页面入口
- `src/core/grid-core.js`：虚拟滚动、选区、IME 状态、过滤分组、冻列几何等纯逻辑
- `src/ui/grid-view.js`：DOM 渲染协作层
- `src/app.js`：页面事件和应用装配
- `src/style.css`：sticky 冻列、基线对齐和选区样式
- `tests/unit/grid-core.test.js`：Node 无浏览器纯逻辑测试
- `tests/manual/browser-regression.manual.js`：可选浏览器手测/回归脚本
- `scripts/test.mjs`：唯一纯逻辑测试入口和环境预检
- `.github/workflows/test.yml`：干净 Ubuntu 上的 CI 配置

## 现有行为

- 纵向 / 横向滚动时只渲染可视窗口附近的 DOM，滚动条仍按完整过滤结果计算。
- 表头和首列冻结，组头固定在表头下方，滚过组边界后切换当前组。
- 首列宽度变化后，横向滚动和编辑器仍使用同一套列坐标。
- 筛选、分组、折叠后的选区和编辑器保存原始数据行号，不绑定屏幕行号。
- IME 组字期间方向键、回车、Tab 不会提交或移动；滚动回收 DOM 不销毁组字状态。
- `Shift+方向键` 拉选区，`Tab` / `Shift+Tab` 移动，`Cmd/Ctrl+C` 按当前过滤顺序复制 TSV。
- 窗口计算在 0、1、10,000 行以及顶部、一像素偏移、中部、越界快速滚动位置都有固定语义断言。
