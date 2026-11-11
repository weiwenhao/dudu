# 第三方声明

本项目自己写的代码以 MIT 协议发布，见 [LICENSE](LICENSE)。下面这些不是本项目写的，或者带着自己的协议；它们的声明随仓库保留。

## 项目模板（Expo）

仓库最初由 Expo 的项目模板生成。旧的 Expo 原型（`App.tsx`、`src/`、`app.json` 等）里还留着模板的文件，模板的协议如下。

```text
The MIT License (MIT)

Copyright (c) 2015-present 650 Industries, Inc. (aka Expo)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## DeepSeek Harness（DSH）

插件接入 DSH 的插件接口；`host/dudu-plugin/ui/pet/whale-tail.png`、一部分界面文字和样式变量取自 DSH 的 Desktop 应用。DSH 以 MIT 发布：https://github.com/deepseek-ai/deepseek-harness 。

```text
MIT License

Copyright (c) 2026 DeepSeek

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## OAR

`packages/oar-adapter/` 是对 `@botiverse/oar` 的适配和补丁，沿用上游的 Apache-2.0，见该目录的 [LICENSE](packages/oar-adapter/LICENSE) 和 [NOTICE](packages/oar-adapter/NOTICE)。

## 从其他开源项目移植的代码

连接器的 OAuth 登录取自 Cline，并参考了 OpenClaw 和 opencode；「粘贴任何 MCP 配置」的解析取自 Hermes Agent；Claude、OpenAI、DeepSeek 的图标来自 Lobe Icons。各自的来源、取了哪些文件和协议原文在 [licenses/](licenses/)。

## 服务图标

信息收集器里各个服务的图标，来源和协议见 [NOTICE.md](host/dudu-plugin/ui/connectors/icons/NOTICE.md)；这些名字和图标是各自所有者的商标，只用来认出是哪个服务。
