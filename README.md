# 长河智慧社区 · 综合治理平台

基于 Vue 3 + Vite + Leaflet + Three.js 构建的街道级智慧社区综合治理前端演示系统，涵盖门户工作台、综合治理驾驶舱（含三维城市沙盘与日/夜双态切换）、数据中枢、数据智库、数字武装、网格治理、数据直达、掌上网格与信创底座展示等模块。

## 技术栈

- **框架**：Vue 3（Composition API）+ Vue Router（Hash 模式）
- **构建工具**：Vite 6
- **地图与三维**：Leaflet + Three.js
- **图标**：Lucide Vue Next

## 本地开发与构建

```bash
npm install
npm run dev
```

生产构建：

```bash
npm run build
```

构建产物输出至 `dist/`，可直接由任意静态资源服务器（如 Nginx）托管。

## 说明

- 本仓库为纯前端演示工程，不依赖后端服务；页面内的演示数据与操作状态保存在浏览器 `localStorage` 中。
- 演示统计、点位及社区分区仅作界面展示用途，不代表真实业务数据或正式行政边界。
- 地图组件 Leaflet 采用 BSD-2-Clause 许可，地图底图数据参考 OpenStreetMap contributors（ODbL）。

## 开源许可

本项目采用 [MIT License](LICENSE) 开源。
