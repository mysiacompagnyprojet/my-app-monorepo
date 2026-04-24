'use strict';

function ocrStage(label, data) {
  if (process.env.OCR_DEBUG !== '1') return;

  console.log(`\n========== OCR_STAGE: ${label} ==========`);
  console.dir(data, {
    depth: 6,
    maxArrayLength: 80,
  });
}

module.exports = { ocrStage };