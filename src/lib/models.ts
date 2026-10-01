export const openAiModelPresets = ['gpt-6.1-sol', 'gpt-6-astra', 'gpt-6-sol', 'gpt-6-luna']

export const orderModels = (models: string[]) => [...new Set(models)].sort((a, b) => {
  const rank = (model: string) => {
    const index = openAiModelPresets.indexOf(model)
    return index < 0 ? openAiModelPresets.length : index
  }
  return rank(a) - rank(b) || a.localeCompare(b)
})
