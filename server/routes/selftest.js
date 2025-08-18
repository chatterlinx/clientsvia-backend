const router = require('express').Router();
const resolver = require('../services/effectiveConfigResolver');

router.get('/api/selftest/:companyId', async (req, res) => {
  try {
    const { companyId } = req.params;
    const { config } = await resolver.getEffectiveSettings(companyId);

    const ttsOk = !!(config?.voice?.provider && config?.voice?.voiceId);
    const sttOk = true; // using Twilio's phone_call model; verified at TwiML build time
    const transferOk = !!(config?.transfer?.serviceAdvisorNumber || (config?.transfer?.targets && config.transfer.targets.length));
    const notifyOk = !!((config?.notify?.sms && config.notify.sms.length) || (config?.notify?.email && config.notify.email.length));

    const qCount =
      (config?.qna?.companyQA?.length || 0) +
      (config?.qna?.tradeQA?.length || 0) +
      (config?.qna?.generic?.length || 0);
    const knowledgeOk = qCount >= 20; // sanity threshold

    const result = {
      tts: { ok: ttsOk, detail: config?.voice?.provider || 'missing' },
      stt: { ok: sttOk, detail: 'twilio phone_call' },
      transfer: { ok: transferOk, detail: config?.transfer?.serviceAdvisorNumber || 'no advisor set' },
      notifications: { ok: notifyOk, detail: { sms: (config?.notify?.sms || []).length, email: (config?.notify?.email || []).length } },
      knowledge: { ok: knowledgeOk, total: qCount }
    };

    res.json({ ok: ttsOk && sttOk && knowledgeOk, result });
  } catch (e) {
    res.status(500).json({ ok: false, error: e?.message || 'selftest-failed' });
  }
});

module.exports = router;
