function createTwilioSender({
    accountSid = process.env.TWILIO_ACCOUNT_SID,
    authToken = process.env.TWILIO_AUTH_TOKEN,
    fromNumber = process.env.TWILIO_FROM_NUMBER,
    messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID,
    fetchImpl = fetch
} = {}) {
    return async ({ phone, code }) => {
        if (!accountSid || !authToken || (!fromNumber && !messagingServiceSid)) {
            throw new Error('Twilio SMS is not configured. Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_FROM_NUMBER or TWILIO_MESSAGING_SERVICE_SID.');
        }

        const form = new URLSearchParams({
            To: phone,
            Body: `Your VENTARCH verification code is ${code}. It expires in 5 minutes.`
        });
        if (messagingServiceSid) form.set('MessagingServiceSid', messagingServiceSid);
        else form.set('From', fromNumber);

        const response = await fetchImpl(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages.json`, {
            method: 'POST',
            headers: {
                Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`,
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: form
        });
        if (!response.ok) throw new Error('Twilio rejected the SMS request. Check the Twilio configuration and phone number.');
    };
}

module.exports = { createTwilioSender };