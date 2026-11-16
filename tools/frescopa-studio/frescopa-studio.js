/**
 * Frescopa Studio: edit the Frescopa app's experience in DA and see it on a phone as you type.
 *
 * The app document is DA structured content (schema "frescopa-app"). Studio edits it with
 * the same SDK as DA's own form editor, so both editors open the same document:
 * https://www.aem.live/docs/ew/administering/structured-content
 *
 * Changes save to DA as you type. Preview publishes them to the app's preview mode,
 * Publish to the live app.
 */
import DA_SDK from 'https://da.live/nx/utils/sdk.js';
import { createEngine, convertHtmlToJson, convertJsonToHtml } from 'https://da.live/nx/deps/da-sc-sdk/dist/index.js';
import { renderForm, showErrors } from './form.js';

const DA_ADMIN = 'https://admin.da.live';
const AEM_ADMIN = 'https://admin.hlx.page';
const SCHEMA = 'frescopa-app';
const DOCUMENT = '/en/us/app/experience';
// Fields that hold a fragment path get a Choose button that opens the fragment picker
// plugin from AEM Apps (https://github.com/adobe-rnd/aem-apps/tree/main/tools/plugins/fragments).
const FRAGMENT_FIELDS = ['/data/announcement', '/data/featured'];
const FRAGMENT_PICKER = new URL('https://main--aem-apps--adobe-rnd.aem.live/tools/plugins/fragments/fragments.html');
const APP = window.location.hostname === 'localhost'
  ? 'http://localhost:4321/app/'
  : 'https://kunwarsaluja.github.io/frescopa-app/app/';

const TEXT = {
  loading: 'Loading…',
  saving: 'Saving…',
  saveFailed: 'Couldn’t save. Your changes are kept here; edit any field to try again.',
  previewing: 'Previewing…',
  publishing: 'Publishing…',
  failed: (action, status) => `${action} failed (${status}).`,
  fixFirst: (n) => `Fix ${n} ${n === 1 ? 'field' : 'fields'} before you preview or publish.`,
  published: (time) => `Published ${time}`,
  previewed: (time) => `Previewed ${time}, not published yet`,
  notPreviewed: 'Saved, not previewed yet',
  loadFailed: (status) => `Couldn’t load the app document (${status}).`,
  schemaFailed: (status) => `Couldn’t read the "${SCHEMA}" schema (${status}).`,
  noSchema: `The "${SCHEMA}" schema isn’t in DA yet. Add it with the Schema Editor app.`,
  phoneNote: 'Your changes show here as you type. Preview and Publish update the app for everyone else.',
  choose: 'Choose',
  chooseFragment: (label) => `Choose a fragment: ${label}`,
  closePicker: 'Close',
};

const { context, token } = await DA_SDK;
const { org, repo: site } = context;
const auth = { Authorization: `Bearer ${token}` };

const statusText = document.getElementById('status');
const form = document.getElementById('form');
const phone = document.getElementById('phone');
const previewButton = document.getElementById('preview');
const publishButton = document.getElementById('publish');
const setStatus = (text) => { statusText.textContent = text; };

const when = (date) => new Date(date).toLocaleString([], {
  month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
});

/** The schema, or null when it isn't in DA yet. */
async function loadSchema() {
  const resp = await fetch(`${DA_ADMIN}/source/${org}/${site}/.da/forms/schemas/${SCHEMA}.html`, { headers: auth });
  if (resp.status === 404) return null;
  if (!resp.ok) throw new Error(TEXT.schemaFailed(resp.status));
  // DA stores a schema as JSON inside <pre><code> (see DA's Schema Editor)
  const code = new DOMParser().parseFromString(await resp.text(), 'text/html').querySelector('code');
  if (!code) throw new Error(TEXT.schemaFailed(resp.status));
  return JSON.parse(code.textContent);
}

/** The saved document, or a new one when it doesn't exist yet. */
async function loadDocument() {
  const resp = await fetch(`${DA_ADMIN}/source/${org}/${site}${DOCUMENT}.html`, { headers: auth });
  if (resp.status === 404) {
    return { metadata: { title: DOCUMENT.split('/').pop(), schemaName: SCHEMA }, data: {} };
  }
  if (!resp.ok) throw new Error(TEXT.loadFailed(resp.status));
  const { json, error } = convertHtmlToJson({ html: await resp.text() });
  if (error) throw new Error(error);
  return json;
}

