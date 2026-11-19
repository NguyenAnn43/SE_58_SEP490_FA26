const { GoogleGenerativeAI } = require('@google/generative-ai');

// gemini-2.5-* không còn mở cho tài khoản mới. Model chính lấy từ GEMINI_MODEL trong .env,
// model quá tải (503) / hết lượt (429) / quá chậm → chuyển ngay model kế tiếp.
const FALLBACK_MODELS = ['gemini-3.5-flash', 'gemini-flash-lite-latest', 'gemini-3.5-flash-lite', 'gemini-3.8-flash'];

/** Model vừa lỗi quá tải bị "nghỉ" một lúc → các câu chat sau không phải chờ nó lỗi lại */
const COOLDOWN_MS = 2 * 60 * 1000;
/** Một lần gọi quá lâu thì bỏ, thử model khác (tránh khách chờ vô hạn) */
const CALL_TIMEOUT_MS = 12 * 1000;
/** Chỉ nghỉ trước khi thử lại khi KHÔNG còn model nào khác để chuyển */
const RETRY_DELAY_MS = 1500;

const cooldownUntil = new Map(); // modelName -> timestamp
let lastGoodModel = null;

const getModelChain = () => {
    const primary = (process.env.GEMINI_MODEL || '').trim();
    const all = [...new Set([lastGoodModel, primary, ...FALLBACK_MODELS].filter(Boolean))];
    const now = Date.now();
    const ready = all.filter((m) => (cooldownUntil.get(m) || 0) <= now);
    // Tất cả đều đang nghỉ → vẫn thử hết (ưu tiên model sắp hết nghỉ)
    return ready.length ? ready : all.sort((a, b) => (cooldownUntil.get(a) || 0) - (cooldownUntil.get(b) || 0));
};

const getStatus = (error) => {
    if (error?.status) return error.status;
    if (error?.code === 'GEMINI_TIMEOUT') return 504;
    const m = String(error?.message || '').match(/\[(\d{3})\s*\]/);
    return m ? Number(m[1]) : null;
};

const isRetryable = (error) => [429, 500, 503, 504].includes(getStatus(error));

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const withTimeout = (promise, ms) => {
    let timer;
    const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => {
            const err = new Error(`Gemini quá ${ms / 1000}s chưa trả lời`);
            err.code = 'GEMINI_TIMEOUT';
            reject(err);
        }, ms);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
};

/**
 * Gọi Gemini generateContent, tự chuyển model khi bị quá tải / quá chậm.
 * @param {string|Array} content - prompt hoặc mảng parts (text + inlineData)
 * @param {object} generationConfig
 */
const generateWithFallback = async (content, generationConfig = {}) => {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const chain = getModelChain();
    let lastError;
    for (let i = 0; i < chain.length; i++) {
        const modelName = chain[i];
        const isLast = i === chain.length - 1;
        const model = genAI.getGenerativeModel({ model: modelName, generationConfig });
        // Còn model khác → lỗi là chuyển luôn; model cuối cùng → thử lại 1 lần
        const attempts = isLast ? 2 : 1;
        for (let attempt = 1; attempt <= attempts; attempt++) {
            const started = Date.now();
            try {
                const result = await withTimeout(model.generateContent(content), CALL_TIMEOUT_MS);
                if (modelName !== lastGoodModel) {
                    console.log(`✅ [Gemini] Dùng ${modelName} (${Date.now() - started}ms)`);
                }
                lastGoodModel = modelName;
                cooldownUntil.delete(modelName);
                return { result, modelName };
            } catch (error) {
                lastError = error;
                if (!isRetryable(error)) throw error;
                const status = getStatus(error);
                const reason = status === 429 ? 'hết lượt' : status === 504 ? 'quá chậm' : 'quá tải';
                cooldownUntil.set(modelName, Date.now() + COOLDOWN_MS);
                if (lastGoodModel === modelName) lastGoodModel = null;
                console.warn(`⚠️ [Gemini] ${modelName} ${reason} (${status}) — tạm bỏ qua ${COOLDOWN_MS / 60000} phút`);
                if (attempt < attempts) await sleep(RETRY_DELAY_MS);
            }
        }
    }
    throw lastError;
};

module.exports = { generateWithFallback };
