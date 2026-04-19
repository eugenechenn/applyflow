# Rollback and Cleanup

## 大改默认策略
采用 Branch by Abstraction / Parallel Change：

1. 先新增新抽象层
2. 让新旧路径同时存在，但入口只能有一个主开关
3. 验证通过后删除旧路径
4. 删除完成后再合并

## 何时必须清理旧路径
- 新路径已经通过全部验证
- UI 已经不再读取旧字段
- 旧 helper 没有被任何入口引用

## 何时必须回滚
- 同类问题连续 2 轮修复失败
- 新路径导致主页面不可用
- 生成结果出现污染回退
- 出现大规模乱码、混版、空结构

## 清理顺序
1. 删除旧 import
2. 删除旧 helper
3. 删除旧 schema 兼容桥
4. 删除旧 render 分支
5. 再删文档中的过时说明

## 不允许的做法
- 在旧 controller 里继续叠一层补丁
- 一边保留旧 render，一边新增新 render
- 用 try/catch 掩盖旧路径错误

