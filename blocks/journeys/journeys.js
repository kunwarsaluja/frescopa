import { readBlockConfig } from '../../scripts/aem.js';

const DEFAULT_SOURCE = '/studio/journeys.json';
const requests = new Map();

const splitList = (value) => String(value || '').split(',').map((v) => v.trim()).filter(Boolean);

/**
 * Rebuilds the nested journey model from the authored multi-sheet
 * (labels, statuses, products, groups, capabilities, journeys, steps, metrics).
 * Steps and metrics link to their journey through the `journey` column.
 * @param {Object} json multi-sheet response
 */
function fromSheets(json) {
  const rows = (name) => json[name]?.data || [];
  const byJourney = (name) => rows(name).reduce((map, row) => {
    if (!map.has(row.journey)) map.set(row.journey, []);
    map.get(row.journey).push(row);
    return map;
  }, new Map());
  const steps = byJourney('steps');
  const metrics = byJourney('metrics');
  return {
    labels: Object.fromEntries(rows('labels').map((r) => [r.key, r.value])),
    statuses: rows('statuses'),
    products: rows('products'),
    capabilityGroups: rows('groups'),
    capabilities: rows('capabilities').map((c) => ({ ...c, products: splitList(c.products) })),
    journeys: rows('journeys').filter((j) => j.id).map((j) => ({
      id: j.id,
      title: j.title,
      industryHints: splitList(j.industries),
      problem: { quote: j.quote, persona: j.persona, context: j.context },
      steps: (steps.get(j.id) || []).map((s) => ({
        title: s.title,
        narrative: s.narrative,
        page: s.page,
        capabilities: splitList(s.capabilities),
        recipes: splitList(s.recipes),
      })),
      outcome: {
        headline: j.outcome,
        metrics: (metrics.get(j.id) || []).map(({ value, label }) => ({ value, label })),
      },
      tags: splitList(j.tags),
    })),
  };
}

function loadData(source) {
  if (!requests.has(source)) {
    requests.set(source, fetch(source, { cache: 'no-cache' }).then((resp) => {
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      return resp.json();
    }).then((json) => (json[':type'] === 'multi-sheet' ? fromSheets(json) : json)));
  }
  return requests.get(source);
}

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  Object.entries(attrs).forEach(([key, value]) => {
    if (value === null || value === undefined || value === false) return;
    if (key === 'className') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else node.setAttribute(key, value === true ? '' : value);
  });
  [].concat(children).forEach((child) => {
    if (child === null || child === undefined || child === false) return;
    node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  });
  return node;
}

