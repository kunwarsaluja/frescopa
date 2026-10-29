import { readBlockConfig } from '../../scripts/aem.js';

const DEFAULT_SOURCE = '/studio/journeys.json';
const ALL = '__all';
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
  const label = (key, vars = {}) => {
    const raw = data.labels?.[key] || key;
    return Object.entries(vars).reduce((str, [k, v]) => str.replace(`{${k}}`, v), raw);
  };
  const journeyCaps = (journey) => {
    const ids = new Set();
    journey.steps.forEach((step) => (step.capabilities || []).forEach((id) => ids.add(id)));
    return [...ids].map((id) => capById.get(id)).filter(Boolean);
  };
  const journeyProducts = (journey) => {
    const products = new Set();
    journeyCaps(journey).forEach((cap) => cap.products.forEach((p) => products.add(p)));
    return products;
  };
  return {
    data, capById, label, journeyCaps, journeyProducts,
  };
}

const statusBadge = (status) => el('span', { className: `journeys-status journeys-status-${slug(status)}`, text: status });
const productTag = (product) => el('span', { className: 'journeys-product', text: product });

/* ---------- Journeys (filters, cards, detail) ---------- */

function renderJourneys(block, ctx) {
  const {
    data, capById, label, journeyCaps, journeyProducts,
  } = ctx;
  const state = { filters: { group: ALL, product: ALL, industry: ALL }, activeId: null };
  const uid = `journeys-${Math.floor(Math.random() * 1e6)}`;

  const dimensions = [
    {
      key: 'group',
      label: label('groupFilter'),
      options: data.capabilityGroups.map((g) => ({ id: g.id, name: g.id, title: g.summary })),
      matches: (journey, value) => journeyCaps(journey).some((cap) => cap.group === value),
    },
    {
      key: 'product',
      label: label('productFilter'),
      options: data.products.map((p) => ({ id: p.id, name: p.id, title: p.name })),
      matches: (journey, value) => journeyProducts(journey).has(value),
    },
    {
      key: 'industry',
      label: label('industryFilter'),
      options: [...new Set(data.journeys.flatMap((j) => j.industryHints || []))].sort()
        .map((i) => ({ id: i, name: i })),
      matches: (journey, value) => (journey.industryHints || []).includes(value),
    },
  ];

  const matchesFilters = (journey) => dimensions
    .every((d) => state.filters[d.key] === ALL || d.matches(journey, state.filters[d.key]));

  const filters = el('div', { className: 'journeys-filters' });
  const count = el('p', { className: 'journeys-count', role: 'status', 'aria-live': 'polite' });
  const list = el('ul', { className: 'journeys-grid' });
  const detail = el('section', {
    className: 'journeys-detail', id: `${uid}-detail`, tabindex: '-1', hidden: true,
  });

  let renderList;
  let closeJourney;

  function renderFilters() {
    filters.replaceChildren();
    dimensions.forEach((dim) => {
      const labelId = `${uid}-${dim.key}`;
      const chips = el('div', { className: 'journeys-chips' });
      [{ id: ALL, name: label('allFilter') }, ...dim.options].forEach((option) => {
        const chip = el('button', {
          type: 'button',
          className: 'journeys-chip',
          'aria-pressed': String(state.filters[dim.key] === option.id),
          title: option.title || null,
          dataset: { value: option.id },
          text: option.name,
        });
        chip.addEventListener('click', () => {
          state.filters[dim.key] = option.id;
          chips.querySelectorAll('.journeys-chip').forEach((c) => {
            c.setAttribute('aria-pressed', String(c.dataset.value === option.id));
          });
          renderList();
        });
        chips.append(chip);
      });
      filters.append(el('div', { className: 'journeys-filter', role: 'group', 'aria-labelledby': labelId }, [
        el('span', { id: labelId, className: 'journeys-filter-label', text: dim.label }),
        chips,
      ]));
    });
  }

  renderList = () => {
    const visible = data.journeys.filter(matchesFilters);
    list.replaceChildren();
    visible.forEach((journey, index) => {
      const isActive = journey.id === state.activeId;
      const button = el('button', {
        type: 'button',
        className: 'journeys-card-button',
        'aria-expanded': String(isActive),
        'aria-controls': detail.id,
        dataset: { journey: journey.id },
      }, [
        el('span', { className: 'journeys-card-index', 'aria-hidden': 'true', text: String(index + 1).padStart(2, '0') }),
        el('span', { className: 'journeys-card-eyebrow', text: label('problem') }),
        el('q', { className: 'journeys-card-quote', text: journey.problem.quote }),
        el('span', { className: 'journeys-card-persona', text: journey.problem.persona }),
        el('span', { className: 'journeys-card-title' }, [
          el('span', { className: 'journeys-card-arrow', 'aria-hidden': 'true', text: '→' }),
          ` ${journey.title}`,
        ]),
        el('span', { className: 'journeys-card-meta' }, [
          el('span', { text: `${journey.steps.length} ${label('steps')}` }),
          el('span', { className: 'journeys-tags' }, [...journeyProducts(journey)].map(productTag)),
        ]),
      ]);
      button.addEventListener('click', () => {
        if (state.activeId === journey.id) closeJourney();
        else window.location.hash = journey.id;
      });
      list.append(el('li', { className: `journeys-card${isActive ? ' is-active' : ''}` }, button));
    });
    count.textContent = visible.length
      ? label('showing', { count: visible.length, total: data.journeys.length })
      : label('noResults');
  };

  function renderCapabilityChip(capId) {
    const cap = capById.get(capId);
    if (!cap) return null;
    return el('li', { className: 'journeys-cap-chip', title: cap.summary }, [
      el('span', { text: cap.name }),
      statusBadge(cap.status),
    ]);
  }

  function renderStep(step, index) {
    const products = new Set();
    (step.capabilities || []).forEach((id) => capById.get(id)?.products.forEach((p) => products.add(p)));
    return el('li', { className: 'journeys-step' }, [
      el('span', { className: 'journeys-step-n', 'aria-hidden': 'true', text: String(index + 1) }),
      el('div', { className: 'journeys-step-body' }, [
        el('div', { className: 'journeys-step-head' }, [
          el('h4', { className: 'journeys-step-title', text: step.title }),
          el('a', {
            className: 'journeys-step-open', href: step.page, target: '_blank', rel: 'noopener',
          }, [
            label('openPage'),
            el('span', { 'aria-hidden': 'true', text: ' ↗' }),
            el('span', { className: 'visually-hidden', text: ` ${label('newTab')}` }),
          ]),
        ]),
        el('code', { className: 'journeys-step-path', text: step.page }),
        el('p', { className: 'journeys-step-narrative', text: `“${step.narrative}”` }),
        el('div', { className: 'journeys-step-meta' }, [
          el('div', {}, [
            el('h5', { className: 'journeys-label', text: label('capabilities') }),
            el('ul', { className: 'journeys-cap-chips' }, (step.capabilities || []).map(renderCapabilityChip)),
          ]),
          step.recipes?.length ? el('div', {}, [
            el('h5', { className: 'journeys-label', text: label('recipes') }),
            el('ul', { className: 'journeys-recipes' }, step.recipes.map((r) => el('li', { text: r }))),
          ]) : null,
          products.size ? el('p', { className: 'journeys-step-products' }, [
            el('span', { className: 'journeys-label', text: label('supportedBy') }),
            ...[...products].map(productTag),
          ]) : null,
        ]),
      ]),
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
    const titleId = `${uid}-title-${journey.id}`;
    const copyButton = el('button', { type: 'button', className: 'journeys-ghost', text: label('copyLink') });
    copyButton.addEventListener('click', () => copyLink(copyButton, journey.id));
    const closeButton = el('button', { type: 'button', className: 'journeys-ghost', text: label('close') });
    closeButton.addEventListener('click', () => closeJourney());

    const problem = el('div', { className: 'journeys-problem' }, [
      el('p', { className: 'journeys-stage', text: `1 · ${label('problem')}` }),
      el('blockquote', { className: 'journeys-problem-quote' }, el('p', { text: `“${journey.problem.quote}”` })),
      el('p', { className: 'journeys-problem-persona', text: `— ${journey.problem.persona}` }),
      el('p', { className: 'journeys-problem-context', text: journey.problem.context }),
      journey.industryHints?.length ? el('p', { className: 'journeys-industries' }, [
        el('span', { className: 'journeys-label', text: label('industries') }),
        ...journey.industryHints.map((i) => el('span', { className: 'journeys-industry', text: i })),
      ]) : null,
    ]);

    const steps = el('div', { className: 'journeys-steps' }, [
      el('p', { className: 'journeys-stage', text: `2 · ${label('journey')}` }),
      el('ol', { className: 'journeys-step-list' }, journey.steps.map(renderStep)),
    ]);

    const outcome = el('div', { className: 'journeys-outcome' }, [
      el('p', { className: 'journeys-stage', text: `3 · ${label('outcome')}` }),
      el('p', { className: 'journeys-outcome-headline', text: journey.outcome.headline }),
      el('dl', { className: 'journeys-metrics' }, journey.outcome.metrics.map((m) => el('div', { className: 'journeys-metric' }, [
        el('dt', { text: m.label }),
        el('dd', { text: m.value }),
      ]))),
      el('p', { className: 'journeys-outcome-note', text: label('metricsNote') }),
    ]);

    detail.replaceChildren(
      el('div', { className: 'journeys-detail-head' }, [
        el('h3', { id: titleId, className: 'journeys-detail-title', text: journey.title }),
        el('div', { className: 'journeys-detail-actions' }, [copyButton, closeButton]),
      ]),
      el('div', { className: 'journeys-detail-layout' }, [problem, steps, outcome]),
    );
    detail.setAttribute('aria-labelledby', titleId);
    detail.hidden = false;
  }

  closeJourney = () => {
    const previous = state.activeId;
    state.activeId = null;
    detail.hidden = true;
    detail.replaceChildren();
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
    renderList();
    const card = previous && list.querySelector(`[data-journey="${CSS.escape(previous)}"]`);
    if (card) card.focus();
  };

  function syncFromHash({ scroll = true } = {}) {
    const id = decodeURIComponent(window.location.hash.slice(1));
    const journey = data.journeys.find((j) => j.id === id);
    if (!journey) {
      // Only an empty hash (e.g. browser Back) closes the panel; in-page anchors leave it open.
      if (!id && state.activeId) {
        state.activeId = null;
        detail.hidden = true;
        renderList();
      }
      return;
    }
    state.activeId = journey.id;
    if (!matchesFilters(journey)) {
      dimensions.forEach((d) => { state.filters[d.key] = ALL; });
      renderFilters();
    }
    renderList();
    renderDetail(journey);
    if (scroll) {
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      detail.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
      detail.focus({ preventScroll: true });
    }
  }

  renderFilters();
  renderList();
  block.replaceChildren(filters, count, list, detail);
  syncFromHash({ scroll: Boolean(window.location.hash) });
  window.addEventListener('hashchange', () => syncFromHash());
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && state.activeId) closeJourney();
  });
}

