const crypto = require('node:crypto');

const OTP_LENGTH = 6;
const DEFAULT_TTL_MS = 5 * 60 * 1000;
const DEFAULT_MAX_ATTEMPTS = 5;

function createOtpService({
    sendOtp = async ({ phone, code }) => console.log(`OTP for ${phone}: ${code}`),
    now = () => Date.now(),
    generateCode = () => crypto.randomInt(0, 1_000_000).toString().padStart(OTP_LENGTH, '0'),
    ttlMs = DEFAULT_TTL_MS,
    maxAttempts = DEFAULT_MAX_ATTEMPTS
} = {}) {
    const challenges = new Map();

    const hashCode = (phone, code) => crypto
        .createHash('sha256')
        .update(`${phone}:${code}`)
        .digest();

    return {
        async request(phone) {
            const code = generateCode();
            const expiresAt = now() + ttlMs;
            challenges.set(phone, {
                codeHash: hashCode(phone, code),
                expiresAt,
                attempts: 0
            });
            await sendOtp({ phone, code, expiresAt });
            return { expiresAt };
        },

        verify(phone, code) {
            const challenge = challenges.get(phone);
            if (!challenge || challenge.expiresAt <= now()) {
                challenges.delete(phone);
                return { valid: false, error: 'OTP expired or not requested.' };
            }
            if (challenge.attempts >= maxAttempts) {
                challenges.delete(phone);
                return { valid: false, error: 'Too many invalid OTP attempts.' };
            }

            challenge.attempts += 1;
            const receivedHash = hashCode(phone, code);
            const valid = typeof code === 'string' && /^\d{6}$/.test(code) &&
                crypto.timingSafeEqual(challenge.codeHash, receivedHash);
            if (!valid) return { valid: false, error: 'Invalid OTP.' };

            challenges.delete(phone);
            return { valid: true };
        }
    };
}

module.exports = { createOtpService };