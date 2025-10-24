import { Anthropic } from "@anthropic-ai/sdk"
import axios from "axios"

import { openAiModelInfoSaneDefaults } from "@roo-code/types"
import type { ModelInfo } from "@roo-code/types"

import type { ApiHandlerOptions } from "../../shared/api"
import type { ApiHandlerCreateMessageMetadata } from "../index"

import { ApiStream } from "../transform/stream"
import { BaseProvider } from "./base-provider"
import { DEFAULT_HEADERS } from "./constants"
import { getApiRequestTimeout } from "./utils/timeout-config"

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

/**
 * OpenAI Assistant API Handler
 *
 * This handler implements the OpenAI Assistant API integration, which differs
 * from the standard Chat Completions API by using a thread-based conversation model.
 *
 * Flow:
 * 1. Create a thread for the conversation
 * 2. Add user message to the thread
 * 3. Create a run with the assistant
 * 4. Poll for run completion
 * 5. Retrieve assistant's response from the thread
 */
export class OpenAiAssistantHandler extends BaseProvider {
	protected options: ApiHandlerOptions
	private readonly providerName = "OpenAI Assistant"
	private readonly baseURL: string
	private readonly apiKey: string
	private readonly assistantId: string
	private readonly headers: Record<string, string>
	private readonly timeout: number

	constructor(options: ApiHandlerOptions) {
		super()
		this.options = options

		this.baseURL = this.options.openAiAssistantBaseUrl || "https://api.openai.com/v1"
		this.apiKey = this.options.openAiAssistantApiKey || ""
		this.assistantId = this.options.openAiAssistantId || ""

		this.headers = {
			...DEFAULT_HEADERS,
			"OpenAI-Beta": "assistants=v2",
			"Content-Type": "application/json",
			Authorization: `Bearer ${this.apiKey}`,
		}

		this.timeout = getApiRequestTimeout()
	}

	private async makeApiCall<T>(method: "GET" | "POST", endpoint: string, data?: any, retryCount = 0): Promise<T> {
		const maxRetries = 2 // Maximum number of retries for rate limit errors
		const retryDelay = 60000 // 60 seconds as suggested by the error

		try {
			const response = await axios({
				method,
				url: `${this.baseURL}${endpoint}`,
				headers: this.headers,
				data,
				timeout: this.timeout,
			})
			return response.data
		} catch (error) {
			if (axios.isAxiosError(error)) {
				const statusCode = error.response?.status
				const errorData = error.response?.data
				const message = error.response?.data?.error?.message || error.message

				// Handle 429 Rate Limit errors with retry
				if (statusCode === 429 && retryCount < maxRetries) {
					const waitTime = retryDelay / 1000 // Convert to seconds for logging
					console.warn(
						`[OpenAI Assistant] Rate limit hit (429), retrying in ${waitTime} seconds... (attempt ${retryCount + 1}/${maxRetries})`,
					)
					await this.sleep(retryDelay)
					return this.makeApiCall<T>(method, endpoint, data, retryCount + 1)
				}

				console.error(`[OpenAI Assistant] API call failed: ${method} ${endpoint}`)
				console.error(`[OpenAI Assistant] Status code: ${statusCode}`)
				console.error(`[OpenAI Assistant] Error data:`, JSON.stringify(errorData, null, 2))
				throw new Error(`${this.providerName} API error: ${message}`)
			}
			throw error
		}
	}

