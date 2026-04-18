# ApplyFlow 部署阶段说明

更新时间：2026-04-17

本文件不再承担完整项目上下文记录职责。
当前部署与进度信息请优先查看以下文档：

- [PROJECT_CONTEXT.md](./PROJECT_CONTEXT.md)：项目定位、当前能力、真实进度、已知限制、下一步优先级
- [DEPLOYMENT_STATUS.md](./DEPLOYMENT_STATUS.md)：本地 / Railway / Cloudflare 的部署状态、已验证链路、当前限制与联调说明

## 当前部署结论

ApplyFlow 目前已经进入“线上可用候选版本”阶段：

- 主系统运行在 Cloudflare Worker + D1
- URL 抓取能力运行在 Railway 上的 Node-only `jd-fetcher`
- Worker 通过 `JD_FETCHER_URL` 调用公网抓取服务
- 线上 URL 导入链路已联调成功

## 当前不要再以本文件为唯一依据的内容

以下信息如与旧记忆不一致，请以 `PROJECT_CONTEXT.md` 和 `DEPLOYMENT_STATUS.md` 为准：

- 项目阶段判断
- 当前是否已完成线上联调
- `jd-fetcher` 的部署方式
- Playwright 在系统中的位置
- 当前线上可用能力与未完成事项
