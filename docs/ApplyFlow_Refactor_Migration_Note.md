# 历史文档说明

> 本文档为历史记录，不再作为 ApplyFlow partial_rebuild 的当前基线。
> 当前重构基线请使用：
> - README.md
> - PROJECT_CONTEXT.md
> - docs/APPLYFLOW_REBUILD_PLAN.md
> - docs/APPLYFLOW_ARCHITECTURE.md
> - docs/DEPRECATION_AND_REMOVAL_PLAN.md

---

# ApplyFlow 閲嶆瀯杩佺Щ璇存槑

鏃ユ湡锛?026-04-14

## 浠撳簱鐜扮姸鍒ゆ柇

褰撳墠浠撳簱娌℃湁鍙戠幇鍙墽琛屼唬鐮併€佸墠绔伐绋嬫垨鍚庣鏈嶅姟銆傜幇鏈夊唴瀹逛粎鍖呮嫭涓や唤椤圭洰绗旇锛?- `applyflow-project-notes/ApplyFlow_椤圭洰閲嶆瀯鎬荤粨_2026-04-14.md`
- `applyflow-project-notes/ApplyFlow_姝ｅ紡璁捐_v1_2026-04-14.md`

## 鍙鐢ㄥ唴瀹?
鍙洿鎺ュ鐢ㄤ负浜у搧鍜岃璁¤緭鍏ワ細
- 椤圭洰瀹氫綅
- 闂幆瀹氫箟
- Agent 瑙掕壊鍒掑垎
- 浜у搧杈圭晫
- MVP 椤甸潰缁撴瀯

## 鏃?Hiring Decision OS 鍐呭鍒ゆ柇

褰撳墠浠撳簱鍐呮湭鍙戠幇鏃?`Hiring Decision OS` 鐨勪唬鐮佸疄鐜帮紝鍥犳娌℃湁闇€瑕佺洿鎺ュ垹闄ゆ垨閲嶅懡鍚嶇殑鍘嗗彶浠ｇ爜銆?
浣嗕粠椤圭洰鍙欎簨涓婏紝闇€瑕佹槑纭細
- `Hiring Decision OS` 闄嶇骇涓哄巻鍙插弬鑰冩柟鍚?- 褰撳墠涓婚」鐩粺涓€鍛藉悕涓?`ApplyFlow`
- 鎵€鏈夋柊鏂囨。銆佷唬鐮併€丄PI銆侀〉闈㈠鑸潎浣跨敤 `ApplyFlow`

## 鏈杩佺Щ鍔ㄤ綔

鏈宸插畬鎴愶細
- 鏂板 `README.md`锛岀粺涓€椤圭洰涓?ApplyFlow
- 鏂板 `docs/ApplyFlow_Technical_Design_v1.md`
- 鏂板 `src/types/applyflow.ts`
- 鏂板鐘舵€佹満銆丱rchestrator銆乵ock API銆乨emo 鏁版嵁銆佸墠绔〉闈㈤鏋?- 鏂板闆朵緷璧栨湰鍦?server锛屾敮鎸?API + 椤甸潰 demo

## 鍚庣画杩佺Щ鍘熷垯

- 濡傛灉鍚庣画瀵煎叆鏃?Hiring Decision OS 浠ｇ爜锛屽彧淇濈暀涓哄弬鑰冪洰褰曪紝渚嬪 `legacy/` 鎴?`references/`
- 涓嶈鎶婃棫椤圭洰鍛藉悕銆侀〉闈€佹帴鍙ｇ洿鎺ユ贩鍏ユ柊涓昏矾寰?- ApplyFlow 鐨勬牳蹇冨璞″拰鐘舵€佹満搴斾紭鍏堜簬鏃?prompt pipeline 缁撴瀯

