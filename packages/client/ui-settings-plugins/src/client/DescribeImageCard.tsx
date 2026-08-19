/**
 * The describe-image tool's card: its vision endpoint and model, and the key —
 * which is written through the credentials domain, never into the settings
 * section, so the literal never rides a response.
 */

import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { SecretField, ValueField } from './fields.tsx'
import { PluginCard } from './PluginCard.tsx'
import type { DescribeImageCardFace } from './describe-image-card-controller.ts'
import type {} from './slot-contract.ts'

/** Props the renderer binds for the describe-image card. */
export type DescribeImageCardProps =
  PropsRuntime<'settings.plugin.item'>
  & PropsLocale<'settings.plugins'>
  & InjectFace<DescribeImageCardFace>

/**
 * Render the describe-image card.
 * @param props - locale copy, the card snapshot, and its form actions.
 * @returns the card.
 */
export function DescribeImageCard(props: DescribeImageCardProps) {
  const { t } = props
  const state = props.useDescribeImageCard(snapshot => snapshot)
  const disabled = !state.writable
  return (
    <PluginCard
      t={t}
      titleKey="describeImageTitle"
      descriptionKey="describeImageDescription"
      state={state}
      onSave={props.save}
      onDiscard={props.discard}
    >
      <SecretField
        id="plugin-config-describe-image-key"
        label={t('describeImageApiKey')}
        hint={t('describeImageApiKeyHint')}
        // The credentials domain accepts a key even when the settings document
        // itself is read-only; they are separate stores with separate refusals.
        // Its own writability is what disables this control — a key sourced
        // from the process environment cannot be written from here.
        disabled={!state.apiKeyWritable}
        text={state.apiKey.text}
        configured={state.apiKeyConfigured}
        stateLabel={state.apiKeyConfigured ? t('describeImageApiKeySet') : t('describeImageApiKeyUnset')}
        onEdit={(text) => { props.edit('apiKey', text) }}
      />
      <ValueField
        id="plugin-config-describe-image-base-url"
        label={t('describeImageBaseUrl')}
        hint={t('describeImageBaseUrlHint')}
        overriddenLabel={t('overridden')}
        resetLabel={t('reset')}
        invalidLabel={t('invalidNumber')}
        disabled={disabled}
        {...state.baseURL}
        onEdit={(text) => { props.edit('baseURL', text) }}
        onReset={() => { props.resetField('baseURL') }}
      />
      <ValueField
        id="plugin-config-describe-image-model"
        label={t('describeImageModel')}
        hint={t('describeImageModelHint')}
        overriddenLabel={t('overridden')}
        resetLabel={t('reset')}
        invalidLabel={t('invalidNumber')}
        disabled={disabled}
        {...state.model}
        onEdit={(text) => { props.edit('model', text) }}
        onReset={() => { props.resetField('model') }}
      />
    </PluginCard>
  )
}
