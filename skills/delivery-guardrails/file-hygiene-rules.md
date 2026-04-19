# File Hygiene Rules

## 硬规则
1. 禁止重复函数定义  
   同一文件中不允许出现多次定义同名函数，尤其是 controller / view-model / render 文件。

2. 禁止旧新路径并存  
   如果新路径已接管，旧 helper / 旧 render / 旧 schema 读取必须删除或隔离。

3. 禁止 fallback 文案进入用户内容  
   以下内容不得进入用户可见字段：
- 建议人工补充确认
- 暂无可展示
- completed with fallback
- 任何调试或错误占位

4. 禁止 UI 直接消费脏字段  
   UI 只能消费 workspace view-model 或其他明确的中间层。

5. 禁止 controller 继续膨胀  
   `workflow-controller.js` 只做编排，不应再吸收 view-model 或渲染级逻辑。

6. 禁止“先叠再删”无计划扩散  
   如果需要 Parallel Change，必须先写明旧路径下线时间点。

7. 禁止把未跟踪文件放进被 `.gitignore` 忽略的关键路径  
   关键服务入口和解析器实现必须被 Git 跟踪。

