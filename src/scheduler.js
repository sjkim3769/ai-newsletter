const cron = require('node-cron');
const config = require('../config.json');
const generator = require('./generator');

function start() {
  const { cron: cronExpr, timezone } = config.scheduler;
  console.log(`[스케줄러] 뉴스레터 발행 예약: "${cronExpr}" (${timezone})`);

  cron.schedule(cronExpr, async () => {
    console.log(`[스케줄러] 자동 발행 시작: ${new Date().toLocaleString('ko-KR')}`);
    try {
      await generator.generate();
    } catch (err) {
      console.error('[스케줄러] 발행 실패:', err.message);
    }
  }, { timezone });
}

module.exports = { start };
