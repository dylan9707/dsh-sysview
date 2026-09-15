# DSH 插件开发踩坑记录（@infmed/dsh-sysview）

> 本文是 `@infmed/dsh-sysview`（原名 `@infmed/dsh-system-view`）插件从「加载失败」到「能跑起来」的完整排查记录，
> 供后续开发/排障的 agent 直接复用。核心结论：**DSH 插件是双面包**——服务端（Node host 面）
> 和浏览器端（client 面）各有硬性格式要求，任何一面格式不对都会 fail-loud。

---

## 0. 背景：一个 DSH 插件是什么

一个可安装的 DSH 插件 = 一个 npm 包，同时扮演两个角色：

| 面 | 运行环境 | 入口 | 作用 |
|----|---------|------|------|
| host 面 | Node（服务端） | `lib/index.js`（`exports["."]`） | 注册工具/服务/HTTP 路由/会话事件，作为组合树里的一行插件被挂载 |
| client 面 | 浏览器 | `lib/client.js`（`exports["./client"]`） | 被 `dsh-client-modules` 扫进 `window.__DSH_BOOT__` 名册，在浏览器里作为 cordis 插件跑 `apply(ctx)` 渲染 UI |

安装方式：`dsh plugin --profile <name> add <包路径或包名>`，pnpm 装进 profile 的 node_modules（本地路径用 `link:` 软链），
并把带 `dsh.bundle` 声明的包 reconcile 进 `dsh.profile.bundles` 层；`cordis.patch.yml` 作为补丁层把插件行插进组合树。

---

## 1. 问题一：Cannot find package '@deepseek-ai/schemastery'

### 报错

~~~
Cannot find package '@deepseek-ai/schemastery' imported from .../plugins/dsh-system-view/lib/index.js
Error [ERR_MODULE_NOT_FOUND]
~~~

### 根因

树外插件（按 `link:` 软链到真实路径加载）的 `import '@deepseek-ai/schemastery'`，Node 的 ESM 解析是从
**插件自己的目录**逐级向上找 `node_modules`，不会去 DSH 主机（profile 的 node_modules / 全局 dsh）
里找。插件目录里没装这个包 → 解析失败。

### 修复

按 DSH 官方插件约定（参考 `dsh-system-prompt`、`dsh-skill` 等包）：

- **`schemastery` 放 `dependencies`（不是 peer）**，版本和主机对齐 `^3.18.1`。
- `cordis` 及其它 `@deepseek-ai/dsh-*` 包放 `peerDependencies` + `devDependencies`。

然后在插件目录（或 monorepo 根）执行 `pnpm install`。

### 关键结论（背下来）

- `@deepseek-ai/schemastery` → `dependencies`
- `@deepseek-ai/cordis`、`@deepseek-ai/dsh-*` → `peerDependencies` + `devDependencies`
- 主机实际版本（无 `-rc` 后缀）：`cordis@4.0.1`、`schemastery@3.18.1`、`cosmokit@1.8.2`、`dsh-tools@0.1.0-rc.6`。**peer 范围别乱写 `-rc.1`**。

---

## 2. 问题二：client-modules loaded without registering

### 报错

~~~
failed to import loader entry sysview (@infmed/dsh-sysview):
client-modules: bundle /plugins/@infmed/dsh-sysview/client.js?rev=...
loaded without registering "@infmed/dsh-sysview" via __ModuleLoader__.load
~~~

### 根因

浏览器端 bundle 有硬性格式要求。DSH 把 `client.js` 当 classic `<script>` 加载，
脚本执行时**必须调用** `window.__ModuleLoader__.load({ id, factory })` 把插件注册进模块表。

正确格式是 **CJS closure-factory**：

~~~js
window.__ModuleLoader__.load({
  id: "@infmed/dsh-sysview",       // 必须逐字符等于包名
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    // ... 插件主体，跨包 import 变成 require("...") ...
    exports.inject = [...];
    exports.apply = function apply(ctx) { ... };
    return module.exports;
  }
});
~~~

错误的 `client.js` 是普通 ESM（`export const inject` / `export function apply`），
脚本加载后什么都没注册 → 报 "loaded without registering"。

### 修复

两种方式：

1. **正规做法（有完整源码+构建链时）**：用 `tsdown` 构建，`tsdown.config.ts` 里必须有这三行
   （否则产物就是普通 bundle，仍然不注册）：

   ~~~ts
   outputOptions: {
     entryFileNames: 'client.js',
     banner: 'window.__ModuleLoader__.load({ id: "@infmed/dsh-sysview", factory: (require) => {',
     intro:  'var module = { exports: {} }; var exports = module.exports;',
     footer: 'return module.exports; } });',
   }
   ~~~

2. **无构建链时（本插件的情况）**：直接手写/手改 `lib/client.js`，把整个 body 包进上面的
   closure-factory（`export const x` → `exports.x`，`export function f` → `exports.f = function f`）。
   **本插件没有 `src/`、没有 tsconfig、没有 build 脚本，`lib/` 就是最终产物，改完即生效。**

