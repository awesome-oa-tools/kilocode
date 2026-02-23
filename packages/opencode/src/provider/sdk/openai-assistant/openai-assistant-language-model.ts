import type {
  LanguageModelV2,
  LanguageModelV2CallOptions,
  LanguageModelV2Content,
  LanguageModelV2FinishReason,
  LanguageModelV2StreamPart,
} from "@ai-sdk/provider"
import { Log } from "../../../util/log"

const log = Log.create({ service: "openai-assistant" })

interface ThreadResponse {
  id: string
  object: string
  created_at: number
}

interface MessageResponse {
  id: string
  object: string
  thread_id: string
}

interface RunResponse {
  id: string
  object: string
  status: string
  thread_id: string
  assistant_id: string
  usage?: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
  }
  required_action?: {
    type: string
    submit_tool_outputs: {
      tool_calls: Array<{
        id: string
        type: string
        function: {
          name: string
          arguments: string
        }
      }>
    }
  }
  last_error?: {
    code: string
    message: string
  }
}

interface MessagesListResponse {
  object: string
  data: Array<{
    id: string
    object: string
    role: "user" | "assistant"
    content: Array<{
      type: string
      text?: {
        value: string
        annotations: any[]
      }
    }>
  }>
}

export interface OpenAIAssistantLanguageModelConfig {
  apiKey: string
  assistantId: string
  baseURL?: string
  fetch?: typeof globalThis.fetch
}

/**
 * LanguageModelV2 adapter for the OpenAI Assistant (Threads/Runs) API.
 *
 * Flow:
 * 1. Create a thread
 * 2. Add user message to the thread
 * 3. Create a run with the assistant
 * 4. Poll for run completion
 * 5. Retrieve assistant's response
 */
export class OpenAIAssistantLanguageModel implements LanguageModelV2 {
  readonly specificationVersion = "v2"
  readonly modelId: string
  readonly provider = "openai-assistant"
  readonly defaultObjectGenerationMode = undefined
  readonly supportsStructuredOutputs = false
  readonly supportedUrls = {}

  private readonly config: OpenAIAssistantLanguageModelConfig
  private readonly baseURL: string
  private readonly headers: Record<string, string>
  private readonly fetchFn: typeof globalThis.fetch

  constructor(modelId: string, config: OpenAIAssistantLanguageModelConfig) {
    this.modelId = modelId
    this.config = config
    this.baseURL = (config.baseURL ?? "https://api.openai.com/v1").replace(/\/+$/, "")
    this.fetchFn = config.fetch ?? globalThis.fetch

    this.headers = {
      "OpenAI-Beta": "assistants=v2",
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    }
  }

