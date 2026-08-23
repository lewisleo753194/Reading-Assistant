/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, type ReactNode } from 'react'

export type AppLanguage = 'zh-CN' | 'en-US' | (string & {})
export type LanguagePack = { code: AppLanguage; label: string; aiLanguage: string; strings: Record<string, string> }

const zh: LanguagePack = { code: 'zh-CN', label: '中文', aiLanguage: '简体中文', strings: {
  home: '主页', openFile: '打开新文件', settings: '设置', light: '切换日间模式', dark: '切换夜间模式', appName: 'Reading Assistant',
  selectFile: '选择文件', dropTitle: '拖放 PDF 或图片', dropSubtitle: '也可以点击选择，或直接粘贴剪贴板图片', paste: '支持 PDF、PNG、JPG、WebP 与剪贴板图片',
  selection: '选区', selectedContent: '已选内容', clear: '清空', selectionEmpty: '选择文字或开启区域选择后，内容会固定显示在这里。', chooseText: '选择文字', chooseArea: '选择区域',
    conversations: '对话', newConversation: '新对话', deleteConversation: '删除对话', untitledConversation: '新对话', deleteSelection: '删除此选区图片及对应文字',
  previousPage: '上一页', nextPage: '下一页', aiAssistant: '阅读助手', selectedScope: '对选区', documentScope: '对全文', translate: '翻译', explain: '解释', insight: '洞察', summarize: '总结',
  analysisHistory: '分析记录', aiAnalysis: 'AI 分析', copy: '复制', thinking: '正在结合上下文思考…', promptSelection: '针对选区继续提问…', promptDocument: '针对全文提问…', sendHint: 'Enter 发送 · Shift + Enter 换行', chooseSkillHint: '/ 选择 skill', unknownSkill: '没有找到这个 skill。请输入 / 后从列表中选择。', skillUsed: 'Skill',
  notConfigured: '尚未配置 AI，点击填写接口与 API Key', language: '语言', closeTab: '关闭工作区', visualPlaceholder: '视觉模型会读取选区原图；也可在此补充文字', textPlaceholder: '识别结果会显示在这里，也可以手动修改',
  invalidFile: '请选择 PDF 或图片文件。', pastedImage: '粘贴图片', recognizing: '正在识别文字', preparingOcr: '正在准备中英文 OCR 模型…', readingPdfText: '正在读取 PDF 原始文字…', noText: '没有识别到文字，请重新框选更清晰或更大的区域。', ocrFailed: 'OCR 失败', readingDocument: '正在读取 PDF 全文…', readingImage: '正在识别图片全文…', extracting: '正在提取全文', scannedOcr: '扫描件 OCR', selectFirst: '请先选择文字，或在开启公式与图表理解后框选视觉区域。', reasoningImageUnsupported: '当前深度思考模式不能处理图片选区。请关闭“深度思考”后重试，应用将改用视觉模型。', requestFailed: 'AI 请求失败', processFailed: '处理失败', translatingFailed: '翻译失败', processing: '处理中…', selectedStatus: '已选 {count} 组 · {chars} 个字符', visualStatus: '已选 {count} 个视觉区域', loadingPdf: '正在打开 PDF…', connectionFailed: '连接失败',
    configTitle: '配置 AI 服务', settingsTitle: '设置', modelSettings: '模型设置', skillSettings: '技能设置', languageSettings: '语言设置', defaultModel: '默认模型', apiUrl: 'API 接口地址', model: '模型名称', apiKey: 'API Key', visual: '启用公式与图表理解', visualUrl: '视觉模型接口地址（可选）', visualModel: '视觉模型名称', visualKey: '视觉模型 API Key（可选）', deepThinking: '深度思考', enableDeepThinking: '启用深度思考', configureDeepThinking: '请先在模型设置中启用深度思考模型', reasoningUrl: '深度思考接口地址（可选）', reasoningModel: '深度思考模型名称', reasoningKey: '深度思考 API Key（可选）',
  inheritUrl: '留空则沿用文本接口', inheritKey: '留空则沿用文本 API Key', serverFallback: '留空则使用服务端配置', test: '测试连接', save: '保存配置', close: '关闭设置', showKey: '显示 API Key', hideKey: '隐藏 API Key', importSkill: '导入 Skill', removeSkill: '删除 Skill', noSkills: '尚未导入 Skill', skillImportHelp: '选择包含 SKILL.md 的文件夹。AI 可自动选择，也可在聊天开头用 / 指定。', skillImported: 'Skill 已导入。', importLanguage: '导入语言包', languageImportHelp: '选择包含 language.json 的文件夹。语言包决定界面、AI 回答及翻译语言。', languageImported: '语言包已导入并切换。', importFailed: '导入失败', desktopImportOnly: '文件夹导入功能仅在桌面应用中可用。',
} }

