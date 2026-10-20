/**
 * SMS provider interface: { name, send(to, body) -> Promise<{ id? }> }.
 * Select with SMS_PROVIDER = console | twilio | none.
 */
const config = require('../../config');

class ConsoleSmsProvider {
  constructor() {
    this.name = 'console';
  }
  async send(to, body) {
    if (!config.isTest) console.log(`[sms:console] -> ${to}: ${body}`);
    return { id: `console-${Date.now()}` };
  }
}

class TwilioSmsProvider {
  constructor({ accountSid, authToken, from }) {
    if (!accountSid || !authToken || !from) throw new Error('Twilio SMS provider needs TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM');
    this.name = 'twilio';
    this.accountSid = accountSid;
    this.authToken = authToken;
    this.from = from;
  }
  async send(to, body) {
    const url = `https://api.twilio.com/2010-04-01/Accounts/${this.accountSid}/Messages.json`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${this.accountSid}:${this.authToken}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ To: to, From: this.from, Body: body }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`Twilio ${res.status}: ${json.message || 'send failed'}`);
    return { id: json.sid };
  }
}

class NoopSmsProvider {
  constructor() {
    this.name = 'none';
  }
  async send() {
    return { id: null, skipped: true };
  }
}

let provider;
function getSmsProvider() {
  if (provider) return provider;
  switch (config.sms.provider) {
    case 'twilio':
      provider = new TwilioSmsProvider({ accountSid: config.sms.twilioSid, authToken: config.sms.twilioToken, from: config.sms.twilioFrom });
      break;
    case 'none':
      provider = new NoopSmsProvider();
      break;
    default:
      provider = new ConsoleSmsProvider();
  }
  return provider;
}

module.exports = { getSmsProvider, ConsoleSmsProvider, TwilioSmsProvider, NoopSmsProvider };
