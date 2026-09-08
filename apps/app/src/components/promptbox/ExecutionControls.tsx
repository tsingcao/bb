import { memo } from "react";
import type { PermissionMode, ReasoningLevel, ServiceTier } from "@bb/domain";
import type {
  SystemExecutionOptionsModelLoadError,
  SystemProvidersQuery,
} from "@bb/server-contract";
import { formatModelLabel } from "@/hooks/useThreadCreationOptions";
import {
  ModelReasoningPicker,
  type ModelReasoningPickerFooterAction,
} from "@/components/pickers/ModelReasoningPicker";
import { type PickerOption } from "@/components/pickers/OptionPicker";
import type { ModelPickerOption } from "@/components/pickers/model-picker-option";
import type { ProviderPickerOption } from "@/components/pickers/model-brand-prefix";
import { Switch } from "@bb/shared-ui/switch";
import {
  usePromptBoxRecentlyUsedModels,
  usePromptBoxShowVerifiedModelsPreference,
} from "@/hooks/thread-creation-options/persisted-selection-fields";

interface ExecutionProviderConfig {
  options?: readonly ProviderPickerOption[];
  selectedId?: string;
  onChange?: (value: string) => void;
  hasMultiple?: boolean;
}

interface ExecutionModelConfig {
  active?: { model: string } | null;
  selected: string;
  options: readonly ModelPickerOption[];
  moreOptions: readonly ModelPickerOption[];
  isLoading: boolean;
  loadFailed: boolean;
  loadError?: SystemExecutionOptionsModelLoadError | null;
  onChange: (value: string) => void;
}

interface ExecutionServiceTierConfig {
  value?: ServiceTier;
  onChange: (value: ServiceTier | undefined) => void;
  supported: boolean;
  supportByProvider?: Record<string, boolean>;
  fastLabel?: string;
}

interface ExecutionReasoningConfig {
  value: ReasoningLevel;
  options: readonly PickerOption<ReasoningLevel>[];
  onChange: (value: ReasoningLevel) => void;
}

export interface ExecutionPermissionConfig {
  value?: PermissionMode;
  options: readonly PickerOption<PermissionMode>[];
  onChange: (value: PermissionMode) => void;
  supported: boolean;
}

export interface ExecutionControlsProps {
  providerRouting?: SystemProvidersQuery;
  provider: ExecutionProviderConfig;
  model: ExecutionModelConfig;
  serviceTier?: ExecutionServiceTierConfig;
  reasoning: ExecutionReasoningConfig;
  footerAction?: ModelReasoningPickerFooterAction;
  disabled?: boolean;
}

export const ExecutionControls = memo(function ExecutionControls({
  provider,
  providerRouting,
  model,
  serviceTier,
  reasoning,
  footerAction,
  disabled,
}: ExecutionControlsProps) {
  const handleServiceTierChange = serviceTier?.onChange ?? (() => {});
  const { value: showOnlyVerified, setValue: setShowOnlyVerified } =
    usePromptBoxShowVerifiedModelsPreference();
  const { value: recentlyUsedModels } = usePromptBoxRecentlyUsedModels();
  const selectedProviderId = provider.selectedId ?? "";

  const canSwitchProviders = Boolean(
    provider.hasMultiple &&
    provider.onChange &&
    provider.options &&
    provider.options.length > 1,
  );
  const showModelPicker =
    model.isLoading ||
    model.loadFailed ||
    model.options.length > 0 ||
    canSwitchProviders ||
    selectedProviderId.length > 0 ||
    footerAction !== undefined;

  // 已验证 = Provider 推荐(isDefault) 或 近期成功使用过 或 已知可用清单（仅本地可用的 OpenCode/NVIDIA）
  const KNOWN_GOOD_MODELS = new Set([
    "opencode/big-pickle",
    "opencode/muse-spark-1.3-contributor-free",
    "opencode/muse-spark-1.2-contributor-free",
    "opencode/nemotron-3.5-lightning-free",
    "nvidia/minimaxai/minimax-m3",
    "nvidia/minimaxai/minimax-m2.7",
    "nvidia/nvidia/nemotron-3-nano-30b-a3b",
    "nvidia/nvidia/nemotron-3-ultra-550b-a55b",
    "nvidia/meta/llama-3.1-70b-instruct",
    "nvidia/meta/llama-3.1-8b-instruct",
    "nvidia/moonshotai/kimi-k3",
    "nvidia/deepseek-ai/deepseek-v4-pro",
  ]);
  const isVerified = (m: { value: string; isDefault?: boolean }) =>
    !!m.isDefault || recentlyUsedModels.includes(m.value) || KNOWN_GOOD_MODELS.has(m.value);
  const verifiedCount = model.options.filter(isVerified).length;
  const filteredModelOptions = showOnlyVerified
    ? model.options.filter(isVerified)
    : model.options;
  const filteredMoreModelOptions = showOnlyVerified
    ? model.moreOptions.filter(isVerified)
    : model.moreOptions;

  return (
    <>
      {showModelPicker ? (
        <div className="space-y-1">
          <div className="flex items-center justify-between gap-2 px-2 py-1">
            <span className="text-xs text-muted-foreground">
              模型 {showOnlyVerified ? `(${verifiedCount} 已验证)` : `(${model.options.length} 全部)`}
            </span>
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
              <span>仅显示已验证</span>
              <Switch
                checked={showOnlyVerified}
                onCheckedChange={setShowOnlyVerified}
                aria-label="仅显示已验证模型"
              />
            </label>
          </div>
          <ModelReasoningPicker
            providerOptions={provider.options ?? []}
            providerRouting={providerRouting}
            selectedProviderId={selectedProviderId}
            onSelectedProviderChange={provider.onChange}
            hasMultipleProviders={provider.hasMultiple ?? false}
            modelValue={model.active?.model ?? model.selected}
            modelOptions={filteredModelOptions}
            moreModelOptions={filteredMoreModelOptions}
            modelIsLoading={model.isLoading}
            modelLoadFailed={model.loadFailed}
            modelLoadError={model.loadError}
            onModelChange={model.onChange}
            formatModelLabel={formatModelLabel}
            reasoningValue={reasoning.value}
            reasoningOptions={reasoning.options}
            onReasoningChange={reasoning.onChange}
            fastModeEnabled={serviceTier?.value === "fast"}
            onFastModeChange={(enabled) =>
              handleServiceTierChange(enabled ? "fast" : "default")
            }
            showFastModeToggle={serviceTier?.supported ?? false}
            serviceTierSupportByProvider={serviceTier?.supportByProvider}
            fastModeLabel={serviceTier?.fastLabel}
            muted
            disabled={disabled}
            footerAction={footerAction}
          />
        </div>
      ) : null}
    </>
  );
});
