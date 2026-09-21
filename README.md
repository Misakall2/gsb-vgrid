# gsb-vgrid

一万行成交明细的虚拟滚动表格。原生 HTML / CSS / JS，无 npm、无框架、无打包器。

## 打开页面

直接双击 `index.html` 即可（`file://` 下可用，复制功能走 `copy` 事件，不依赖剪贴板权限）。
也可以起个静态服务：

```sh
python3 -m http.server 8000
# 打开 http://localhost:8000
```

URL 参数可复现边界状态：

- `index.html` 默认 10,000 行
- `index.html?rows=0` 空表状态
- `index.html?rows=1` 单行状态
- 工具栏可按列分组、折叠组、按列关键字筛选；输入无匹配关键字可复现零行状态

## 跑测试

纯函数逻辑（可视窗口计算、选区模型、TSV、输入法按键状态机、数据生成）在
`grid-core.js`，用 Node 自带测试运行器，无需安装任何依赖：

```sh
node --test
```

五起线上事故的浏览器层回归直接用本机 Chrome DevTools Protocol，不安装 npm 依赖：

```sh
node test/browser-regression.js
```

也可以把浏览器回归并入 Node 测试进程：

```sh
RUN_BROWSER_TEST=1 node --test
```

## 交互

- 纵向 / 横向滚动：未分组只渲染可视窗口内行；分组只渲染附近组头和行，滚动条按过滤 / 折叠后的行数计算
- 表头、首列冻结，组头冻结在表头下方；滚过组边界会切换为下一组
- 表头右缘可拖动列宽；首列宽度变化后，横向滚动仍按同一套列坐标对齐
- 筛选 / 分组 / 折叠后的选区和编辑器都保存原始数据行号，不绑定屏幕行号
- 单击选中，双击或回车进入编辑；中文输入法组字期间方向键 / 回车不会提交，
  筛选框等 `compositionend` 后才过滤；折叠 / 展开组不丢正在编辑的坐标
- 方向键移动，`Shift+方向键` 拉选区，`Tab` / `Shift+Tab` 前后移动，
  `Esc` 收起选区（编辑中 `Esc` 取消编辑）
- `Cmd/Ctrl+C` 把当前选区以 TSV 复制到剪贴板；筛选后按过滤结果顺序复制
- 选区存在数据层，滚动回收 DOM 后滚回来高亮仍在

## 文件

- `index.html` 页面结构
- `style.css` 样式（sticky 冻结、基线对齐、选区高亮）
- `grid-core.js` 纯逻辑，浏览器和 Node 共用，含筛选、分组布局、数据坐标选区和列宽计算
- `app.js` DOM 渲染与事件
- `test/grid-core.test.js` `node:test` 单测