function slug(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

function createContext(data) {
  const capById = new Map(data.capabilities.map((cap) => [cap.id, cap]));
  const statusById = new Map(data.statuses.map((s) => [s.id, s]));
  const label = (key, vars = {}) => {
    const raw = data.labels?.[key] || key;
    return Object.entries(vars).reduce((str, [k, v]) => str.replace(`{${k}}`, v), raw);
  };
  const stepCaps = (step) => (step.capabilities || []).map((id) => capById.get(id)).filter(Boolean);
  const journeyCaps = (journey) => [...new Set(journey.steps.flatMap(stepCaps))];
  const journeyProducts = (journey) => [...new Set(journeyCaps(journey).flatMap((c) => c.products))];
  return {
    data, statusById, label, stepCaps, journeyCaps, journeyProducts,
  };
}

/* ---------- Journeys: list view and talk-track view ---------- */

function renderJourneys(block, ctx) {
  const {
    data, statusById, label, stepCaps, journeyProducts,
  } = ctx;
  const uid = `journeys-${Math.floor(Math.random() * 1e6)}`;
  let industry = '';

  const industries = [...new Set(data.journeys.flatMap((j) => j.industryHints || []))].sort();
  const select = el('select', { id: `${uid}-industry`, className: 'journeys-select' }, [
    el('option', { value: '', text: label('allFilter') }),
    ...industries.map((i) => el('option', { value: i, text: i })),
  ]);
  const toolbar = el('div', { className: 'journeys-toolbar' }, [
    el('label', { for: select.id, text: label('industryFilter') }),
    select,
  ]);
  const count = el('p', { className: 'journeys-count', role: 'status', 'aria-live': 'polite' });
  const list = el('ol', { className: 'journeys-list' });
  const listView = el('div', { className: 'journeys-list-view' }, [toolbar, count, list]);
  const detail = el('article', { className: 'journeys-detail', tabindex: '-1', hidden: true });

  function renderList() {
    const visible = data.journeys.filter((j) => !industry || (j.industryHints || []).includes(industry));
    list.replaceChildren(...visible.map((journey) => el('li', {}, el('a', {
      className: 'journeys-row', href: `#${journey.id}`,
    }, [
      el('span', { className: 'journeys-row-title', text: journey.title }),
      el('span', { className: 'journeys-row-quote', text: `“${journey.problem.quote}”` }),
      el('span', {
        className: 'journeys-row-meta',
        text: `${journey.problem.persona} · ${journey.steps.length} ${label('steps')}`,
      }),
    ]))));
    count.textContent = visible.length
      ? label('showing', { count: visible.length, total: data.journeys.length })
      : label('noResults');
  }

  function cautions(step) {
    return stepCaps(step)
      .filter((cap) => cap.status && cap.status !== 'Current')
      .map((cap) => el('p', { className: 'journeys-caution' }, [
        el('strong', { text: `${cap.name}: ${cap.status}.` }),
        ` ${statusById.get(cap.status)?.description || ''}`,
      ]));
  }

  function renderStep(step) {
    const caps = stepCaps(step);
    return el('li', { className: 'journeys-step' }, [
      el('div', { className: 'journeys-step-head' }, [
        el('h4', { text: step.title }),
        el('a', {
          className: 'button', href: step.page, target: '_blank', rel: 'noopener',
        }, [
          label('openPage'),
          el('span', { className: 'visually-hidden', text: ` ${label('newTab')}` }),
        ]),
      ]),
      el('p', { className: 'journeys-say' }, [
        el('span', { className: 'journeys-key', text: `${label('say')}: ` }),
        step.narrative,
      ]),
      caps.length ? el('p', { className: 'journeys-shows' }, [
        el('span', { className: 'journeys-key', text: `${label('capabilities')}: ` }),
        caps.map((c) => c.name).join(' · '),
      ]) : null,
      ...cautions(step),
    ]);
  }

  function copyLink(button, journeyId) {
    const url = `${window.location.origin}${window.location.pathname}#${journeyId}`;
    const done = () => {
      button.textContent = label('copied');
      setTimeout(() => { button.textContent = label('copyLink'); }, 2000);
    };
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(url).then(done).catch(() => window.prompt('', url));
    } else {
      window.prompt('', url);
    }
  }

  function renderDetail(journey) {
    const back = el('a', { className: 'journeys-back', href: '#journeys-list', text: `← ${label('back')}` });
    back.addEventListener('click', (event) => {
      event.preventDefault();
      window.history.pushState(null, '', window.location.pathname + window.location.search);
      sync();
    });
    const copy = el('button', { type: 'button', className: 'button secondary', text: label('copyLink') });
    copy.addEventListener('click', () => copyLink(copy, journey.id));
    const section = (heading, children) => el('section', { className: 'journeys-part' }, [
      el('h4', { className: 'journeys-part-title', text: heading }), ...children,
    ]);

    detail.replaceChildren(
      el('div', { className: 'journeys-detail-bar' }, [back, copy]),
      el('h3', { className: 'journeys-detail-title', text: journey.title }),
      el('p', { className: 'journeys-detail-meta' }, [
        journey.problem.persona,
        journey.industryHints?.length ? ` · ${label('industries')}: ${journey.industryHints.join(', ')}` : '',
      ]),
      section(`1. ${label('problem')}`, [
        el('blockquote', {}, el('p', { text: `“${journey.problem.quote}”` })),
        el('p', { text: journey.problem.context }),
      ]),
      section(`2. ${label('journey')} (${journey.steps.length} ${label('steps')})`, [
        el('ol', { className: 'journeys-steps' }, journey.steps.map(renderStep)),
      ]),
      section(`3. ${label('outcome')}`, [
        el('p', { className: 'journeys-outcome', text: journey.outcome.headline }),
        el('ul', { className: 'journeys-metrics' }, journey.outcome.metrics.map((m) => el('li', {}, [
          el('strong', { text: m.value }), ` ${m.label}`,
        ]))),
        el('p', { className: 'journeys-note', text: label('metricsNote') }),
      ]),
      el('p', { className: 'journeys-products' }, [
        el('span', { className: 'journeys-key', text: `${label('supportedBy')}: ` }),
        journeyProducts(journey).join(', '),
      ]),
    );
  }

  function sync({ scroll = true } = {}) {
    const id = decodeURIComponent(window.location.hash.slice(1));
    const journey = data.journeys.find((j) => j.id === id);
    if (journey) {
      renderDetail(journey);
      listView.hidden = true;
      detail.hidden = false;
      if (scroll) {
        block.scrollIntoView({ block: 'start' });
        detail.focus({ preventScroll: true });
      }
      return;
    }
    if (!id && !detail.hidden) {
      detail.hidden = true;
      listView.hidden = false;
      if (scroll) block.scrollIntoView({ block: 'start' });
    }
  }

  select.addEventListener('change', () => {
    industry = select.value;
    renderList();
  });

  renderList();
  block.replaceChildren(listView, detail);
  sync({ scroll: Boolean(window.location.hash) });
  window.addEventListener('hashchange', () => sync());
  window.addEventListener('popstate', () => sync());
}

