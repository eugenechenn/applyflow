# Recovery Cleanup Triage（阶段 1）

## 基线
- 分支：`codex/recovery-20260508-restore-snapshot`
- 保护快照提交：`38a4ec5`

## 污染目录盘点
- `src/src`：85 文件
- `scripts/scripts`：116 文件
- `public/public`：33 文件
- `docs/docs`：16 文件
- `data/data`：6 文件
- `cloudflare/cloudflare`：1 文件

## 重复关系扫描结果
- `same`（嵌套与主目录同名同内容）：133
- `diff`（嵌套与主目录同名但内容不同）：123
- `only_nested`（只在嵌套目录存在）：1

清单文件：
- `tmp/recovery-cleanup-manifest.csv`

## 已执行的安全动作
- 将 `only_nested` 文件补回主目录路径：
  - 新增 [diagnose-production-onboarding-bootstrap.js](/E:/my-agent/applyflow/scripts/validation/diagnose-production-onboarding-bootstrap.js)

## 结论
当前不能直接删除 `src/src`、`scripts/scripts` 等嵌套目录。  
原因：有 123 个文件“同名但内容不同”，必须先做差异合并，再删除污染目录。

## 下一步（阶段 2）
1. 先对 `diff` 文件做批量差异审计（按模块：`src`、`scripts`、`public`、`docs`）。
2. 逐批把“应保留版本”合入主路径。
3. 每批合入后跑最小验证。
4. 最后再删除污染目录并提交“clean baseline”。