	override async *createMessage(
		systemPrompt: string,
		messages: Anthropic.Messages.MessageParam[],
		_metadata?: ApiHandlerCreateMessageMetadata,
	): ApiStream {
		// Validate assistant ID
		if (!this.assistantId) {
			throw new Error("OpenAI Assistant ID is required")
		}

		try {
			// Step 1: Create a new thread
			console.log(`[OpenAI Assistant] Creating new thread...`)
			const thread = await this.makeApiCall<ThreadResponse>("POST", "/threads", {})
			console.log(`[OpenAI Assistant] Thread created: ${thread.id}`)

			// Step 2: Combine system prompt and user messages
			// For Assistant API, we'll add the system prompt as the first user message
			// and then add the actual conversation messages
			const fullMessage = this.constructUserMessage(systemPrompt, messages)

			console.log(`[OpenAI Assistant] Adding message to thread ${thread.id}`)
			await this.makeApiCall<MessageResponse>("POST", `/threads/${thread.id}/messages`, {
				role: "user",
				content: fullMessage,
			})

			// Step 3: Create a run
			console.log(`[OpenAI Assistant] Creating run with assistant ${this.assistantId}`)
			const run = await this.makeApiCall<RunResponse>("POST", `/threads/${thread.id}/runs`, {
				assistant_id: this.assistantId,
			})
			console.log(`[OpenAI Assistant] Run created: ${run.id}, initial status: ${run.status}`)

			// Step 4: Poll for completion
			let runStatus = run.status
			let currentRun = run
			const maxWaitTime = 300000 // 5 minutes
			const pollInterval = 1000 // 1 second
			let elapsedTime = 0

			while (runStatus !== "completed" && elapsedTime < maxWaitTime) {
				await this.sleep(pollInterval)
				elapsedTime += pollInterval

				currentRun = await this.makeApiCall<RunResponse>("GET", `/threads/${thread.id}/runs/${run.id}`)
				runStatus = currentRun.status

				// Log status changes
				if (runStatus !== run.status) {
					console.log(`[OpenAI Assistant] Run status changed: ${runStatus}`)
				}

				// Handle different statuses
				if (runStatus === "failed" || runStatus === "cancelled" || runStatus === "expired") {
					const errorDetails = currentRun.last_error
						? `${currentRun.last_error.code}: ${currentRun.last_error.message}`
						: "No error details available"
					console.error(`[OpenAI Assistant] Run ${runStatus}`)
					console.error(`[OpenAI Assistant] Error details: ${errorDetails}`)
					console.error(`[OpenAI Assistant] Full run response:`, JSON.stringify(currentRun, null, 2))
					throw new Error(`Assistant run ${runStatus}: ${errorDetails}`)
				}

				// Handle tool calls if needed
				if (runStatus === "requires_action" && currentRun.required_action) {
					console.log(`[OpenAI Assistant] Run requires action, handling tool calls...`)
					// For now, we'll submit empty tool outputs
					// In a full implementation, you would execute the tools and return results
					const toolCalls = currentRun.required_action.submit_tool_outputs.tool_calls
					const toolOutputs = toolCalls.map((call) => ({
						tool_call_id: call.id,
						output: "Tool execution not implemented",
					}))

					await this.makeApiCall("POST", `/threads/${thread.id}/runs/${run.id}/submit_tool_outputs`, {
						tool_outputs: toolOutputs,
					})
					console.log(`[OpenAI Assistant] Tool outputs submitted`)
				}
			}

			if (runStatus !== "completed") {
				console.error(`[OpenAI Assistant] Run timeout after ${elapsedTime}ms`)
				throw new Error("Assistant run timeout")
			}

			console.log(`[OpenAI Assistant] Run completed successfully, retrieving messages...`)

			// Step 5: Retrieve messages
			const messagesResponse = await this.makeApiCall<MessagesListResponse>(
				"GET",
				`/threads/${thread.id}/messages`,
			)

			// Find the latest assistant message
			const assistantMessages = messagesResponse.data.filter((msg) => msg.role === "assistant")
			if (assistantMessages.length === 0) {
				throw new Error("No assistant response found")
			}

			const latestMessage = assistantMessages[0]
			const textContent = latestMessage.content
				.filter((c) => c.type === "text" && c.text)
				.map((c) => c.text!.value)
				.join("\n")

			console.log(`[OpenAI Assistant] Response received, length: ${textContent.length} characters`)

			// Yield the response
			yield {
				type: "text",
				text: textContent,
			}

			// Yield usage information (Assistant API doesn't provide detailed token counts)
			yield {
				type: "usage",
				inputTokens: 0,
				outputTokens: 0,
			}
		} catch (error) {
			console.error(`[OpenAI Assistant] Error:`, error)
			if (error instanceof Error) {
				throw new Error(`${this.providerName} error: ${error.message}`)
			}
			throw error
		}
	}

	override getModel() {
		// Assistant API doesn't expose model info directly
		// The model is configured in the assistant itself
		return {
			id: this.assistantId,
			info: {
				...openAiModelInfoSaneDefaults,
				maxTokens: 16384, // Default context window
				contextWindow: 128000, // Modern OpenAI models context window
				supportsPromptCache: false,
			} as ModelInfo,
		}
	}

	/**
	 * Constructs the user message from system prompt and conversation messages
	 */
	private constructUserMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): string {
		// Convert Anthropic message format to plain text
		const conversationText = messages
			.map((msg) => {
				if (typeof msg.content === "string") {
					return `${msg.role}: ${msg.content}`
				} else if (Array.isArray(msg.content)) {
					const textParts = msg.content
						.filter((part) => part.type === "text")
						.map((part) => (part as any).text)
						.join("\n")
					return `${msg.role}: ${textParts}`
				}
				return ""
			})
			.filter((text) => text.length > 0)
			.join("\n\n")

		// Combine system prompt with conversation
		return `${systemPrompt}\n\n${conversationText}`
	}

	/**
	 * Helper to sleep for polling
	 */
	private sleep(ms: number): Promise<void> {
		return new Promise((resolve) => setTimeout(resolve, ms))
	}
}