function saveDocument(engine) {
  const { document: json, model } = engine.getState();
  const { html } = convertJsonToHtml({ json, model });
  const body = new FormData();
  body.append('data', new Blob([html], { type: 'text/html' }));
  return fetch(`${DA_ADMIN}/source/${org}/${site}${DOCUMENT}.html`, { method: 'POST', headers: auth, body });
}

/**
 * Opens the fragment picker plugin in a dialog and hosts it the way DA's library does:
 * it gets the DA context and token over a MessagePort, and sends back the link to
 * insert (sendHTML), then closeLibrary. Resolves with the fragment's path, or null.
 */
function chooseFragment(title) {
  return new Promise((resolve) => {
    const frame = document.createElement('iframe');
    // no allow-top-navigation: the picker can't move the DA tab elsewhere
    frame.sandbox = 'allow-scripts allow-same-origin allow-popups allow-forms';
    frame.referrerPolicy = 'no-referrer';
    frame.src = FRAGMENT_PICKER.href;
    frame.title = title;
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'studio-button';
    close.textContent = TEXT.closePicker;
    const dialog = document.createElement('dialog');
    dialog.className = 'picker';
    dialog.setAttribute('aria-label', title);
    dialog.append(close, frame);

    let path = null;
    const finish = () => {
      dialog.close();
      dialog.remove();
      resolve(path);
    };
    close.addEventListener('click', finish);
    dialog.addEventListener('cancel', finish); // Escape, while focus is outside the picker

    frame.addEventListener('load', () => {
      const channel = new MessageChannel();
      channel.port1.onmessage = ({ data }) => {
        if (data?.action === 'sendHTML') path = fragmentPath(data.details);
        if (data?.action === 'closeLibrary') finish();
      };
      frame.contentWindow.postMessage({
        ready: true, context: { org, repo: site, path: DOCUMENT }, token,
      }, FRAGMENT_PICKER.origin, [channel.port2]);
    }, { once: true });

    document.body.append(dialog);
    dialog.showModal();
  });
}

/** The path of the fragment link the picker sends, if it's a page on this site. */
function fragmentPath(html) {
  const href = new DOMParser().parseFromString(String(html), 'text/html').querySelector('a[href]')?.getAttribute('href');
  try {
    const url = new URL(href);
    const host = `https://main--${site}--${org}.aem.page`;
    return url.origin === host && /^\/[^/]/.test(url.pathname) ? url.pathname : null;
  } catch {
    return null;
  }
}

/** Adds a Choose button next to each fragment field. */
function addPickers(engine) {
  return (form) => FRAGMENT_FIELDS.forEach((pointer) => {
    const input = form.querySelector(`[data-pointer="${pointer}"]`);
    if (!input) return;
    const { label } = input.dataset;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'studio-button';
    button.textContent = TEXT.choose;
    button.setAttribute('aria-label', `${TEXT.choose}: ${label}`);
    button.addEventListener('click', async () => {
      const path = await chooseFragment(TEXT.chooseFragment(label));
      if (!path) return;
      input.value = path;
      engine.setField(pointer, path);
      input.focus();
    });
    const row = document.createElement('div');
    row.className = 'field-row';
    input.replaceWith(row);
    row.append(input, button);
  });
}

/** Preview, publish or status for the document, through the AEM admin API. */
function admin(route, method = 'POST') {
  return fetch(`${AEM_ADMIN}/${route}/${org}/${site}/main${DOCUMENT}`, {
    method,
    headers: { ...auth, 'x-content-source-authorization': `Bearer ${token}` },
  });
}

const time = (date) => (date ? new Date(date).getTime() : 0);

/** When the document was last saved in DA, from DA's list of its folder. */
async function lastEdited() {
  const folder = DOCUMENT.slice(0, DOCUMENT.lastIndexOf('/'));
  const name = DOCUMENT.slice(folder.length + 1);
  const resp = await fetch(`${DA_ADMIN}/list/${org}/${site}${folder}`, { headers: auth });
  if (!resp.ok) return 0;
  const item = (await resp.json()).find((i) => i.name === name && i.ext === 'html');
  return item?.lastModified ?? 0;
}

