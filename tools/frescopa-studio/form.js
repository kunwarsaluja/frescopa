/**
 * Renders a DA structured content form from the da-sc-sdk model.
 * The SDK owns state, validation and storage format; this file only draws inputs
 * and turns input events into engine calls. Field names, help text, options and
 * limits all come from the schema, so a schema change needs no code change here.
 * Model reference: https://github.com/adobe/da-sc-sdk/blob/main/docs/model-builder.md
 */

const idFor = (pointer) => `field${pointer.replaceAll('/', '-')}`;

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  Object.entries(attrs).forEach(([key, value]) => {
    if (value !== false && value !== null && value !== undefined) node.setAttribute(key, value);
  });
  node.append(...children.filter((c) => c !== null && c !== undefined && c !== false));
  return node;
}

const help = (node) => node.description && el('p', { class: 'field-help', id: `${idFor(node.pointer)}-help` }, node.description);
const errorSlot = (node) => el('p', { class: 'field-error', id: `${idFor(node.pointer)}-error`, 'data-error-for': node.pointer });

function control(node, engine) {
  const id = idFor(node.pointer);
  const describedBy = [node.description && `${id}-help`, `${id}-error`].filter(Boolean).join(' ');
  const common = {
    id, 'aria-describedby': describedBy, 'data-pointer': node.pointer, readonly: node.readonly || null,
  };
  const formatTypes = { date: 'date', 'date-time': 'datetime-local', time: 'time' };

  if (node.kind === 'boolean') {
    const input = el('input', { ...common, type: 'checkbox', disabled: node.readonly || null });
    input.checked = node.value === true;
    input.addEventListener('change', () => engine.setField(node.pointer, input.checked));
    return input;
  }

  let input;
  if (node.enumValues) {
    input = el('select', common,
      el('option', { value: '' }, ''),
      ...node.enumValues.map((v) => el('option', { value: v }, String(v))));
  } else if (node.semanticType === 'long-text') {
    input = el('textarea', { ...common, rows: 3, maxlength: node.validation?.maxLength });
  } else if (node.kind === 'number' || node.kind === 'integer') {
    input = el('input', {
      ...common,
      type: 'number',
      step: node.kind === 'integer' ? 1 : 'any',
      min: node.validation?.minimum,
      max: node.validation?.maximum,
    });
  } else {
    input = el('input', { ...common, type: formatTypes[node.format] ?? 'text', maxlength: node.validation?.maxLength });
  }
  input.value = node.value ?? '';
  input.addEventListener('input', () => {
    const { value } = input;
    const numeric = node.kind === 'number' || node.kind === 'integer';
    engine.setField(node.pointer, numeric && value !== '' ? Number(value) : value);
  });
  return input;
}

function field(node, engine) {
  const input = control(node, engine);
  input.dataset.label = node.label; // the plain label, for tools that decorate the field
  const labelText = el('span', { class: 'field-label' }, node.label, node.required && el('span', { class: 'field-required', 'aria-hidden': 'true' }, ' *'));
  if (node.kind === 'boolean') {
    return el('div', { class: 'field field-check' }, el('label', { for: input.id }, input, labelText), help(node), errorSlot(node));
  }
  return el('div', { class: 'field' }, el('label', { for: input.id }, labelText), help(node), input, errorSlot(node));
}

const children = (node, engine, rerender) => node.children.map((child) => render(child, engine, rerender));

function group(node, engine, rerender) {
  return el('fieldset', { class: 'group' },
    el('legend', {}, node.label),
    help(node),
    ...children(node, engine, rerender),
    errorSlot(node));
}

function list(node, engine, rerender) {
  const count = node.items.length;
  // after the form is redrawn, focus goes back where the author was working
  const change = (fn, focusAfter) => () => { fn(); rerender(focusAfter); };
  const items = node.items.map((item, index) => {
    const title = item.kind === 'object'
      ? (item.children.find((c) => c.kind === 'string' && !c.enumValues && c.value)?.value || `${node.itemLabel} ${index + 1}`)
      : `${node.itemLabel} ${index + 1}`;
    const tools = el('div', { class: 'item-tools' });
    const tool = (text, label, action, disabled, focusAfter) => {
      const button = el('button', {
        type: 'button', class: 'item-tool', 'aria-label': `${label}: ${title}`, disabled,
      }, text);
      button.addEventListener('click', change(action, focusAfter));
      tools.append(button);
    };
    const moved = (to) => `[data-item="${node.pointer}/${to}"] .item-tool:not(:disabled)`;
    tool('↑', 'Move up', () => engine.moveItem(node.pointer, index, index - 1), index === 0, moved(index - 1));
    tool('↓', 'Move down', () => engine.moveItem(node.pointer, index, index + 1), index === count - 1, moved(index + 1));
    tool('✕', 'Remove', () => engine.removeItem(item.pointer), false, `[data-add="${node.pointer}"]`);
    const body = item.kind === 'object' ? children(item, engine, rerender) : [field(item, engine)];
    return el('li', { class: 'item', 'data-item': item.pointer }, el('div', { class: 'item-head' }, el('span', { class: 'item-title' }, title), tools), ...body);
  });
  const full = node.maxItems !== undefined && count >= node.maxItems;
  const add = el('button', {
    type: 'button', class: 'item-add', disabled: full, 'data-add': node.pointer,
  }, `Add ${node.itemLabel.toLowerCase()}`);
  add.addEventListener('click', change(() => engine.addItem(node.pointer),
    `[data-item="${node.pointer}/${count}"] :is(input, select, textarea)`));
  return el('fieldset', { class: 'group' },
    el('legend', {}, node.label),
    help(node),
    el('ol', { class: 'items' }, ...items),
    add,
    errorSlot(node));
}

function render(node, engine, rerender) {
  if (node.kind === 'object') return group(node, engine, rerender);
  if (node.kind === 'array') return list(node, engine, rerender);
  if (node.kind === 'unsupported') return null;
  return field(node, engine);
}

/**
 * Draws the whole form; it redraws itself after list items are added, removed or moved.
 * @param {HTMLFormElement} form
 * @param {object} engine da-sc-sdk engine
 * @param {object} [options]
 * @param {(form: HTMLFormElement) => void} [options.decorate] runs after every draw,
 *   e.g. to add a picker button next to a field (inputs carry data-pointer)
 * @param {string} [options.focusAfter] selector to focus once drawn
 */
export function renderForm(form, engine, { decorate, focusAfter } = {}) {
  const rerender = (next) => renderForm(form, engine, { decorate, focusAfter: next });
  const { root } = engine.getState().model;
  form.replaceChildren(...children(root, engine, rerender));
  showErrors(form, engine);
  decorate?.(form);
  if (focusAfter) form.querySelector(focusAfter)?.focus();
}

/** Shows the engine's current validation messages next to their fields. */
export function showErrors(form, engine) {
  const { errors } = engine.getState().validation;
  form.querySelectorAll('[data-error-for]').forEach((slot) => {
    const message = errors[slot.dataset.errorFor]?.message ?? '';
    slot.textContent = message;
    const input = form.querySelector(`[data-pointer="${CSS.escape(slot.dataset.errorFor)}"]`);
    if (input) input.setAttribute('aria-invalid', message ? 'true' : 'false');
  });
  return Object.keys(errors).length;
}