### 快速自检

打开构建后的 `lib/client.js` 看前两行：

- ✅ 第一行 `window.__ModuleLoader__.load({`，第二行 `id: "<包名>",`
- ❌ 以 `import` / `export` / `"use strict"` / `(function` / `define(` 开头 → 缺三层包裹

`id` 写错（哪怕一个字符）也会报一模一样的 "loaded without registering"，因为注册到了别的 key 上。

---

## 3. 问题三：package.json 重复 key（隐性 bug）

### 现象

排查时发现 `package.json` 里 `peerDependencies`、`exports` 各出现了**两次**。

### 根因与后果

JSON 里重复 key「后者覆盖前者」→ 最终生效的 `exports` 只剩：

~~~json
{ "./client": { "default": "./lib/client.js" } }
~~~

把 `.`（服务端入口 `lib/index.js`）覆盖没了。服务端加载用 `import('@infmed/dsh-sysview')`，
走 Node ESM 的 `exports` 解析，缺 `.` 会报 `ERR_PACKAGE_PATH_NOT_EXPORTED`。

### 修复

`exports` 必须**完整四项**：

~~~json
"exports": {
  ".": { "default": "./lib/index.js" },
  "./client": { "default": "./lib/client.js" },
  "./cordis.patch.yml": "./cordis.patch.yml",
  "./package.json": "./package.json"
}
~~~

**教训**：往已有 package.json 加字段时不要「追加重复 key」，要合并到已有 key 里；
编辑后跑一次 `JSON.parse` 确认无重复 key、无语法错误。

---

## 4. 缓存与重启（重要！）

以下内容是 **DSH 进程启动时读一次、之后按包名缓存且不失效**：

- `package.json` 的 `dsh.client` 声明、`exports["./client"]`
- `lib/client.js` 的内容哈希（`rev`，决定浏览器加载哪个版本）

所以：

- 改了 `dsh.client` / `exports` / 包元数据 → **必须重启 `dsh web`**。
- 改了 `lib/client.js` 内容 → 生产环境也**重启**最可靠（只有开发模式 HMR watcher 在跑时才走热更新链）。
- 改了 `dsh.profile.bundles`（`dsh plugin add` 会改）→ 必须重启。

**「重启」≠「重新构建」**：本插件没有构建链，`lib/` 就是产物，改文件 + 重启进程即可。

---

## 5. 正确骨架参考（可直接套用）

### package.json（关键字段）

~~~jsonc
{
  "name": "@infmed/dsh-sysview",
  "type": "module",
  "main": "lib/index.js",
  "exports": {
    ".": { "default": "./lib/index.js" },
    "./client": { "default": "./lib/client.js" },
    "./cordis.patch.yml": "./cordis.patch.yml",
    "./package.json": "./package.json"
  },
  "files": ["lib", "assets", "cordis.patch.yml"],
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": { "inject": [...], "platform": "web" }
  },
  "dependencies": {
    "@deepseek-ai/schemastery": "^3.18.1"
  },
  "peerDependencies": {
    "@deepseek-ai/cordis": "^4.0.1",
    "@deepseek-ai/dsh-tools": "^0.1.0-rc.6"
  },
  "devDependencies": {
    "@deepseek-ai/cordis": "^4.0.1",
    "@deepseek-ai/dsh-tools": "^0.1.0-rc.6"
  }
}
~~~

### cordis.patch.yml

~~~yaml
- insert:
    - id: sysview
      name: '@infmed/dsh-sysview'
      config:
        graphPath: ai_notes/diagrams/system_graph.json
~~~

### lib/client.js（closure-factory 格式）

见「问题二」的代码块。要点：

- `id` 逐字符等于包名。
- body 里的 `export` 全部改成 `exports.xxx = ...`。
- 结尾 `return module.exports;`。
- 无跨包 import 时 `factory(require)` 的 `require` 参数可以不用。

---

## 6. 问题四：插件被引用但未安装（Cannot find package '<你的包名>'）

### 报错

~~~
failed to import loader entry sysview (@infmed/dsh-sysview): Cannot find package '@infmed/dsh-sysview' imported from C:\Users\user\.dsh\profiles\web\
Error [ERR_MODULE_NOT_FOUND]
~~~

### 根因

profile 的 patch / bundles 里引用了插件（`sysview` 这个 entry、`name: '@infmed/dsh-sysview'`），
但插件包**没真正装进 profile 的 node_modules**（`profile/node_modules/@infmed` 目录 ENOENT）。

常见触发：改完插件后手动改了 profile 配置，或 `dsh plugin add` 中途 pnpm 失败（例如 peer 依赖解析不出来），
导致 bundles 写了、包却没装上。

### 修复

用 `dsh plugin` 真正装进去（它会 pnpm 装包 + reconcile 进 bundles）：

~~~
dsh plugin --profile web add D:\dsh-system-view
~~~

装完验证：

~~~
dsh --profile web --dump-config     # 应能看到 id: sysview / name: '@infmed/dsh-sysview'
~~~

