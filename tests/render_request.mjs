// Explicit opt-in live render verification. Never spend subscription turns in a blanket test sweep.
// node tests/render_request.mjs --generate creates THREE isolated, exact-camera Real jobs.
if (!process.argv.includes('--generate')) {
  console.log('SKIP live image generation: use --generate intentionally, or run tests/real_capture.mjs for a free regression.');
} else {
  await import('./real_evidence.mjs');
}