/* ---------- Capability map: one plain table ---------- */

function renderMap(block, ctx) {
  const { data, label, journeyCaps } = ctx;
  const usage = new Map();
  data.journeys.forEach((j) => journeyCaps(j).forEach((c) => usage.set(c.id, (usage.get(c.id) || 0) + 1)));

  const legend = el('dl', { className: 'journeys-legend' }, data.statuses.flatMap((s) => [
    el('dt', { text: s.id }),
    el('dd', { text: s.description }),
  ]));

  const rows = data.capabilityGroups.flatMap((group) => [
    el('tr', { className: 'journeys-group-row' }, el('th', { colspan: '4', scope: 'colgroup' }, [
      group.id,
      el('span', { text: ` — ${group.summary}` }),
    ])),
    ...data.capabilities.filter((c) => c.group === group.id).map((cap) => el('tr', { id: `cap-${slug(cap.id)}` }, [
      el('th', { scope: 'row' }, [cap.name, el('span', { className: 'journeys-cap-summary', text: cap.summary })]),
      el('td', { className: `journeys-status${cap.status === 'Current' ? '' : ' is-caution'}`, text: cap.status }),
      el('td', { text: cap.products.join(', ') }),
      el('td', { text: String(usage.get(cap.id) || 0) }),
    ])),
  ]);

  const table = el('table', { className: 'journeys-table' }, [
    el('thead', {}, el('tr', {}, [
      el('th', { scope: 'col', text: label('capabilities') }),
      el('th', { scope: 'col', text: label('status') }),
      el('th', { scope: 'col', text: label('supportedBy') }),
      el('th', { scope: 'col', text: label('plays') }),
    ])),
    el('tbody', {}, rows),
  ]);

  block.replaceChildren(legend, el('div', { className: 'journeys-table-wrap' }, table));
}

/**
 * Studio journeys. Config rows: `source` (default /studio/journeys.json),
 * optional `error-message` shown if the data cannot be loaded.
 * Variant `map` renders the capability map instead of the journey explorer.
 * @param {Element} block
 */
export default async function decorate(block) {
  const config = readBlockConfig(block);
  const source = config.source || DEFAULT_SOURCE;
  block.replaceChildren(el('p', { className: 'journeys-count', role: 'status', 'aria-live': 'polite' }));

  let data;
  try {
    data = await loadData(source);
  } catch (error) {
    const status = block.querySelector('.journeys-count');
    status.textContent = config['error-message'] || `${source}: ${error.message}`;
    status.classList.add('is-error');
    return;
  }

  const ctx = createContext(data);
  if (block.classList.contains('map')) renderMap(block, ctx);
  else renderJourneys(block, ctx);
}