### 排查技巧

- `dsh --profile <name> --dump-config` 能离线看组合后的 entry 树（带 provenance 注释，每个 entry 标注来自哪个 bundle/patch 层），
  不 boot 就能定位「某 entry 从哪来」。
- 引用在但装不上 → 先确认 `profile/node_modules` 里有没有该包（注意 profile 自己的 `web/node_modules` 和父级 `profiles/node_modules` 是两处）。

---

## 7. 问题五：新增 DSH 包 import 后依赖没装全（传递依赖缺口）

### 报错

修好问题四后，插件加载时继续报：

~~~
Cannot find package '@deepseek-ai/dsh-tools' imported from D:\dsh-system-view\lib\index.js
# 或者：
Cannot find package '@deepseek-ai/cosmokit' imported from ...\node_modules\@deepseek-ai\schemastery\lib\index.mjs
~~~

### 根因

插件按 `link:` 软链加载，`import` 从**插件真实路径**向上解析，只会找插件自己的 `node_modules`。
你新增了 `import { defineTool } from '@deepseek-ai/dsh-tools'`，但插件 `node_modules` 里没有 `dsh-tools`；
而且 `schemastery` 的传递依赖（`@deepseek-ai/cosmokit`、`@standard-schema/spec`）也没在插件 node_modules 里。

### 修复（DSH 包不是公共 npm，外置插件要手动 junction）

DSH 包是 pre-release，不一定能从公共 registry 拉到。外置插件按 `link:` 加载时，
**每个直接 import 的 `@deepseek-ai/*` 包 + 其传递依赖，都要物理出现在插件 node_modules 里**。

来源目录（本机 dsh 安装，所有 DSH 包都在这里）：

~~~
C:\Users\user\AppData\Roaming\npm\node_modules\@deepseek-ai\dsh\node_modules\@deepseek-ai\
~~~

用 junction（目录软链，Windows 无需管理员）补上，以 `dsh-tools` 为例：

~~~powershell
New-Item -ItemType Junction -Path "D:\dsh-system-view\node_modules\@deepseek-ai\dsh-tools" -Target "C:\Users\user\AppData\Roaming\npm\node_modules\@deepseek-ai\dsh\node_modules\@deepseek-ai\dsh-tools"
~~~

本次实际补了三个：

- `@deepseek-ai/dsh-tools`（新 feature 直接 import）
- `@deepseek-ai/cosmokit`（schemastery 的传递依赖，0 deps）
- `@standard-schema/spec`（schemastery 的传递依赖，0 deps）

### 提前自检（比 `dsh web` 启动失败更快定位）

~~~powershell
cd D:\dsh-system-view
node --input-type=module -e "import('./lib/index.js').then(m => console.log('OK: ' + Object.keys(m).join(', '))).catch(e => { console.error('FAIL: ' + e.message); process.exit(1) })"
~~~

- 成功 → 服务端依赖全解析，可以 `dsh plugin add` 装进 profile。
- 失败 → 报哪个包缺，就去上面那个 dsh 安装目录 junction 哪个包。

### 注意

- junction 是机器本地的。插件拷到**另一台机器**（InfMed 那台）时，同样的 junction 要重做（或那台机器上 `pnpm install` 补全）。
- `cosmokit`、`@standard-schema/spec` 都是 0 deps 的叶子包，junction 后自包含；`dsh-tools` 自己的依赖会从它真实所在目录（dsh 安装目录）解析，所以单个 junction 就够了。

---

## 8. 其它踩坑备忘（本次遇到/顺带发现的）

- **host 面用命名导出**：`export const name/inject/Config` + `export function apply`，
  不要 default export（loader 的 `unwrapExports` 优先 `default ?? 整个 namespace`，命名导出直接可用）。
- **服务注入要「最早可解析点」再取**：`ctx.get('webServer') ?? ctx.get('httpServer')`
  （新旧版本键名不同），服务可能晚于 apply 绑定，用 `ctx.on('internal/service', name => ...)` 补注册。
- **client 面 `apply` 里挂的全局监听要 teardown**：`ctx.effect(() => () => { ...清理... }, 'label')`
  里既要清 DOM 也要 `removeEventListener`，否则 HMR 重载会累积监听器。
- **静态资源路由要做白名单防路径穿越**；`decodeURIComponent` 包 try（畸形编码 404 而非 500）。

---

## 9. 一句话总结

DSH 插件 = host 面(`lib/index.js`) + client 面(`lib/client.js`) 双面包；
`dependencies` 装 schemastery、`peer/devDependencies` 装 cordis/dsh-tools 等 host 包；
`exports` 四项缺一不可、不能有重复 key；
`lib/client.js` 必须是 `__ModuleLoader__.load({id, factory})` closure-factory 且 `id`=包名；
插件要用 `dsh plugin --profile web add <路径>` 真正装进 profile；
每个新增的 `@deepseek-ai/*` import + 传递依赖都要 junction 进插件 node_modules；
改完包元数据/bundle 必须重启 `dsh web`。