const en: LanguagePack = { code: 'en-US', label: 'English', aiLanguage: 'English', strings: {
  home: 'Home', openFile: 'Open file', settings: 'Settings', light: 'Use light mode', dark: 'Use dark mode', appName: 'Reading Assistant',
  selectFile: 'Choose file', dropTitle: 'Drop a PDF or image', dropSubtitle: 'Click to choose, or paste an image from the clipboard', paste: 'PDF, PNG, JPG, WebP and clipboard images',
  selection: 'Selections', selectedContent: 'Selected content', clear: 'Clear', selectionEmpty: 'Selected text and regions stay here for this workspace.', chooseText: 'Select text', chooseArea: 'Select area',
    conversations: 'Conversations', newConversation: 'New conversation', deleteConversation: 'Delete conversation', untitledConversation: 'New conversation', deleteSelection: 'Delete this image and its extracted text',
  previousPage: 'Previous page', nextPage: 'Next page', aiAssistant: 'Reading assistant', selectedScope: 'Selection', documentScope: 'Document', translate: 'Translate', explain: 'Explain', insight: 'Insight', summarize: 'Summarize',
  analysisHistory: 'History', aiAnalysis: 'AI analysis', copy: 'Copy', thinking: 'Thinking with document context…', promptSelection: 'Ask about the selection…', promptDocument: 'Ask about the document…', sendHint: 'Enter to send · Shift + Enter for a new line', chooseSkillHint: '/ choose skill', unknownSkill: 'Skill not found. Type / and choose one from the list.', skillUsed: 'Skill',
  notConfigured: 'Configure an AI endpoint and API key', language: 'Language', closeTab: 'Close workspace', visualPlaceholder: 'The visual model will read the selected image; optional notes can be added here', textPlaceholder: 'Extracted text appears here and can be edited',
  invalidFile: 'Choose a PDF or image file.', pastedImage: 'Pasted image', recognizing: 'Recognizing text', preparingOcr: 'Preparing Chinese and English OCR…', readingPdfText: 'Reading native PDF text…', noText: 'No text was found. Select a clearer or larger region.', ocrFailed: 'OCR failed', readingDocument: 'Reading the PDF…', readingImage: 'Recognizing the image…', extracting: 'Extracting document', scannedOcr: 'Scanned PDF OCR', selectFirst: 'Select text, or enable visual understanding and select an image region.', reasoningImageUnsupported: 'Deep-thinking mode cannot process an image selection. Turn off Deep thinking and try again so the vision model can handle it.', requestFailed: 'AI request failed', processFailed: 'Processing failed', translatingFailed: 'Translation failed', processing: 'Processing…', selectedStatus: '{count} selections · {chars} characters', visualStatus: '{count} visual selections', loadingPdf: 'Opening PDF…', connectionFailed: 'Connection failed',
    configTitle: 'Configure AI service', settingsTitle: 'Settings', modelSettings: 'Model settings', skillSettings: 'Skill settings', languageSettings: 'Language settings', defaultModel: 'Default model', apiUrl: 'API base URL', model: 'Model', apiKey: 'API Key', visual: 'Enable formula and chart understanding', visualUrl: 'Vision API base URL (optional)', visualModel: 'Vision model', visualKey: 'Vision API Key (optional)', deepThinking: 'Deep thinking', enableDeepThinking: 'Enable deep thinking', configureDeepThinking: 'Enable a deep-thinking model in Model settings first', reasoningUrl: 'Deep-thinking API base URL (optional)', reasoningModel: 'Deep-thinking model', reasoningKey: 'Deep-thinking API Key (optional)',
  inheritUrl: 'Leave blank to use the text endpoint', inheritKey: 'Leave blank to use the text API key', serverFallback: 'Leave blank to use the server configuration', test: 'Test connection', save: 'Save', close: 'Close settings', showKey: 'Show API Key', hideKey: 'Hide API Key', importSkill: 'Import Skill', removeSkill: 'Remove Skill', noSkills: 'No Skills imported', skillImportHelp: 'Choose a folder containing SKILL.md. AI can select automatically, or use / at the start of a chat.', skillImported: 'Skill imported.', importLanguage: 'Import language pack', languageImportHelp: 'Choose a folder containing language.json. It controls the interface, AI replies, and translation language.', languageImported: 'Language pack imported and selected.', importFailed: 'Import failed', desktopImportOnly: 'Folder import is available in the desktop app only.',
} }

const packs = new Map<string, LanguagePack>([[zh.code, zh], [en.code, en]])
export function registerLanguagePack(pack: LanguagePack) { packs.set(pack.code, pack) }
export function getLanguagePacks() { return Array.from(packs.values()) }
export function getLanguagePack(code: AppLanguage) { return packs.get(code) || zh }

const I18nContext = createContext({ pack: zh, t: (key: string) => zh.strings[key] || key })
export function I18nProvider({ language, children }: { language: AppLanguage; children: ReactNode }) {
  const pack = getLanguagePack(language)
  return <I18nContext.Provider value={{ pack, t: (key) => pack.strings[key] || zh.strings[key] || key }}>{children}</I18nContext.Provider>
}
export function useI18n() { return useContext(I18nContext) }
