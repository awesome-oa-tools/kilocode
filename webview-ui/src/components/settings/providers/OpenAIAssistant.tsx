import { useCallback } from "react"
import { VSCodeTextField } from "@vscode/webview-ui-toolkit/react"

import type { ProviderSettings } from "@roo-code/types"

import { useAppTranslation } from "@src/i18n/TranslationContext"
import { VSCodeButtonLink } from "@src/components/common/VSCodeButtonLink"

import { inputEventTransform } from "../transforms"

type OpenAIAssistantProps = {
	apiConfiguration: ProviderSettings
	setApiConfigurationField: (field: keyof ProviderSettings, value: ProviderSettings[keyof ProviderSettings]) => void
}

export const OpenAIAssistant = ({ apiConfiguration, setApiConfigurationField }: OpenAIAssistantProps) => {
	const { t } = useAppTranslation()

	const handleInputChange = useCallback(
		<K extends keyof ProviderSettings, E>(
			field: K,
			transform: (event: E) => ProviderSettings[K] = inputEventTransform,
		) =>
			(event: E | Event) => {
				setApiConfigurationField(field, transform(event as E))
			},
		[setApiConfigurationField],
	)

	return (
		<>
			<VSCodeTextField
				value={apiConfiguration?.openAiAssistantBaseUrl || ""}
				type="url"
				onInput={handleInputChange("openAiAssistantBaseUrl")}
				placeholder="https://api.openai.com/v1"
				className="w-full">
				<label className="block font-medium mb-1">Base URL (Optional)</label>
			</VSCodeTextField>
			<div className="text-sm text-vscode-descriptionForeground -mt-2">
				Leave empty to use the default OpenAI API endpoint
			</div>

			<VSCodeTextField
				value={apiConfiguration?.openAiAssistantApiKey || ""}
				type="password"
				onInput={handleInputChange("openAiAssistantApiKey")}
				placeholder={t("settings:placeholders.apiKey")}
				className="w-full">
				<label className="block font-medium mb-1">OpenAI API Key</label>
			</VSCodeTextField>
			<div className="text-sm text-vscode-descriptionForeground -mt-2">
				{t("settings:providers.apiKeyStorageNotice")}
			</div>
			{!apiConfiguration?.openAiAssistantApiKey && (
				<VSCodeButtonLink href="https://platform.openai.com/api-keys" appearance="secondary">
					Get OpenAI API Key
				</VSCodeButtonLink>
			)}

			<VSCodeTextField
				value={apiConfiguration?.openAiAssistantId || ""}
				type="text"
				onInput={handleInputChange("openAiAssistantId")}
				placeholder="asst_xxxxxxxxxxxxx"
				className="w-full">
				<label className="block font-medium mb-1">Assistant ID</label>
			</VSCodeTextField>
			<div className="text-sm text-vscode-descriptionForeground -mt-2">
				The ID of your configured OpenAI Assistant. Create one at{" "}
				<a
					href="https://platform.openai.com/assistants"
					target="_blank"
					rel="noopener noreferrer"
					className="text-vscode-textLink-foreground hover:text-vscode-textLink-activeForeground">
					platform.openai.com/assistants
				</a>
			</div>

			<div className="mt-4 p-3 bg-vscode-textBlockQuote-background border-l-4 border-vscode-textBlockQuote-border rounded">
				<div className="text-sm">
					<strong>Note:</strong> OpenAI Assistant API uses a thread-based conversation model. Each request
					creates a new thread. The assistant&apos;s behavior and tools are configured in the OpenAI
					dashboard.
				</div>
			</div>
		</>
	)
}