/* ---------- Capability map ---------- */

function renderMap(block, ctx) {
  const { data, label, journeyCaps } = ctx;
  const usage = new Map();
  data.journeys.forEach((journey) => {
    journeyCaps(journey).forEach((cap) => usage.set(cap.id, (usage.get(cap.id) || 0) + 1));
  });

  const legend = el('ul', { className: 'journeys-legend' }, data.statuses.map((s) => el('li', {}, [
    statusBadge(s.id),
    el('span', { className: 'journeys-legend-desc', text: s.description }),
  ])));

  const grid = el('div', { className: 'journeys-cap-grid' }, data.capabilityGroups.map((group) => {
    const headingId = `cap-group-${slug(group.id)}`;
    const caps = data.capabilities.filter((c) => c.group === group.id);
    return el('section', { className: 'journeys-cap-group', 'aria-labelledby': headingId }, [
      el('h3', { id: headingId, text: group.id }),
      el('p', { className: 'journeys-cap-group-summary', text: group.summary }),
      el('ul', { className: 'journeys-cap-list' }, caps.map((cap) => {
        const n = usage.get(cap.id) || 0;
        let usedText = label('notUsed');
        if (n === 1) usedText = label('usedInOne');
        else if (n > 1) usedText = label('usedIn', { count: n });
        return el('li', { className: 'journeys-cap', id: `cap-${cap.id}` }, [
          el('div', { className: 'journeys-cap-head' }, [
            el('h4', { text: cap.name }),
            statusBadge(cap.status),
          ]),
          el('p', { className: 'journeys-cap-summary', text: cap.summary }),
          el('div', { className: 'journeys-cap-foot' }, [
            el('span', { className: 'journeys-tags' }, cap.products.map(productTag)),
            el('span', { className: 'journeys-cap-usage', text: usedText }),
          ]),
        ]);
      })),
    ]);
  }));

  block.replaceChildren(legend, grid);
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
