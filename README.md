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

## 跑测试

纯函数逻辑（可视窗口计算、选区模型、TSV、输入法按键状态机、数据生成）在
`grid-core.js`，用 Node 自带测试运行器，无需安装任何依赖：

```sh
node --test
```

## 交互

- 纵向 / 横向滚动：只渲染可视窗口内的行，滚动条长度按 10,000 行计算
- 表头、首列冻结，斜向滚动保持对齐；冻结列与右侧单元格同一基线
- 单击选中，双击或回车进入编辑；中文输入法组字期间方向键 / 回车不会提交，
  `compositionend` 后才落值；组字中点击其他单元格会先结束组字再提交
- 方向键移动，`Shift+方向键` 拉选区，`Tab` / `Shift+Tab` 前后移动，
  `Esc` 收起选区（编辑中 `Esc` 取消编辑）
- `Cmd/Ctrl+C` 把当前选区以 TSV 复制到剪贴板
- 选区存在数据层，滚动回收 DOM 后滚回来高亮仍在

## 文件

- `index.html` 页面结构
- `style.css` 样式（sticky 冻结、基线对齐、选区高亮）
- `grid-core.js` 纯逻辑，浏览器和 Node 共用
- `app.js` DOM 渲染与事件
- `test/grid-core.test.js` `node:test` 单测
