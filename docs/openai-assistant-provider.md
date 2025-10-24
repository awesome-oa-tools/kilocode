# OpenAI Assistant API Provider

本文檔說明如何在 Kilocode (Roo Code) 中使用 OpenAI Assistant API provider。

## 概述

OpenAI Assistant API provider 允許您使用在 OpenAI 平台上預先配置的 Assistant 與 Kilocode 互動。這種整合使用基於 thread 的對話模型，與傳統的 Chat Completions API 不同。

## 設定步驟

### 1. 建立 OpenAI Assistant

首先,您需要在 OpenAI 平台上建立一個 Assistant:

1. 訪問 [OpenAI Assistants 頁面](https://platform.openai.com/assistants)
2. 點擊 "Create Assistant"
3. 配置您的 Assistant:
    - 設定名稱和描述
    - 選擇模型 (例如 gpt-4, gpt-3.5-turbo 等)
    - 配置 instructions (系統提示詞)
    - 選擇性添加 tools (Code Interpreter, Retrieval, Functions)
4. 建立後,複製 Assistant ID (格式為 `asst_xxxxxxxxxxxxx`)

### 2. 在 Kilocode 中配置

1. 打開 Kilocode 設定頁面
2. 在 API Provider 下拉選單中選擇 "OpenAI Assistant"
3. 填寫以下資訊:

    - **Base URL** (可選): 如果使用自定義端點,請填寫。預設為 `https://api.openai.com/v1`
    - **OpenAI API Key**: 您的 OpenAI API 金鑰 (從 https://platform.openai.com/api-keys 取得)
    - **Assistant ID**: 您在步驟 1 中建立的 Assistant ID

4. 點擊保存

## 工作原理

OpenAI Assistant API 使用以下流程:

1. **建立 Thread**: 每次對話開始時,創建一個新的 thread
2. **添加訊息**: 將使用者訊息添加到 thread
3. **執行 Assistant**: 使用指定的 Assistant ID 創建一個 run
4. **輪詢狀態**: 持續檢查 run 的狀態,直到完成
5. **取得回應**: 從 thread 中檢索 Assistant 的回應

## 特點

- **預配置模型**: 模型在 Assistant 中配置,無需在 Kilocode 中選擇
- **Tool 支援**: Assistant 可以使用 OpenAI 提供的 tools (Code Interpreter, Retrieval, Functions)
- **持久化配置**: Assistant 的 instructions 和設定在 OpenAI 平台上管理
- **獨立 Thread**: 每次對話使用獨立的 thread,確保隔離性

## 限制

- **Token 計數**: 目前不支援詳細的 token 使用統計
- **Tool Calls**: 基本的 tool call 處理已實作,但可能需要根據具體需求進一步客製化
- **輪詢延遲**: 使用輪詢機制檢查 run 狀態,可能有輕微延遲

## 範例配置

參考 `scripts/openai-assistant-curl.sh` 腳本,了解 OpenAI Assistant API 的基本使用流程。

## 故障排除

### 錯誤: "OpenAI Assistant ID is required"

確保您已在設定中填寫 Assistant ID。

### 錯誤: "Assistant run timeout"

Assistant 執行超過 5 分鐘。檢查:

- Assistant 配置是否正確
- 使用的模型是否可用
- API 金鑰是否有效

### 錯誤: "No assistant response found"

Assistant 沒有產生回應。可能原因:

- Assistant instructions 配置問題
- 模型配額不足
- API 金鑰權限不足

## 相關檔案

- Backend Handler: `src/api/providers/openai-assistant.ts`
- Type Definitions: `packages/types/src/provider-settings.ts`
- UI Component: `webview-ui/src/components/settings/providers/OpenAIAssistant.tsx`
- Registration: `src/api/index.ts`