  private async apiCall<T>(method: "GET" | "POST", endpoint: string, body?: unknown): Promise<T> {
    const url = `${this.baseURL}${endpoint}`
    const response = await this.fetchFn(url, {
      method,
      headers: this.headers,
      body: body ? JSON.stringify(body) : undefined,
    })

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "unknown error")
      throw new Error(`OpenAI Assistant API error (${response.status}): ${errorBody}`)
    }

    return response.json() as Promise<T>
  }

  private async runAssistant(userMessage: string): Promise<{ text: string; usage: { input: number; output: number } }> {
    const assistantId = this.config.assistantId
    if (!assistantId) {
      throw new Error("OpenAI Assistant ID is required")
    }

    // Step 1: Create thread
    log.info("creating thread")
    const thread = await this.apiCall<ThreadResponse>("POST", "/threads", {})

    // Step 2: Add user message
    log.info("adding message", { threadId: thread.id })
    await this.apiCall<MessageResponse>("POST", `/threads/${thread.id}/messages`, {
      role: "user",
      content: userMessage,
    })

    // Step 3: Create run
    log.info("creating run", { threadId: thread.id, assistantId })
    const run = await this.apiCall<RunResponse>("POST", `/threads/${thread.id}/runs`, {
      assistant_id: assistantId,
    })

    // Step 4: Poll for completion
    const maxWait = 300_000 // 5 minutes
    const pollInterval = 1_000
    let elapsed = 0
    let currentRun = run

    while (currentRun.status !== "completed" && elapsed < maxWait) {
      await new Promise((r) => setTimeout(r, pollInterval))
      elapsed += pollInterval

      currentRun = await this.apiCall<RunResponse>("GET", `/threads/${thread.id}/runs/${run.id}`)

      if (currentRun.status === "failed" || currentRun.status === "cancelled" || currentRun.status === "expired") {
        const detail = currentRun.last_error
          ? `${currentRun.last_error.code}: ${currentRun.last_error.message}`
          : "no details"
        throw new Error(`Assistant run ${currentRun.status}: ${detail}`)
      }

      // Handle tool calls — submit empty outputs since we don't bridge assistant tools
      if (currentRun.status === "requires_action" && currentRun.required_action) {
        const toolCalls = currentRun.required_action.submit_tool_outputs.tool_calls
        const toolOutputs = toolCalls.map((tc) => ({
          tool_call_id: tc.id,
          output: "Tool execution not available in this context",
        }))
        await this.apiCall("POST", `/threads/${thread.id}/runs/${run.id}/submit_tool_outputs`, {
          tool_outputs: toolOutputs,
        })
      }
    }

    if (currentRun.status !== "completed") {
      throw new Error(`Assistant run timed out after ${elapsed}ms`)
    }

    // Step 5: Retrieve messages
    log.info("retrieving messages", { threadId: thread.id })
    const messagesResp = await this.apiCall<MessagesListResponse>("GET", `/threads/${thread.id}/messages`)

    const assistantMsgs = messagesResp.data.filter((m) => m.role === "assistant")
    if (assistantMsgs.length === 0) {
      throw new Error("No assistant response found in thread")
    }

    const text = assistantMsgs[0].content
      .filter((c) => c.type === "text" && c.text)
      .map((c) => c.text!.value)
      .join("\n")

    return {
      text,
      usage: {
        input: currentRun.usage?.prompt_tokens ?? 0,
        output: currentRun.usage?.completion_tokens ?? 0,
      },
    }
  }

  /**
   * Convert AI SDK prompt format to a single user message string.
   */
  private promptToText(prompt: LanguageModelV2CallOptions["prompt"]): string {
    const parts: string[] = []

    for (const message of prompt) {
      if (message.role === "system") {
        if (typeof message.content === "string") {
          parts.push(`[System]\n${message.content}`)
        }
      } else if (message.role === "user") {
        const textParts = message.content
          .filter((p): p is Extract<typeof p, { type: "text" }> => p.type === "text")
          .map((p) => p.text)
        if (textParts.length > 0) {
          parts.push(`[User]\n${textParts.join("\n")}`)
        }
      } else if (message.role === "assistant") {
        const textParts = message.content
          .filter((p): p is Extract<typeof p, { type: "text" }> => p.type === "text")
          .map((p) => p.text)
        if (textParts.length > 0) {
          parts.push(`[Assistant]\n${textParts.join("\n")}`)
        }
      } else if (message.role === "tool") {
        const results = message.content
          .filter((p) => p.type === "tool-result")
          .map((p) => {
            const content = "content" in p ? JSON.stringify(p.content) : ""
            return `[Tool Result: ${p.toolCallId}]\n${content}`
          })
        parts.push(...results)
      }
    }

    return parts.join("\n\n")
  }

  async doGenerate(
    options: Parameters<LanguageModelV2["doGenerate"]>[0],
  ): Promise<Awaited<ReturnType<LanguageModelV2["doGenerate"]>>> {
    const userMessage = this.promptToText(options.prompt)
    const result = await this.runAssistant(userMessage)

    const content: LanguageModelV2Content[] = [{ type: "text", text: result.text }]

    return {
      content,
      finishReason: "stop" as LanguageModelV2FinishReason,
      usage: {
        inputTokens: result.usage.input,
        outputTokens: result.usage.output,
        totalTokens: result.usage.input + result.usage.output,
      },
      warnings: [],
      request: { body: userMessage },
    }
  }

  async doStream(
    options: Parameters<LanguageModelV2["doStream"]>[0],
  ): Promise<Awaited<ReturnType<LanguageModelV2["doStream"]>>> {
    const userMessage = this.promptToText(options.prompt)
    const result = await this.runAssistant(userMessage)

    const stream = new ReadableStream<LanguageModelV2StreamPart>({
      start(controller) {
        controller.enqueue({ type: "text-start", id: "0" })
        controller.enqueue({ type: "text-delta", id: "0", delta: result.text })
        controller.enqueue({ type: "text-end", id: "0" })
        controller.enqueue({
          type: "finish",
          finishReason: "stop" as LanguageModelV2FinishReason,
          usage: {
            inputTokens: result.usage.input,
            outputTokens: result.usage.output,
            totalTokens: result.usage.input + result.usage.output,
          },
          providerMetadata: undefined,
        })
        controller.close()
      },
    })

    return {
      stream,
      request: { body: userMessage },
    }
  }
}
