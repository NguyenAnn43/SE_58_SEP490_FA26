const { GoogleGenerativeAI } = require('@google/generative-ai');

// gemini-2.5-* không còn mở cho tài khoản mới. Model chính lấy từ GEMINI_MODEL trong .env,
// nếu model đang quá tải (503) / hết lượt (429) thì thử lại 1 lần rồi chuyển model kế tiếp.
const FALLBACK_MODELS = ['gemini-3.5-flash', 'gemini-flash-lite-latest', 'gemini-3.5-flash-lite', 'gemini-3.8-flash'];
const RETRY_DELAY_MS = 1500;

const getModelChain = () => {
    const primary = (process.env.GEMINI_MODEL || '').trim();
    return [...new Set([primary, ...FALLBACK_MODELS].filter(Boolean))];
};

const getStatus = (error) => {
    if (error?.status) return error.status;
    const m = String(error?.message || '').match(/\[(\d{3})\s*\]/);
    return m ? Number(m[1]) : null;
};

const isRetryable = (error) => [429, 500, 503].includes(getStatus(error));

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Gọi Gemini generateContent, tự thử lại / chuyển model khi bị quá tải.
 * @param {string|Array} content - prompt hoặc mảng parts (text + inlineData)
 * @param {object} generationConfig
 */
const generateWithFallback = async (content, generationConfig = {}) => {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    let lastError;
    let usedFallback = false;
    for (const modelName of getModelChain()) {
        const model = genAI.getGenerativeModel({ model: modelName, generationConfig });
        for (let attempt = 1; attempt <= 2; attempt++) {
            try {
                const result = await model.generateContent(content);
                if (usedFallback || attempt > 1) {
                    console.log(`✅ [Gemini] Đã trả lời bằng ${modelName}${attempt > 1 ? ' (lần thử 2)' : ''}`);
                }
                return { result, modelName };
            } catch (error) {
                lastError = error;
                if (!isRetryable(error)) throw error;
                const status = getStatus(error);
                const reason = status === 429 ? 'hết lượt' : 'quá tải';
                if (attempt === 1) {
                    console.warn(`⚠️ [Gemini] ${modelName} ${reason} (${status}), thử lại...`);
                    await sleep(RETRY_DELAY_MS);
                } else {
                    console.warn(`⚠️ [Gemini] ${modelName} vẫn ${reason} (${status}), chuyển model khác...`);
                    usedFallback = true;
                }
            }
        }
    }
    throw lastError;
};

module.exports = { generateWithFallback };
