import * as react from 'react';
import * as react_jsx_runtime from 'react/jsx-runtime';
import * as _deepseek_ai_dsh_client_ui_primitives from './primitives/index.js';
const TrajectoryToolbar_module_css_default = {
			"action": "fV0t5q_action",
			"actionIcon": "fV0t5q_actionIcon",
			"actions": "fV0t5q_actions",
			"control": "fV0t5q_control",
			"controlThumb": "fV0t5q_controlThumb",
			"controlTrack": "fV0t5q_controlTrack",
			"inner": "fV0t5q_inner",
			"root": "fV0t5q_root",
			"search": "fV0t5q_search",
			"searchIcon": "fV0t5q_searchIcon",
			"searchInput": "fV0t5q_searchInput",
			"toggle": "fV0t5q_toggle",
			"toggleIcon": "fV0t5q_toggleIcon"
		};
/**
		* Render the sticky trajectory toolbar.
		* @param props - rendered counts and whole-list fold state.
		* @returns the toolbar element.
		*/
		function TrajectoryToolbar({ actualDuration, onActualDurationChange, actualTime, onActualTimeChange, allTurnsCollapsed, onToggleAllTurns, allAssistantsCollapsed, onToggleAllAssistants, searchQuery, onSearchQueryChange, t }) {
			return (0, react_jsx_runtime.jsx)("div", {
				className: TrajectoryToolbar_module_css_default.root,
				role: "toolbar",
				"aria-label": t("toolbar.aria"),
				children: (0, react_jsx_runtime.jsxs)("div", {
					className: TrajectoryToolbar_module_css_default.inner,
					children: [(0, react_jsx_runtime.jsxs)("div", {
						className: TrajectoryToolbar_module_css_default.actions,
						children: [
							(0, react_jsx_runtime.jsxs)("button", {
								type: "button",
								className: TrajectoryToolbar_module_css_default.toggle,
								"aria-label": t("toolbar.useActualDuration"),
								"aria-pressed": actualDuration,
								title: actualDuration ? t("toolbar.useEqualWidth") : t("toolbar.useActualDuration"),
								onClick: () => {
									onActualDurationChange(!actualDuration);
								},
								children: [(0, react_jsx_runtime.jsxs)("svg", {
									className: TrajectoryToolbar_module_css_default.toggleIcon,
									viewBox: "0 0 16 16",
									fill: "none",
									"aria-hidden": "true",
									children: [(0, react_jsx_runtime.jsx)("circle", {
										cx: "8",
										cy: "8",
										r: "5.25"
									}), (0, react_jsx_runtime.jsx)("path", { d: "M8 4.75V8l2.25 1.5" })]
								}), t("toolbar.duration")]
							}),
							(0, react_jsx_runtime.jsxs)("button", {
								type: "button",
								className: TrajectoryToolbar_module_css_default.control,
								role: "switch",
								"aria-checked": actualTime,
								hidden: true,
								onClick: () => {
									onActualTimeChange(!actualTime);
								},
								children: [(0, react_jsx_runtime.jsx)("span", { children: t("toolbar.actualTime") }), (0, react_jsx_runtime.jsx)("span", {
									className: TrajectoryToolbar_module_css_default.controlTrack,
									"data-on": actualTime || void 0,
									"aria-hidden": "true",
									children: (0, react_jsx_runtime.jsx)("span", { className: TrajectoryToolbar_module_css_default.controlThumb })
								})]
							}),
							(0, react_jsx_runtime.jsxs)("button", {
								type: "button",
								className: TrajectoryToolbar_module_css_default.action,
								"aria-label": allTurnsCollapsed ? t("toolbar.expandTurns") : t("toolbar.collapseTurns"),
								"aria-pressed": allTurnsCollapsed,
								title: allTurnsCollapsed ? t("toolbar.expandTurns") : t("toolbar.collapseTurns"),
								onClick: onToggleAllTurns,
								children: [(0, react_jsx_runtime.jsx)("span", {
									className: TrajectoryToolbar_module_css_default.actionIcon,
									"aria-hidden": "true",
									children: allTurnsCollapsed ? "⊞" : "⊟"
								}), t("toolbar.turns")]
							}),
							(0, react_jsx_runtime.jsxs)("button", {
								type: "button",
								className: TrajectoryToolbar_module_css_default.action,
								"aria-label": allAssistantsCollapsed ? t("toolbar.expandCalls") : t("toolbar.collapseCalls"),
								"aria-pressed": allAssistantsCollapsed,
								title: allAssistantsCollapsed ? t("toolbar.expandCalls") : t("toolbar.collapseCalls"),
								onClick: onToggleAllAssistants,
								children: [(0, react_jsx_runtime.jsx)("span", {
									className: TrajectoryToolbar_module_css_default.actionIcon,
									"aria-hidden": "true",
									children: allAssistantsCollapsed ? "⊞" : "⊟"
								}), t("toolbar.calls")]
							})
						]
					}), (0, react_jsx_runtime.jsxs)("div", {
						className: TrajectoryToolbar_module_css_default.search,
						children: [(0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconSearchOutline16, {
							size: 11,
							className: TrajectoryToolbar_module_css_default.searchIcon
						}), (0, react_jsx_runtime.jsx)("input", {
							type: "search",
							className: TrajectoryToolbar_module_css_default.searchInput,
							"aria-label": t("toolbar.search"),
							placeholder: t("toolbar.searchPlaceholder"),
							value: searchQuery,
							onChange: (event) => {
								onSearchQueryChange(event.currentTarget.value);
							}
						})]
					})]
				})
			});
		}
export { TrajectoryToolbar };
