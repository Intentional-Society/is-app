This is reference code brought over from the is-appsscript repo,
to assist in our own buttondown api client development.
(This is intentionally not-a-code-comment, to bar any non-reading usage.)

/**
 * Buttondown API helpers
 * All HTTP calls to the Buttondown API live here.
 */

var BUTTONDOWN_API = 'https://api.buttondown.com/v1';
var BUTTONDOWN_SUBSCRIBERS_API = BUTTONDOWN_API + '/subscribers';
var BUTTONDOWN_TAGS_API = BUTTONDOWN_API + '/tags';

/**
 * Build auth headers for Buttondown API
 */
function buttondownHeaders_() {
  return {'Authorization': 'Token ' + CONFIG.BUTTONDOWN_API_KEY};
}

/**
 * Send a JSON request to Buttondown and handle errors
 * @param {string} url
 * @param {string} method - 'POST' or 'PATCH'
 * @param {Object} body
 * @param {string} action - label for the result ('created' or 'updated')
 * @param {Array} tags - tags to echo back on success
 * @returns {Object} {action, tags} or {error}
 */
function buttondownSend_(url, method, body, action, tags) {
  var resp = UrlFetchApp.fetch(url, {
    method: method,
    headers: Object.assign(buttondownHeaders_(), {'Content-Type': 'application/json'}),
    payload: JSON.stringify(body),
    muteHttpExceptions: true
  });

  var text = resp.getContentText();
  if (resp.getResponseCode() >= 400) {
    var err;
    try { err = JSON.parse(text); } catch (e) { err = {detail: text}; }
    return {error: err.detail || JSON.stringify(err)};
  }
  var data = null;
  try { data = JSON.parse(text); } catch (e) {}
  return {action: action, tags: tags, response: data};
}

/**
 * Test API connection by listing subscribers
 * @returns {Object} {ok: boolean, body: string}
 */
function buttondownTestConnection() {
  var resp = UrlFetchApp.fetch(BUTTONDOWN_SUBSCRIBERS_API, {
    headers: buttondownHeaders_(),
    muteHttpExceptions: true
  });
  return {ok: resp.getResponseCode() === 200, body: resp.getContentText()};
}

/**
 * Find an existing subscriber by email
 * @param {string} email
 * @returns {Object|null} subscriber object, or null if not found
 */
function buttondownFind(email) {
  var resp = UrlFetchApp.fetch(
    BUTTONDOWN_SUBSCRIBERS_API + '?email_address=' + encodeURIComponent(email),
    {headers: buttondownHeaders_(), muteHttpExceptions: true}
  );
  var data = JSON.parse(resp.getContentText());
  var results = data.results || [];
  if (results.length > 1) {
    throw new Error('buttondownFind: expected 0 or 1 results for ' + email + ', got ' + results.length);
  }
  return results.length === 1 ? results[0] : null;
}

/**
 * Create a new subscriber
 * @param {Object} payload - {email, tags, metadata}
 * @returns {Object} {action: 'created', tags} or {error}
 */
function buttondownCreate(payload) {
  return buttondownSend_(BUTTONDOWN_SUBSCRIBERS_API, 'POST', payload, 'created', payload.tags);
}

/**
 * Update an existing subscriber (PATCH replaces all tags)
 * @param {string} id - Buttondown subscriber ID
 * @param {Object} payload - {tags, metadata}
 * @returns {Object} {action: 'updated', tags} or {error}
 */
/**
 * List all tags in Buttondown
 * @returns {Array} array of tag objects, or empty array on error
 */
function buttondownListTags() {
  var resp = UrlFetchApp.fetch(BUTTONDOWN_TAGS_API, {
    headers: buttondownHeaders_(),
    muteHttpExceptions: true
  });
  if (resp.getResponseCode() >= 400) {
    throw new Error('buttondownListTags failed (' + resp.getResponseCode() + '): ' + resp.getContentText());
  }
  var data = JSON.parse(resp.getContentText());
  return data.results || [];
}

/**
 * Create a new tag in Buttondown
 * @param {string} name - tag name
 * @returns {Object} {action: 'tag_created', name} or {error}
 */
function buttondownCreateTag(name) {
  var resp = UrlFetchApp.fetch(BUTTONDOWN_TAGS_API, {
    method: 'POST',
    headers: Object.assign(buttondownHeaders_(), {'Content-Type': 'application/json'}),
    payload: JSON.stringify({name: name, color: '#E8F0EC'}),
    muteHttpExceptions: true
  });

  if (resp.getResponseCode() >= 400) {
    return {error: resp.getContentText()};
  }
  return {action: 'tag_created', name: name};
}

/**
 * Find all subscribers that have a given tag.
 * Handles pagination automatically.
 * @param {string} tagName - exact tag name (e.g. 'Sunday Community Calls')
 * @returns {Array} array of subscriber objects
 */
function buttondownFindByTag(tagName) {
  // Resolve tag name to UUID
  var tags = buttondownListTags();
  var match = tags.filter(function(t) { return t.name === tagName; });
  if (match.length === 0) {
    throw new Error('buttondownFindByTag: no tag found with name "' + tagName + '"');
  }
  var tagId = match[0].id;

  var allResults = [];
  var url = BUTTONDOWN_SUBSCRIBERS_API + '?tag=' + tagId;

  while (url) {
    var resp = UrlFetchApp.fetch(url, {
      headers: buttondownHeaders_(),
      muteHttpExceptions: true
    });
    if (resp.getResponseCode() >= 400) {
      throw new Error('buttondownFindByTag failed (' + resp.getResponseCode() + '): ' + resp.getContentText());
    }
    var data = JSON.parse(resp.getContentText());
    allResults = allResults.concat(data.results || []);
    url = data.next || null;
  }

  return allResults;
}

function buttondownUpdate(id, payload) {
  return buttondownSend_(BUTTONDOWN_SUBSCRIBERS_API + '/' + id, 'PATCH',
    {tags: payload.tags, metadata: payload.metadata}, 'updated', payload.tags);
}