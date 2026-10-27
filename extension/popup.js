const $ = selector => document.querySelector(selector);
async function message(payload) {
  const result = await chrome.runtime.sendMessage(payload);
  if (!result?.ok) throw new Error(result?.error || 'Could not connect. Try opening Frame again.');
  return result;
}
function fail(error) { $('#error').textContent = error.message; $('#error').hidden = false; }
async function refresh() {
  $('#error').hidden = true;
  try {
    const status = await message({ type: 'STATUS' });
    $('#status').textContent = status.paired
      ? !status.enabled ? 'Sharing is off in Frame. Your presence is hidden.' : status.discord ? 'Paired with Frame · Discord connected' : 'Paired with Frame · Open Discord desktop'
      : 'Frame is open. Let’s link your Chrome.';
    $('#pair-form').hidden = status.paired;
    $('#ready').hidden = !status.paired;
    $('#retry').hidden = true;
  } catch (error) {
    $('#status').textContent = 'Waiting for the Frame app on your Mac.';
    $('#pair-form').hidden = true; $('#ready').hidden = true; $('#retry').hidden = false;
    fail(error);
  }
}
$('#pair-form').addEventListener('submit', async event => {
  event.preventDefault(); $('#pair-button').disabled = true; $('#error').hidden = true;
  try { await message({ type: 'PAIR', code: $('#code').value }); await refresh(); }
  catch (error) { fail(error); }
  finally { $('#pair-button').disabled = false; }
});
$('#re-pair').addEventListener('click', () => { $('#pair-form').hidden = false; $('#ready').hidden = true; $('#code').focus(); });
$('#retry').addEventListener('click', refresh);
refresh();
