import {createElement, Fragment} from 'react';
import {createRoot} from 'react-dom/client';
import {TrajectoryToolbar} from './TrajectoryToolbar.js';
import {TrajectoryTimeline} from './TrajectoryTimeline.js';
import {trajectoryTimelineFocusIndexes} from './timeline.js';
import {trajectoryRecordId} from './trajectory-record.js';
import {zh} from './locales.js';

const t = (key, args = {}) => (zh[key] || key).replace(/\{(\w+)\}/g, (_, name) => String(args[name] ?? ''));

// The published DSH components own the toolbar, timing projection and gestures.
// This adapter supplies Blueprint's records and updates its existing ledger.
export function mountTrace({host, onChange, onRecordSelect, onRecordFocus}) {
  const root = createRoot(host);
  let session, turns = [], cells = [], actualDuration = true, query = '', range = null, selectedIndex = null;
  let collapsedTurns = new Set(), collapsedAssistants = new Set(), searchSources = null, state;
  let collapsibleTurns = [], callsByAssistant = new Map();
  const mode = () => actualDuration ? 'duration' : 'sequence';

  function indexLayout() {
    cells = turns.flatMap(turn => turn.groups.flatMap(group => group.cells.filter(cell => !cell.requestOnly)));
    collapsibleTurns = turns.filter(turn => turn.turn !== null
      && turn.groups.flatMap(group => group.cells).filter(cell => !cell.requestOnly && cell.kind !== 'system').length > 1)
      .map(turn => turn.turn);
    callsByAssistant = new Map();
    for (let i = 0; i < cells.length; i++) {
      if (cells[i].kind !== 'message') continue;
      const calls = [];
      for (let j = i + 1; j < cells.length && ['tool', 'subtool'].includes(cells[j].kind); j++) calls.push(cells[j]);
      if (calls.length) callsByAssistant.set(trajectoryRecordId(cells[i]), calls);
    }
    searchSources = null;
  }

  function searchIndexes() {
    const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) return null;
    // Search the retained full payload/result/reasoning, not the truncated row.
    if (!searchSources) {
      searchSources = new Map();
      for (const turn of turns) for (const group of turn.groups) for (const cell of group.cells) {
        if (cell.requestOnly) continue;
        searchSources.set(cell.index, [turn.turn === null ? 'between turns' : `turn ${turn.turn}`,
          group.title, cell.kind, cell.kind === 'message' ? 'assistant' : '',
          JSON.stringify(cell)].join('\n').toLocaleLowerCase());
      }
    }
    return new Set([...searchSources].filter(([, source]) => terms.every(term => source.includes(term))).map(([index]) => index));
  }

  function publish() {
    const searchMatchIndexes = searchIndexes();
    const focusIndexes = range === null ? null : trajectoryTimelineFocusIndexes(turns, range, mode());
    // DSH keeps the ledger intact: a time range dims outside records, while
    // text search independently filters records.
    const matches = searchMatchIndexes;
    const hiddenCalls = new Set();
    for (const id of collapsedAssistants) for (const cell of callsByAssistant.get(id) || []) hiddenCalls.add(cell.index);
    state = {query, range, matches, focusIndexes, selectedIndex, collapsedTurns, collapsedAssistants, hiddenCalls, callsByAssistant};
    const allTurnsCollapsed = collapsibleTurns.length > 0 && collapsibleTurns.every(turn => collapsedTurns.has(turn));
    const allAssistantsCollapsed = callsByAssistant.size > 0 && [...callsByAssistant.keys()].every(id => collapsedAssistants.has(id));
    root.render(createElement(Fragment, {key: session},
      createElement(TrajectoryToolbar, {t, actualDuration, actualTime: false,
        onActualDurationChange(value) { actualDuration = value; range = null; publish(); },
        onActualTimeChange() {}, allTurnsCollapsed, allAssistantsCollapsed,
        onToggleAllTurns() {
          collapsedTurns = allTurnsCollapsed ? new Set() : new Set(collapsibleTurns); publish();
        },
        onToggleAllAssistants() {
          collapsedAssistants = allAssistantsCollapsed ? new Set() : new Set(callsByAssistant.keys()); publish();
        },
        searchQuery: query, onSearchQueryChange(value) {
          query = value;
          if (query.trim()) { collapsedTurns = new Set(); collapsedAssistants = new Set(); }
          publish();
        },
      }),
      createElement(TrajectoryTimeline, {t, turns, mode: mode(), range, selectedIndex, searchMatchIndexes,
        onRangeChange(value) {
          range = value;
          if (range) { collapsedTurns = new Set(); collapsedAssistants = new Set(); }
          publish();
        },
        onRecordSelect(index) { reveal(index); onRecordSelect?.(index); },
        onRecordFocus(index) { reveal(index, true); onRecordFocus?.(index); },
      }),
    ));
    onChange?.(state);
  }

  function reveal(index, keepRange = false) {
    selectedIndex = index;
    if (state?.matches && !state.matches.has(index)) query = '';
    if (!keepRange) range = null;
    const owner = turns.find(turn => turn.groups.some(group => group.cells.some(cell => cell.index === index)));
    if (owner) collapsedTurns.delete(owner.turn);
    for (const [id, calls] of callsByAssistant) if (calls.some(cell => cell.index === index)) collapsedAssistants.delete(id);
    publish();
  }

  return {
    update(next) {
      if (session !== next.session) {
        session = next.session; query = ''; range = null; selectedIndex = null;
        collapsedTurns = new Set(); collapsedAssistants = new Set();
      }
      turns = next.turns || []; indexLayout(); publish();
    },
    select(index) { selectedIndex = index; range = null; publish(); },
    reveal,
    toggleTurn(turn) {
      if (collapsedTurns.has(turn)) collapsedTurns.delete(turn); else collapsedTurns.add(turn);
      publish();
    },
    toggleAssistant(id) {
      if (collapsedAssistants.has(id)) collapsedAssistants.delete(id); else collapsedAssistants.add(id);
      publish();
    },
    recordId: trajectoryRecordId,
    destroy() { root.unmount(); },
  };
}
