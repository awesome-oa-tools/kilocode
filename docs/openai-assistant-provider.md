# OpenAI Assistant API Provider

本文檔說明如何在 Kilo Code 中使用 OpenAI Assistant API provider。

## 概述

OpenAI Assistant API provider 允許您使用在 OpenAI 平台上預先配置的 Assistant 與 Kilo Code 互動。這種整合使用基於 thread 的對話模型，與傳統的 Chat Completions API 不同。

## 設定步驟

### 1. 建立 OpenAI Assistant

首先，您需要在 OpenAI 平台上建立一個 Assistant:

1. 訪問 [OpenAI Assistants 頁面](https://platform.openai.com/assistants)
2. 點擊 "Create Assistant"
3. 配置您的 Assistant:
    - 設定名稱和描述
    - 選擇模型 (例如 gpt-4o, gpt-4-turbo 等)
    - 配置 instructions (系統提示詞)
    - 選擇性添加 tools (Code Interpreter, File Search, Functions)
4. 建立後，複製 Assistant ID (格式為 `asst_xxxxxxxxxxxxx`)

### 2. 在 Kilo Code 中配置

在 `opencode.json` (或 `opencode.jsonc`) 中添加以下配置:

```jsonc
{
  "provider": {
    "openai-assistant": {
      "options": {
        "apiKey": "sk-your-openai-api-key",
        "assistantId": "asst_xxxxxxxxxxxxx",
        "baseURL": "https://api.openai.com/v1"  // 可選，預設值
      }
    }
  }
}
```

或者使用環境變數:

```bash
export OPENAI_ASSISTANT_API_KEY="sk-your-openai-api-key"
```

然後在 `opencode.json` 中只需配置 assistant ID:

```jsonc
{
  "provider": {
    "openai-assistant": {
      "options": {
        "assistantId": "asst_xxxxxxxxxxxxx"
      }
    }
  }
}
```

也可以使用 `opencode auth` 命令儲存 API key:

```bash
opencode auth openai-assistant
```

### 3. 選擇模型

配置完成後，在模型選擇中選擇 `openai-assistant/assistant`。

## 工作原理

OpenAI Assistant API 使用以下流程:

1. **建立 Thread**: 每次對話開始時，創建一個新的 thread
2. **添加訊息**: 將使用者訊息添加到 thread
3. **執行 Assistant**: 使用指定的 Assistant ID 創建一個 run
4. **輪詢狀態**: 持續檢查 run 的狀態，直到完成
5. **取得回應**: 從 thread 中檢索 Assistant 的回應

## 特點

- **預配置模型**: 模型在 Assistant 中配置，無需在 Kilo Code 中選擇
- **Tool 支援**: Assistant 可以使用 OpenAI 提供的 tools (Code Interpreter, File Search, Functions)
- **持久化配置**: Assistant 的 instructions 和設定在 OpenAI 平台上管理
- **獨立 Thread**: 每次對話使用獨立的 thread，確保隔離性

## 限制

- **非串流**: 目前使用輪詢機制，回應會在完成後一次性返回
- **Tool Calls**: Assistant 自身的 tool calls 會自動處理，但不會橋接到 Kilo Code 的工具系統
- **輪詢延遲**: 使用輪詢機制檢查 run 狀態，可能有輕微延遲

## 故障排除

### 錯誤: "OpenAI Assistant ID is required"

確保您已在 `opencode.json` 的 `provider.openai-assistant.options.assistantId` 中填寫 Assistant ID。

### 錯誤: "Assistant run timed out"

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

- LanguageModelV2 Adapter: `packages/opencode/src/provider/sdk/openai-assistant/`
- Provider Registration: `packages/opencode/src/provider/provider.ts` (CUSTOM_LOADERS)
- Model Definition: `packages/opencode/src/provider/models.ts`