/** Where the saved document stands: not previewed, previewed, or published. */
async function showPublishState() {
  const [resp, edited] = await Promise.all([admin('status', 'GET'), lastEdited()]);
  if (!resp.ok) return;
  const { preview, live } = await resp.json();
  const [previewed, published] = [preview, live].map((s) => time(s?.lastModified));
  if (!previewed || edited > previewed) setStatus(TEXT.notPreviewed);
  else if (!published || previewed > published) setStatus(TEXT.previewed(when(preview.lastModified)));
  else setStatus(TEXT.published(when(live.lastModified)));
}

/**
 * Saves after each change, one request at a time: changes made during a save
 * are saved right after it, so a slow request never overwrites newer content.
 */
function autosave(engine, saved) {
  let saving = null;
  let again = false;
  const run = async () => {
    setStatus(TEXT.saving);
    let ok = false;
    try {
      do {
        again = false;
        ok = (await saveDocument(engine)).ok;
      } while (again && ok);
    } catch {
      ok = false; // offline or blocked: the next change tries again
    } finally {
      saving = null;
    }
    if (ok) await saved();
    else setStatus(TEXT.saveFailed);
    return ok;
  };
  return {
    changed() {
      if (saving) again = true;
      else saving = run();
    },
    /** Resolves once everything is saved: true if it saved. */
    done: () => saving ?? Promise.resolve(true),
  };
}

/** Sends the draft to the app in the phone frame; it redraws without reloading. */
function connectPhone(engine) {
  const appOrigin = new URL(APP).origin;
  const send = () => phone.contentWindow.postMessage({
    type: 'frescopa-experience',
    experience: engine.getState().document.data,
  }, appOrigin);
  window.addEventListener('message', (event) => {
    if (event.source === phone.contentWindow && event.data?.type === 'frescopa-app-ready') send();
  });
  phone.src = `${APP}?preview`;
  document.getElementById('phone-note').textContent = TEXT.phoneNote;
  let timer;
  return () => {
    clearTimeout(timer);
    timer = setTimeout(send, 250);
  };
}

async function init() {
  setStatus(TEXT.loading);
  document.getElementById('open-in-da').href = `https://da.live/form#/${org}/${site}${DOCUMENT}`;

  const [schema, json] = await Promise.all([loadSchema(), loadDocument()]);
  if (!schema) {
    setStatus(TEXT.noSchema);
    return;
  }

  let save;
  let updatePhone;
  let lastDocument;
  let engine;
  const errorCount = () => Object.keys(engine.getState().validation.errors).length;
  /** Preview and Publish need a valid document; the status says what to fix. */
  const checkErrors = () => {
    const errors = errorCount();
    previewButton.disabled = errors > 0;
    publishButton.disabled = errors > 0;
    if (errors) setStatus(TEXT.fixFirst(errors));
    return errors;
  };

  engine = createEngine({
    schema,
    document: json,
    onChange: () => {
      const { document: next } = engine.getState();
      if (next === lastDocument) return;
      lastDocument = next;
      showErrors(form, engine);
      checkErrors();
      save.changed();
      updatePhone();
    },
  });
  lastDocument = engine.getState().document;
  // When the document was last saved in DA, by Studio or anyone else
  let known = await lastEdited();
  save = autosave(engine, async () => {
    known = await lastEdited();
    if (!checkErrors()) setStatus(TEXT.notPreviewed);
  });
  // Someone changed the document in DA (e.g. DA's form editor) while Studio was in the
  // background: reload it rather than overwrite their changes with the next save.
  window.addEventListener('focus', async () => {
    if (!await save.done()) return;
    if (await lastEdited() > known) window.location.reload();
  });
  updatePhone = connectPhone(engine);
  renderForm(form, engine, { decorate: addPickers(engine) });
  if (!checkErrors()) await showPublishState();

  // Publishing goes through preview first, as in DA.
  const publish = async (steps) => {
    previewButton.disabled = true;
    publishButton.disabled = true;
    try {
      if (!await save.done()) return;
      for (const [route, busy, name] of steps) {
        setStatus(busy);
        const resp = await admin(route);
        if (!resp.ok) {
          setStatus(TEXT.failed(name, resp.status));
          return;
        }
      }
      await showPublishState();
    } finally {
      checkErrors();
    }
  };
  previewButton.addEventListener('click', () => publish([['preview', TEXT.previewing, 'Preview']]));
  publishButton.addEventListener('click', () => publish([
    ['preview', TEXT.previewing, 'Preview'],
    ['live', TEXT.publishing, 'Publish'],
  ]));
}

init().catch((error) => setStatus(error.message));
